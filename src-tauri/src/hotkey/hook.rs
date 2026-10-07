//! `WH_KEYBOARD_LL` on a dedicated thread with a message pump.
//!
//! Rules the callback obeys, all learned the hard way in tools/m0-probe:
//!
//! * It does no work. It matches against a lock-free snapshot of the binding
//!   table and pushes onto a channel. Windows silently uninstalls a hook whose
//!   callback exceeds `LowLevelHooksTimeout` (300 ms default), degrading input
//!   handling system-wide. Measured budget in the probe: 67 us.
//! * It ignores events carrying our own `INJECT_STAMP`. Checking
//!   `LLKHF_INJECTED` alone would also ignore other legitimate tools' input.
//!   Without this, a macro that presses its own trigger key re-triggers forever.
//! * It never panics. A panic on the hook thread takes the hook down with it,
//!   so every fallible step is handled rather than unwrapped.

use std::sync::mpsc::Sender;
use std::sync::Arc;

use arc_swap::ArcSwap;
use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetMessageW, PostThreadMessageW, SetWindowsHookExW,
    TranslateMessage, UnhookWindowsHookEx, HHOOK, KBDLLHOOKSTRUCT, MSG, WH_KEYBOARD_LL, WM_KEYDOWN,
    WM_KEYUP, WM_QUIT, WM_SYSKEYDOWN, WM_SYSKEYUP,
};

use windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;

use super::bindings::BindingTable;
use super::logic::KeyLogic;
use super::TriggerEvent;
use crate::input::INJECT_STAMP;
use crate::model::Modifier;

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
static mut HOOK: HHOOK = HHOOK(std::ptr::null_mut());

pub struct HookThread {
    thread_id: u32,
    handle: Option<std::thread::JoinHandle<()>>,
}

impl HookThread {
    /// Install the hook. Returns an error if it could not be installed, which
    /// on a normal desktop essentially only happens under lockdown policy.
    pub fn start(
        table: Arc<BindingTable>,
        tx: Sender<TriggerEvent>,
    ) -> std::result::Result<Self, String> {
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
                // SAFETY: a WH_KEYBOARD_LL hook needs no module handle, and
                // `callback` is a plain `extern "system"` fn with static
                // lifetime, so there is nothing for the OS to dangle.
                let hook = unsafe { SetWindowsHookExW(WH_KEYBOARD_LL, Some(callback), None, 0) };
                let hook = match hook {
                    Ok(h) => h,
                    Err(e) => {
                        let _ = ready_tx.send(Err(format!("SetWindowsHookExW failed: {e}")));
                        return;
                    }
                };
                // SAFETY: only this thread writes HOOK, and only before the
                // pump starts and after it ends.
                unsafe { HOOK = hook };

                let tid = unsafe {
                    windows::Win32::System::Threading::GetCurrentThreadId()
                };
                let _ = ready_tx.send(Ok(tid));

                // SetWindowsHookEx requires a message pump on the installing
                // thread; without one the callback never fires.
                let mut msg = MSG::default();
                // SAFETY: `msg` is a valid, owned MSG for each call.
                while unsafe { GetMessageW(&mut msg, None, 0, 0) }.as_bool() {
                    unsafe {
                        let _ = TranslateMessage(&msg);
                        DispatchMessageW(&msg);
                    }
                }

                // SAFETY: `hook` is the handle we installed and have not freed.
                unsafe {
                    let _ = UnhookWindowsHookEx(hook);
                    HOOK = HHOOK(std::ptr::null_mut());
                }
            })
            .map_err(|e| format!("could not spawn the hook thread: {e}"))?;

        match ready_rx.recv_timeout(std::time::Duration::from_secs(5)) {
            Ok(Ok(thread_id)) => Ok(Self {
                thread_id,
                handle: Some(handle),
            }),
            Ok(Err(e)) => Err(e),
            Err(_) => Err("the hook thread did not start in time".into()),
        }
    }

    /// Swap in a new binding table. Lock-free from the callback's point of view.
    pub fn update(table: Arc<BindingTable>) {
        if let Some(s) = STATE.get() {
            s.table.store(table);
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
        Ok(mut logic) => logic.on_key(&table, vk, down, mods),
        Err(_) => return CallNextHookEx(None, code, wparam, lparam),
    };
    if let Some(ev) = outcome.event {
        let _ = state.tx.send(ev);
    }
    let swallow = outcome.swallow;

    if swallow {
        return LRESULT(1);
    }
    CallNextHookEx(None, code, wparam, lparam)
}
