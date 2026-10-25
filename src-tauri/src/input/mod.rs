//! Input synthesis. The only module besides `hotkey` that is allowed `unsafe`.
//!
//! The engine talks to the [`InputBackend`] trait, never to Win32 directly, so
//! it can be tested against a recording fake. See docs/01-architecture.md.

#[cfg(windows)]
pub mod clipboard;
pub mod coords;
pub mod keys;
#[cfg(windows)]
pub mod win;

pub use coords::VirtualRect;

use std::sync::atomic::{AtomicU8, Ordering};

use crate::model::{Modifier, MouseButton, ScrollAxis};

/// Stamped into `dwExtraInfo` on everything we inject so the hook can tell our
/// own events apart from the user's.
///
/// MUST stay below `i32::MAX`. A value with the high bit set sign-extends to
/// `0xFFFFFFFF_xxxxxxxx` on x64 when written as a pointer-sized field, and is
/// compared against a zero-extended value when read back out of
/// `KBDLLHOOKSTRUCT` - so the filter silently never matches and the
/// self-trigger guard becomes dead code that looks correct. This bit us in the
/// probe. 0x434C4943 is 'CLIC'.
pub const INJECT_STAMP: u32 = 0x434C_4943;

const _: () = assert!(INJECT_STAMP < i32::MAX as u32);

/// Modifier keys our own injected input holds down right now, one bit per
/// physical key. `GetAsyncKeyState` cannot tell those from keys the user
/// holds, so while a step held Shift for a shift-click, the user's own hotkey
/// read as Shift+key and did not match (the second press of a toggle-mode
/// macro, a queued press). The hook leaves these out.
pub struct InjectedModifiers(AtomicU8);

/// Written by the Win32 backend, read by the hook callback (lock-free).
pub static INJECTED: InjectedModifiers = InjectedModifiers::new();

impl InjectedModifiers {
    pub const fn new() -> Self {
        Self(AtomicU8::new(0))
    }

    /// Note a key event we sent. Keys that are not modifiers are ignored.
    pub fn key(&self, scan: u16, extended: bool, down: bool) {
        let bit = match (scan, extended) {
            (0x1D, false) => 1 << 0, // left Ctrl
            (0x1D, true) => 1 << 1,  // right Ctrl
            (0x38, false) => 1 << 2, // left Alt
            (0x38, true) => 1 << 3,  // right Alt (AltGr)
            (0x2A, _) => 1 << 4,     // left Shift
            (0x36, _) => 1 << 5,     // right Shift
            (0x5B, _) => 1 << 6,     // left Win
            (0x5C, _) => 1 << 7,     // right Win
            _ => return,
        };
        if down {
            self.0.fetch_or(bit, Ordering::Relaxed);
        } else {
            self.0.fetch_and(!bit, Ordering::Relaxed);
        }
    }

    /// Held modifiers in `hotkey::logic::mod_bits` form: Ctrl 1, Alt 2,
    /// Shift 4, Win 8.
    pub fn held(&self) -> u8 {
        let keys = self.0.load(Ordering::Relaxed);
        (0..4).fold(0, |acc, i| if keys & (0b11 << (i * 2)) != 0 { acc | 1 << i } else { acc })
    }
}

impl Default for InjectedModifiers {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, thiserror::Error)]
pub enum InputError {
    #[error("SendInput inserted {sent} of {expected} events (os error {code})")]
    Partial { sent: u32, expected: u32, code: u32 },
    /// UIPI: a normal-integrity process cannot inject into an elevated window.
    #[error("blocked by UIPI - the foreground window belongs to an elevated process")]
    AccessDenied,
    #[error("no displays found")]
    NoDisplays,
}

pub type Result<T> = std::result::Result<T, InputError>;

/// One monitor, in virtual-desktop pixels.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Monitor {
    pub device: String,
    pub rect: [i32; 4],
    pub dpi: u32,
    pub primary: bool,
}

/// Everything the engine needs from the OS. Implemented by [`win::WinInput`]
/// in production and by a recording fake in tests.
pub trait InputBackend: Send + Sync {
    fn virtual_rect(&self) -> VirtualRect;
    fn monitors(&self) -> Result<Vec<Monitor>>;
    fn cursor_pos(&self) -> Result<(i32, i32)>;

    fn move_to(&self, x: i32, y: i32) -> Result<()>;
    fn button(&self, button: MouseButton, down: bool) -> Result<()>;
    fn scroll(&self, axis: ScrollAxis, notches: i32, at: Option<(i32, i32)>) -> Result<()>;

    /// `scan` is a scan code, not a virtual key code.
    fn key(&self, scan: u16, extended: bool, down: bool) -> Result<()>;
    fn modifier(&self, m: Modifier, down: bool) -> Result<()>;
    /// One UTF-16 code unit via `KEYEVENTF_UNICODE`.
    fn unicode(&self, unit: u16, down: bool) -> Result<()>;
}

/// Unit tests, and the e2e test mode of debug builds (see `crate::e2e`).
#[cfg(any(test, debug_assertions))]
pub mod fake;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn injected_modifiers_track_each_physical_key() {
        let m = InjectedModifiers::new();
        m.key(0x2A, false, true); // left Shift
        assert_eq!(m.held(), 4);
        m.key(0x1D, true, true); // right Ctrl
        assert_eq!(m.held(), 4 | 1);
        m.key(0x1E, false, true); // A: not a modifier
        assert_eq!(m.held(), 5);
        m.key(0x2A, false, false);
        assert_eq!(m.held(), 1);
        m.key(0x1D, true, false);
        assert_eq!(m.held(), 0);
    }

    #[test]
    fn both_shifts_down_stay_held_until_both_come_up() {
        let m = InjectedModifiers::new();
        m.key(0x2A, false, true);
        m.key(0x36, false, true);
        m.key(0x2A, false, false);
        assert_eq!(m.held(), 4, "right Shift is still down");
        m.key(0x36, false, false);
        assert_eq!(m.held(), 0);
    }

    #[test]
    fn win_and_alt_map_to_their_bits() {
        let m = InjectedModifiers::new();
        m.key(0x5B, true, true);
        m.key(0x38, false, true);
        assert_eq!(m.held(), 8 | 2);
    }
}
