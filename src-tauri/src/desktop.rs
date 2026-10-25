use crate::{
    build::{BuildOutcome, BuildRequest},
    coordinator::{Coordinator, RunStatus},
    desktop_platform, harness,
    placement::{Application, PlacementContext},
    settings::{Bounds, Settings, SettingsEnvelope, Store},
};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Mutex,
};
use tauri::{Emitter, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

struct DesktopState {
    settings: Mutex<Store>,
    builds: Coordinator,
    dirty: AtomicBool,
    quitting: AtomicBool,
    last_application: Mutex<Option<Application>>,
    return_focus: Mutex<Option<desktop_platform::FocusReturnTarget>>,
    paste_epoch: AtomicU64,
    placement_message: Mutex<Option<String>>,
}

#[derive(Clone, Copy)]
enum ShowIntent {
    Resume,
    NewDraft,
}

impl ShowIntent {
    fn event(self) -> &'static str {
        match self {
            Self::Resume => "ramble:focus",
            Self::NewDraft => "ramble:summon",
        }
    }
}

fn show(app: &tauri::AppHandle) {
    show_with_intent(app, ShowIntent::Resume);
}
fn summon(app: &tauri::AppHandle) {
    show_with_intent(app, ShowIntent::NewDraft);
}

fn show_with_intent(app: &tauri::AppHandle, intent: ShowIntent) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || show_on_main(&handle, intent));
}

fn show_on_main(app: &tauri::AppHandle, intent: ShowIntent) {
    if let Some(window) = app.get_webview_window("main") {
        let state = app.state::<DesktopState>();
        state.paste_epoch.fetch_add(1, Ordering::Relaxed);
        let settings = state
            .settings
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .envelope
            .settings
            .window_placement();
        // Capture BEFORE show/unminimize/set_focus: afterwards the foreground app is Ramble.
        let captured = desktop_platform::capture_focus(settings.enabled);
        let target = &captured.target;
        desktop_platform::remember_return_target(
            &mut state.return_focus.lock().unwrap_or_else(|e| e.into_inner()),
            target.is_ramble,
            captured.return_target,
        );
        if let Some(application) = target.application.clone() {
            *state
                .last_application
                .lock()
                .unwrap_or_else(|e| e.into_inner()) = Some(application);
        }
        let message = match desktop_platform::place(&window, target, &settings) {
            Ok(message) => message,
            Err(error) => {
                let _ = window.center();
                Some(format!("Focused-window placement unavailable: {error}"))
            }
        };
        *state
            .placement_message
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = message.clone();
        // Change policy only after capturing the external focus target. Accessory
        // keeps the menu-bar app running without a Dock icon while hidden.
        #[cfg(target_os = "macos")]
        let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        let _ = app.emit(intent.event(), ());
        let _ = app.emit("ramble:placement", message);
    }
}

async fn on_main<T: Send + 'static>(
    app: tauri::AppHandle,
    action: impl FnOnce() -> T + Send + 'static,
) -> Result<T, String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let _ = sender.send(action());
    })
    .map_err(|_| "Desktop main thread unavailable.")?;
    receiver
        .await
        .map_err(|_| "Desktop operation interrupted.".into())
}

#[tauri::command]
async fn get_placement_context(app: tauri::AppHandle) -> Result<PlacementContext, String> {
    let handle = app.clone();
    on_main(app, move || {
        let state = handle.state::<DesktopState>();
        let last_application = state
            .last_application
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        let message = state
            .placement_message
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        PlacementContext {
            applications: desktop_platform::applications(),
            last_application,
            message,
            accessibility_required: cfg!(target_os = "macos"),
            accessibility_granted: desktop_platform::accessibility_granted(),
        }
    })
    .await
}

#[tauri::command]
fn get_placement_message(state: tauri::State<'_, DesktopState>) -> Option<String> {
    state
        .placement_message
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
}

#[tauri::command]
async fn request_placement_access(app: tauri::AppHandle) -> Result<bool, String> {
    on_main(app, desktop_platform::request_access).await
}

#[tauri::command]
fn get_settings(state: tauri::State<'_, DesktopState>) -> Result<SettingsEnvelope, String> {
    Ok(state
        .settings
        .lock()
        .map_err(|_| "Settings unavailable.")?
        .envelope
        .clone())
}

#[tauri::command]
async fn update_settings(
    app: tauri::AppHandle,
    expected_revision: u64,
    settings: Settings,
) -> Result<SettingsEnvelope, String> {
    let handle = app.clone();
    on_main(app, move || {
        update_settings_on_main(&handle, expected_revision, settings)
    })
    .await?
}

fn update_settings_on_main(
    app: &tauri::AppHandle,
    expected_revision: u64,
    mut settings: Settings,
) -> Result<SettingsEnvelope, String> {
    let state = app.state::<DesktopState>();
    save_bounds(app);
    let mut store = state.settings.lock().map_err(|_| "Settings unavailable.")?;
    if expected_revision != store.envelope.settings.revision {
        return Err("SettingsConflict: reopen Settings and retry.".into());
    }
    let old = store.envelope.settings.hotkey.clone();
    settings.bounds = store.envelope.settings.bounds.clone();
    settings.normalize_window_bounds();
    settings.validate()?;
    if old != settings.hotkey {
        app.global_shortcut().register(settings.hotkey.as_str()).map_err(|_| "Shortcut unavailable or invalid. Choose another shortcut; the previous binding is still active.")?;
    }
    match store.update(expected_revision, settings.clone()) {
        Ok(mut envelope) => {
            if old != settings.hotkey {
                let _ = app.global_shortcut().unregister(old.as_str());
                if envelope
                    .warning
                    .as_deref()
                    .is_some_and(|w| w.starts_with("The global shortcut"))
                {
                    envelope.warning = None;
                    store.envelope.warning = None;
                }
            }
            drop(store);
            if let Some(window) = app.get_webview_window("main") {
                if apply_window_mode(&window, &settings).is_err() {
                    envelope.warning = Some("Settings saved, but the native window minimum could not be updated. Restart Ramble to apply the window mode.".into());
                }
            }
            Ok(envelope)
        }
        Err(error) => {
            if old != settings.hotkey {
                let _ = app.global_shortcut().unregister(settings.hotkey.as_str());
            }
            Err(error)
        }
    }
}

fn apply_window_mode(window: &tauri::WebviewWindow, settings: &Settings) -> Result<(), String> {
    let (width, height) = settings.minimum_window_size();
    window
        .set_min_size(Some(tauri::LogicalSize::new(width, height)))
        .map_err(|_| "Could not update window minimum.")?;
    let size = window
        .inner_size()
        .map_err(|_| "Could not read window size.")?;
    let scale = window
        .scale_factor()
        .map_err(|_| "Could not read window scale.")?;
    let current_width = size.width as f64 / scale;
    let current_height = size.height as f64 / scale;
    if current_width < width || current_height < height {
        window
            .set_size(tauri::LogicalSize::new(
                current_width.max(width),
                current_height.max(height),
            ))
            .map_err(|_| "Could not restore regular window minimum.")?;
    }
    Ok(())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Inspection {
    resolved_path: Option<String>,
    limitation: String,
}

#[tauri::command]
fn inspect_preset(
    state: tauri::State<'_, DesktopState>,
    preset_id: String,
) -> Result<Inspection, String> {
    let store = state.settings.lock().map_err(|_| "Settings unavailable.")?;
    let settings = &store.envelope.settings;
    let preset = settings
        .presets
        .iter()
        .find(|p| p.id == preset_id)
        .ok_or("Preset not found. Save new settings before inspecting.")?;
    let template = settings
        .templates
        .iter()
        .find(|t| t.id == preset.template_id)
        .ok_or("Template not found.")?;
    Ok(Inspection {
        // Inspection resolves only the literal executable; it never launches it.
        resolved_path: harness::resolve_executable(
            preset
                .parameters
                .executable
                .as_deref()
                .unwrap_or(&crate::templates::parse_command(&template.command)?.0),
        )
        .map(|p| p.to_string_lossy().into_owned()),
        limitation: template.description.clone(),
    })
}

#[tauri::command]
fn preview_build(
    state: tauri::State<'_, DesktopState>,
    request: BuildRequest,
) -> Result<serde_json::Value, String> {
    let settings = state
        .settings
        .lock()
        .map_err(|_| "Settings unavailable.")?
        .envelope
        .settings
        .clone();
    serde_json::to_value(harness::preview(&settings, &request)?)
        .map_err(|_| "Could not encode command preview.".into())
}

#[tauri::command]
fn take_harness_output(
    state: tauri::State<'_, DesktopState>,
    run_id: String,
) -> Result<crate::diagnostics::HarnessOutput, String> {
    state.builds.take_harness_output(&run_id)
}

#[tauri::command]
fn discard_harness_output(
    state: tauri::State<'_, DesktopState>,
    run_id: String,
) -> Result<(), String> {
    state.builds.discard_harness_output(&run_id)
}

#[tauri::command]
async fn start_build(
    state: tauri::State<'_, DesktopState>,
    request: BuildRequest,
) -> Result<BuildOutcome, String> {
    let settings = state
        .settings
        .lock()
        .map_err(|_| "Settings unavailable.")?
        .envelope
        .settings
        .clone();
    state.builds.build(request, settings).await
}

#[tauri::command]
fn cancel_build(state: tauri::State<'_, DesktopState>, run_id: String) -> Result<(), String> {
    state.builds.cancel(&run_id)
}

#[tauri::command]
fn abandon_build(state: tauri::State<'_, DesktopState>, run_id: String) -> Result<(), String> {
    state.builds.abandon(&run_id)
}

#[tauri::command]
fn get_active_run(state: tauri::State<'_, DesktopState>) -> Result<RunStatus, String> {
    state.builds.status()
}

#[tauri::command]
fn copy_result(app: tauri::AppHandle, text: String) -> Result<(), String> {
    if text.len() > 8 * 1024 * 1024 {
        return Err("Message is too large to copy.".into());
    }
    app.clipboard()
        .write_text(text)
        .map_err(|_| "Clipboard unavailable. Please try again.".into())
}

fn save_bounds(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if let (Ok(position), Ok(size), Ok(scale)) = (
            window.outer_position(),
            window.inner_size(),
            window.scale_factor(),
        ) {
            let state = app.state::<DesktopState>();
            if let Ok(mut store) = state.settings.lock() {
                let mut settings = store.envelope.settings.clone();
                settings.bounds = Some(Bounds {
                    x: position.x as f64 / scale,
                    y: position.y as f64 / scale,
                    width: size.width as f64 / scale,
                    height: size.height as f64 / scale,
                });
                // Bounds changes must not advance the frontend's optimistic settings revision.
                // Kept in memory here; persisted alongside the next explicit settings save/quit.
                store.envelope.settings.bounds = settings.bounds;
            };
        }
    }
}

#[tauri::command]
fn hide_window(app: tauri::AppHandle) {
    app.state::<DesktopState>()
        .paste_epoch
        .fetch_add(1, Ordering::Relaxed);
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        save_bounds(&handle);
        if let Some(window) = handle.get_webview_window("main") {
            let _ = hide_main_window(&handle, &window);
        }
    });
}

/// All dismiss paths share this main-thread operation. Do not remove the Dock
/// presence if hiding fails, and switch policy before restoring external focus.
fn hide_main_window(app: &tauri::AppHandle, window: &tauri::WebviewWindow) -> Result<(), String> {
    window
        .hide()
        .map_err(|_| "Ramble could not hide its window.".to_string())?;
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
    #[cfg(not(target_os = "macos"))]
    let _ = app;
    Ok(())
}

#[tauri::command]
async fn hide_and_restore_focus(app: tauri::AppHandle) -> Result<(), String> {
    let handle = app.clone();
    on_main(app, move || {
        let state = handle.state::<DesktopState>();
        state.paste_epoch.fetch_add(1, Ordering::Relaxed);
        let target = state
            .return_focus
            .lock()
            .map_err(|_| "Focus history unavailable.")?
            .clone();
        let was_foreground = desktop_platform::is_ramble_foreground();
        let window = handle
            .get_webview_window("main")
            .ok_or("Ramble window unavailable.")?;
        save_bounds(&handle);
        desktop_platform::hide_then_restore(
            was_foreground,
            target.as_ref(),
            || hide_main_window(&handle, &window),
            desktop_platform::restore_focus,
        )
    })
    .await?
}

/// One explicit user-requested paste only. Never a general keyboard/input API.
#[tauri::command]
async fn hide_restore_and_paste(app: tauri::AppHandle) -> Result<(), String> {
    use crate::paste::{Foreground, PasteGate, Step};
    let handle = app.clone();
    let (epoch, target) = on_main(app.clone(), move || {
        let state = handle.state::<DesktopState>();
        let epoch = state
            .paste_epoch
            .fetch_add(1, Ordering::Relaxed)
            .wrapping_add(1);
        desktop_platform::paste_preflight()?;
        if !desktop_platform::is_ramble_foreground() {
            return Err("Ramble is no longer focused. Paste was not sent.".to_string());
        }
        let target = state
            .return_focus
            .lock()
            .map_err(|_| "Focus history unavailable.")?
            .clone()
            .filter(desktop_platform::target_alive)
            .ok_or("The original app/window is no longer available. Paste was not sent.")?;
        let window = handle
            .get_webview_window("main")
            .ok_or("Ramble window unavailable.")?;
        save_bounds(&handle);
        desktop_platform::hide_then_restore(
            true,
            Some(&target),
            || hide_main_window(&handle, &window),
            desktop_platform::restore_focus,
        )?;
        Ok((epoch, target))
    })
    .await??;

    let start = std::time::Instant::now();
    let mut gate = PasteGate::default();
    loop {
        // Yield the native event loop so activation and physical key-up events can
        // complete. Never sleep on the desktop main thread or use a blind delay.
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        let handle = app.clone();
        let target = target.clone();
        let (next_gate, step) = on_main(app.clone(), move || {
            let mut gate = gate;
            let state = handle.state::<DesktopState>();
            let current = state.paste_epoch.load(Ordering::Relaxed) == epoch;
            let foreground = if desktop_platform::target_is_foreground(&target) { Foreground::Target }
                else if desktop_platform::is_ramble_foreground() { Foreground::Ramble } else { Foreground::Other };
            let step = gate.poll(start.elapsed(), current, desktop_platform::target_alive(&target), foreground, desktop_platform::paste_keys_released());
            match step {
                Step::Cancel => return Err("Paste cancelled: focus changed, the original app closed, a newer action replaced it, or shortcut keys were held too long. The message remains copied.".to_string()),
                Step::PasteOnce => desktop_platform::paste_once(&target)?,
                Step::Wait => {},
            }
            Ok((gate, step))
        }).await??;
        gate = next_gate;
        if step == Step::PasteOnce {
            return Ok(());
        }
    }
}

#[tauri::command]
fn set_draft_dirty(state: tauri::State<'_, DesktopState>, dirty: bool) {
    state.dirty.store(dirty, Ordering::Relaxed);
}

#[tauri::command]
async fn request_quit(
    app: tauri::AppHandle,
    state: tauri::State<'_, DesktopState>,
) -> Result<(), String> {
    state.paste_epoch.fetch_add(1, Ordering::Relaxed);
    // Only called after explicit confirmation. Join owned cleanup before exiting.
    state.builds.shutdown().await;
    save_bounds(&app);
    if let Ok(mut store) = state.settings.lock() {
        let settings = store.envelope.settings.clone();
        let revision = settings.revision;
        let _ = store.update(revision, settings);
    }
    state.quitting.store(true, Ordering::Relaxed);
    app.exit(0);
    Ok(())
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| show(app)))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().with_handler(|app, _, event| { if event.state() == ShortcutState::Pressed { summon(app); } }).build())
        .invoke_handler(tauri::generate_handler![get_settings, update_settings, inspect_preset, start_build, cancel_build, abandon_build, get_active_run, copy_result, hide_window, hide_and_restore_focus, hide_restore_and_paste, set_draft_dirty, request_quit, get_placement_context, get_placement_message, request_placement_access, preview_build, take_harness_output, discard_harness_output])
        .setup(|app| {
            let directory = app.path().app_data_dir()?;
            let store = Store::load(&directory);
            let hotkey = store.envelope.settings.hotkey.clone();
            let bounds = store.envelope.settings.bounds.clone();
            let window_settings = store.envelope.settings.clone();
            app.manage(DesktopState { settings: Mutex::new(store), builds: Coordinator::default(), dirty: AtomicBool::new(false), quitting: AtomicBool::new(false), last_application: Mutex::new(None), return_focus: Mutex::new(None), paste_epoch: AtomicU64::new(0), placement_message: Mutex::new(None) });
            let show_item = tauri::menu::MenuItem::with_id(app, "show", "Show Ramble", true, None::<&str>)?;
            let settings_item = tauri::menu::MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
            let quit_item = tauri::menu::MenuItem::with_id(app, "quit", "Quit Ramble", true, None::<&str>)?;
            let menu = tauri::menu::Menu::with_items(app, &[&show_item, &settings_item, &quit_item])?;
            #[cfg(target_os = "macos")]
            let icon = tauri::image::Image::from_bytes(include_bytes!("../../doc/brand/app/ramble-template-32.png"))?;
            #[cfg(not(target_os = "macos"))]
            let icon = tauri::image::Image::from_bytes(include_bytes!("../../doc/brand/app/ramble-32.png"))?;
            tauri::tray::TrayIconBuilder::new().icon(icon).icon_as_template(cfg!(target_os = "macos")).tooltip("Ramble — a little space to find your words").menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show(app),
                    "settings" => { show(app); let _ = app.emit("ramble:settings", ()); },
                    "quit" => { show(app); let _ = app.emit("ramble:quit", ()); }, _ => {}
                }).build(app)?;
            if app.global_shortcut().register(hotkey.as_str()).is_err() {
                app.state::<DesktopState>().settings.lock().unwrap().envelope.warning = Some("The global shortcut could not be registered. Use the tray/menu-bar entry to show Ramble, then choose a different shortcut in Settings.".into());
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = apply_window_mode(&window, &window_settings);
                if let Some(bounds) = bounds { let _ = window.set_size(tauri::LogicalSize::new(bounds.width, bounds.height)); let _ = window.set_position(tauri::LogicalPosition::new(bounds.x, bounds.y)); }
                let handle = app.handle().clone();
                window.on_window_event(move |event| { if let tauri::WindowEvent::CloseRequested { api, .. } = event { api.prevent_close(); hide_window(handle.clone()); } });
            }
            show(app.handle());
            Ok(())
        })
        .build(tauri::generate_context!()).expect("Could not start Ramble desktop services");
    app.run(|app, event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = event {
            if !app.state::<DesktopState>().quitting.load(Ordering::Relaxed) {
                api.prevent_exit();
                show(app);
                let _ = app.emit("ramble:quit", ());
            }
        }
    });
}

#[cfg(test)]
mod tests {
    #[test]
    fn only_shortcut_summons_request_a_new_draft() {
        assert_eq!(super::ShowIntent::NewDraft.event(), "ramble:summon");
        assert_eq!(super::ShowIntent::Resume.event(), "ramble:focus");
    }
}
