//! Harness-independent, bounded extraction of Ramble's single-key JSON response.
//! The distinctive key is a format marker, not a security boundary.
use serde::de::{self, Deserialize, Deserializer, MapAccess, SeqAccess, Visitor};
use std::fmt;

pub const MAX_STDOUT: usize = 8 * 1024 * 1024;
const MAX_JSON: usize = 2 * 1024 * 1024;
const MAX_MESSAGE: usize = 1024 * 1024;
const MAX_WORK: usize = 64 * 1024 * 1024;
const MAX_ATTEMPTS: usize = 4096;
const MAX_NODES: usize = 100_000;
const MAX_DEPTH: usize = 32;
const MAX_DECODINGS: usize = 8;

// Preserve duplicate object keys: serde_json::Value would silently overwrite them.
enum Node {
    Object(Vec<(String, Node)>),
    Array(Vec<Node>),
    Text(String),
    Other,
}
impl<'de> Deserialize<'de> for Node {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct JsonVisitor;
        impl<'de> Visitor<'de> for JsonVisitor {
            type Value = Node;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("a JSON value")
            }
            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Node, A::Error> {
                let mut fields = Vec::new();
                while let Some(field) = map.next_entry()? {
                    fields.push(field);
                }
                Ok(Node::Object(fields))
            }
            fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Node, A::Error> {
                let mut values = Vec::new();
                while let Some(value) = seq.next_element()? {
                    values.push(value);
                }
                Ok(Node::Array(values))
            }
            fn visit_str<E: de::Error>(self, s: &str) -> Result<Node, E> {
                Ok(Node::Text(s.into()))
            }
            fn visit_string<E: de::Error>(self, s: String) -> Result<Node, E> {
                Ok(Node::Text(s))
            }
            fn visit_bool<E: de::Error>(self, _: bool) -> Result<Node, E> {
                Ok(Node::Other)
            }
            fn visit_i64<E: de::Error>(self, _: i64) -> Result<Node, E> {
                Ok(Node::Other)
            }
            fn visit_u64<E: de::Error>(self, _: u64) -> Result<Node, E> {
                Ok(Node::Other)
            }
            fn visit_f64<E: de::Error>(self, _: f64) -> Result<Node, E> {
                Ok(Node::Other)
            }
            fn visit_unit<E: de::Error>(self) -> Result<Node, E> {
                Ok(Node::Other)
            }
        }
        d.deserialize_any(JsonVisitor)
    }
}

struct Extractor {
    message: Option<String>,
    work: usize,
    attempts: usize,
    nodes: usize,
}
fn limit_error() -> String {
    "ProtocolError: harness output exceeded JSON extraction limits.".into()
}
impl Extractor {
    fn spend(&mut self, bytes: usize) -> Result<(), String> {
        self.work = self.work.checked_add(bytes).ok_or_else(limit_error)?;
        if self.work > MAX_WORK {
            return Err(limit_error());
        }
        Ok(())
    }
    // Balance brackets with JSON string/escape awareness, never a greedy regex.
    fn end(&mut self, bytes: &[u8], start: usize) -> Result<Option<usize>, String> {
        let string = bytes[start] == b'"';
        let mut stack = if string {
            Vec::new()
        } else {
            vec![bytes[start]]
        };
        let mut quoted = string;
        let mut escaped = false;
        for (i, &c) in bytes.iter().enumerate().skip(start + 1) {
            self.spend(1)?;
            if quoted {
                if escaped {
                    escaped = false;
                } else if c == b'\\' {
                    escaped = true;
                } else if c == b'"' {
                    quoted = false;
                    if string {
                        return Ok(Some(i + 1));
                    }
                }
            } else {
                match c {
                    b'"' => quoted = true,
                    b'{' | b'[' => {
                        stack.push(c);
                        if stack.len() > MAX_DEPTH {
                            return Err(limit_error());
                        }
                    }
                    b'}' | b']' => {
                        if stack.pop() != Some(if c == b'}' { b'{' } else { b'[' }) {
                            return Ok(None);
                        }
                        if stack.is_empty() {
                            return Ok(Some(i + 1));
                        }
                    }
                    _ => {}
                }
            }
        }
        Ok(None)
    }
    fn scan(&mut self, text: &str, decoding: usize) -> Result<(), String> {
        let bytes = text.as_bytes();
        let mut i = 0;
        while i < bytes.len() {
            self.spend(1)?;
            if matches!(bytes[i], b'{' | b'[' | b'"') {
                self.attempts += 1;
                if self.attempts > MAX_ATTEMPTS {
                    return Err(limit_error());
                }
                if let Some(end) = self.end(bytes, i)? {
                    if end - i > MAX_JSON {
                        return Err(limit_error());
                    }
                    self.spend(end - i)?;
                    if let Ok(node) = serde_json::from_str::<Node>(&text[i..end]) {
                        self.visit(node, 0, decoding)?;
                        i = end;
                        continue;
                    }
                }
            }
            // Recover from unrelated malformed log prefixes without accepting them.
            i += 1;
        }
        Ok(())
    }
    fn visit(&mut self, node: Node, depth: usize, decoding: usize) -> Result<(), String> {
        self.nodes += 1;
        if self.nodes > MAX_NODES || depth > MAX_DEPTH {
            return Err(limit_error());
        }
        match node {
            Node::Object(fields) => {
                if fields.iter().any(|(key, _)| key == "ramble_response") {
                    if fields.len() != 1 {
                        return Err("ProtocolError: response must contain only ramble_response, without duplicate keys.".into());
                    }
                    let message = fields.into_iter().next().map(|(_, value)| value);
                    let Some(Node::Text(message)) = message else {
                        return Err("ProtocolError: ramble_response must be a string.".into());
                    };
                    if message.trim().is_empty() || message.len() > MAX_MESSAGE {
                        return Err(
                            "ProtocolError: matching response message is empty or exceeds 1 MiB."
                                .into(),
                        );
                    }
                    if self.message.as_ref().is_some_and(|old| old != &message) {
                        return Err(
                            "ProtocolError: harness returned conflicting responses for this build."
                                .into(),
                        );
                    }
                    self.message = Some(message);
                    // Message content is data, not more candidate responses.
                } else {
                    for (_, value) in fields {
                        self.visit(value, depth + 1, decoding)?;
                    }
                }
            }
            Node::Array(values) => {
                for value in values {
                    self.visit(value, depth + 1, decoding)?;
                }
            }
            Node::Text(text) if text.bytes().any(|c| matches!(c, b'{' | b'[' | b'"')) => {
                if decoding >= MAX_DECODINGS {
                    return Err(limit_error());
                }
                self.scan(&text, decoding + 1)?;
            }
            _ => {}
        }
        Ok(())
    }
}

/// Call ONLY after a successful exit, completed cleanup, and fully drained stdout.
pub fn extract(stdout: &[u8]) -> Result<String, String> {
    if stdout.len() > MAX_STDOUT {
        return Err(limit_error());
    }
    let text = std::str::from_utf8(stdout)
        .map_err(|_| "ProtocolError: harness stdout is not valid UTF-8.")?;
    let mut extractor = Extractor {
        message: None,
        work: 0,
        attempts: 0,
        nodes: 0,
    };
    extractor.scan(text, 0)?;
    extractor.message.ok_or_else(|| "ProtocolError: no valid Ramble JSON response was found. Return one object containing only a nonempty ramble_response string.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn response(message: &str) -> String {
        serde_json::json!({"ramble_response":message}).to_string()
    }
    #[test]
    fn plain_noisy_fenced_and_unknown_nested_json_share_one_contract() {
        let message = "  Literal 🦊\n```text``` { braces } \\\"quotes\"  ";
        let body = response(message);
        for text in [
            body.clone(),
            format!("startup noise\n```json\n{body}\n```\nfinished"),
            serde_json::json!({"arbitrary":{"payload":[body.clone()]},"unrelated":true})
                .to_string(),
            serde_json::json!([{"unknown":serde_json::json!({"deeper":body.clone()}).to_string()}])
                .to_string(),
            format!("logs [unfinished\n{body}"),
        ] {
            assert_eq!(extract(text.as_bytes()).unwrap(), message);
        }
    }
    #[test]
    fn identical_duplicates_are_allowed_conflicting_messages_are_not() {
        let a = response("one");
        let b = response("two");
        assert_eq!(extract(format!("{a}\n{a}").as_bytes()).unwrap(), "one");
        assert!(extract(format!("{a}\n{b}").as_bytes())
            .unwrap_err()
            .contains("conflicting"));
    }
    #[test]
    fn strict_schema_rejects_unrelated_empty_malformed_or_duplicate_keys() {
        for body in [
            "unstructured text".into(),
            response(" \n"),
            r#"{"message":"not the response key"}"#.into(),
            r#"{"rambleResponseId":"old","message":"legacy format"}"#.into(),
            r#"{"ramble_response":3}"#.into(),
            r#"{"ramble_response":null}"#.into(),
            r#"{"ramble_response":"one","extra":true}"#.into(),
            r#"{"ramble_response":"one","ramble_response":"one"}"#.into(),
            r#"{"ramble_response":"unfinished"#.into(),
        ] {
            assert!(
                extract(body.as_bytes()).is_err(),
                "accepted invalid response"
            );
        }
        assert!(extract(&[0xff]).is_err());
    }
    #[test]
    fn unrelated_json_is_not_a_message_and_response_contents_are_not_reparsed() {
        let echo = serde_json::json!({"source":["ordinary notes"],"style":"plain"}).to_string();
        assert!(extract(echo.as_bytes()).is_err());
        let embedded = response("do not extract me");
        assert_eq!(extract(response(&embedded).as_bytes()).unwrap(), embedded);
    }
    #[test]
    fn complexity_and_size_are_bounded() {
        assert!(extract(&vec![b'x'; MAX_STDOUT + 1]).is_err());
        assert!(extract(response(&"x".repeat(MAX_MESSAGE + 1)).as_bytes()).is_err());
        assert!(extract(
            format!(
                "{}{}{}",
                "[".repeat(MAX_DEPTH + 1),
                response("one"),
                "]".repeat(MAX_DEPTH + 1)
            )
            .as_bytes()
        )
        .is_err());
        assert!(extract(
            format!("{}{}", "{} ".repeat(MAX_ATTEMPTS + 1), response("one")).as_bytes()
        )
        .is_err());
        let large_array = format!("[{}0]", "0,".repeat(MAX_NODES));
        assert!(extract(large_array.as_bytes()).is_err());
        let mut encoded = response("one");
        for _ in 0..=MAX_DECODINGS {
            encoded = serde_json::to_string(&encoded).unwrap();
        }
        assert!(extract(encoded.as_bytes()).is_err());
        let mut exhausted = Extractor {
            message: None,
            work: MAX_WORK,
            attempts: 0,
            nodes: 0,
        };
        assert!(exhausted.scan(&response("one"), 0).is_err());
    }
}
