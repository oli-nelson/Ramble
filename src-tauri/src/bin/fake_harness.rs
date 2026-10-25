//! Offline fixtures only: never bundled in a production desktop build.
use std::{
    io::{Read, Write},
    time::Duration,
};

fn main() {
    let mut args = std::env::args().skip(1);
    match args.next().as_deref() {
        Some(mode @ ("echo-stdin" | "plain-stdin")) => {
            let mut input = String::new();
            std::io::stdin().read_to_string(&mut input).unwrap();
            if mode == "plain-stdin" {
                print!("{input}");
            } else {
                print!("{}", serde_json::json!({"kind":"final", "text": input}));
            }
        }
        Some("echo-arg") => print!(
            "{}",
            serde_json::json!({"kind":"final", "text": args.next().unwrap()})
        ),
        Some("plain-arg") => print!("{}", args.next().unwrap()),
        Some(
            mode @ ("response-stdin"
            | "response-arg"
            | "response-noisy"
            | "response-enveloped"
            | "response-duplicate"
            | "response-conflict"
            | "response-wrong-key"
            | "response-fail"
            | "response-truncated"
            | "response-hang"
            | "response-stderr-only"
            | "response-echo-prompt"),
        ) => {
            let prompt = if mode == "response-stdin" {
                let mut text = String::new();
                std::io::stdin().read_to_string(&mut text).unwrap();
                text
            } else {
                args.next().unwrap()
            };
            let _: serde_json::Value =
                serde_json::from_str(prompt.strip_prefix(ramble_lib::build::PREAMBLE).unwrap())
                    .unwrap();
            let message = if matches!(mode, "response-stdin" | "response-arg") {
                prompt.as_str()
            } else {
                "The draft is ready.\nPlease review it."
            };
            let output = if mode == "response-wrong-key" {
                serde_json::json!({"message":message})
            } else {
                serde_json::json!({"ramble_response":message})
            }
            .to_string();
            match mode {
                "response-truncated" => print!("{}", output.strip_suffix('}').unwrap()),
                "response-noisy" => println!("startup log\n```json\n{output}\n```\nfinished"),
                "response-enveloped" => println!(
                    "{}",
                    serde_json::json!({"arbitrary":{"nested":[{"body": output}]}})
                ),
                "response-duplicate" => println!("{output}\n{output}"),
                "response-conflict" => println!(
                    "{output}\n{}",
                    serde_json::json!({"ramble_response":"a conflicting answer"})
                ),
                "response-stderr-only" => {
                    eprintln!("{output}");
                    println!("no matching stdout");
                }
                "response-echo-prompt" => print!("{prompt}"),
                _ => print!("{output}"),
            }
            std::io::stdout().flush().unwrap();
            if mode == "response-fail" {
                eprintln!("synthetic private failure detail");
                std::process::exit(17);
            }
            if mode == "response-hang" {
                std::thread::sleep(Duration::from_secs(60));
            }
        }
        Some("flood") => {
            for _ in 0..2048 {
                std::io::stdout().write_all(&[b'x'; 8192]).unwrap();
                std::io::stderr().write_all(&[b'e'; 8192]).unwrap();
            }
        }
        Some("hang") => std::thread::sleep(Duration::from_secs(60)),
        Some(mode @ ("child" | "orphan")) => {
            #[allow(
                clippy::zombie_processes,
                reason = "The orphan fixture deliberately exits; supervisor tests verify descendant cleanup."
            )]
            let mut child = std::process::Command::new(std::env::current_exe().unwrap())
                .arg("hang")
                .spawn()
                .unwrap();
            println!("{}", child.id());
            std::io::stdout().flush().unwrap();
            if let Some(path) = std::env::var_os("RAMBLE_TEST_CHILD_MARKER") {
                std::fs::write(path, child.id().to_string()).unwrap();
            }
            if mode == "child" {
                let _ = child.wait();
            }
        }
        Some("fail") => {
            eprintln!("synthetic secret that must not be returned");
            std::process::exit(17);
        }
        Some("malformed") => print!("{{broken json"),
        Some("empty") => {}
        _ => std::process::exit(2),
    }
}
