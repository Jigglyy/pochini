//! Waiting, and being interruptible while waiting.
//!
//! `thread::sleep` is not usable here. Measured on the dev machine, the default
//! timer granularity is ~15.6 ms: `sleep(1ms)` takes 15.45 ms and `sleep(50ms)`
//! takes 62.17 ms. A high-resolution waitable timer gives 1.50 ms and 50.30 ms
//! for the same requests, and - the reason it is the design rather than just an
//! accuracy win - it is a kernel object, so a wait can be aborted the instant
//! the panic key is pressed instead of at the next step boundary.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// Shared cancellation for one macro run.
///
/// Two kinds: `cancel` is a hard stop (Panic, the Stop button, switching
/// macros off: "stop driving my mouse"); `stop` is a normal end requested by
/// the hotkey itself (releasing a hold-to-repeat key, the second press of a
/// toggle). The engine treats a `stop` like finishing, for example it still
/// moves the mouse back to where the macro started.
#[derive(Clone)]
pub struct CancelToken {
    flag: Arc<AtomicBool>,
    soft: Arc<AtomicBool>,
    #[cfg(windows)]
    event: Arc<OwnedEvent>,
}

impl CancelToken {
    pub fn new() -> Self {
        Self {
            flag: Arc::new(AtomicBool::new(false)),
            soft: Arc::new(AtomicBool::new(false)),
            #[cfg(windows)]
            event: Arc::new(OwnedEvent::new()),
        }
    }

    /// Hard stop. Wins over an earlier `stop`.
    pub fn cancel(&self) {
        self.soft.store(false, Ordering::SeqCst);
        self.flag.store(true, Ordering::SeqCst);
        #[cfg(windows)]
        self.event.set();
    }

    /// Normal end requested by the hotkey (see the type docs).
    pub fn stop(&self) {
        if !self.flag.load(Ordering::SeqCst) {
            self.soft.store(true, Ordering::SeqCst);
        }
        self.flag.store(true, Ordering::SeqCst);
        #[cfg(windows)]
        self.event.set();
    }

    /// Ended by `stop` rather than `cancel`.
    pub fn is_soft_stop(&self) -> bool {
        self.flag.load(Ordering::SeqCst) && self.soft.load(Ordering::SeqCst)
    }

    pub fn is_cancelled(&self) -> bool {
        self.flag.load(Ordering::SeqCst)
    }
}

impl Default for CancelToken {
    fn default() -> Self {
        Self::new()
    }
}

/// Wait `ms`, returning `false` if cancelled first.
pub fn wait(ms: u64, cancel: &CancelToken) -> bool {
    if cancel.is_cancelled() {
        return false;
    }
    if ms == 0 {
        return true;
    }
    #[cfg(windows)]
    if let Some(event) = cancel.event.0 {
        return win::wait_ms(ms, cancel, event);
    }
    // No cancel event (another OS, or Windows ran out of handles): poll, so
    // cancellation still works, if less precisely.
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(ms);
    while std::time::Instant::now() < deadline {
        if cancel.is_cancelled() {
            return false;
        }
        std::thread::sleep(std::time::Duration::from_millis(1).min(deadline - std::time::Instant::now()));
    }
    !cancel.is_cancelled()
}

/// Wait until `due`, to a fraction of a millisecond: the timer for all but
/// the last millisecond or two (it wakes in whole ones, up to one late),
/// then a short spin. A moment already past returns at once. `false` if
/// cancelled first.
pub fn wait_until(due: std::time::Instant, cancel: &CancelToken) -> bool {
    let spin = std::time::Duration::from_millis(2);
    loop {
        let now = std::time::Instant::now();
        if now >= due {
            return !cancel.is_cancelled();
        }
        let left = due - now;
        if left > spin {
            if !wait((left - spin / 2).as_millis() as u64, cancel) {
                return false;
            }
            continue;
        }
        while std::time::Instant::now() < due {
            if cancel.is_cancelled() {
                return false;
            }
            std::hint::spin_loop();
        }
        return true;
    }
}

/// The kernel event a cancel signals, so a wait ends at once. `None` if it
/// could not be created; waits then poll instead.
#[cfg(windows)]
pub struct OwnedEvent(Option<windows::Win32::Foundation::HANDLE>);

// SAFETY: a Win32 event handle is just a kernel handle; it is safe to signal
// and wait on from any thread.
#[cfg(windows)]
unsafe impl Send for OwnedEvent {}
#[cfg(windows)]
unsafe impl Sync for OwnedEvent {}

#[cfg(windows)]
impl OwnedEvent {
    fn new() -> Self {
        use windows::Win32::System::Threading::CreateEventW;
        // SAFETY: all-default manual-reset, initially unsignalled, unnamed
        // event; it only fails when the process is out of handles.
        Self(unsafe { CreateEventW(None, true, false, None) }.ok())
    }

    fn set(&self) {
        use windows::Win32::System::Threading::SetEvent;
        if let Some(h) = self.0 {
            // SAFETY: `h` is a live event handle owned by this struct.
            let _ = unsafe { SetEvent(h) };
        }
    }
}

#[cfg(windows)]
impl Drop for OwnedEvent {
    fn drop(&mut self) {
        if let Some(h) = self.0 {
            // SAFETY: the handle is owned and not used after this point.
            unsafe {
                let _ = windows::Win32::Foundation::CloseHandle(h);
            }
        }
    }
}

#[cfg(windows)]
mod win {
    use super::CancelToken;
    use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0};
    use windows::Win32::System::Threading::{
        CreateWaitableTimerExW, SetWaitableTimer, WaitForMultipleObjects, INFINITE,
        CREATE_WAITABLE_TIMER_HIGH_RESOLUTION, TIMER_ALL_ACCESS,
    };

    pub fn wait_ms(ms: u64, cancel: &CancelToken, event: HANDLE) -> bool {
        // SAFETY: unnamed timer with default security; the handle is closed below.
        let timer: HANDLE = match unsafe {
            CreateWaitableTimerExW(
                None,
                None,
                CREATE_WAITABLE_TIMER_HIGH_RESOLUTION,
                TIMER_ALL_ACCESS.0,
            )
        } {
            Ok(h) => h,
            Err(_) => {
                // Pre-1803: fall back to a coarse timer rather than failing.
                // SAFETY: as above, without the high-resolution flag.
                match unsafe { CreateWaitableTimerExW(None, None, 0, TIMER_ALL_ACCESS.0) } {
                    Ok(h) => h,
                    Err(_) => {
                        std::thread::sleep(std::time::Duration::from_millis(ms));
                        return !cancel.is_cancelled();
                    }
                }
            }
        };

        // Negative due time is relative, in 100ns units.
        let due: i64 = -(ms as i64).saturating_mul(10_000);
        // SAFETY: `timer` is live; `due` outlives the call.
        let ok = unsafe { SetWaitableTimer(timer, &due, 0, None, None, false) }.is_ok();
        if !ok {
            // SAFETY: owned handle.
            unsafe {
                let _ = CloseHandle(timer);
            }
            std::thread::sleep(std::time::Duration::from_millis(ms));
            return !cancel.is_cancelled();
        }

        let handles = [timer, event];
        // SAFETY: both handles are live for the duration of the wait.
        let r = unsafe { WaitForMultipleObjects(&handles, false, INFINITE) };
        // SAFETY: owned handle, not used again.
        unsafe {
            let _ = CloseHandle(timer);
        }
        r == WAIT_OBJECT_0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    #[test]
    fn wait_is_reasonably_accurate() {
        let c = CancelToken::new();
        let t = Instant::now();
        assert!(wait(50, &c));
        let e = t.elapsed();
        // The whole point: a naive sleep(50) measures ~62ms here.
        assert!(
            e >= Duration::from_millis(48) && e < Duration::from_millis(70),
            "50ms wait took {e:?}"
        );
    }

    #[test]
    fn a_long_wait_aborts_immediately_when_cancelled() {
        let c = CancelToken::new();
        let c2 = c.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(30));
            c2.cancel();
        });
        let t = Instant::now();
        // A 30 second wait must not hold the abort hostage.
        assert!(!wait(30_000, &c), "wait should report cancellation");
        let e = t.elapsed();
        assert!(e < Duration::from_millis(500), "abort took {e:?}");
        assert!(c.is_cancelled());
    }

    #[test]
    fn an_already_cancelled_token_does_not_wait_at_all() {
        let c = CancelToken::new();
        c.cancel();
        let t = Instant::now();
        assert!(!wait(5_000, &c));
        assert!(t.elapsed() < Duration::from_millis(50));
    }

    #[test]
    fn a_hard_cancel_wins_over_a_soft_stop() {
        let c = CancelToken::new();
        c.stop();
        assert!(c.is_cancelled() && c.is_soft_stop());
        c.cancel();
        assert!(c.is_cancelled() && !c.is_soft_stop());
        let d = CancelToken::new();
        d.cancel();
        d.stop();
        assert!(!d.is_soft_stop(), "a stop after a cancel stays hard");
    }

    #[test]
    fn zero_is_a_no_op() {
        let c = CancelToken::new();
        assert!(wait(0, &c));
    }
}
