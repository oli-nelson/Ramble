use crate::placement::{self, Application, FocusTarget, PlacementRule, PlacementSettings, Rect};
use accessibility_sys::*;
use core_foundation::{
    base::{CFGetTypeID, CFRelease, CFTypeRef, TCFType},
    boolean::CFBoolean,
    dictionary::CFDictionary,
    string::CFString,
};
use objc2::{rc::Retained, MainThreadMarker};
use objc2_app_kit::{
    NSApplicationActivationOptions, NSApplicationActivationPolicy, NSRunningApplication, NSScreen,
    NSWindow, NSWorkspace,
};
use objc2_foundation::{NSPoint, NSRect, NSSize};

/// Own a CF Create/Copy result. No raw Accessibility references leave this module.
struct OwnedCf(CFTypeRef);
impl Drop for OwnedCf {
    fn drop(&mut self) {
        unsafe { CFRelease(self.0) }
    }
}

fn attribute(element: AXUIElementRef, name: &str) -> Option<OwnedCf> {
    let key = CFString::new(name);
    let mut value = std::ptr::null();
    let status =
        unsafe { AXUIElementCopyAttributeValue(element, key.as_concrete_TypeRef(), &mut value) };
    if status == kAXErrorSuccess && !value.is_null() {
        Some(OwnedCf(value))
    } else {
        None
    }
}

fn focused_bounds(pid: i32) -> Option<Rect> {
    if !accessibility_granted() {
        return None;
    }
    let raw = unsafe { AXUIElementCreateApplication(pid) };
    if raw.is_null() {
        return None;
    }
    let app = OwnedCf(raw.cast());
    // Do not let an unresponsive app block hotkey handling indefinitely.
    unsafe {
        AXUIElementSetMessagingTimeout(app.0.cast_mut().cast(), 0.1);
    }
    let window = attribute(raw, kAXFocusedWindowAttribute)?;
    if unsafe { CFGetTypeID(window.0) } != unsafe { AXUIElementGetTypeID() } {
        return None;
    }
    let element: AXUIElementRef = window.0.cast_mut().cast();
    unsafe {
        AXUIElementSetMessagingTimeout(element, 0.1);
    }
    let position = attribute(element, kAXPositionAttribute)?;
    let size = attribute(element, kAXSizeAttribute)?;
    if unsafe { CFGetTypeID(position.0) } != unsafe { AXValueGetTypeID() }
        || unsafe { CFGetTypeID(size.0) } != unsafe { AXValueGetTypeID() }
    {
        return None;
    }
    let mut origin = NSPoint::new(0.0, 0.0);
    let mut dimensions = NSSize::new(0.0, 0.0);
    let valid = unsafe {
        AXValueGetValue(
            position.0.cast_mut().cast(),
            kAXValueTypeCGPoint,
            (&mut origin as *mut NSPoint).cast(),
        ) && AXValueGetValue(
            size.0.cast_mut().cast(),
            kAXValueTypeCGSize,
            (&mut dimensions as *mut NSSize).cast(),
        )
    };
    let rect = Rect {
        x: origin.x,
        y: origin.y,
        width: dimensions.width,
        height: dimensions.height,
    };
    (valid && rect.valid()).then_some(rect)
}

fn identity(app: &NSRunningApplication) -> Option<Application> {
    Some(Application {
        id: app.bundleIdentifier()?.to_string(),
        name: app.localizedName()?.to_string(),
    })
}

/// Retain the exact running instance, not a bundle ID/PID that might be reused.
/// NSRunningApplication is Send + Sync; calls still run on the desktop main thread.
#[derive(Clone)]
pub struct FocusReturnTarget(Retained<NSRunningApplication>);

pub fn capture_focus(read_geometry: bool) -> super::CapturedFocus {
    let Some(app) = NSWorkspace::sharedWorkspace().frontmostApplication() else {
        return super::CapturedFocus::default();
    };
    let pid = app.processIdentifier();
    if pid == std::process::id() as i32 {
        return super::CapturedFocus {
            target: FocusTarget {
                is_ramble: true,
                ..Default::default()
            },
            ..Default::default()
        };
    }
    let target = FocusTarget {
        is_ramble: false,
        application: identity(&app),
        window: if read_geometry {
            focused_bounds(pid)
        } else {
            None
        },
    };
    super::CapturedFocus {
        target,
        return_target: Some(FocusReturnTarget(app)),
    }
}

pub fn is_ramble_foreground() -> bool {
    NSWorkspace::sharedWorkspace()
        .frontmostApplication()
        .is_some_and(|app| app.processIdentifier() == std::process::id() as i32)
}

pub fn restore_focus(target: &FocusReturnTarget) {
    // Activation uses AppKit, not Accessibility; never relaunch a terminated app,
    // force all its windows forward, or use deprecated force-activation flags.
    if !target.0.isTerminated() && target.0.processIdentifier() != std::process::id() as i32 {
        let _ = target
            .0
            .activateWithOptions(NSApplicationActivationOptions::empty());
    }
}

pub fn target_alive(target: &FocusReturnTarget) -> bool {
    !target.0.isTerminated()
        && target.0.processIdentifier() > 0
        && target.0.processIdentifier() != std::process::id() as i32
}

pub fn target_is_foreground(target: &FocusReturnTarget) -> bool {
    target_alive(target)
        && NSWorkspace::sharedWorkspace()
            .frontmostApplication()
            .is_some_and(|app| app == target.0)
}

// Signatures/constants checked against the installed CoreGraphics SDK headers.
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventCreateKeyboardEvent(source: CFTypeRef, key: u16, down: bool) -> CFTypeRef;
    fn CGEventSetFlags(event: CFTypeRef, flags: u64);
    fn CGEventPostToPid(pid: i32, event: CFTypeRef);
    fn CGEventSourceFlagsState(state: i32) -> u64;
    fn CGEventSourceKeyState(state: i32, key: u16) -> bool;
}

pub fn paste_preflight() -> Result<(), String> {
    // Check only; never trigger an Accessibility prompt from a keyboard shortcut.
    if !accessibility_granted() {
        return Err("Paste needs Accessibility access. Use Settings → Placement → Enable access, then retry.".into());
    }
    Ok(())
}

pub fn paste_keys_released() -> bool {
    const HID_STATE: i32 = 1;
    const MODIFIERS: u64 = (1 << 17) | (1 << 18) | (1 << 19) | (1 << 20);
    unsafe {
        CGEventSourceFlagsState(HID_STATE) & MODIFIERS == 0
            && [9, 36, 76]
                .iter()
                .all(|&key| !CGEventSourceKeyState(HID_STATE, key))
    }
}

pub fn paste_once(target: &FocusReturnTarget) -> Result<(), String> {
    paste_preflight()?;
    if !target_is_foreground(target) || !paste_keys_released() {
        return Err(
            "The original app lost focus or shortcut keys are still held. Paste was not sent."
                .into(),
        );
    }
    const COMMAND: u64 = 1 << 20;
    // Build the entire Command-V chord before posting anything, so allocation
    // failure cannot leave a synthetic modifier down. Never synthesize Enter.
    let mut events = Vec::new();
    for (key, down, flags) in [
        (55, true, COMMAND),
        (9, true, COMMAND),
        (9, false, COMMAND),
        (55, false, 0),
    ] {
        let event = unsafe { CGEventCreateKeyboardEvent(std::ptr::null(), key, down) };
        if event.is_null() {
            return Err("The OS could not prepare the paste shortcut.".into());
        }
        let event = OwnedCf(event);
        unsafe {
            CGEventSetFlags(event.0, flags);
        }
        events.push(event);
    }
    // Address the captured running instance, not the global event stream. There
    // is exactly one V key-down, and no retry or clipboard-content read.
    if !target_is_foreground(target) {
        return Err("Focus changed before paste. Paste was not sent.".into());
    }
    for event in events {
        unsafe {
            CGEventPostToPid(target.0.processIdentifier(), event.0);
        }
    }
    Ok(())
}

pub fn applications() -> Vec<Application> {
    let apps = NSWorkspace::sharedWorkspace().runningApplications();
    let mut result: Vec<_> = apps
        .iter()
        .filter(|a| {
            a.processIdentifier() != std::process::id() as i32
                && a.activationPolicy() != NSApplicationActivationPolicy::Prohibited
        })
        .filter_map(|a| identity(&a))
        .collect();
    result.sort_by_key(|a| a.name.to_lowercase());
    let mut ids = std::collections::HashSet::new();
    result.retain(|a| ids.insert(a.id.clone()));
    result.truncate(500);
    result
}

pub fn accessibility_granted() -> bool {
    unsafe { AXIsProcessTrusted() }
}
/// Called ONLY by the explicit Settings button. Never from startup or summon.
pub fn request_access() -> bool {
    let key = unsafe { CFString::wrap_under_get_rule(kAXTrustedCheckOptionPrompt) };
    let options = CFDictionary::from_CFType_pairs(&[(key, CFBoolean::true_value())]);
    unsafe { AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef()) }
}

fn from_cocoa(rect: NSRect, primary_top: f64) -> Rect {
    Rect {
        x: rect.origin.x,
        y: primary_top - rect.origin.y - rect.size.height,
        width: rect.size.width,
        height: rect.size.height,
    }
}

pub fn place(
    window: &tauri::WebviewWindow,
    target: &FocusTarget,
    settings: &PlacementSettings,
) -> Result<Option<String>, String> {
    let mtm = MainThreadMarker::new().ok_or("Window placement must run on the main thread.")?;
    let screens = NSScreen::screens(mtm);
    let first = screens.firstObject().ok_or("No available display.")?;
    let primary_top = first.frame().origin.y + first.frame().size.height;
    // `ns_window` is owned by Tauri and used synchronously on its main thread.
    let ptr = window
        .ns_window()
        .map_err(|_| "Native window unavailable.")?;
    let native = unsafe { &*ptr.cast::<NSWindow>() };
    let current = from_cocoa(native.frame(), primary_top);
    let areas: Vec<_> = screens
        .iter()
        .map(|s| from_cocoa(s.visibleFrame(), primary_top))
        .collect();
    let fallback = native
        .screen()
        .map(|s| from_cocoa(s.visibleFrame(), primary_top))
        .unwrap_or(areas[0]);
    let reference = if settings.enabled && !target.is_ramble {
        target.window.unwrap_or(fallback)
    } else {
        current
    };
    let work = placement::work_area_for(reference, &areas).ok_or("No usable display area.")?;
    let unchanged_rule = PlacementRule {
        anchor: placement::Anchor::TopLeft,
        ..Default::default()
    };
    let rule = if settings.enabled && !target.is_ramble {
        settings.rule_for(target.application.as_ref().map(|a| a.id.as_str()))
    } else {
        unchanged_rule
    };
    let placed = placement::anchored(reference, (current.width, current.height), work, &rule, 1.0)?;
    native.setFrame_display(
        NSRect::new(
            NSPoint::new(placed.x, primary_top - placed.y - placed.height),
            NSSize::new(placed.width, placed.height),
        ),
        true,
    );
    if settings.enabled && !target.is_ramble && target.window.is_none() {
        Ok(Some(if accessibility_granted() { "The focused window did not expose its geometry. Ramble was placed relative to the display instead." } else { "Focused-window placement needs Accessibility access. Using a display fallback; enable access in Settings → Placement." }.into()))
    } else {
        Ok(None)
    }
}
