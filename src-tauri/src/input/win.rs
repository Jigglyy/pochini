//! The Win32 `InputBackend`. All `unsafe` in this crate lives here and in
//! `hotkey::hook`.

use windows::Win32::Foundation::{BOOL, LPARAM, RECT, TRUE};
use windows::Win32::Graphics::Gdi::{
    EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO, MONITORINFOEXW,
};
use windows::Win32::UI::HiDpi::{
    GetDpiForMonitor, SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
    MDT_EFFECTIVE_DPI,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT, KEYBD_EVENT_FLAGS,
    KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, KEYEVENTF_SCANCODE, KEYEVENTF_UNICODE, MOUSEINPUT,
    MOUSEEVENTF_ABSOLUTE, MOUSEEVENTF_HWHEEL, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP,
    MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP, MOUSEEVENTF_MOVE, MOUSEEVENTF_RIGHTDOWN,
    MOUSEEVENTF_RIGHTUP, MOUSEEVENTF_VIRTUALDESK, MOUSEEVENTF_WHEEL, MOUSEEVENTF_XDOWN,
    MOUSEEVENTF_XUP, MOUSE_EVENT_FLAGS, VIRTUAL_KEY,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetCursorPos, GetSystemMetrics, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN,
    SM_YVIRTUALSCREEN,
};

use super::coords::{to_normalized, VirtualRect};
use super::{InputBackend, InputError, Monitor, Result, INJECT_STAMP};
use crate::input::keys;
use crate::model::{Modifier, MouseButton, ScrollAxis};

const WHEEL_DELTA: i32 = 120;
const ERROR_ACCESS_DENIED: u32 = 5;
// windows-rs 0.58 does not re-export these three; they are stable Win32 values.
const MONITORINFOF_PRIMARY: u32 = 0x0000_0001;
const XBUTTON1: i32 = 0x0001;
const XBUTTON2: i32 = 0x0002;

/// Opt into per-monitor DPI awareness v2.
///
/// MUST run before any window exists. Without it Windows virtualizes
/// `SetCursorPos`, `GetCursorPos`, absolute `SendInput` and the
/// `SM_*VIRTUALSCREEN` metrics, and input lands off by the scale ratio on any
/// monitor whose scaling differs from the primary - and only on that monitor,
/// which makes it look like a random bug.
///
/// The manifest is authoritative; this covers launch paths that bypass it.
/// Failing with ERROR_ACCESS_DENIED just means the manifest already set it.
pub fn init_dpi_awareness() -> std::result::Result<(), String> {
    // SAFETY: no preconditions beyond being called before any HWND is created,
    // which is why this is invoked first thing in `run()`.
    let r = unsafe { SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    match r {
        Ok(()) => Ok(()),
        Err(e) if e.code().0 as u32 & 0xFFFF == ERROR_ACCESS_DENIED => Ok(()),
        Err(e) => Err(format!("SetProcessDpiAwarenessContext failed: {e}")),
    }
}

pub struct WinInput;

impl WinInput {
    pub fn new() -> Self {
        Self
    }

    fn send(inputs: &[INPUT]) -> Result<()> {
        // SAFETY: `inputs` is a valid slice and cbSize matches the struct we
        // actually pass. SendInput copies the data; nothing escapes.
        let sent = unsafe { SendInput(inputs, std::mem::size_of::<INPUT>() as i32) };
        if sent as usize == inputs.len() {
            return Ok(());
        }
        let code = unsafe { windows::Win32::Foundation::GetLastError().0 };
        if code == ERROR_ACCESS_DENIED {
            Err(InputError::AccessDenied)
        } else {
            Err(InputError::Partial {
                sent,
                expected: inputs.len() as u32,
                code,
            })
        }
    }

    fn mouse(flags: MOUSE_EVENT_FLAGS, dx: i32, dy: i32, data: i32) -> INPUT {
        INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 {
                mi: MOUSEINPUT {
                    dx,
                    dy,
                    mouseData: data as u32,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: INJECT_STAMP as usize,
                },
            },
        }
    }

    fn kbd(scan: u16, flags: KEYBD_EVENT_FLAGS) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(0),
                    wScan: scan,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: INJECT_STAMP as usize,
                },
            },
        }
    }

    fn move_input(&self, x: i32, y: i32) -> INPUT {
        let r = self.virtual_rect();
        let (cx, cy) = r.clamp(x, y);
        let (nx, ny) = to_normalized(r, cx, cy);
        Self::mouse(
            MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK,
            nx,
            ny,
            0,
        )
    }
}

impl Default for WinInput {
    fn default() -> Self {
        Self::new()
    }
}

impl InputBackend for WinInput {
    fn virtual_rect(&self) -> VirtualRect {
        // SAFETY: GetSystemMetrics takes an index and returns an int.
        unsafe {
            VirtualRect {
                x: GetSystemMetrics(SM_XVIRTUALSCREEN),
                y: GetSystemMetrics(SM_YVIRTUALSCREEN),
                w: GetSystemMetrics(SM_CXVIRTUALSCREEN),
                h: GetSystemMetrics(SM_CYVIRTUALSCREEN),
            }
        }
    }

    fn monitors(&self) -> Result<Vec<Monitor>> {
        let mut out: Vec<Monitor> = Vec::new();
        // SAFETY: the callback receives only the pointer we pass in `lparam`,
        // which points at `out` and outlives the enumeration.
        unsafe {
            let _ = EnumDisplayMonitors(
                None,
                None,
                Some(enum_proc),
                LPARAM(&mut out as *mut Vec<Monitor> as isize),
            );
        }
        if out.is_empty() {
            Err(InputError::NoDisplays)
        } else {
            Ok(out)
        }
    }

    fn cursor_pos(&self) -> Result<(i32, i32)> {
        let mut p = Default::default();
        // SAFETY: `p` is a valid, owned POINT.
        unsafe { GetCursorPos(&mut p) }.map_err(|_| InputError::NoDisplays)?;
        Ok((p.x, p.y))
    }

    fn move_to(&self, x: i32, y: i32) -> Result<()> {
        Self::send(&[self.move_input(x, y)])
    }

    fn button(&self, button: MouseButton, down: bool) -> Result<()> {
        let (flags, data) = match (button, down) {
            (MouseButton::Left, true) => (MOUSEEVENTF_LEFTDOWN, 0),
            (MouseButton::Left, false) => (MOUSEEVENTF_LEFTUP, 0),
            (MouseButton::Right, true) => (MOUSEEVENTF_RIGHTDOWN, 0),
            (MouseButton::Right, false) => (MOUSEEVENTF_RIGHTUP, 0),
            (MouseButton::Middle, true) => (MOUSEEVENTF_MIDDLEDOWN, 0),
            (MouseButton::Middle, false) => (MOUSEEVENTF_MIDDLEUP, 0),
            (MouseButton::X1, true) => (MOUSEEVENTF_XDOWN, XBUTTON1),
            (MouseButton::X1, false) => (MOUSEEVENTF_XUP, XBUTTON1),
            (MouseButton::X2, true) => (MOUSEEVENTF_XDOWN, XBUTTON2),
            (MouseButton::X2, false) => (MOUSEEVENTF_XUP, XBUTTON2),
        };
        Self::send(&[Self::mouse(flags, 0, 0, data)])
    }

    fn scroll(&self, axis: ScrollAxis, notches: i32, at: Option<(i32, i32)>) -> Result<()> {
        let flags = match axis {
            ScrollAxis::Vertical => MOUSEEVENTF_WHEEL,
            ScrollAxis::Horizontal => MOUSEEVENTF_HWHEEL,
        };
        let wheel = Self::mouse(flags, 0, 0, notches * WHEEL_DELTA);
        // Batch the move and the wheel event into one call so nothing can
        // interleave between positioning and scrolling.
        match at {
            Some((x, y)) => Self::send(&[self.move_input(x, y), wheel]),
            None => Self::send(&[wheel]),
        }
    }

    fn key(&self, scan: u16, extended: bool, down: bool) -> Result<()> {
        let mut flags = KEYEVENTF_SCANCODE;
        if extended {
            flags |= KEYEVENTF_EXTENDEDKEY;
        }
        if !down {
            flags |= KEYEVENTF_KEYUP;
        }
        Self::send(&[Self::kbd(scan, flags)])
    }

    fn modifier(&self, m: Modifier, down: bool) -> Result<()> {
        let (scan, extended) = keys::scan_for_vk(keys::modifier_vk(m));
        self.key(scan, extended, down)
    }

    fn unicode(&self, unit: u16, down: bool) -> Result<()> {
        let mut flags = KEYEVENTF_UNICODE;
        if !down {
            flags |= KEYEVENTF_KEYUP;
        }
        Self::send(&[Self::kbd(unit, flags)])
    }
}

unsafe extern "system" fn enum_proc(
    hmon: HMONITOR,
    _hdc: HDC,
    _clip: *mut RECT,
    lparam: LPARAM,
) -> BOOL {
    let out = &mut *(lparam.0 as *mut Vec<Monitor>);

    let mut mi = MONITORINFOEXW {
        monitorInfo: MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFOEXW>() as u32,
            ..Default::default()
        },
        ..Default::default()
    };
    if GetMonitorInfoW(hmon, &mut mi as *mut _ as *mut MONITORINFO).as_bool() {
        let r = mi.monitorInfo.rcMonitor;
        let mut dpi_x = 96u32;
        let mut dpi_y = 96u32;
        let _ = GetDpiForMonitor(hmon, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y);

        let device = String::from_utf16_lossy(&mi.szDevice)
            .trim_end_matches('\0')
            .to_string();

        out.push(Monitor {
            device,
            rect: [r.left, r.top, r.right, r.bottom],
            dpi: dpi_x,
            primary: mi.monitorInfo.dwFlags & MONITORINFOF_PRIMARY != 0,
        });
    }
    TRUE
}
