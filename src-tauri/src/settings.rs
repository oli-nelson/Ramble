use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    io::Write,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommandTemplate {
    pub id: String,
    pub version: u32,
    pub adapter_version: u32,
    pub name: String,
    pub command: String,
    pub prompt_transport: String,
    pub description: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Parameters {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_effort: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub executable: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Preset {
    pub id: String,
    pub name: String,
    pub template_id: String,
    pub template_version: u32,
    pub parameters: Parameters,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    pub schema_version: u32,
    pub revision: u64,
    pub default_style: String,
    pub templates: Vec<CommandTemplate>,
    pub presets: Vec<Preset>,
    pub selected_preset_id: String,
    pub hotkey: String,
    pub timeout_seconds: u64,
    pub theme: String,
    pub bounds: Option<Bounds>,
    pub placement: crate::placement::PlacementSettings,
}

impl Default for Settings {
    fn default() -> Self {
        serde_json::from_str(include_str!("../../src/domain/builtins.json"))
            .expect("Bundled settings must match the native schema")
    }
}

impl Settings {
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != 6 {
            return Err("Unsupported settings schema; update Ramble before saving.".into());
        }
        if self.templates.is_empty() || self.templates.len() > 100 {
            return Err("Keep between 1 and 100 command templates.".into());
        }
        let mut template_ids = HashSet::new();
        for template in &self.templates {
            if template.id.is_empty()
                || template.id.len() > 100
                || !template_ids.insert(&template.id)
                || template.name.trim().is_empty()
                || template.name.chars().count() > 80
                || template.version == 0
                || template.adapter_version != 1
                || template.command.trim().is_empty()
                || template.description.len() > 4096
            {
                return Err(
                    "Invalid command template identity, version, name or executable.".into(),
                );
            }
            crate::templates::validate_command(&template.command, &template.prompt_transport)?;
        }
        if !(5..=600).contains(&self.timeout_seconds)
            || !["system", "light", "dark"].contains(&self.theme.as_str())
            || self.default_style.len() > 65536
            || self.hotkey.len() > 100
            || self.hotkey.trim().is_empty()
        {
            return Err("Invalid timeout, appearance, style length, or shortcut.".into());
        }
        if self.presets.len() > 100 {
            return Err("Keep at most 100 presets.".into());
        }
        let mut ids = HashSet::new();
        for p in &self.presets {
            if p.id.is_empty()
                || p.id.len() > 100
                || !ids.insert(&p.id)
                || p.name.trim().is_empty()
                || p.name.chars().count() > 80
                || !self
                    .templates
                    .iter()
                    .any(|t| t.id == p.template_id && t.version == p.template_version)
            {
                return Err("Invalid preset name, identity, or template version.".into());
            }
            for value in [
                &p.parameters.model,
                &p.parameters.reasoning_effort,
                &p.parameters.executable,
            ]
            .into_iter()
            .flatten()
            {
                if value.len() > 4096
                    || value.contains('\0')
                    || value.contains('\n')
                    || value.contains('\r')
                    || value.starts_with('-')
                {
                    return Err("Invalid model or executable override.".into());
                }
            }
        }
        for default in Settings::default().presets {
            if !self
                .presets
                .iter()
                .any(|p| p.id == default.id && p.template_id == default.template_id)
            {
                return Err("Keep the three default presets as recovery options.".into());
            }
        }
        if !ids.contains(&self.selected_preset_id) {
            return Err("Select an existing preset.".into());
        }
        if let Some(b) = &self.bounds {
            if ![b.x, b.y, b.width, b.height].iter().all(|v| v.is_finite())
                || !(560.0..=10000.0).contains(&b.width)
                || !(420.0..=10000.0).contains(&b.height)
            {
                return Err("Invalid saved window bounds.".into());
            }
        }
        self.placement.validate()?;
        if serde_json::to_vec_pretty(self)
            .map_err(|_| "Could not encode settings.")?
            .len()
            > 1024 * 1024
        {
            return Err("Settings exceed the 1 MiB storage limit. Reduce template arguments or preset count.".into());
        }
        Ok(())
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsEnvelope {
    pub settings: Settings,
    pub warning: Option<String>,
    pub read_only: bool,
}

pub struct Store {
    path: PathBuf,
    pub envelope: SettingsEnvelope,
}

impl Store {
    pub fn load(directory: &Path) -> Self {
        let path = directory.join("settings.json");
        let mut envelope = SettingsEnvelope {
            settings: Settings::default(),
            warning: None,
            read_only: false,
        };
        match fs::read(&path) {
            Ok(bytes) => {
                let parsed = if bytes.len() > 1024 * 1024 {
                    Err("Settings file exceeds the safety limit.".to_string())
                } else {
                    decode_settings(&bytes)
                        .map_err(|_| {
                            "Settings are unreadable or use an unsupported schema.".to_string()
                        })
                        .and_then(|s| {
                            s.validate()?;
                            Ok(s)
                        })
                };
                match parsed {
                    Ok(settings) => envelope.settings = settings,
                    Err(message) => {
                        envelope.read_only = true;
                        envelope.warning = Some(format!("{message} Original file preserved. Restore settings.backup.json or move settings.json aside in Ramble’s application-data folder, then restart. Using temporary defaults."));
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => {
                envelope.read_only = true;
                envelope.warning = Some("Could not read settings. Check application-data folder permissions and restart. Settings are read-only.".into());
            }
        }
        Self { path, envelope }
    }

    pub fn update(
        &mut self,
        expected_revision: u64,
        mut settings: Settings,
    ) -> Result<SettingsEnvelope, String> {
        if self.envelope.read_only {
            return Err(
                "Settings are read-only to protect the original file. Repair it and restart."
                    .into(),
            );
        }
        if expected_revision != self.envelope.settings.revision {
            return Err("SettingsConflict: settings changed. Reopen Settings and retry.".into());
        }
        settings.revision = expected_revision
            .checked_add(1)
            .ok_or("Settings revision overflow.")?;
        settings.validate()?;
        let parent = self
            .path
            .parent()
            .ok_or("Settings directory unavailable.")?;
        fs::create_dir_all(parent).map_err(|_| "Could not create the application-data folder.")?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(parent, fs::Permissions::from_mode(0o700))
                .map_err(|_| "Could not protect settings directory.")?;
        }
        if self.path.exists() {
            let old = fs::read(&self.path).map_err(|_| "Could not back up settings.")?;
            atomic_write(&parent.join("settings.backup.json"), &old)?;
        }
        atomic_write(
            &self.path,
            &serde_json::to_vec_pretty(&settings).map_err(|_| "Could not encode settings.")?,
        )?;
        self.envelope.settings = settings;
        Ok(self.envelope.clone())
    }
}

fn decode_settings(bytes: &[u8]) -> Result<Settings, String> {
    let mut value: serde_json::Value =
        serde_json::from_slice(bytes).map_err(|_| "Invalid settings JSON.")?;
    if value["schemaVersion"] == 1 {
        // V1 never allowed custom/editable templates. Preserve every preset parameter,
        // default style, binding, bounds and revision; replace only the old blocked bases.
        let defaults = Settings::default();
        let legacy = value["templates"]
            .as_array()
            .ok_or("Invalid legacy templates.")?;
        if legacy.len() != 3
            || defaults
                .templates
                .iter()
                .any(|d| legacy.iter().filter(|t| t["id"] == d.id).count() != 1)
        {
            return Err(
                "Unrecognized legacy templates; preserve the file for manual migration.".into(),
            );
        }
        value["templates"] =
            serde_json::to_value(defaults.templates).map_err(|_| "Could not migrate templates.")?;
        value["schemaVersion"] = 2.into();
    }
    if value["schemaVersion"] == 2 {
        value["placement"] = serde_json::to_value(crate::placement::PlacementSettings::default())
            .map_err(|_| "Could not migrate placement settings.")?;
        for dimension in ["width", "height"] {
            if value["bounds"][dimension].is_number() {
                value["placement"]["default"][dimension] = value["bounds"][dimension].clone();
            }
        }
        value["schemaVersion"] = 3.into();
    }
    if value["schemaVersion"] == 3 {
        let bases: serde_json::Value =
            serde_json::from_str(include_str!("legacy-templates-v3.json"))
                .map_err(|_| "Invalid migration resource.")?;
        let defaults = Settings::default();
        let mut upgraded = HashSet::new();
        for template in value["templates"]
            .as_array_mut()
            .ok_or("Invalid templates.")?
        {
            if template.get("command").is_none() {
                let executable = template["executable"]
                    .as_str()
                    .ok_or("Invalid legacy executable.")?;
                let args: Vec<crate::templates::ArgNode> =
                    serde_json::from_value(template["args"].clone())
                        .map_err(|_| "Invalid legacy arguments.")?;
                let mut command = crate::templates::legacy_command(executable, &args)?;
                // Only untouched starting invocations gain the new effort slot.
                // Custom commands keep their exact argv/optional-group semantics.
                if let Some(base) = template["id"].as_str().and_then(|id| bases.get(id)) {
                    if ["executable", "args", "promptTransport", "parser"]
                        .iter()
                        .all(|key| template[*key] == base[*key])
                    {
                        if let Some(default) =
                            defaults.templates.iter().find(|t| template["id"] == t.id)
                        {
                            command = default.command.clone();
                            upgraded.insert(default.id.clone());
                        }
                    }
                }
                let object = template.as_object_mut().ok_or("Invalid legacy template.")?;
                object.remove("executable");
                object.remove("args");
                object.insert("command".into(), command.into());
            } else if let Some(default) = defaults.templates.iter().find(|t| {
                template["id"] == t.id
                    && template["command"] == t.command
                    && template["promptTransport"] == t.prompt_transport
                    && template.get("parser").is_none()
            }) {
                // Schema 1 has just replaced its blocked bases with current ones.
                upgraded.insert(default.id.clone());
            }
        }
        for preset in value["presets"].as_array_mut().ok_or("Invalid presets.")? {
            if let Some(default) = defaults.presets.iter().find(|p| {
                preset["id"] == p.id
                    && preset["templateId"] == p.template_id
                    && upgraded.contains(&p.template_id)
            }) {
                let parameters = preset["parameters"]
                    .as_object()
                    .ok_or("Invalid preset parameters.")?;
                if parameters.is_empty() {
                    preset["parameters"] = serde_json::to_value(&default.parameters)
                        .map_err(|_| "Could not migrate preset defaults.")?;
                }
            }
        }
        value["schemaVersion"] = 4.into();
    }
    if value["schemaVersion"] == 4 {
        let bases: serde_json::Value =
            serde_json::from_str(include_str!("legacy-templates-v4.json"))
                .map_err(|_| "Invalid migration resource.")?;
        let defaults = Settings::default();
        for template in value["templates"]
            .as_array_mut()
            .ok_or("Invalid templates.")?
        {
            if let Some(parser) = template.get("parser") {
                if !["plain", "opencode-jsonl", "codex-jsonl", "claude-json"]
                    .iter()
                    .any(|known| parser == known)
                {
                    return Err(
                        "Unsupported legacy output parser; original settings preserved.".into(),
                    );
                }
            }
            if let Some(base) = template["id"].as_str().and_then(|id| bases.get(id)) {
                if ["command", "promptTransport", "parser"]
                    .iter()
                    .all(|key| template[*key] == base[*key])
                {
                    if let Some(default) =
                        defaults.templates.iter().find(|t| template["id"] == t.id)
                    {
                        template["command"] = default.command.clone().into();
                    }
                }
            }
            template
                .as_object_mut()
                .ok_or("Invalid template.")?
                .remove("parser");
        }
        value["schemaVersion"] = 5.into();
    }
    if value["schemaVersion"] == 5 {
        for (dimension, fallback) in [("width", 640.0), ("height", 480.0)] {
            let saved = value["bounds"][dimension].as_f64().unwrap_or(fallback);
            value["placement"]["default"]
                .as_object_mut()
                .ok_or("Invalid default placement.")?
                .entry(dimension)
                .or_insert_with(|| saved.into());
            for override_ in value["placement"]["overrides"]
                .as_array_mut()
                .ok_or("Invalid placement overrides.")?
            {
                override_["rule"]
                    .as_object_mut()
                    .ok_or("Invalid placement rule.")?
                    .entry(dimension)
                    .or_insert(serde_json::Value::Null);
            }
        }
        value["schemaVersion"] = 6.into();
    }
    serde_json::from_value(value).map_err(|_| "Unsupported settings shape.".into())
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut temporary =
        tempfile::NamedTempFile::new_in(path.parent().ok_or("Settings directory unavailable.")?)
            .map_err(|_| "Could not create settings temporary file.")?;
    temporary
        .write_all(bytes)
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|_| "Could not flush settings.")?;
    // tempfile uses atomic replacement (including ReplaceFile/MoveFileEx on Windows).
    temporary
        .persist(path)
        .map_err(|_| "Could not atomically replace settings.")?;
    #[cfg(unix)]
    fs::File::open(path.parent().unwrap())
        .and_then(|d| d.sync_all())
        .map_err(|_| "Could not sync settings directory.")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn settings_roundtrip_backup_and_conflict() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::load(dir.path());
        let mut s = store.envelope.settings.clone();
        s.default_style = "".into();
        store.update(0, s.clone()).unwrap();
        assert!(store.update(0, s).is_err());
        let mut s = store.envelope.settings.clone();
        s.theme = "light".into();
        store.update(1, s).unwrap();
        assert_eq!(Store::load(dir.path()).envelope.settings.revision, 2);
        assert_eq!(
            serde_json::from_slice::<Settings>(
                &fs::read(dir.path().join("settings.backup.json")).unwrap()
            )
            .unwrap()
            .revision,
            1
        );
    }
    #[test]
    fn corrupt_or_future_settings_are_not_overwritten() {
        for data in ["private broken bytes", "{\"schemaVersion\":99}"] {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("settings.json");
            fs::write(&path, data).unwrap();
            let mut store = Store::load(dir.path());
            assert!(store.envelope.read_only);
            assert!(store.update(0, Settings::default()).is_err());
            assert_eq!(fs::read_to_string(path).unwrap(), data);
        }
    }
    #[test]
    fn rejects_invalid_templates_and_unknown_fields() {
        let mut s = Settings::default();
        s.templates[0].command = "writer \"unclosed".into();
        assert!(s.validate().is_err());
        let mut json = serde_json::to_value(Settings::default()).unwrap();
        json["draft"] = "secret".into();
        assert!(serde_json::from_value::<Settings>(json).is_err());
    }

    #[test]
    fn migration_preserves_saved_values_and_custom_preset_parameters() {
        let directory = tempfile::tempdir().unwrap();
        let mut legacy = serde_json::to_value(Settings::default()).unwrap();
        legacy["schemaVersion"] = 1.into();
        legacy["hotkey"] = "Control+Alt+K".into();
        legacy["defaultStyle"] = "Custom saved style".into();
        legacy["presets"][0]["parameters"]["model"] = "provider/custom".into();
        legacy["templates"] = serde_json::json!([
            {"id":"opencode","availability":"blocked"}, {"id":"codex","availability":"blocked"}, {"id":"claude","availability":"blocked"}
        ]);
        let original = serde_json::to_vec(&legacy).unwrap();
        fs::write(directory.path().join("settings.json"), &original).unwrap();
        let mut store = Store::load(directory.path());
        assert!(!store.envelope.read_only);
        assert_eq!(store.envelope.settings.schema_version, 6);
        assert_eq!(store.envelope.settings.hotkey, "Control+Alt+K");
        assert_eq!(store.envelope.settings.default_style, "Custom saved style");
        assert_eq!(
            store.envelope.settings.presets[0]
                .parameters
                .model
                .as_deref(),
            Some("provider/custom")
        );
        let settings = store.envelope.settings.clone();
        store.update(0, settings).unwrap();
        assert_eq!(
            fs::read(directory.path().join("settings.backup.json")).unwrap(),
            original
        );
        assert_eq!(
            Store::load(directory.path())
                .envelope
                .settings
                .schema_version,
            6
        );
    }

    #[test]
    fn schema_two_adds_placement_without_changing_custom_settings() {
        let directory = tempfile::tempdir().unwrap();
        let mut expected = Settings {
            revision: 7,
            hotkey: "Control+Alt+K".into(),
            default_style: "Keep my custom style".into(),
            ..Default::default()
        };
        expected.templates[0].command = "\"custom-writer\" \"--custom\"".into();
        expected.templates[0].prompt_transport = "stdin".into();
        expected.presets[0].parameters.model = Some("my-model".into());
        expected.bounds = Some(Bounds {
            x: -700.0,
            y: 30.0,
            width: 640.0,
            height: 700.0,
        });
        expected.placement.default.height = Some(700.0);
        let mut legacy = serde_json::to_value(&expected).unwrap();
        legacy["schemaVersion"] = 2.into();
        legacy.as_object_mut().unwrap().remove("placement");
        legacy["templates"][0]
            .as_object_mut()
            .unwrap()
            .remove("command");
        legacy["templates"][0]["executable"] = "custom-writer".into();
        legacy["templates"][0]["args"] =
            serde_json::json!([{ "kind": "literal", "value": "--custom" }]);
        let original = serde_json::to_vec(&legacy).unwrap();
        fs::write(directory.path().join("settings.json"), &original).unwrap();
        let mut store = Store::load(directory.path());
        assert!(!store.envelope.read_only);
        assert_eq!(store.envelope.settings, expected);
        store.update(7, expected).unwrap();
        assert_eq!(
            fs::read(directory.path().join("settings.backup.json")).unwrap(),
            original
        );
    }

    #[test]
    fn placement_overrides_and_compact_bounds_survive_restart() {
        use crate::placement::{Anchor, ApplicationOverride, PlacementRule};
        let directory = tempfile::tempdir().unwrap();
        let mut store = Store::load(directory.path());
        let mut settings = Settings {
            bounds: Some(Bounds {
                x: -600.0,
                y: 40.0,
                width: 560.0,
                height: 420.0,
            }),
            ..Default::default()
        };
        settings.placement.overrides.push(ApplicationOverride {
            application_id: "com.example.editor".into(),
            application_name: "Editor".into(),
            rule: PlacementRule {
                anchor: Anchor::TopRight,
                offset_x: -24.5,
                offset_y: 16.0,
                width: Some(800.0),
                height: Some(600.0),
            },
        });
        let expected = store.update(0, settings).unwrap().settings;
        assert_eq!(Store::load(directory.path()).envelope.settings, expected);
        let mut invalid = expected;
        invalid.bounds.as_mut().unwrap().height = 419.0;
        assert!(invalid.validate().is_err());
        invalid.bounds.as_mut().unwrap().height = 480.0;
        invalid.placement.overrides[0].rule.offset_y = 4097.0;
        assert!(invalid.validate().is_err());
    }

    #[test]
    fn legacy_custom_commands_migrate_losslessly_and_untouched_bases_gain_effort() {
        use crate::templates::{self, ArgNode};
        use std::collections::BTreeMap;
        let bases: serde_json::Value =
            serde_json::from_str(include_str!("legacy-templates-v3.json")).unwrap();
        let literal = "literal {{MODEL_ID}} [[text]] \\\"quotes\\\"\n$(touch nope)";
        let custom_args = vec![
            ArgNode::Literal(literal.into()),
            ArgNode::Literal("".into()),
            ArgNode::OptionalGroup {
                when_present: "model".into(),
                args: vec![
                    ArgNode::Literal("--choose".into()),
                    ArgNode::Parameter("model".into()),
                    ArgNode::Literal("tail".into()),
                ],
            },
            ArgNode::Parameter("prompt".into()),
        ];
        for schema in [2, 3] {
            let directory = tempfile::tempdir().unwrap();
            let mut legacy = serde_json::to_value(Settings::default()).unwrap();
            legacy["schemaVersion"] = schema.into();
            for t in legacy["templates"].as_array_mut().unwrap() {
                let base = &bases[t["id"].as_str().unwrap()];
                t.as_object_mut().unwrap().remove("command");
                for key in ["executable", "args", "promptTransport", "parser"] {
                    t[key] = base[key].clone();
                }
            }
            legacy["templates"][0]["args"] = serde_json::to_value(&custom_args).unwrap();
            for preset in legacy["presets"].as_array_mut().unwrap() {
                preset["parameters"] = serde_json::json!({});
            }
            let original = serde_json::to_vec(&legacy).unwrap();
            fs::write(directory.path().join("settings.json"), &original).unwrap();
            let mut store = Store::load(directory.path());
            assert!(!store.envelope.read_only);
            let migrated = &store.envelope.settings;
            let (_, nodes) = templates::parse_command(&migrated.templates[0].command).unwrap();
            for model in [None, Some("my model with spaces")] {
                let mut values =
                    BTreeMap::from([("prompt".into(), "{{PROMPT}} remains literal".into())]);
                if let Some(model) = model {
                    values.insert("model".into(), model.into());
                }
                assert_eq!(
                    templates::compile(&nodes, &values).unwrap(),
                    templates::compile(&custom_args, &values).unwrap()
                );
            }
            assert_eq!(
                migrated.templates[1].command,
                Settings::default().templates[1].command
            );
            assert_eq!(
                migrated.presets[1].parameters,
                Settings::default().presets[1].parameters
            );
            assert_eq!(migrated.presets[0].parameters, Parameters::default());
            let settings = migrated.clone();
            store.update(0, settings).unwrap();
            assert_eq!(
                fs::read(directory.path().join("settings.backup.json")).unwrap(),
                original
            );
        }
    }

    #[test]
    fn schema_four_removes_parser_choices_preserving_custom_commands_and_values() {
        let directory = tempfile::tempdir().unwrap();
        let mut expected = Settings::default();
        expected.templates[0].command = "my-custom-runtime --format json {{PROMPT}}".into();
        expected.presets[0].parameters.model = Some("custom/model".into());
        expected.presets[0].parameters.reasoning_effort = Some("low".into());
        expected.default_style = "my style".into();
        expected.hotkey = "Control+Alt+K".into();
        let bases: serde_json::Value =
            serde_json::from_str(include_str!("legacy-templates-v4.json")).unwrap();
        let mut legacy = serde_json::to_value(&expected).unwrap();
        legacy["schemaVersion"] = 4.into();
        for template in legacy["templates"].as_array_mut().unwrap() {
            let base = &bases[template["id"].as_str().unwrap()];
            template["parser"] = base["parser"].clone();
            if template["id"] != "opencode" {
                template["command"] = base["command"].clone();
            }
        }
        let original = serde_json::to_vec(&legacy).unwrap();
        fs::write(directory.path().join("settings.json"), &original).unwrap();
        let mut store = Store::load(directory.path());
        assert!(!store.envelope.read_only);
        assert_eq!(store.envelope.settings, expected);
        assert!(
            serde_json::to_value(&store.envelope.settings).unwrap()["templates"][0]
                .get("parser")
                .is_none()
        );
        store.update(0, expected).unwrap();
        assert_eq!(
            fs::read(directory.path().join("settings.backup.json")).unwrap(),
            original
        );
    }

    #[test]
    fn schema_five_adds_dimensions_preserving_saved_bounds_and_custom_rules() {
        for bounds in [
            None,
            Some(Bounds {
                x: -700.0,
                y: 30.0,
                width: 800.0,
                height: 600.0,
            }),
        ] {
            let directory = tempfile::tempdir().unwrap();
            let mut expected = Settings {
                bounds,
                hotkey: "Control+Alt+K".into(),
                ..Default::default()
            };
            expected.templates[0].command = "custom-cli {{PROMPT}}".into();
            expected.presets[0].parameters.model = Some("custom/model".into());
            expected
                .placement
                .overrides
                .push(crate::placement::ApplicationOverride {
                    application_id: "editor".into(),
                    application_name: "Editor".into(),
                    rule: crate::placement::PlacementRule {
                        anchor: crate::placement::Anchor::TopRight,
                        offset_x: -24.0,
                        ..Default::default()
                    },
                });
            if let Some(bounds) = &expected.bounds {
                expected.placement.default.width = Some(bounds.width);
                expected.placement.default.height = Some(bounds.height);
            }
            let mut legacy = serde_json::to_value(&expected).unwrap();
            legacy["schemaVersion"] = 5.into();
            for dimension in ["width", "height"] {
                legacy["placement"]["default"]
                    .as_object_mut()
                    .unwrap()
                    .remove(dimension);
                legacy["placement"]["overrides"][0]["rule"]
                    .as_object_mut()
                    .unwrap()
                    .remove(dimension);
            }
            let original = serde_json::to_vec(&legacy).unwrap();
            fs::write(directory.path().join("settings.json"), &original).unwrap();
            let mut store = Store::load(directory.path());
            assert!(!store.envelope.read_only);
            assert_eq!(store.envelope.settings, expected);
            store.update(0, expected).unwrap();
            assert_eq!(
                fs::read(directory.path().join("settings.backup.json")).unwrap(),
                original
            );
            assert_eq!(
                Store::load(directory.path())
                    .envelope
                    .settings
                    .placement
                    .overrides[0]
                    .rule
                    .width,
                None
            );
        }
    }

    #[test]
    fn custom_command_templates_are_allowed_but_invalid_transport_is_rejected() {
        let mut settings = Settings::default();
        let mut template = settings.templates[0].clone();
        template.id = "any-cli".into();
        template.name = "Custom".into();
        template.command = "any-executable --any-flag".into();
        template.prompt_transport = "stdin".into();
        settings.templates.push(template);
        settings.validate().unwrap();
        settings.templates.last_mut().unwrap().prompt_transport = "argument".into();
        assert!(settings.validate().is_err());
    }
}
