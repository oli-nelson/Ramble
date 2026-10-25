//! Native geometry/focus/input calls run on the desktop main thread. Only the
//! explicit guarded paste command may synthesize one OS paste shortcut.
use crate::placement::FocusTarget;
#[cfg(not(any(target_os = "macos", windows)))]
use crate::placement::{Application, PlacementSettings};

/// Native-only, transient capture. The return target is never serialized or saved.
#[derive(Default)]
pub struct CapturedFocus {
    pub target: FocusTarget,
    pub return_target: Option<FocusReturnTarget>,
}

pub fn remember_return_target<T>(saved: &mut Option<T>, is_ramble: bool, captured: Option<T>) {
    // Repeated summons while Ramble is focused must keep the original other app.
    // An unavailable external capture clears stale history instead of guessing.
    if !is_ramble {
        *saved = captured;
    }
}

pub fn hide_then_restore<T>(
    was_foreground: bool,
    target: Option<&T>,
    hide: impl FnOnce() -> Result<(), String>,
    restore: impl FnOnce(&T),
) -> Result<(), String> {
    hide()?;
    // Never steal focus if the user switched apps while clipboard IPC was pending.
    if was_foreground {
        if let Some(target) = target {
            restore(target);
        }
    }
    Ok(())
}

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::*;
#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use windows::*;

#[cfg(not(any(target_os = "macos", windows)))]
#[derive(Clone)]
pub struct FocusReturnTarget;
#[cfg(not(any(target_os = "macos", windows)))]
pub fn capture_focus(_: bool) -> CapturedFocus {
    CapturedFocus::default()
}
#[cfg(not(any(target_os = "macos", windows)))]
pub fn is_ramble_foreground() -> bool {
    false
}
#[cfg(not(any(target_os = "macos", windows)))]
pub fn restore_focus(_: &FocusReturnTarget) {}
#[cfg(not(any(target_os = "macos", windows)))]
pub fn target_alive(_: &FocusReturnTarget) -> bool {
    false
}
#[cfg(not(any(target_os = "macos", windows)))]
pub fn target_is_foreground(_: &FocusReturnTarget) -> bool {
    false
}
#[cfg(not(any(target_os = "macos", windows)))]
pub fn paste_preflight() -> Result<(), String> {
    Err("Paste is supported on macOS and Windows only.".into())
}
#[cfg(not(any(target_os = "macos", windows)))]
pub fn paste_keys_released() -> bool {
    false
}
#[cfg(not(any(target_os = "macos", windows)))]
pub fn paste_once(_: &FocusReturnTarget) -> Result<(), String> {
    paste_preflight()
}
#[cfg(not(any(target_os = "macos", windows)))]
pub fn applications() -> Vec<Application> {
    Vec::new()
}
#[cfg(not(any(target_os = "macos", windows)))]
pub fn accessibility_granted() -> bool {
    false
}
#[cfg(not(any(target_os = "macos", windows)))]
pub fn request_access() -> bool {
    false
}
#[cfg(not(any(target_os = "macos", windows)))]
pub fn place(
    _: &tauri::WebviewWindow,
    _: &FocusTarget,
    _: &PlacementSettings,
) -> Result<Option<String>, String> {
    Ok(Some(
        "Focused-window placement is supported on macOS and Windows only.".into(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[test]
    fn repeated_own_app_summons_preserve_origin_and_new_external_captures_replace_it() {
        let mut origin = None;
        remember_return_target(&mut origin, false, Some(42));
        remember_return_target(&mut origin, true, None);
        assert_eq!(origin, Some(42));
        remember_return_target(&mut origin, false, Some(77));
        assert_eq!(origin, Some(77));
        remember_return_target(&mut origin, false, None);
        assert_eq!(origin, None);
    }

    #[test]
    fn focus_is_restored_only_after_successful_hide_while_ramble_was_foreground() {
        let calls = RefCell::new(Vec::new());
        hide_then_restore(
            true,
            Some(&42),
            || {
                calls.borrow_mut().push("hide");
                Ok(())
            },
            |_| calls.borrow_mut().push("restore"),
        )
        .unwrap();
        assert_eq!(*calls.borrow(), ["hide", "restore"]);
        calls.borrow_mut().clear();
        assert!(hide_then_restore(
            true,
            Some(&42),
            || Err("hide failed".into()),
            |_| calls.borrow_mut().push("restore")
        )
        .is_err());
        assert!(calls.borrow().is_empty());
        hide_then_restore(
            false,
            Some(&42),
            || Ok(()),
            |_| calls.borrow_mut().push("restore"),
        )
        .unwrap();
        hide_then_restore(
            true,
            None::<&i32>,
            || Ok(()),
            |_| calls.borrow_mut().push("restore"),
        )
        .unwrap();
        assert!(calls.borrow().is_empty());
    }
}
