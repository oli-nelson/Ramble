//! Explicit-consent failure diagnostics. Bounded excerpts, never logs/settings.
use serde::{Deserialize, Serialize};
const STREAM_LIMIT: usize = 256 * 1024;
const OMITTED: &str = "\n… output omitted (diagnostic excerpt limit) …\n";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessOutput {
    pub run_id: String,
    pub stdout: String,
    pub stderr: String,
    pub stdout_truncated: bool,
    pub stderr_truncated: bool,
}
fn excerpt(bytes: &[u8]) -> (String, bool) {
    if bytes.len() <= STREAM_LIMIT {
        let text = String::from_utf8_lossy(bytes);
        if text.len() <= STREAM_LIMIT {
            return (text.into_owned(), false);
        }
    }
    // Budget the displayed UTF-8 bytes too: replacement characters can expand
    // invalid input, and the omission marker belongs inside the stream cap.
    let half = (STREAM_LIMIT - OMITTED.len()) / 2;
    let head = String::from_utf8_lossy(&bytes[..half.min(bytes.len())]);
    let tail = String::from_utf8_lossy(&bytes[bytes.len().saturating_sub(half)..]);
    let mut head_end = half.min(head.len());
    while !head.is_char_boundary(head_end) {
        head_end -= 1;
    }
    let mut tail_start = tail.len().saturating_sub(half);
    while !tail.is_char_boundary(tail_start) {
        tail_start += 1;
    }
    (
        format!("{}{OMITTED}{}", &head[..head_end], &tail[tail_start..]),
        true,
    )
}
impl HarnessOutput {
    pub fn capture(run_id: &str, stdout: &[u8], stderr: &[u8]) -> Self {
        let (stdout, stdout_truncated) = excerpt(stdout);
        let (stderr, stderr_truncated) = excerpt(stderr);
        Self {
            run_id: run_id.into(),
            stdout,
            stderr,
            stdout_truncated,
            stderr_truncated,
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn diagnostic_excerpts_are_bounded_and_include_both_ends() {
        let bytes = [
            b"first".as_slice(),
            &vec![b'x'; super::STREAM_LIMIT],
            b"last",
        ]
        .concat();
        let output = super::HarnessOutput::capture("run", &bytes, b"stderr");
        assert!(output.stdout_truncated);
        assert!(output.stdout.starts_with("first"));
        assert!(output.stdout.ends_with("last"));
        assert!(output.stdout.len() <= super::STREAM_LIMIT);
        assert_eq!(output.stderr, "stderr");
        assert!(!output.stderr_truncated);
    }

    #[test]
    fn invalid_utf8_replacements_and_marker_stay_within_the_display_limit() {
        for size in [
            super::STREAM_LIMIT / 2,
            super::STREAM_LIMIT,
            super::STREAM_LIMIT + 1,
        ] {
            let output = super::HarnessOutput::capture("run", &vec![0xff; size], b"");
            assert!(output.stdout_truncated);
            assert!(output.stdout.len() <= super::STREAM_LIMIT);
            assert!(output.stdout.contains('\u{fffd}'));
        }
    }
}
