//! The global hotkey layer: a `WH_KEYBOARD_LL` hook on its own pumped thread.
//!
//! `RegisterHotKey` is not used. It consumes the key it binds, so binding a
//! plain key like Space would stop Space working in every other application,
//! which is the central use case, not an edge case. A low-level hook can choose
//! per binding whether to pass the key through or swallow it.

pub mod bindings;
#[cfg(windows)]
mod hook;
pub mod logic;

pub use bindings::{Binding, BindingTable, Match};

use crate::model::Macro;

/// What the hook thread (and the UI) send to the engine worker.
#[derive(Debug, Clone, PartialEq)]
pub enum TriggerEvent {
    /// Run a saved macro, optionally after a countdown. `at` is where the
    /// mouse was when the hotkey was pressed (the activation point); `None`
    /// means "read it when the run starts", which is what a countdown wants.
    Start { macro_id: String, delay_ms: u64, at: Option<(i32, i32)> },
    /// Run an unsaved step list (the editor's Test button).
    RunAdhoc { mac: Box<Macro>, delay_ms: u64 },
    /// A `HoldRepeat` binding's key came up.
    Stop { macro_id: String },
    /// The panic key. Aborts whatever is running, including a countdown.
    Panic,
    /// The toggle hotkey. Flips the master switch.
    ToggleEnabled,
    /// A watched key was pressed; for the Settings "Hotkey check".
    Seen(logic::Seen),
}

/// Health of the keyboard layer, for the Settings "Hotkey check".
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize)]
pub struct HookStatus {
    pub installed: bool,
    /// The on/off hotkey is registered with Windows (RegisterHotKey), so it
    /// works even if the keyboard hook misses it.
    pub toggle_registered: bool,
    /// Windows refused to register it: another program already owns it.
    pub toggle_taken: bool,
    /// Key events the hook has seen since start (a count, never their content).
    pub key_events: u64,
    /// Times the hook has been reinstalled by the 30 s watchdog.
    pub reinstalls: u64,
}

#[cfg(windows)]
pub use hook::{status as hook_status, HookThread};

#[cfg(not(windows))]
pub fn hook_status() -> HookStatus {
    HookStatus::default()
}
