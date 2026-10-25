//! Windows uses foreground HWND rectangles and monitor work areas, in physical
//! desktop pixels. User offsets are converted using the target window's DPI.
use crate::placement::{self, Application, FocusTarget, PlacementRule, PlacementSettings, Rect};
use windows_sys::Win32::{
    Foundation::{CloseHandle, HWND, LPARAM, RECT},
    Graphics::{
        Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS},
        Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST},
    },
    System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    },
    UI::{
        HiDpi::GetDpiForWindow,
        Input::KeyboardAndMouse::{
            GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT,
            KEYEVENTF_KEYUP, VK_CONTROL, VK_LWIN, VK_MENU, VK_RETURN, VK_RWIN, VK_SHIFT, VK_V,
        },
        WindowsAndMessaging::{
            EnumWindows, GetForegroundWindow, GetWindowRect, GetWindowThreadProcessId, IsIconic,
            IsWindow, IsWindowVisible, SetForegroundWindow, SetWindowPos, ShowWindowAsync,
            SWP_NOACTIVATE, SWP_NOZORDER, SW_RESTORE,
        },
    },
};

fn bounds(hwnd: HWND) -> Option<Rect> {
    let mut rect: RECT = unsafe { std::mem::zeroed() };
    let dwm = unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS as u32,
            (&mut rect as *mut RECT).cast(),
            std::mem::size_of::<RECT>() as u32,
        )
    };
    if dwm < 0 && unsafe { GetWindowRect(hwnd, &mut rect) } == 0 {
        return None;
    }
    let r = Rect {
        x: rect.left as f64,
        y: rect.top as f64,
        width: (rect.right - rect.left) as f64,
        height: (rect.bottom - rect.top) as f64,
    };
    r.valid().then_some(r)
}
// SetWindowPos expects the full outer rect, not DWM's visible-frame rect.
fn outer_bounds(hwnd: HWND) -> Option<Rect> {
    let mut rect: RECT = unsafe { std::mem::zeroed() };
    if unsafe { GetWindowRect(hwnd, &mut rect) } == 0 {
        return None;
    }
    let rect = Rect {
        x: rect.left as f64,
        y: rect.top as f64,
        width: (rect.right - rect.left) as f64,
        height: (rect.bottom - rect.top) as f64,
    };
    rect.valid().then_some(rect)
}
fn identity(pid: u32) -> Option<Application> {
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if handle.is_null() {
        return None;
    }
    let mut buffer = vec![0u16; 32768];
    let mut length = buffer.len() as u32;
    let ok = unsafe { QueryFullProcessImageNameW(handle, 0, buffer.as_mut_ptr(), &mut length) };
    unsafe {
        CloseHandle(handle);
    }
    if ok == 0 {
        return None;
    }
    let path = String::from_utf16_lossy(&buffer[..length as usize]);
    let name = std::path::Path::new(&path)
        .file_stem()?
        .to_string_lossy()
        .into_owned();
    Some(Application {
        id: path.to_lowercase(),
        name,
    })
}
#[derive(Clone)]
pub struct FocusReturnTarget {
    window: usize,
    process_id: u32,
}

pub fn capture_focus(read_geometry: bool) -> super::CapturedFocus {
    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.is_null() {
        return super::CapturedFocus::default();
    }
    let mut pid = 0;
    unsafe {
        GetWindowThreadProcessId(hwnd, &mut pid);
    }
    if pid == 0 {
        return super::CapturedFocus::default();
    }
    if pid == std::process::id() {
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
        application: identity(pid),
        window: if read_geometry { bounds(hwnd) } else { None },
    };
    super::CapturedFocus {
        target,
        return_target: Some(FocusReturnTarget {
            window: hwnd as usize,
            process_id: pid,
        }),
    }
}

pub fn is_ramble_foreground() -> bool {
    let hwnd = unsafe { GetForegroundWindow() };
    let mut pid = 0;
    if !hwnd.is_null() {
        unsafe {
            GetWindowThreadProcessId(hwnd, &mut pid);
        }
    }
    pid == std::process::id()
}

pub fn restore_focus(target: &FocusReturnTarget) {
    let hwnd = target.window as HWND;
    if unsafe { IsWindow(hwnd) } == 0 {
        return;
    }
    let mut pid = 0;
    unsafe {
        GetWindowThreadProcessId(hwnd, &mut pid);
    }
    // HWNDs may be reused. Do not activate another process or launch a replacement.
    if pid == 0 || pid != target.process_id || pid == std::process::id() {
        return;
    }
    unsafe {
        if IsIconic(hwnd) != 0 {
            ShowWindowAsync(hwnd, SW_RESTORE);
        }
        // Best effort under the OS foreground-activation policy; no input attachment
        // tricks, synthetic keystrokes or permission bypasses.
        SetForegroundWindow(hwnd);
    }
}

pub fn target_alive(target: &FocusReturnTarget) -> bool {
    let hwnd = target.window as HWND;
    let mut pid = 0;
    if unsafe { IsWindow(hwnd) } == 0 {
        return false;
    }
    unsafe {
        GetWindowThreadProcessId(hwnd, &mut pid);
    }
    pid != 0 && pid == target.process_id && pid != std::process::id()
}

pub fn target_is_foreground(target: &FocusReturnTarget) -> bool {
    target_alive(target) && unsafe { GetForegroundWindow() } == target.window as HWND
}

pub fn paste_preflight() -> Result<(), String> {
    Ok(())
}

pub fn paste_keys_released() -> bool {
    [
        VK_CONTROL, VK_SHIFT, VK_MENU, VK_LWIN, VK_RWIN, VK_RETURN, VK_V,
    ]
    .iter()
    .all(|&key| unsafe { GetAsyncKeyState(key as i32) } >= 0)
}

pub fn paste_once(target: &FocusReturnTarget) -> Result<(), String> {
    if !target_is_foreground(target) || !paste_keys_released() {
        return Err(
            "The original app lost focus or shortcut keys are still held. Paste was not sent."
                .into(),
        );
    }
    let key = |virtual_key, flags| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: virtual_key,
                wScan: 0,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    let events = [
        key(VK_CONTROL, 0),
        key(VK_V, 0),
        key(VK_V, KEYEVENTF_KEYUP),
        key(VK_CONTROL, KEYEVENTF_KEYUP),
    ];
    let sent = unsafe {
        SendInput(
            events.len() as u32,
            events.as_ptr(),
            std::mem::size_of::<INPUT>() as i32,
        )
    };
    if sent != events.len() as u32 {
        // Never retry the chord: a partial insertion might already have pasted.
        // Release only our synthetic keys, without another V key-down.
        if sent > 0 {
            let releases = [key(VK_V, KEYEVENTF_KEYUP), key(VK_CONTROL, KEYEVENTF_KEYUP)];
            unsafe {
                SendInput(
                    releases.len() as u32,
                    releases.as_ptr(),
                    std::mem::size_of::<INPUT>() as i32,
                );
            }
        }
        return Err("Windows did not accept the complete paste shortcut. It was not retried; protected/elevated apps may reject input.".into());
    }
    Ok(())
}
unsafe extern "system" fn collect(hwnd: HWND, data: LPARAM) -> i32 {
    if unsafe { IsWindowVisible(hwnd) } == 0 {
        return 1;
    }
    let mut pid = 0;
    unsafe {
        GetWindowThreadProcessId(hwnd, &mut pid);
    }
    if pid != std::process::id() {
        if let Some(app) = identity(pid) {
            unsafe { &mut *(data as *mut Vec<Application>) }.push(app);
        }
    }
    1
}
pub fn applications() -> Vec<Application> {
    let mut apps = Vec::new();
    unsafe {
        EnumWindows(
            Some(collect),
            (&mut apps as *mut Vec<Application>) as LPARAM,
        );
    }
    apps.sort_by_key(|a| a.name.to_lowercase());
    let mut ids = std::collections::HashSet::new();
    apps.retain(|a| ids.insert(a.id.clone()));
    apps.truncate(500);
    apps
}
pub fn accessibility_granted() -> bool {
    true
}
pub fn request_access() -> bool {
    true
}
pub fn place(
    window: &tauri::WebviewWindow,
    target: &FocusTarget,
    settings: &PlacementSettings,
) -> Result<Option<String>, String> {
    let own = window.hwnd().map_err(|_| "Native window unavailable.")?.0 as HWND;
    let foreground = unsafe { GetForegroundWindow() };
    let relative = settings.enabled && !target.is_ramble;
    let display_window = if relative && !foreground.is_null() {
        foreground
    } else {
        own
    };
    let monitor = unsafe { MonitorFromWindow(display_window, MONITOR_DEFAULTTONEAREST) };
    let mut info: MONITORINFO = unsafe { std::mem::zeroed() };
    info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
    if unsafe { GetMonitorInfoW(monitor, &mut info) } == 0 {
        return Err("Monitor work area unavailable.".into());
    }
    let work = Rect {
        x: info.rcWork.left as f64,
        y: info.rcWork.top as f64,
        width: (info.rcWork.right - info.rcWork.left) as f64,
        height: (info.rcWork.bottom - info.rcWork.top) as f64,
    };
    let current = outer_bounds(own).ok_or("Window bounds unavailable.")?;
    let scale = (unsafe { GetDpiForWindow(display_window) }.max(96) as f64) / 96.0;
    let current_scale = window
        .scale_factor()
        .map_err(|_| "Window scale unavailable.")?;
    let reference = if settings.enabled && !target.is_ramble {
        target.window.unwrap_or(work)
    } else {
        current
    };
    let unchanged = PlacementRule {
        anchor: placement::Anchor::TopLeft,
        ..Default::default()
    };
    let rule = if settings.enabled && !target.is_ramble {
        settings.rule_for(target.application.as_ref().map(|a| a.id.as_str()))
    } else {
        unchanged
    };
    let size = if settings.enabled && !target.is_ramble {
        (
            current.width / current_scale * scale,
            current.height / current_scale * scale,
        )
    } else {
        (current.width, current.height)
    };
    let r = placement::anchored(reference, size, work, &rule, scale)?;
    if unsafe {
        SetWindowPos(
            own,
            std::ptr::null_mut(),
            r.x.round() as i32,
            r.y.round() as i32,
            r.width.round() as i32,
            r.height.round() as i32,
            SWP_NOACTIVATE | SWP_NOZORDER,
        )
    } == 0
    {
        return Err("Could not position the window.".into());
    }
    Ok(
        (settings.enabled && !target.is_ramble && target.window.is_none()).then(|| {
            "The foreground window was unavailable; using its display work area instead.".into()
        }),
    )
}
