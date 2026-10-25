use crate::{build::BuildRequest, process::ExecutionPlan, settings::Settings, templates};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    time::Duration,
};

/// Trusted command compilation only: no harness-specific output protocol or shell.
pub fn compile(
    settings: &Settings,
    request: &BuildRequest,
    prompt: String,
) -> Result<ExecutionPlan, String> {
    settings.validate()?;
    let preset = settings
        .presets
        .iter()
        .find(|p| p.id == request.preset_id)
        .ok_or("PresetMissing: select an existing preset.")?;
    let template = settings
        .templates
        .iter()
        .find(|t| t.id == preset.template_id)
        .ok_or("Template not found.")?;
    let (command_executable, nodes) = templates::parse_command(&template.command)?;
    let name = preset
        .parameters
        .executable
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or(&command_executable);
    let executable = resolve_executable(name).ok_or("ExecutableMissing: install/authenticate the CLI outside Ramble, or set its full executable path. On Windows use an .exe (or a runtime such as node.exe with the script as an argument), not a .cmd/.bat launcher.")?;
    let mut values = BTreeMap::from([("prompt".into(), prompt.clone())]);
    if let Some(model) = &preset.parameters.model {
        if !model.is_empty() {
            values.insert("model".into(), model.clone());
        }
    }
    if let Some(effort) = &preset.parameters.reasoning_effort {
        values.insert("reasoningEffort".into(), effort.clone());
    }
    let args = templates::compile(&nodes, &values)?;
    templates::check_argument_budget(&executable.to_string_lossy(), &args)?;
    // Preserve native CLI auth/provider discovery. No environment is exposed over IPC.
    let mut environment: BTreeMap<String, String> = std::env::vars_os()
        .filter_map(|(k, v)| Some((k.into_string().ok()?, v.into_string().ok()?)))
        .collect();
    let mut paths: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    if let Some(parent) = executable.parent() {
        paths.push(parent.to_path_buf());
    }
    #[cfg(unix)]
    paths.extend([
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/bin"),
        PathBuf::from("/bin"),
    ]);
    if let Ok(path) = std::env::join_paths(paths) {
        environment.insert("PATH".into(), path.to_string_lossy().into_owned());
    }
    Ok(ExecutionPlan {
        executable,
        args,
        stdin: if template.prompt_transport == "stdin" {
            prompt.into_bytes()
        } else {
            Vec::new()
        },
        environment,
        timeout: Duration::from_secs(settings.timeout_seconds),
        stdout_limit: crate::response::MAX_STDOUT,
        stderr_limit: 1024 * 1024,
    })
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildPreview {
    pub command: String,
    pub stdin: String,
}
pub fn preview(settings: &Settings, request: &BuildRequest) -> Result<BuildPreview, String> {
    if request.expected_settings_revision != settings.revision {
        return Err("SettingsConflict: settings changed. Reopen Settings and retry.".into());
    }
    let prompt = crate::build::prompt(request)?;
    let plan = compile(settings, request, prompt)?;
    Ok(BuildPreview {
        command: terminal_command(&plan.executable.to_string_lossy(), &plan.args),
        stdin: String::from_utf8(plan.stdin).map_err(|_| "Invalid stdin encoding.")?,
    })
}

/// Terminal replay quoting is separate from template escaping and actual launch.
pub fn terminal_command(executable: &str, args: &[String]) -> String {
    let quote = |text: &str| {
        #[cfg(windows)]
        let escaped = text.replace('\'', "''");
        #[cfg(not(windows))]
        let escaped = text.replace('\'', "'\\''");
        format!("'{escaped}'")
    };
    let command = std::iter::once(executable)
        .chain(args.iter().map(String::as_str))
        .map(quote)
        .collect::<Vec<_>>()
        .join(" ");
    #[cfg(windows)]
    let command = format!("& {command}");
    command
}

pub fn resolve_executable(name: &str) -> Option<PathBuf> {
    fn candidate(path: &Path) -> Option<PathBuf> {
        if !path.is_file() {
            return None;
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if path.metadata().ok()?.permissions().mode() & 0o111 == 0 {
                return None;
            }
        }
        #[cfg(windows)]
        {
            let extension = path.extension()?.to_str()?.to_ascii_lowercase();
            if extension != "exe" && extension != "com" {
                return None;
            }
        }
        std::fs::canonicalize(path).ok()
    }
    let path = Path::new(name);
    if path.is_absolute() {
        return candidate(path);
    }
    if path.components().count() != 1 {
        return None;
    }
    let mut directories: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| {
            std::env::split_paths(&p)
                .filter(|p| p.is_absolute())
                .collect()
        })
        .unwrap_or_default();
    if let Some(home) = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }) {
        let home = PathBuf::from(home);
        directories.extend([
            home.join(".local/bin"),
            home.join(".cargo/bin"),
            home.join(".bun/bin"),
        ]);
        #[cfg(windows)]
        directories.push(home.join("AppData/Local/Programs/claude"));
    }
    #[cfg(unix)]
    directories.extend([
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/bin"),
    ]);
    for directory in directories {
        if let Some(found) = candidate(&directory.join(name)) {
            return Some(found);
        }
        #[cfg(windows)]
        if let Some(found) = candidate(&directory.join(format!("{name}.exe"))) {
            return Some(found);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    #[test]
    fn all_builtin_templates_validate_without_launching_a_cli() {
        let settings = crate::settings::Settings::default();
        settings.validate().unwrap();
        for template in settings.templates {
            crate::templates::validate_command(&template.command, &template.prompt_transport)
                .unwrap();
        }
    }
}
