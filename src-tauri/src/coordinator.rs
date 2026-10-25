//! A single native owner arbitrates terminal transitions and joins cleanup on shutdown.
use crate::{
    build::{self, BuildOutcome, BuildRequest},
    diagnostics::HarnessOutput,
    harness,
    process::{self, ExecutionPlan, ProcessError},
    settings::Settings,
};
use serde::Serialize;
use std::{
    sync::{Arc, Mutex},
    time::Instant,
};
use tokio::sync::{oneshot, Notify};
use tokio_util::sync::CancellationToken;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveRun {
    pub run_id: String,
    pub draft_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunStatus {
    pub active_run: Option<ActiveRun>,
    pub terminal: Option<BuildOutcome>,
}

struct Active {
    descriptor: ActiveRun,
    cancel: CancellationToken,
}
#[derive(Default)]
struct State {
    active: Option<Active>,
    terminal: Option<BuildOutcome>,
    diagnostics: Option<HarnessOutput>,
    // One in-flight build can be abandoned. Remember its ID even if its start IPC
    // arrives late; the UI joins that request before enabling another generation.
    abandoned_run: Option<String>,
    closing: bool,
}
#[derive(Default)]
struct Inner {
    state: Mutex<State>,
    done: Notify,
}
#[derive(Clone, Default)]
pub struct Coordinator {
    inner: Arc<Inner>,
}

impl Coordinator {
    /// Explicit offline-test feature only; there is deliberately no corresponding IPC.
    #[cfg(feature = "test-harness")]
    pub async fn build_fixture(
        &self,
        request: BuildRequest,
        settings: Settings,
        plan: ExecutionPlan,
    ) -> Result<BuildOutcome, String> {
        self.start(request, settings, Ok(plan)).await
    }
    pub async fn build(
        &self,
        request: BuildRequest,
        settings: Settings,
    ) -> Result<BuildOutcome, String> {
        let plan = if settings.revision != request.expected_settings_revision {
            Err("SettingsConflict: settings changed. Reopen Settings and retry.".into())
        } else {
            build::prompt(&request).and_then(|prompt| harness::compile(&settings, &request, prompt))
        };
        self.start(request, settings, plan).await
    }

    async fn start(
        &self,
        request: BuildRequest,
        settings: Settings,
        plan: Result<ExecutionPlan, String>,
    ) -> Result<BuildOutcome, String> {
        let cancel = CancellationToken::new();
        {
            let mut state = self
                .inner
                .state
                .lock()
                .map_err(|_| "Build service unavailable.")?;
            if state.closing {
                return Err("Ramble is shutting down.".into());
            }
            if state.abandoned_run.as_deref() == Some(&request.run_id) {
                return Err("BuildAbandoned: this draft was replaced before launch.".into());
            }
            if state.active.is_some() {
                return Err("A build is already running. Wait for cleanup before retrying.".into());
            }
            state.terminal = None;
            state.diagnostics = None;
            state.active = Some(Active {
                descriptor: ActiveRun {
                    run_id: request.run_id.clone(),
                    draft_id: request.draft_id.clone(),
                },
                cancel: cancel.clone(),
            });
        }
        let inner = self.inner.clone();
        let (sender, receiver) = oneshot::channel();
        // The owner task survives an IPC listener disconnect and keeps supervising its child.
        tokio::spawn(async move {
            let start = Instant::now();
            let mut diagnostics = None;
            let validated = if settings.revision != request.expected_settings_revision {
                Err("SettingsConflict: settings changed. Reopen Settings and retry.".to_string())
            } else {
                build::prompt(&request).map(|_| ())
            };
            let result = match validated.and(plan) {
                Err(message) => Err(("failed", message)),
                Ok(plan) => match process::execute_captured(plan, cancel).await {
                    Ok(output) => {
                        let parsed = if output.exit_success {
                            crate::response::extract(&output.stdout)
                        } else {
                            Err("ProcessFailed: the harness exited unsuccessfully. Check its installation/authentication or inspect its output.".into())
                        };
                        if parsed.is_err() {
                            diagnostics = Some(HarnessOutput::capture(
                                &request.run_id,
                                &output.stdout,
                                &output.stderr,
                            ));
                        }
                        parsed.map_err(|message| ("failed", message))
                    }
                    Err(error) => {
                        let kind = match error {
                            ProcessError::Cancelled => "cancelled",
                            ProcessError::TimedOut => "timedOut",
                            _ => "failed",
                        };
                        Err((kind, format!("{error:?}: {}", match error {
                            ProcessError::Cancelled => "Build cancelled. Your last successful message is unchanged.",
                            ProcessError::TimedOut => "Build timed out. Check the harness or increase the timeout in Settings.",
                            ProcessError::ExecutableMissing => "Executable not found. Set an explicit executable path in a preset.",
                            ProcessError::OutputLimitExceeded => "The harness exceeded an output limit. No output was accepted.",
                            _ => "The harness could not complete safely. Check its installation and authentication outside Ramble, then retry.",
                        })))
                    }
                },
            };
            let (kind, text, code, message) = match result {
                Ok(text) => ("succeeded", Some(text), None, None),
                Err((kind, message)) => {
                    let code = message
                        .split(':')
                        .next()
                        .unwrap_or("BuildFailed")
                        .to_string();
                    (kind, None, Some(code), Some(message))
                }
            };
            let outcome = BuildOutcome {
                run_id: request.run_id,
                draft_id: request.draft_id,
                kind: kind.into(),
                text,
                code,
                message,
                duration_ms: start.elapsed().as_millis() as u64,
                diagnostics_available: diagnostics.is_some(),
            };
            {
                let mut state = inner.state.lock().unwrap_or_else(|e| e.into_inner());
                state.active = None;
                if state.abandoned_run.as_deref() == Some(&outcome.run_id) {
                    state.terminal = None;
                    state.diagnostics = None;
                } else {
                    state.terminal = Some(outcome.clone());
                    state.diagnostics = if state.closing { None } else { diagnostics };
                }
            }
            inner.done.notify_waiters();
            let _ = sender.send(outcome);
        });
        receiver
            .await
            .map_err(|_| "Build service disconnected after cleanup.".into())
    }

    pub fn cancel(&self, run_id: &str) -> Result<(), String> {
        let state = self
            .inner
            .state
            .lock()
            .map_err(|_| "Build service unavailable.")?;
        if let Some(active) = &state.active {
            if active.descriptor.run_id == run_id {
                active.cancel.cancel();
            }
        }
        Ok(())
    }

    /// New-draft intent: cancel this run and forget its output, including a start
    /// request still queued in IPC. Does not shut down or affect another run.
    pub fn abandon(&self, run_id: &str) -> Result<(), String> {
        if uuid::Uuid::parse_str(run_id).is_err() {
            return Err("Invalid run identity.".into());
        }
        let mut state = self
            .inner
            .state
            .lock()
            .map_err(|_| "Build service unavailable.")?;
        state.abandoned_run = Some(run_id.into());
        if let Some(active) = &state.active {
            if active.descriptor.run_id == run_id {
                active.cancel.cancel();
            }
        }
        if state
            .terminal
            .as_ref()
            .is_some_and(|outcome| outcome.run_id == run_id)
        {
            state.terminal = None;
        }
        if state
            .diagnostics
            .as_ref()
            .is_some_and(|output| output.run_id == run_id)
        {
            state.diagnostics = None;
        }
        Ok(())
    }

    /// The only raw-output read path. Called after explicit UI consent; consume once.
    pub fn take_harness_output(&self, run_id: &str) -> Result<HarnessOutput, String> {
        let mut state = self
            .inner
            .state
            .lock()
            .map_err(|_| "Build service unavailable.")?;
        if state
            .diagnostics
            .as_ref()
            .is_none_or(|output| output.run_id != run_id)
        {
            return Err("Harness output is no longer available for this build.".into());
        }
        Ok(state.diagnostics.take().unwrap())
    }

    pub fn discard_harness_output(&self, run_id: &str) -> Result<(), String> {
        let mut state = self
            .inner
            .state
            .lock()
            .map_err(|_| "Build service unavailable.")?;
        if state
            .diagnostics
            .as_ref()
            .is_some_and(|output| output.run_id == run_id)
        {
            state.diagnostics = None;
        }
        Ok(())
    }

    pub fn status(&self) -> Result<RunStatus, String> {
        let state = self
            .inner
            .state
            .lock()
            .map_err(|_| "Build service unavailable.")?;
        Ok(RunStatus {
            active_run: state.active.as_ref().map(|a| a.descriptor.clone()),
            terminal: state.terminal.clone(),
        })
    }

    pub async fn shutdown(&self) {
        loop {
            let notified = self.inner.done.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            {
                let mut state = self.inner.state.lock().unwrap_or_else(|e| e.into_inner());
                state.closing = true;
                state.diagnostics = None;
                match &state.active {
                    Some(active) => active.cancel.cancel(),
                    None => return,
                }
            }
            notified.await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request() -> BuildRequest {
        BuildRequest {
            run_id: uuid::Uuid::new_v4().to_string(),
            draft_id: uuid::Uuid::new_v4().to_string(),
            source: vec!["A thought".into()],
            style: "".into(),
            preset_id: "default-opencode".into(),
            expected_settings_revision: 0,
            revision: None,
        }
    }
    #[tokio::test]
    async fn missing_executable_and_revision_conflict_have_recoverable_outcomes() {
        let c = Coordinator::default();
        let r = request();
        let id = r.run_id.clone();
        let mut settings = Settings::default();
        settings.presets[0].parameters.executable = Some("/nonexistent/ramble-fixture-cli".into());
        let result = c.build(r, settings).await.unwrap();
        assert_eq!(result.code.as_deref(), Some("ExecutableMissing"));
        let status = c.status().unwrap();
        assert!(status.active_run.is_none());
        assert_eq!(status.terminal.unwrap().run_id, id);
        let mut r = request();
        r.expected_settings_revision = 10;
        assert_eq!(
            c.build(r, Settings::default())
                .await
                .unwrap()
                .code
                .as_deref(),
            Some("SettingsConflict")
        );
    }
    #[tokio::test]
    async fn shutdown_prevents_later_builds_and_late_cancel_is_harmless() {
        let c = Coordinator::default();
        c.cancel("wrong").unwrap();
        c.shutdown().await;
        assert!(c.build(request(), Settings::default()).await.is_err());
    }
}
