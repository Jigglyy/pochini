//! Input synthesis. The only module besides `hotkey` that is allowed `unsafe`.
//!
//! The engine talks to the [`InputBackend`] trait, never to Win32 directly, so
//! it can be tested against a recording fake. See docs/01-architecture.md.

pub mod coords;
pub mod keys;
#[cfg(windows)]
pub mod win;

pub use coords::VirtualRect;

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
