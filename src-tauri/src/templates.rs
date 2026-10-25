//! Literal argv compilation for trusted user-configured command templates.
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(from = "WireArgNode", into = "WireArgNode")]
pub enum ArgNode {
    Literal(String),
    Parameter(String),
    Argument(Vec<Part>),
    OptionalGroup {
        when_present: String,
        args: Vec<ArgNode>,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum Part {
    Text(String),
    Variable(String),
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum WireArgNode {
    Argument {
        parts: Vec<Part>,
    },
    Literal {
        value: String,
    },
    Parameter {
        name: String,
    },
    OptionalGroup {
        #[serde(rename = "whenPresent")]
        when_present: String,
        args: Vec<ArgNode>,
    },
}

impl From<WireArgNode> for ArgNode {
    fn from(node: WireArgNode) -> Self {
        match node {
            WireArgNode::Argument { parts } => Self::Argument(parts),
            WireArgNode::Literal { value } => Self::Literal(value),
            WireArgNode::Parameter { name } => Self::Parameter(name),
            WireArgNode::OptionalGroup { when_present, args } => {
                Self::OptionalGroup { when_present, args }
            }
        }
    }
}
impl From<ArgNode> for WireArgNode {
    fn from(node: ArgNode) -> Self {
        match node {
            ArgNode::Argument(parts) => Self::Argument { parts },
            ArgNode::Literal(value) => Self::Literal { value },
            ArgNode::Parameter(name) => Self::Parameter { name },
            ArgNode::OptionalGroup { when_present, args } => {
                Self::OptionalGroup { when_present, args }
            }
        }
    }
}

pub fn validate(nodes: &[ArgNode], transport: &str) -> Result<(), String> {
    fn count_prompt(nodes: &[ArgNode], nested: bool) -> Result<usize, String> {
        let mut count = 0;
        for node in nodes {
            match node {
                ArgNode::Parameter(name) if name == "prompt" => {
                    if nested {
                        return Err("The prompt cannot be inside an optional group.".into());
                    }
                    count += 1;
                }
                ArgNode::Argument(parts) => {
                    let prompts = parts
                        .iter()
                        .filter(|p| matches!(p, Part::Variable(n) if n == "prompt"))
                        .count();
                    if nested && prompts > 0 {
                        return Err("PROMPT cannot be optional.".into());
                    }
                    count += prompts;
                }
                ArgNode::OptionalGroup { args, .. } => {
                    count += count_prompt(args, true)?;
                }
                ArgNode::Literal(value) if value.len() > 32768 => {
                    return Err("An argument exceeds 32 KiB.".into())
                }
                _ => {}
            }
        }
        Ok(count)
    }
    // Compilation validates even unused groups, placeholder names, NUL and depth.
    compile(
        nodes,
        &BTreeMap::from([
            ("prompt".into(), "probe".into()),
            ("model".into(), "probe".into()),
            ("reasoningEffort".into(), "probe".into()),
        ]),
    )?;
    let count = count_prompt(nodes, false)?;
    match (transport, count) {
        ("stdin", 0) | ("argument", 1) => Ok(()),
        _ => Err("Stdin templates must have no prompt argument; argument templates need exactly one prompt slot.".into()),
    }
}

pub fn compile(
    nodes: &[ArgNode],
    parameters: &BTreeMap<String, String>,
) -> Result<Vec<String>, String> {
    fn visit(
        nodes: &[ArgNode],
        values: &BTreeMap<String, String>,
        output: &mut Vec<String>,
        depth: usize,
    ) -> Result<(), String> {
        if depth > 4 || nodes.len() > 64 {
            return Err("Template is too complex.".into());
        }
        for node in nodes {
            match node {
                ArgNode::Literal(value) => {
                    if value.contains('\0') {
                        return Err("NUL is not valid in argv.".into());
                    }
                    output.push(value.clone());
                }
                ArgNode::Argument(parts) => {
                    let mut argument = String::new();
                    for part in parts {
                        match part {
                            Part::Text(text) => argument.push_str(text),
                            Part::Variable(name) => {
                                if !["prompt", "model", "reasoningEffort"].contains(&name.as_str())
                                {
                                    return Err("Unsupported template parameter.".into());
                                }
                                argument
                                    .push_str(values.get(name).map(String::as_str).unwrap_or(""));
                            }
                        }
                    }
                    if argument.contains('\0') {
                        return Err("NUL is not valid in argv.".into());
                    }
                    output.push(argument);
                }
                ArgNode::Parameter(name) => {
                    if !["prompt", "model", "reasoningEffort"].contains(&name.as_str()) {
                        return Err("Unsupported template parameter.".into());
                    }
                    let value = values.get(name).ok_or("Missing template parameter.")?;
                    if value.contains('\0') {
                        return Err("NUL is not valid in argv.".into());
                    }
                    output.push(value.clone());
                }
                ArgNode::OptionalGroup { when_present, args } => {
                    let key = when_present.strip_prefix('!').unwrap_or(when_present);
                    if !["model", "reasoningEffort"].contains(&key) {
                        return Err(
                            "Only model and reasoning effort options may be optional.".into()
                        );
                    }
                    // Validate even an omitted group, so invalid placeholders cannot lurk in it.
                    let mut checked = values.clone();
                    checked.entry(key.into()).or_default();
                    let mut group = Vec::new();
                    visit(args, &checked, &mut group, depth + 1)?;
                    if values.get(key).is_some_and(|v| !v.is_empty())
                        != when_present.starts_with('!')
                    {
                        output.extend(group);
                    }
                }
            }
            if output.len() > 128 {
                return Err("Too many template arguments.".into());
            }
        }
        Ok(())
    }
    let mut output = Vec::new();
    visit(nodes, parameters, &mut output, 0)?;
    Ok(output)
}

fn variable(name: &str) -> Result<&'static str, String> {
    match name {
        "MODEL_ID" => Ok("model"),
        "REASONING_EFFORT" => Ok("reasoningEffort"),
        "PROMPT" => Ok("prompt"),
        _ => Err(format!(
            "Unknown variable: {name}. Use MODEL_ID, REASONING_EFFORT or PROMPT."
        )),
    }
}

/// Parse the command before substitutions. No shell is started and injected text
/// can never create an argument, quote, optional section, or second substitution.
pub fn parse_command(command: &str) -> Result<(String, Vec<ArgNode>), String> {
    if command.len() > 65536 || command.contains('\0') {
        return Err("Command is too long or contains NUL.".into());
    }
    struct Parser {
        chars: Vec<char>,
        i: usize,
    }
    impl Parser {
        fn starts(&self, a: char, b: char) -> bool {
            self.chars.get(self.i) == Some(&a) && self.chars.get(self.i + 1) == Some(&b)
        }
        fn read(&mut self, nested: bool, depth: usize) -> Result<Vec<ArgNode>, String> {
            if depth > 4 {
                return Err("Optional sections are nested too deeply.".into());
            }
            let mut nodes = Vec::new();
            while self.i < self.chars.len() {
                while self.chars.get(self.i).is_some_and(|c| c.is_whitespace()) {
                    self.i += 1;
                }
                if self.i == self.chars.len() {
                    break;
                }
                if self.starts(']', ']') {
                    if !nested {
                        return Err("Unexpected optional-section closing marker.".into());
                    }
                    self.i += 2;
                    return Ok(nodes);
                }
                if self.starts('[', '[') {
                    self.i += 2;
                    let inverse = self.chars.get(self.i) == Some(&'!');
                    if inverse {
                        self.i += 1;
                    }
                    let start = self.i;
                    while self
                        .chars
                        .get(self.i)
                        .is_some_and(|c| c.is_ascii_uppercase() || *c == '_')
                    {
                        self.i += 1;
                    }
                    if self.i == start || !self.chars.get(self.i).is_some_and(|c| c.is_whitespace())
                    {
                        return Err(
                            "Optional sections need a variable name followed by a space.".into(),
                        );
                    }
                    let name: String = self.chars[start..self.i].iter().collect();
                    let guard = variable(&name)?;
                    if guard == "prompt" {
                        return Err("PROMPT cannot be optional.".into());
                    }
                    nodes.push(ArgNode::OptionalGroup {
                        when_present: format!("{}{guard}", if inverse { "!" } else { "" }),
                        args: self.read(true, depth + 1)?,
                    });
                } else {
                    let mut parts = Vec::new();
                    let mut text = String::new();
                    let mut quote = None;
                    while let Some(&c) = self.chars.get(self.i) {
                        if quote.is_none() && c.is_whitespace() {
                            break;
                        }
                        if c == '\\'
                            && self.chars.get(self.i + 1).is_some_and(|c| {
                                c.is_whitespace() || ['\\', '\'', '"', '{', '[', ']'].contains(c)
                            })
                        {
                            text.push(self.chars[self.i + 1]);
                            self.i += 2;
                            continue;
                        }
                        if c == '\'' || c == '"' {
                            if quote.is_none() {
                                quote = Some(c);
                                self.i += 1;
                                continue;
                            }
                            if quote == Some(c) {
                                quote = None;
                                self.i += 1;
                                continue;
                            }
                        }
                        if self.starts('{', '{') {
                            if !text.is_empty() {
                                parts.push(Part::Text(std::mem::take(&mut text)));
                            }
                            self.i += 2;
                            let start = self.i;
                            while self.i < self.chars.len() && !self.starts('}', '}') {
                                self.i += 1;
                            }
                            if self.i == self.chars.len() {
                                return Err("Unclosed variable.".into());
                            }
                            let name: String = self.chars[start..self.i].iter().collect();
                            parts.push(Part::Variable(variable(&name)?.into()));
                            self.i += 2;
                            continue;
                        }
                        text.push(c);
                        self.i += 1;
                    }
                    if quote.is_some() {
                        return Err("Unclosed quote in command.".into());
                    }
                    if !text.is_empty() {
                        parts.push(Part::Text(text));
                    }
                    nodes.push(ArgNode::Argument(parts));
                }
                if nodes.len() > 128 {
                    return Err("Too many command arguments.".into());
                }
            }
            if nested {
                return Err("Unclosed optional section; end it with a space and ]].".into());
            }
            Ok(nodes)
        }
    }
    let mut nodes = Parser {
        chars: command.chars().collect(),
        i: 0,
    }
    .read(false, 0)?;
    let Some(ArgNode::Argument(parts)) = nodes.first() else {
        return Err("Start with a literal executable name or quoted path.".into());
    };
    let mut executable = String::new();
    for part in parts {
        match part {
            Part::Text(text) => executable.push_str(text),
            _ => return Err("Variables cannot appear in the executable.".into()),
        }
    }
    if executable.trim().is_empty() || executable.len() > 4096 || executable.contains(['\n', '\r'])
    {
        return Err("Invalid executable name or path.".into());
    }
    nodes.remove(0);
    Ok((executable, nodes))
}

pub fn validate_command(command: &str, transport: &str) -> Result<(), String> {
    let (_, nodes) = parse_command(command)?;
    validate(&nodes, transport)
}

/// Lossless conversion of schema-2/3 literal arguments and guarded model groups.
pub fn quote_literal(text: &str) -> String {
    let mut quoted = String::from("\"");
    for c in text.chars() {
        if ['\\', '"', '{', '['].contains(&c) {
            quoted.push('\\');
        }
        quoted.push(c);
    }
    quoted.push('"');
    quoted
}
pub fn legacy_command(executable: &str, nodes: &[ArgNode]) -> Result<String, String> {
    fn render(nodes: &[ArgNode], depth: usize) -> Result<Vec<String>, String> {
        if depth > 4 {
            return Err("Legacy command is nested too deeply.".into());
        }
        nodes
            .iter()
            .map(|n| {
                Ok(match n {
                    ArgNode::Literal(text) => quote_literal(text),
                    ArgNode::Parameter(name) if name == "model" => "{{MODEL_ID}}".into(),
                    ArgNode::Parameter(name) if name == "prompt" => "{{PROMPT}}".into(),
                    ArgNode::OptionalGroup { when_present, args } if when_present == "model" => {
                        format!("[[MODEL_ID {} ]]", render(args, depth + 1)?.join(" "))
                    }
                    _ => {
                        return Err(
                            "Unsupported legacy template; original settings preserved.".into()
                        )
                    }
                })
            })
            .collect()
    }
    Ok(format!(
        "{} {}",
        quote_literal(executable),
        render(nodes, 0)?.join(" ")
    )
    .trim()
    .into())
}

pub fn check_argument_budget(executable: &str, argv: &[String]) -> Result<(), String> {
    // A conservative cross-platform UTF-16 budget, including worst-case quote escaping.
    let units = executable.encode_utf16().count() * 2
        + argv
            .iter()
            .map(|a| a.encode_utf16().count() * 2 + 3)
            .sum::<usize>()
        + 2;
    if units > 30000 {
        Err("InputTooLarge: argument prompt exceeds the safe command-line budget. Select a verified stdin transport; text was not truncated.".into())
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn command_strings_preserve_argument_boundaries_and_never_reparse_values() {
        let (exe, nodes) = parse_command(r#""C:\Tools\my writer.exe" "" --model={{MODEL_ID}} --effort {{REASONING_EFFORT}} {{PROMPT}} "\{{literal}}""#).unwrap();
        assert_eq!(exe, r"C:\Tools\my writer.exe");
        let prompt = "'quotes' \" ; $(touch nope)\n{{MODEL_ID}} [[MODEL_ID injected ]]";
        let values = BTreeMap::from([
            ("model".into(), "provider/model with spaces".into()),
            ("reasoningEffort".into(), "high".into()),
            ("prompt".into(), prompt.into()),
        ]);
        assert_eq!(
            compile(&nodes, &values).unwrap(),
            vec![
                "",
                "--model=provider/model with spaces",
                "--effort",
                "high",
                prompt,
                "{{literal}}"
            ]
        );
        let empty = parse_command("tool [[MODEL_ID --model {{MODEL_ID}} ]] [[REASONING_EFFORT --effort {{REASONING_EFFORT}} ]] {{PROMPT}}").unwrap().1;
        assert_eq!(
            compile(&empty, &BTreeMap::from([("prompt".into(), prompt.into())])).unwrap(),
            vec![prompt]
        );
    }

    #[test]
    fn new_command_syntax_rejects_ambiguous_or_invalid_templates() {
        for command in [
            "",
            "\"\" run",
            "{{MODEL_ID}} run",
            "tool {{UNKNOWN}}",
            "tool {{PROMPT",
            "tool \"unterminated",
            "tool [[MODEL_ID --model {{MODEL_ID}}",
            "tool ]]",
            "tool [[PROMPT x ]]",
            "tool [[MODEL_ID {{PROMPT}} ]]",
            "tool \0",
        ] {
            assert!(validate_command(command, "argument").is_err(), "{command}");
        }
        assert!(validate_command("tool {{PROMPT}} {{PROMPT}}", "argument").is_err());
        assert!(validate_command("tool {{PROMPT}}", "stdin").is_err());
    }

    #[test]
    fn builtin_effort_options_are_omitted_or_injected_as_documented() {
        let settings = crate::settings::Settings::default();
        for template in settings.templates {
            let (_, nodes) = parse_command(&template.command).unwrap();
            let mut values = BTreeMap::from([
                ("prompt".into(), "source".into()),
                ("model".into(), "provider/model".into()),
            ]);
            let args = compile(&nodes, &values).unwrap();
            assert!(args.windows(2).any(|a| a == ["--model", "provider/model"]));
            assert!(!args
                .iter()
                .any(|a| a.contains("model_reasoning_effort") || a == "--effort"));
            values.insert("reasoningEffort".into(), "high".into());
            let args = compile(&nodes, &values).unwrap();
            match template.id.as_str() {
                "opencode" => {
                    assert!(args
                        .windows(2)
                        .any(|a| a == ["--model", "provider/model#high"]));
                    assert_eq!(args.iter().filter(|a| *a == "--model").count(), 1);
                }
                "codex" => assert!(args
                    .windows(2)
                    .any(|a| a == ["-c", "model_reasoning_effort=\"high\""])),
                "claude" => assert!(args.windows(2).any(|a| a == ["--effort", "high"])),
                _ => unreachable!(),
            }
        }
    }
    #[test]
    fn substitutions_are_literal_and_optional_groups_are_atomic() {
        let nodes = vec![
            ArgNode::Literal("run".into()),
            ArgNode::OptionalGroup {
                when_present: "model".into(),
                args: vec![
                    ArgNode::Literal("--model".into()),
                    ArgNode::Parameter("model".into()),
                ],
            },
            ArgNode::Parameter("prompt".into()),
        ];
        let mut values = BTreeMap::from([(
            "prompt".into(),
            "quotes ' \"\n$(touch nope) {{model}}".into(),
        )]);
        let out = compile(&nodes, &values).unwrap();
        assert_eq!(out.len(), 2);
        assert_eq!(out[1], values["prompt"]);
        values.insert("model".into(), "provider/model with spaces".into());
        let out = compile(&nodes, &values).unwrap();
        assert_eq!(out.len(), 4);
        assert_eq!(out[2], values["model"]);
    }
    #[test]
    fn unknown_placeholders_and_oversize_argv_are_rejected() {
        assert!(compile(&[ArgNode::Parameter("HOME".into())], &BTreeMap::new()).is_err());
        assert!(check_argument_budget("tool", &["🦊".repeat(10000)]).is_err());
    }
}
