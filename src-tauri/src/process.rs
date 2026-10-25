//! Native-only supervisor. No webview command accepts an ExecutionPlan.
use process_wrap::tokio::*;
use std::{
    collections::BTreeMap,
    path::PathBuf,
    process::Stdio,
    time::{Duration, Instant},
};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio_util::sync::CancellationToken;

pub struct ExecutionPlan {
    pub executable: PathBuf,
    pub args: Vec<String>,
    pub stdin: Vec<u8>,
    /// Native runtime environment, never supplied by the webview or saved to disk.
    pub environment: BTreeMap<String, String>,
    pub timeout: Duration,
    pub stdout_limit: usize,
    pub stderr_limit: usize,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ProcessError {
    ExecutableMissing,
    UnsupportedLauncher,
    InputTooLarge,
    SpawnFailed,
    Cancelled,
    TimedOut,
    OutputLimitExceeded,
    PipeFailed,
    ProcessFailed,
    CleanupFailed,
}

pub struct ProcessOutput {
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub exit_success: bool,
    pub duration: Duration,
}

async fn read_bounded(
    mut pipe: impl AsyncRead + Unpin,
    limit: usize,
    failure: tokio::sync::mpsc::Sender<ProcessError>,
) -> Result<Vec<u8>, ProcessError> {
    let mut output = Vec::new();
    let mut buffer = [0u8; 8192];
    loop {
        let size = match pipe.read(&mut buffer).await {
            Ok(size) => size,
            Err(_) => {
                let _ = failure.send(ProcessError::PipeFailed).await;
                return Err(ProcessError::PipeFailed);
            }
        };
        if size == 0 {
            return Ok(output);
        }
        if output.len() + size > limit {
            let _ = failure.send(ProcessError::OutputLimitExceeded).await;
            return Err(ProcessError::OutputLimitExceeded);
        }
        output.extend_from_slice(&buffer[..size]);
    }
}

pub async fn execute(
    plan: ExecutionPlan,
    cancel: CancellationToken,
) -> Result<ProcessOutput, ProcessError> {
    let output = execute_captured(plan, cancel).await?;
    if !output.exit_success {
        return Err(ProcessError::ProcessFailed);
    }
    Ok(output)
}

/// Captured output is private, bounded, and used only for opt-in failure diagnostics.
pub async fn execute_captured(
    plan: ExecutionPlan,
    cancel: CancellationToken,
) -> Result<ProcessOutput, ProcessError> {
    if cancel.is_cancelled() {
        return Err(ProcessError::Cancelled);
    }
    if !plan.executable.is_absolute() || !plan.executable.is_file() {
        return Err(ProcessError::ExecutableMissing);
    }
    if plan.stdin.len() > crate::build::PROMPT_LIMIT {
        return Err(ProcessError::InputTooLarge);
    }
    if crate::templates::check_argument_budget(&plan.executable.to_string_lossy(), &plan.args)
        .is_err()
    {
        return Err(ProcessError::InputTooLarge);
    }
    #[cfg(windows)]
    if !plan
        .executable
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("exe") || e.eq_ignore_ascii_case("com"))
    {
        return Err(ProcessError::UnsupportedLauncher);
    }
    let started = Instant::now();
    // No source, prompt, or model output is ever written into this directory.
    let neutral = tempfile::Builder::new()
        .prefix("ramble-run-")
        .tempdir()
        .map_err(|_| ProcessError::SpawnFailed)?;
    let mut command = CommandWrap::with_new(&plan.executable, |c| {
        c.args(&plan.args)
            .current_dir(neutral.path())
            .env_clear()
            .envs(&plan.environment)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
    });
    command.wrap(KillOnDrop);
    #[cfg(unix)]
    command.wrap(ProcessGroup::leader());
    #[cfg(windows)]
    {
        // process-wrap creates suspended, assigns the Job Object, then resumes.
        // Assignment failure is a spawn error, not an uncontained fallback.
        command.wrap(CreationFlags(0x08000000)); // CREATE_NO_WINDOW
        command.wrap(JobObject);
    }
    let mut child = command.spawn().map_err(|_| ProcessError::SpawnFailed)?;
    drop(command);
    let mut stdin = child.stdin().take().ok_or(ProcessError::PipeFailed)?;
    let stdout = child.stdout().take().ok_or(ProcessError::PipeFailed)?;
    let stderr = child.stderr().take().ok_or(ProcessError::PipeFailed)?;
    let (failure_tx, mut failure_rx) = tokio::sync::mpsc::channel(3);
    let mut out_task = tokio::spawn(read_bounded(stdout, plan.stdout_limit, failure_tx.clone()));
    let mut err_task = tokio::spawn(read_bounded(stderr, plan.stderr_limit, failure_tx.clone()));
    let mut in_task = tokio::spawn(async move {
        let result = stdin.write_all(&plan.stdin).await;
        if result.is_err() {
            let _ = failure_tx.send(ProcessError::PipeFailed).await;
        }
        drop(stdin); // Close input even when the harness does not consume it.
        result.map_err(|_| ProcessError::PipeFailed)
    });
    let terminal = tokio::select! {
        biased;
        _ = cancel.cancelled() => Err(ProcessError::Cancelled),
        _ = tokio::time::sleep(plan.timeout) => Err(ProcessError::TimedOut),
        Some(error) = failure_rx.recv() => Err(error),
        status = child.wait() => status.map_err(|_| ProcessError::ProcessFailed).map(|s| s.success()),
    };
    // Normal exits clean up owned helpers too. Never signal a shared harness service.
    #[cfg(unix)]
    {
        let _ = child.signal(libc::SIGTERM);
        if terminal.is_err() {
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }
    let _ = child.start_kill();
    let cleanup = tokio::time::timeout(Duration::from_secs(3), child.wait()).await;
    drop(child); // Closing the Windows job kills all remaining job members.
    let pipes = tokio::time::timeout(Duration::from_secs(3), async {
        let (input, output, diagnostics) = tokio::join!(&mut in_task, &mut out_task, &mut err_task);
        input.map_err(|_| ProcessError::PipeFailed)??;
        let stdout = output.map_err(|_| ProcessError::PipeFailed)??;
        let stderr = diagnostics.map_err(|_| ProcessError::PipeFailed)??;
        Ok::<_, ProcessError>((stdout, stderr))
    })
    .await;
    if pipes.is_err() {
        // An escaped helper must not leave detached IO tasks holding private buffers.
        in_task.abort();
        out_task.abort();
        err_task.abort();
        let _ = tokio::join!(in_task, out_task, err_task);
    }
    // First accepted terminal cause wins. Pipe failures can still invalidate a zero exit.
    let exit_success = terminal?;
    cleanup
        .map_err(|_| ProcessError::CleanupFailed)?
        .map_err(|_| ProcessError::CleanupFailed)?;
    let (stdout, stderr) = pipes.map_err(|_| ProcessError::CleanupFailed)??;
    Ok(ProcessOutput {
        stdout,
        stderr,
        exit_success,
        duration: started.elapsed(),
    })
}
