//! `WH_KEYBOARD_LL` on a dedicated thread with a message pump, plus the on/off
//! toggle registered with Windows itself.
//!
//! Rules the callback obeys, all learned the hard way in tools/m0-probe:
//!
//! * It does no blocking work. It matches against a lock-free snapshot of the
//!   binding table and pushes onto a channel. Windows silently uninstalls a
//!   hook whose callback exceeds `LowLevelHooksTimeout` (300 ms default),
//!   without telling the app. Measured budget in the probe: 67 us.
//! * It ignores events carrying our own `INJECT_STAMP`. Checking
//!   `LLKHF_INJECTED` alone would also ignore other legitimate tools' input.
//!   Without this, a macro that presses its own trigger key re-triggers forever.
//! * It never panics. A panic on the hook thread takes the hook down with it,
//!   so every fallible step is handled rather than unwrapped.
//!
//! Two safety nets, because a hotkey that silently stops working is the worst
//! failure this app has (reported for the toggle hotkey):
//!
//! * The toggle is also registered with `RegisterHotKey`. Windows then delivers
//!   it as WM_HOTKEY whatever has focus, even if our hook was removed or never
//!   saw the key. While that registration holds, the hook leaves the toggle to
//!   it, so one press cannot flip the switch twice.
//! * A 30 s timer reinstalls the hook. That revives it if Windows removed it,
//!   and keeps it at the front of the hook chain, ahead of hooks other apps
//!   installed later that might swallow keys before we see them.

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc::Sender;
use std::sync::Arc;

use arc_swap::ArcSwap;
use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, RegisterHotKey, UnregisterHotKey, HOT_KEY_MODIFIERS, MOD_ALT, MOD_CONTROL,
    MOD_NOREPEAT, MOD_SHIFT, MOD_WIN,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetMessageW, KillTimer, PostThreadMessageW, SetTimer,
    SetWindowsHookExW, TranslateMessage, UnhookWindowsHookEx, HHOOK, KBDLLHOOKSTRUCT, MSG,
    WH_KEYBOARD_LL, WM_APP, WM_HOTKEY, WM_KEYDOWN, WM_KEYUP, WM_QUIT, WM_SYSKEYDOWN, WM_SYSKEYUP,
    WM_TIMER,
};

use super::bindings::BindingTable;
use super::logic::{mod_bits, KeyContext, KeyLogic, Seen, SeenResult, Via};
use super::{HookStatus, TriggerEvent};
use crate::input::INJECT_STAMP;
use crate::model::Modifier;

/// RegisterHotKey id for the on/off toggle.
const TOGGLE_HOTKEY_ID: i32 = 1;
/// Posted to the hook thread when the binding table changes, so the toggle can
/// be re-registered (RegisterHotKey binds to the calling thread).
const WM_REREGISTER: u32 = WM_APP + 1;
/// How often the hook is reinstalled.
const REINSTALL_MS: u32 = 30_000;

static INSTALLED: AtomicBool = AtomicBool::new(false);
static TOGGLE_REGISTERED: AtomicBool = AtomicBool::new(false);
static TOGGLE_TAKEN: AtomicBool = AtomicBool::new(false);
static KEY_EVENTS: AtomicU64 = AtomicU64::new(0);
static REINSTALLS: AtomicU64 = AtomicU64::new(0);
static HOOK_TID: AtomicU32 = AtomicU32::new(0);

/// What the hook can learn about the moment of a press. Each answer is only
/// computed if a binding needs it.
struct LiveContext;

impl KeyContext for LiveContext {
    fn cursor(&mut self) -> Option<(i32, i32)> {
        let mut p = windows::Win32::Foundation::POINT::default();
        // SAFETY: `p` is a valid, owned POINT.
        unsafe { windows::Win32::UI::WindowsAndMessaging::GetCursorPos(&mut p) }.ok()?;
        Some((p.x, p.y))
    }

    fn app_under_cursor(&mut self) -> Option<String> {
        let (x, y) = self.cursor()?;
        crate::input::win::app_at(x, y)
    }
}

/// The modifiers Windows considers held right now. Read fresh for every key
/// rather than tracked from the event stream, which goes permanently wrong the
/// first time a key-up is hidden from the hook (UIPI, secure desktop) or a
/// modifier was already down when the app started. No allocation: it runs
/// inside the hook callback.
fn held_modifiers(buf: &mut [Modifier; 4]) -> &[Modifier] {
    // SAFETY: GetAsyncKeyState takes a virtual key code and returns a state word.
    let down = |vk: i32| (unsafe { GetAsyncKeyState(vk) } as u16) & 0x8000 != 0;
    let mut n = 0;
    for (vks, m) in [
        (&[0x11][..], Modifier::Ctrl),
        (&[0x12][..], Modifier::Alt),
        (&[0x10][..], Modifier::Shift),
        (&[0x5B, 0x5C][..], Modifier::Win),
    ] {
        if vks.iter().any(|&vk| down(vk)) {
            buf[n] = m;
            n += 1;
        }
    }
    &buf[..n]
}

/// State the callback reaches through a `static`, because a Win32 hook callback
/// gets no user pointer. One hook per process, enforced by `HookThread::start`.
struct HookState {
    table: ArcSwap<BindingTable>,
    tx: Sender<TriggerEvent>,
    /// Every decision lives in `KeyLogic` (pure, unit-tested). Only the hook
    /// thread ever locks this, so `try_lock` never actually contends.
    logic: std::sync::Mutex<KeyLogic>,
}

static STATE: std::sync::OnceLock<HookState> = std::sync::OnceLock::new();

/// Health of the keyboard layer, for the Settings "Hotkey check".
pub fn status() -> HookStatus {
    HookStatus {
        installed: INSTALLED.load(Ordering::Relaxed),
        toggle_registered: TOGGLE_REGISTERED.load(Ordering::Relaxed),
        toggle_taken: TOGGLE_TAKEN.load(Ordering::Relaxed),
        key_events: KEY_EVENTS.load(Ordering::Relaxed),
        reinstalls: REINSTALLS.load(Ordering::Relaxed),
    }
}

fn install() -> Option<HHOOK> {
    // SAFETY: a WH_KEYBOARD_LL hook needs no module handle, and `callback` is
    // a plain `extern "system"` fn with static lifetime.
    unsafe { SetWindowsHookExW(WH_KEYBOARD_LL, Some(callback), None, 0) }.ok()
}

/// (Re)register the toggle with Windows. Must run on the hook thread, which is
/// where WM_HOTKEY will then be posted.
fn register_toggle(table: &BindingTable) {
    // SAFETY: unregistering an id we may not hold just fails harmlessly.
    unsafe {
        let _ = UnregisterHotKey(None, TOGGLE_HOTKEY_ID);
    }
    TOGGLE_REGISTERED.store(false, Ordering::Relaxed);
    TOGGLE_TAKEN.store(false, Ordering::Relaxed);
    let Some((vk, mods)) = &table.toggle else {
        return;
    };
    let mut flags = MOD_NOREPEAT;
    for m in mods {
        flags |= match m {
            Modifier::Ctrl => MOD_CONTROL,
            Modifier::Alt => MOD_ALT,
            Modifier::Shift => MOD_SHIFT,
            Modifier::Win => MOD_WIN,
        };
    }
    // SAFETY: registers a thread hotkey (no window) for this thread.
    let ok = unsafe { RegisterHotKey(None, TOGGLE_HOTKEY_ID, HOT_KEY_MODIFIERS(flags.0), *vk as u32) }.is_ok();
    TOGGLE_REGISTERED.store(ok, Ordering::Relaxed);
    TOGGLE_TAKEN.store(!ok, Ordering::Relaxed);
}

pub struct HookThread {
    thread_id: u32,
    handle: Option<std::thread::JoinHandle<()>>,
}

impl HookThread {
    /// Install the hook. Returns an error if it could not be installed, which
    /// on a normal desktop essentially only happens under lockdown policy.
    pub fn start(table: Arc<BindingTable>, tx: Sender<TriggerEvent>) -> std::result::Result<Self, String> {
        STATE
            .set(HookState {
                table: ArcSwap::from(table),
                tx,
                logic: std::sync::Mutex::new(KeyLogic::default()),
            })
            .map_err(|_| "the keyboard hook is already installed".to_string())?;

        let (ready_tx, ready_rx) = std::sync::mpsc::channel::<std::result::Result<u32, String>>();

        let handle = std::thread::Builder::new()
            .name("keyboard-hook".into())
            .spawn(move || {
                let Some(mut hook) = install() else {
                    let _ = ready_tx.send(Err("SetWindowsHookExW failed".into()));
                    return;
                };
                INSTALLED.store(true, Ordering::Relaxed);
                // SAFETY: plain thread id query.
                let tid = unsafe { windows::Win32::System::Threading::GetCurrentThreadId() };
                HOOK_TID.store(tid, Ordering::Relaxed);
                if let Some(s) = STATE.get() {
                    register_toggle(&s.table.load());
                }
                // SAFETY: a thread timer (no window); WM_TIMER lands in this queue.
                let timer = unsafe { SetTimer(None, 0, REINSTALL_MS, None) };
                let _ = ready_tx.send(Ok(tid));

                // SetWindowsHookEx requires a message pump on the installing
                // thread; without one the callback never fires.
                let mut msg = MSG::default();
                // SAFETY: `msg` is a valid, owned MSG for each call.
                while unsafe { GetMessageW(&mut msg, None, 0, 0) }.as_bool() {
                    match msg.message {
                        WM_HOTKEY if msg.wParam.0 == TOGGLE_HOTKEY_ID as usize => on_windows_toggle(),
                        WM_TIMER => {
                            // New hook first, then drop the old one: no gap.
                            if let Some(fresh) = install() {
                                // SAFETY: `hook` is the handle we installed and still own.
                                unsafe {
                                    let _ = UnhookWindowsHookEx(hook);
                                }
                                hook = fresh;
                                REINSTALLS.fetch_add(1, Ordering::Relaxed);
                            }
                        }
                        WM_REREGISTER => {
                            if let Some(s) = STATE.get() {
                                register_toggle(&s.table.load());
                            }
                        }
                        _ => unsafe {
                            let _ = TranslateMessage(&msg);
                            DispatchMessageW(&msg);
                        },
                    }
                }

                // SAFETY: handles we created and have not freed.
                unsafe {
                    let _ = UnregisterHotKey(None, TOGGLE_HOTKEY_ID);
                    let _ = KillTimer(None, timer);
                    let _ = UnhookWindowsHookEx(hook);
                }
                INSTALLED.store(false, Ordering::Relaxed);
                TOGGLE_REGISTERED.store(false, Ordering::Relaxed);
            })
            .map_err(|e| format!("could not spawn the hook thread: {e}"))?;

        match ready_rx.recv_timeout(std::time::Duration::from_secs(5)) {
            Ok(Ok(thread_id)) => Ok(Self { thread_id, handle: Some(handle) }),
            Ok(Err(e)) => Err(e),
            Err(_) => Err("the hook thread did not start in time".into()),
        }
    }

    /// Swap in a new binding table (lock-free from the callback's point of
    /// view) and have the hook thread re-register the toggle hotkey.
    pub fn update(table: Arc<BindingTable>) {
        if let Some(s) = STATE.get() {
            s.table.store(table);
        }
        let tid = HOOK_TID.load(Ordering::Relaxed);
        if tid != 0 {
            // SAFETY: posting to a thread id; a stale id simply fails.
            unsafe {
                let _ = PostThreadMessageW(tid, WM_REREGISTER, WPARAM(0), LPARAM(0));
            }
        }
    }

    pub fn stop(&mut self) {
        // SAFETY: posting WM_QUIT to a thread id is safe; a stale id simply fails.
        unsafe {
            let _ = PostThreadMessageW(self.thread_id, WM_QUIT, WPARAM(0), LPARAM(0));
        }
        if let Some(h) = self.handle.take() {
            let _ = h.join();
        }
    }
}

impl Drop for HookThread {
    fn drop(&mut self) {
        self.stop();
    }
}

/// WM_HOTKEY for the toggle: Windows saw it even if the hook did not.
fn on_windows_toggle() {
    let Some(state) = STATE.get() else {
        return;
    };
    let _ = state.tx.send(TriggerEvent::ToggleEnabled);
    let table = state.table.load();
    if let Some((vk, mods)) = &table.toggle {
        let _ = state.tx.send(TriggerEvent::Seen(Seen {
            vk: *vk,
            mods: mod_bits(mods),
            result: SeenResult::Toggle,
            via: Via::Windows,
        }));
    }
}

unsafe extern "system" fn callback(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    // HC_ACTION == 0; anything else must be passed straight on.
    if code != 0 {
        return CallNextHookEx(None, code, wparam, lparam);
    }
    let Some(state) = STATE.get() else {
        return CallNextHookEx(None, code, wparam, lparam);
    };

    let k = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
    let msg = wparam.0 as u32;
    let down = msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN;
    let up = msg == WM_KEYUP || msg == WM_SYSKEYUP;
    if !down && !up {
        return CallNextHookEx(None, code, wparam, lparam);
    }
    // A count only, to show the hook is alive. Never which key.
    KEY_EVENTS.fetch_add(1, Ordering::Relaxed);

    // Our own injected input: ignore entirely, including for modifier tracking,
    // or a macro pressing Shift would look like the user holding Shift.
    if k.dwExtraInfo == INJECT_STAMP as usize {
        return CallNextHookEx(None, code, wparam, lparam);
    }

    let vk = k.vkCode as u16;
    let table = state.table.load();
    let mut buf = [Modifier::Ctrl; 4];
    let mods = held_modifiers(&mut buf);
    let outcome = match state.logic.try_lock() {
        Ok(mut logic) => logic.on_key(&table, vk, down, mods, &mut LiveContext),
        Err(_) => return CallNextHookEx(None, code, wparam, lparam),
    };
    if let Some(ev) = outcome.event {
        // While Windows owns the toggle, let WM_HOTKEY do the toggling so one
        // press cannot flip the switch twice.
        let windows_has_it = TOGGLE_REGISTERED.load(Ordering::Relaxed);
        if !(ev == TriggerEvent::ToggleEnabled && windows_has_it) {
            let _ = state.tx.send(ev);
        }
    }
    if let Some(seen) = outcome.seen {
        let _ = state.tx.send(TriggerEvent::Seen(seen));
    }

    if outcome.swallow {
        return LRESULT(1);
    }
    CallNextHookEx(None, code, wparam, lparam)
}
