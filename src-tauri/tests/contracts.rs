use ramble_lib::{
    build::{BuildOutcome, BuildRequest},
    settings::Settings,
};

#[test]
fn bundled_settings_and_ipc_fixtures_roundtrip_without_type_drift() {
    let bundled: serde_json::Value =
        serde_json::from_str(include_str!("../../src/domain/builtins.json")).unwrap();
    let settings: Settings = serde_json::from_value(bundled.clone()).unwrap();
    settings.validate().unwrap();
    assert_eq!(serde_json::to_value(settings).unwrap(), bundled);
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("../../tests/fixtures/contracts.json")).unwrap();
    let request: BuildRequest = serde_json::from_value(fixture["request"].clone()).unwrap();
    let preferences: ramble_lib::placement::PlacementSettings =
        serde_json::from_value(fixture["placementSettings"].clone()).unwrap();
    preferences.validate().unwrap();
    assert_eq!(
        serde_json::to_value(preferences).unwrap(),
        fixture["placementSettings"]
    );
    let outcome: BuildOutcome = serde_json::from_value(fixture["outcome"].clone()).unwrap();
    let diagnostic: ramble_lib::diagnostics::HarnessOutput =
        serde_json::from_value(fixture["harnessOutput"].clone()).unwrap();
    assert_eq!(
        serde_json::to_value(diagnostic).unwrap(),
        fixture["harnessOutput"]
    );
    let preview: ramble_lib::harness::BuildPreview =
        serde_json::from_value(fixture["buildPreview"].clone()).unwrap();
    assert_eq!(
        serde_json::to_value(preview).unwrap(),
        fixture["buildPreview"]
    );
    let placement: ramble_lib::placement::PlacementContext =
        serde_json::from_value(fixture["placementContext"].clone()).unwrap();
    assert_eq!(
        serde_json::to_value(placement).unwrap(),
        fixture["placementContext"]
    );
    assert_eq!(serde_json::to_value(request).unwrap(), fixture["request"]);
    assert_eq!(serde_json::to_value(outcome).unwrap(), fixture["outcome"]);
}

#[test]
fn summon_default_uses_control_on_both_platforms_and_preserves_saved_customizations() {
    assert_eq!(Settings::default().hotkey, "Control+Shift+Y");
    let directory = tempfile::tempdir().unwrap();
    let mut store = ramble_lib::settings::Store::load(directory.path());
    let mut settings = store.envelope.settings.clone();
    settings.hotkey = "Control+Alt+K".into();
    store.update(0, settings).unwrap();
    assert_eq!(
        ramble_lib::settings::Store::load(directory.path())
            .envelope
            .settings
            .hotkey,
        "Control+Alt+K"
    );
}

#[test]
fn macos_overlay_preserves_shared_window_geometry_and_drag_permission() {
    let base: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
    let mac: serde_json::Value =
        serde_json::from_str(include_str!("../tauri.macos.conf.json")).unwrap();
    let base_window = &base["app"]["windows"][0];
    let mac_window = &mac["app"]["windows"][0];
    assert_eq!(base_window["width"], 640);
    assert_eq!(base_window["height"], 480);
    assert_eq!(base_window["minWidth"], 560);
    assert_eq!(base_window["minHeight"], 420);
    for key in ["width", "height", "minWidth", "minHeight", "alwaysOnTop"] {
        assert_eq!(base_window[key], mac_window[key]);
    }
    assert_eq!(mac_window["titleBarStyle"], "Overlay");
    assert_eq!(mac_window["hiddenTitle"], true);
    let capability: serde_json::Value =
        serde_json::from_str(include_str!("../capabilities/main.json")).unwrap();
    assert!(capability["permissions"]
        .as_array()
        .unwrap()
        .iter()
        .any(|p| p == "core:window:allow-start-dragging"));
}
