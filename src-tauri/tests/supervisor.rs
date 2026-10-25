#![cfg(feature = "test-harness")]
use ramble_lib::process::{execute, ExecutionPlan, ProcessError};
use std::{collections::BTreeMap, path::PathBuf, time::Duration};
use tokio_util::sync::CancellationToken;

fn request() -> ramble_lib::build::BuildRequest {
    ramble_lib::build::BuildRequest {
        run_id: uuid::Uuid::new_v4().to_string(),
        draft_id: uuid::Uuid::new_v4().to_string(),
        source: vec!["Literal source".into()],
        style: "".into(),
        preset_id: "default-opencode".into(),
        expected_settings_revision: 0,
        revision: None,
    }
}

fn plan(mode: &str) -> ExecutionPlan {
    ExecutionPlan {
        executable: PathBuf::from(env!("CARGO_BIN_EXE_fake-harness")),
        args: vec![mode.into()],
        stdin: Vec::new(),
        environment: BTreeMap::new(),
        timeout: Duration::from_secs(5),
        stdout_limit: 8 * 1024 * 1024,
        stderr_limit: 1024 * 1024,
    }
}

// Raw process-fidelity fixture decoding is test-only, not a production parser.
fn parse_fixture_output(bytes: &[u8]) -> Result<String, serde_json::Error> {
    let value: serde_json::Value = serde_json::from_slice(bytes)?;
    Ok(value["text"].as_str().unwrap().into())
}

#[tokio::test]
async fn stdin_and_argv_preserve_literal_text_without_a_shell() {
    let text = "  🦊 日本語\n\"quotes\" 'single' $(touch nope) ; & | </notes> {{prompt}}  ";
    for mode in ["echo-stdin", "echo-arg"] {
        let mut p = plan(mode);
        if mode == "echo-stdin" {
            p.stdin = text.as_bytes().to_vec();
        } else {
            p.args.push(text.into());
        }
        let output = execute(p, CancellationToken::new()).await.unwrap();
        assert_eq!(parse_fixture_output(&output.stdout).unwrap(), text);
    }
}

#[tokio::test]
async fn long_stdin_and_concurrent_pipe_limits() {
    let text = "🦊'\"\n".repeat(20000);
    let mut p = plan("echo-stdin");
    p.stdin = text.as_bytes().to_vec();
    let output = execute(p, CancellationToken::new()).await.unwrap();
    assert_eq!(parse_fixture_output(&output.stdout).unwrap(), text);
    let mut p = plan("flood");
    p.stdout_limit = 32768;
    p.stderr_limit = 32768;
    assert_eq!(
        execute(p, CancellationToken::new()).await.err(),
        Some(ProcessError::OutputLimitExceeded)
    );
}

#[tokio::test]
async fn cancellation_and_timeout_cleanup_are_bounded() {
    let cancel = CancellationToken::new();
    let trigger = cancel.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(100)).await;
        trigger.cancel();
    });
    assert_eq!(
        execute(plan("child"), cancel).await.err(),
        Some(ProcessError::Cancelled)
    );
    let mut p = plan("hang");
    p.timeout = Duration::from_millis(100);
    assert_eq!(
        execute(p, CancellationToken::new()).await.err(),
        Some(ProcessError::TimedOut)
    );
}

#[tokio::test]
async fn failures_and_invalid_protocol_do_not_become_messages() {
    assert_eq!(
        execute(plan("fail"), CancellationToken::new()).await.err(),
        Some(ProcessError::ProcessFailed)
    );
    for mode in ["malformed", "empty"] {
        let output = execute(plan(mode), CancellationToken::new()).await.unwrap();
        assert!(parse_fixture_output(&output.stdout).is_err());
    }
    let mut p = plan("echo-arg");
    p.args.push("x".repeat(40000));
    assert_eq!(
        execute(p, CancellationToken::new()).await.err(),
        Some(ProcessError::InputTooLarge)
    );
}

#[tokio::test]
async fn coordinator_excludes_overlap_joins_shutdown_and_retains_terminal() {
    use ramble_lib::{coordinator::Coordinator, settings::Settings};
    let c = Coordinator::default();
    let worker = c.clone();
    let r = request();
    let id = r.run_id.clone();
    let running = tokio::spawn(async move {
        worker
            .build_fixture(r, Settings::default(), plan("hang"))
            .await
            .unwrap()
    });
    tokio::time::timeout(Duration::from_secs(2), async {
        while c.status().unwrap().active_run.is_none() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert!(c.build(request(), Settings::default()).await.is_err());
    c.cancel("a stale run").unwrap();
    assert!(c.status().unwrap().active_run.is_some());
    c.shutdown().await;
    let outcome = running.await.unwrap();
    assert_eq!(outcome.kind, "cancelled");
    assert_eq!(outcome.run_id, id);
    let status = c.status().unwrap();
    assert!(status.active_run.is_none());
    assert_eq!(status.terminal.unwrap().kind, "cancelled");
}

#[tokio::test]
async fn coordinator_survives_dropped_listener_and_extracts_exact_final() {
    use ramble_lib::{coordinator::Coordinator, settings::Settings};
    let c = Coordinator::default();
    let worker = c.clone();
    let mut p = plan("plain-arg");
    let r = request();
    p.args
        .push(serde_json::json!({"ramble_response":"  final 🦊\n```literal```  "}).to_string());
    let id = r.run_id.clone();
    let listener =
        tokio::spawn(async move { worker.build_fixture(r, Settings::default(), p).await });
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            let s = c.status().unwrap();
            if s.active_run.is_some() || s.terminal.is_some() {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    listener.abort();
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            if c.status().unwrap().terminal.is_some() {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let outcome = c.status().unwrap().terminal.unwrap();
    assert_eq!(outcome.run_id, id);
    assert_eq!(outcome.text.as_deref(), Some("  final 🦊\n```literal```  "));
}

#[cfg(unix)]
#[tokio::test]
async fn owned_descendants_are_gone_after_cancel_and_normal_parent_exit() {
    for mode in ["child", "orphan"] {
        let dir = tempfile::tempdir().unwrap();
        let marker = dir.path().join("child.pid");
        let mut p = plan(mode);
        p.environment.insert(
            "RAMBLE_TEST_CHILD_MARKER".into(),
            marker.to_string_lossy().into_owned(),
        );
        let cancel = CancellationToken::new();
        let trigger = cancel.clone();
        let running = tokio::spawn(execute(p, cancel));
        let pid = tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                if let Ok(text) = std::fs::read_to_string(&marker) {
                    if let Ok(pid) = text.parse::<i32>() {
                        break pid;
                    }
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        if mode == "child" {
            trigger.cancel();
        }
        let outcome = running.await.unwrap();
        if mode == "child" {
            assert_eq!(outcome.err(), Some(ProcessError::Cancelled));
        } else {
            assert!(outcome.is_ok());
        }
        tokio::time::timeout(Duration::from_secs(2), async {
            // Signal zero only observes the owned synthetic PID; it does not kill anything.
            while unsafe { libc::kill(pid, 0) } == 0 {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("owned descendant survived cleanup");
    }
}

#[tokio::test]
async fn normal_build_path_launches_a_saved_custom_template_without_a_model() {
    use ramble_lib::{
        coordinator::Coordinator,
        settings::{Parameters, Preset, Settings},
        templates::quote_literal,
    };
    let mut settings = Settings::default();
    let mut template = settings.templates[0].clone();
    template.id = "custom-fixture".into();
    template.name = "Any CLI".into();
    template.command = format!(
        "{} response-stdin",
        quote_literal(env!("CARGO_BIN_EXE_fake-harness"))
    );
    template.prompt_transport = "stdin".into();
    settings.templates.push(template);
    settings.presets.push(Preset {
        id: "custom".into(),
        name: "Custom".into(),
        template_id: "custom-fixture".into(),
        template_version: 1,
        parameters: Parameters::default(),
    });
    let mut request = request();
    request.preset_id = "custom".into();
    request.source[0] = "Literal 🦊 \"quotes\" $(touch nope)\nline two".into();
    let expected = ramble_lib::build::prompt(&request).unwrap();
    {
        let preview = ramble_lib::harness::preview(&settings, &request).unwrap();
        assert_eq!(preview.stdin, expected);
        assert!(preview.command.contains("response-stdin"));
        let mut stale = request.clone();
        stale.expected_settings_revision += 1;
        assert!(ramble_lib::harness::preview(&settings, &stale).is_err());
    }
    let outcome = Coordinator::default()
        .build(request.clone(), settings.clone())
        .await
        .unwrap();
    assert_eq!(outcome.kind, "succeeded");
    assert_eq!(outcome.text.as_deref(), Some(expected.as_str()));
    let template = settings.templates.last_mut().unwrap();
    template.prompt_transport = "argument".into();
    template.command = format!(
        "{} response-arg {{{{PROMPT}}}}",
        quote_literal(env!("CARGO_BIN_EXE_fake-harness"))
    );
    request.run_id = uuid::Uuid::new_v4().to_string();
    let expected = ramble_lib::build::prompt(&request).unwrap();
    {
        let preview = ramble_lib::harness::preview(&settings, &request).unwrap();
        assert!(preview.stdin.is_empty());
        let execution =
            ramble_lib::harness::compile(&settings, &request, expected.clone()).unwrap();
        assert_eq!(
            preview.command,
            ramble_lib::harness::terminal_command(
                &execution.executable.to_string_lossy(),
                &execution.args
            )
        );
    }
    let outcome = Coordinator::default()
        .build(request, settings)
        .await
        .unwrap();
    assert_eq!(outcome.kind, "succeeded");
    assert_eq!(outcome.text.as_deref(), Some(expected.as_str()));
}

#[tokio::test]
async fn generic_response_build_path_accepts_only_successful_matching_json() {
    use ramble_lib::{coordinator::Coordinator, settings::Settings, templates::quote_literal};
    for mode in [
        "response-noisy",
        "response-enveloped",
        "response-duplicate",
        "response-conflict",
        "response-wrong-key",
        "response-fail",
        "response-truncated",
        "response-stderr-only",
        "response-echo-prompt",
    ] {
        let mut settings = Settings::default();
        settings.templates[0].command = format!(
            "{} {mode} {{{{PROMPT}}}}",
            quote_literal(env!("CARGO_BIN_EXE_fake-harness"))
        );
        let outcome = Coordinator::default()
            .build(request(), settings)
            .await
            .unwrap();
        if matches!(
            mode,
            "response-noisy" | "response-enveloped" | "response-duplicate"
        ) {
            assert_eq!(outcome.kind, "succeeded");
            assert_eq!(
                outcome.text.as_deref(),
                Some("The draft is ready.\nPlease review it.")
            );
        } else {
            assert_eq!(outcome.kind, "failed");
            assert!(outcome.text.is_none());
            assert_eq!(
                outcome.code.as_deref(),
                Some(if mode == "response-fail" {
                    "ProcessFailed"
                } else {
                    "ProtocolError"
                })
            );
        }
    }
    for cancel in [false, true] {
        let mut p = plan("response-hang");
        p.timeout = if cancel {
            Duration::from_secs(5)
        } else {
            Duration::from_millis(150)
        };
        let coordinator = Coordinator::default();
        let request = request();
        p.args.push(ramble_lib::build::prompt(&request).unwrap());
        if cancel {
            let trigger = coordinator.clone();
            let run_id = request.run_id.clone();
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_millis(50)).await;
                trigger.cancel(&run_id).unwrap();
            });
        }
        let outcome = coordinator
            .build_fixture(request, Settings::default(), p)
            .await
            .unwrap();
        assert_eq!(outcome.kind, if cancel { "cancelled" } else { "timedOut" });
        assert!(outcome.text.is_none());
    }
}

#[tokio::test]
async fn abandoning_a_run_cancels_and_joins_owned_work_without_shutting_down() {
    use ramble_lib::{coordinator::Coordinator, settings::Settings};
    let c = Coordinator::default();
    let worker = c.clone();
    let r = request();
    let id = r.run_id.clone();
    let task = tokio::spawn(async move {
        worker
            .build_fixture(r, Settings::default(), plan("child"))
            .await
            .unwrap()
    });
    tokio::time::timeout(Duration::from_secs(2), async {
        while c.status().unwrap().active_run.is_none() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    c.abandon(&id).unwrap();
    let outcome = task.await.unwrap();
    assert_eq!(outcome.kind, "cancelled");
    assert!(c.status().unwrap().active_run.is_none());
    assert!(c.status().unwrap().terminal.is_none());
    assert!(c.take_harness_output(&id).is_err());
    let mut p = plan("plain-arg");
    p.args
        .push(serde_json::json!({"ramble_response":"Fresh result"}).to_string());
    assert_eq!(
        c.build_fixture(request(), Settings::default(), p)
            .await
            .unwrap()
            .kind,
        "succeeded"
    );
}

#[tokio::test]
async fn abandoning_before_start_blocks_late_launch_and_discards_completed_failure_output() {
    use ramble_lib::{coordinator::Coordinator, settings::Settings};
    let c = Coordinator::default();
    let old = request();
    c.abandon(&old.run_id).unwrap();
    // This would hang if the abandoned invocation were actually launched.
    assert!(c
        .build_fixture(old, Settings::default(), plan("hang"))
        .await
        .err()
        .unwrap()
        .starts_with("BuildAbandoned:"));
    assert!(c.status().unwrap().active_run.is_none());
    let r = request();
    let id = r.run_id.clone();
    let failed = c
        .build_fixture(r, Settings::default(), plan("fail"))
        .await
        .unwrap();
    assert!(failed.diagnostics_available);
    c.abandon(&id).unwrap();
    assert!(c.status().unwrap().terminal.is_none());
    assert!(c.take_harness_output(&id).is_err());
    assert!(c.abandon("invalid").is_err());
}

#[tokio::test]
async fn failed_output_is_private_consumed_once_and_cleared_on_dismissal_next_build_or_quit() {
    use ramble_lib::{coordinator::Coordinator, settings::Settings, templates::quote_literal};
    let mut settings = Settings::default();
    settings.templates[0].command = format!(
        "{} response-fail {{{{PROMPT}}}}",
        quote_literal(env!("CARGO_BIN_EXE_fake-harness"))
    );
    let c = Coordinator::default();
    let r = request();
    let id = r.run_id.clone();
    let outcome = c.build(r, settings.clone()).await.unwrap();
    assert!(outcome.diagnostics_available);
    assert!(outcome.text.is_none());
    assert!(!serde_json::to_string(&outcome)
        .unwrap()
        .contains("synthetic private failure detail"));
    assert!(!serde_json::to_string(&c.status().unwrap())
        .unwrap()
        .contains("synthetic private failure detail"));
    assert!(c.take_harness_output("stale-run").is_err());
    let output = c.take_harness_output(&id).unwrap();
    assert!(output.stdout.contains("ramble_response"));
    assert!(output.stderr.contains("synthetic private failure detail"));
    assert!(c.take_harness_output(&id).is_err());

    let r = request();
    let id = r.run_id.clone();
    c.build(r, settings.clone()).await.unwrap();
    c.discard_harness_output(&id).unwrap();
    assert!(c.take_harness_output(&id).is_err());
    let r = request();
    let old_id = r.run_id.clone();
    c.build(r, settings.clone()).await.unwrap();
    settings.templates[0].command = format!(
        "{} response-noisy {{{{PROMPT}}}}",
        quote_literal(env!("CARGO_BIN_EXE_fake-harness"))
    );
    assert_eq!(
        c.build(request(), settings.clone()).await.unwrap().kind,
        "succeeded"
    );
    assert!(c.take_harness_output(&old_id).is_err());
    settings.templates[0].command = format!(
        "{} response-fail {{{{PROMPT}}}}",
        quote_literal(env!("CARGO_BIN_EXE_fake-harness"))
    );
    let r = request();
    let id = r.run_id.clone();
    c.build(r, settings).await.unwrap();
    c.shutdown().await;
    assert!(c.take_harness_output(&id).is_err());
}

#[cfg(unix)]
#[test]
fn diagnostic_terminal_command_roundtrips_literal_arguments_without_expansion() {
    // Execute only the offline fake binary through a shell to test the displayed
    // replay string, never a model CLI. Ramble itself still launches without a shell.
    let directory = tempfile::tempdir().unwrap();
    let executable = directory.path().join("fake writer's executable");
    std::fs::copy(env!("CARGO_BIN_EXE_fake-harness"), &executable).unwrap();
    let prompt = "  {\"source\":[\"it isn't a secret\"],\"literal\":\"{{MODEL_ID}}\"}\n🦊 $HOME $(exit 23) `exit 24` ; & | < > \\path\\  ";
    let args = vec!["echo-arg".into(), prompt.into()];
    let command = ramble_lib::harness::terminal_command(executable.to_str().unwrap(), &args);
    assert!(command.contains("{\"source\":[\""));
    assert!(!command.contains("\\{"));
    assert!(!command.contains("\\["));
    let shells = if cfg!(target_os = "macos") {
        vec!["/bin/sh", "/bin/zsh"]
    } else {
        vec!["/bin/sh"]
    };
    for shell in shells {
        let output = std::process::Command::new(shell)
            .args(["-c", &command])
            .output()
            .unwrap();
        assert!(output.status.success());
        assert_eq!(parse_fixture_output(&output.stdout).unwrap(), prompt);
    }
    assert_eq!(
        ramble_lib::harness::terminal_command("writer", &["".into()]),
        "'writer' ''"
    );
}
