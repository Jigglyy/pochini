//! Trace exactly what a saved macro puts into the OS input stream.
//!
//!     cargo run --example trace_macro -- ["macro name"] [--live]
//!
//! For every click it also reports WHICH WINDOW the click lands on and whether
//! that process is elevated - a click can be sent perfectly and still go to the
//! wrong window, or be silently dropped by UIPI.
//!
//! --live lets the clicks through for real. Without it they are swallowed.
//! --first N runs only the first N steps, e.g. to stop short of a confirm button.
//!
//! Runs the macro through the real engine and the real SendInput backend, with a
//! WH_MOUSE_LL hook recording every event it produces. Button events carrying
//! our INJECT_STAMP are SWALLOWED by the hook, so nothing on screen actually gets
//! clicked; cursor moves pass through so positions are real. Your own mouse is
//! untouched (unstamped events always pass).
//!
//! Prints a timeline and the two gaps that matter for click reliability:
//!   settle  = time between the cursor arriving and the button going down
//!   dwell   = time between the button coming up and the cursor leaving

#[cfg(not(windows))]
fn main() {
    eprintln!("trace_macro is Windows-only");
}

#[cfg(windows)]
fn main() {
    win::main()
}

#[cfg(windows)]
mod win {
    use std::sync::{Arc, Mutex, OnceLock};
    use std::time::Instant;

    use pochini_lib::engine::{CancelToken, Engine};
    use pochini_lib::input::win::{init_dpi_awareness, WinInput};
    use pochini_lib::input::{InputBackend, INJECT_STAMP};
    use pochini_lib::model::MacroFile;
    use windows::core::PWSTR;
    use windows::Win32::Foundation::{CloseHandle, HANDLE, HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::Security::{
        GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY,
    };
    use windows::Win32::System::Threading::{
        GetCurrentProcess, GetCurrentThreadId, OpenProcess, OpenProcessToken,
        QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, DispatchMessageW, GetAncestor, GetForegroundWindow, GetMessageW,
        GetWindowTextW, GetWindowThreadProcessId, PostThreadMessageW, SetWindowsHookExW,
        TranslateMessage, UnhookWindowsHookEx, WindowFromPoint, GA_ROOT, MSG, MSLLHOOKSTRUCT,
        WH_MOUSE_LL, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MBUTTONDOWN, WM_MBUTTONUP, WM_MOUSEMOVE,
        WM_QUIT, WM_RBUTTONDOWN, WM_RBUTTONUP,
    };

    #[derive(Clone, Copy, Debug, PartialEq)]
    enum Kind {
        Move,
        Down,
        Up,
        Other(u32),
    }

    struct Ev {
        t: Instant,
        kind: Kind,
        x: i32,
        y: i32,
        /// Top-level window under the cursor when a button went down.
        target: Option<isize>,
    }

    static LOG: OnceLock<Mutex<Vec<Ev>>> = OnceLock::new();
    static LIVE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

    fn window_title(h: HWND) -> String {
        let mut buf = [0u16; 256];
        let n = unsafe { GetWindowTextW(h, &mut buf) };
        String::from_utf16_lossy(&buf[..n.max(0) as usize])
    }

    fn token_elevated(process: HANDLE) -> Option<bool> {
        unsafe {
            let mut tok = HANDLE::default();
            OpenProcessToken(process, TOKEN_QUERY, &mut tok).ok()?;
            let mut el = TOKEN_ELEVATION::default();
            let mut len = 0u32;
            let r = GetTokenInformation(
                tok,
                TokenElevation,
                Some(&mut el as *mut _ as *mut _),
                std::mem::size_of::<TOKEN_ELEVATION>() as u32,
                &mut len,
            );
            let _ = CloseHandle(tok);
            r.ok()?;
            Some(el.TokenIsElevated != 0)
        }
    }

    /// (pid, exe name, elevated?) for the process owning a window. `elevated`
    /// is None when we are not allowed to look, which itself suggests it is.
    fn window_owner(h: HWND) -> (u32, String, Option<bool>) {
        unsafe {
            let mut pid = 0u32;
            GetWindowThreadProcessId(h, Some(&mut pid));
            let Ok(p) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
                return (pid, "<access denied>".into(), None);
            };
            let mut buf = [0u16; 512];
            let mut len = buf.len() as u32;
            let name = if QueryFullProcessImageNameW(
                p,
                PROCESS_NAME_WIN32,
                PWSTR(buf.as_mut_ptr()),
                &mut len,
            )
            .is_ok()
            {
                let full = String::from_utf16_lossy(&buf[..len as usize]);
                full.rsplit('\\').next().unwrap_or(&full).to_string()
            } else {
                "<unknown>".into()
            };
            let el = token_elevated(p);
            let _ = CloseHandle(p);
            (pid, name, el)
        }
    }

    unsafe extern "system" fn hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code != 0 {
            return CallNextHookEx(None, code, wparam, lparam);
        }
        let m = &*(lparam.0 as *const MSLLHOOKSTRUCT);
        if m.dwExtraInfo != INJECT_STAMP as usize {
            return CallNextHookEx(None, code, wparam, lparam);
        }
        let msg = wparam.0 as u32;
        let kind = match msg {
            WM_MOUSEMOVE => Kind::Move,
            WM_LBUTTONDOWN | WM_RBUTTONDOWN | WM_MBUTTONDOWN => Kind::Down,
            WM_LBUTTONUP | WM_RBUTTONUP | WM_MBUTTONUP => Kind::Up,
            other => Kind::Other(other),
        };
        let target = if kind == Kind::Down {
            let h = WindowFromPoint(m.pt);
            Some(GetAncestor(h, GA_ROOT).0 as isize)
        } else {
            None
        };
        if let Some(l) = LOG.get() {
            if let Ok(mut v) = l.lock() {
                v.push(Ev { t: Instant::now(), kind, x: m.pt.x, y: m.pt.y, target });
            }
        }
        // Swallow our own button events so the trace never clicks anything,
        // unless --live was asked for.
        if matches!(kind, Kind::Down | Kind::Up)
            && !LIVE.load(std::sync::atomic::Ordering::Relaxed)
        {
            return LRESULT(1);
        }
        CallNextHookEx(None, code, wparam, lparam)
    }

    pub fn main() {
        if let Err(e) = init_dpi_awareness() {
            eprintln!("warning: {e}");
        }

        let args: Vec<String> = std::env::args().skip(1).collect();
        let live = args.iter().any(|a| a == "--live");
        LIVE.store(live, std::sync::atomic::Ordering::Relaxed);
        let want = args
            .iter()
            .enumerate()
            .find(|(i, a)| {
                !a.starts_with("--") && (*i == 0 || args[i - 1] != "--first")
            })
            .map(|(_, a)| a.clone());
        let path = std::path::PathBuf::from(std::env::var("APPDATA").expect("APPDATA"))
            .join("com.pochini.app")
            .join("macros.json");
        let file: MacroFile =
            serde_json::from_str(&std::fs::read_to_string(&path).expect("read macros.json"))
                .expect("parse macros.json");
        let m = match &want {
            Some(n) => file.macros.iter().find(|m| &m.name == n),
            None => file.macros.first(),
        }
        .expect("no matching macro")
        .clone();
        let mut m = m;
        // --first N runs only the first N steps (e.g. stop before a confirm button).
        if let Some(n) = args
            .iter()
            .position(|a| a == "--first")
            .and_then(|i| args.get(i + 1))
            .and_then(|v| v.parse::<usize>().ok())
        {
            m.steps.truncate(n);
        }
        println!(
            "macro: {:?}  ({} steps)  mode: {}",
            m.name,
            m.steps.len(),
            if live { "LIVE - clicks go through" } else { "dry run - clicks swallowed" }
        );
        let me_elev = token_elevated(unsafe { GetCurrentProcess() });
        println!("this process elevated: {:?}", me_elev);
        let fg = unsafe { GetForegroundWindow() };
        let (_, fg_exe, _) = window_owner(fg);
        println!("foreground window at start: {:?} ({})\n", window_title(fg), fg_exe);

        LOG.set(Mutex::new(Vec::new())).ok();
        let (tx, rx) = std::sync::mpsc::channel::<u32>();
        let pump = std::thread::spawn(move || unsafe {
            let h = SetWindowsHookExW(WH_MOUSE_LL, Some(hook), None, 0).expect("install hook");
            tx.send(GetCurrentThreadId()).unwrap();
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            let _ = UnhookWindowsHookEx(h);
        });
        let hook_tid = rx.recv().unwrap();

        let input = Arc::new(WinInput::new());
        let start_pos = input.cursor_pos().unwrap_or((0, 0));
        let mut engine = Engine::new(input.clone(), Some(1));
        let t0 = Instant::now();
        let r = engine.run(&m, &CancelToken::new());
        std::thread::sleep(std::time::Duration::from_millis(150));
        let _ = input.move_to(start_pos.0, start_pos.1);

        unsafe {
            let _ = PostThreadMessageW(hook_tid, WM_QUIT, WPARAM(0), LPARAM(0));
        }
        let _ = pump.join();
        println!("engine result: {r:?}\n");

        let log = LOG.get().unwrap().lock().unwrap();
        let ms = |t: Instant| t.duration_since(t0).as_secs_f64() * 1000.0;

        println!("{:>9}  {:<6} {:>12}", "t (ms)", "event", "position");
        let mut last_kind = None;
        for e in log.iter() {
            // collapse runs of interpolated moves to keep the table short
            if e.kind == Kind::Move && last_kind == Some(Kind::Move) {
                continue;
            }
            println!("{:>9.2}  {:<6} {:>12}", ms(e.t), format!("{:?}", e.kind), format!("({},{})", e.x, e.y));
            last_kind = Some(e.kind);
        }

        println!();
        let mut click = 0;
        for (i, e) in log.iter().enumerate() {
            if e.kind != Kind::Down {
                continue;
            }
            click += 1;
            let arrived = log[..i].iter().rev().find(|p| p.kind == Kind::Move);
            let up = log[i + 1..].iter().find(|p| p.kind == Kind::Up);
            let left = up.and_then(|u| {
                log.iter()
                    .skip_while(|p| p.t <= u.t)
                    .find(|p| p.kind == Kind::Move && (p.x != u.x || p.y != u.y))
            });
            let settle = arrived.map(|a| ms(e.t) - ms(a.t));
            let hold = up.map(|u| ms(u.t) - ms(e.t));
            let dwell = match (up, left) {
                (Some(u), Some(l)) => format!("{:.2} ms", ms(l.t) - ms(u.t)),
                (Some(_), None) => "end of macro".into(),
                _ => "n/a".into(),
            };
            let up_moved = up.map(|u| (u.x, u.y) != (e.x, e.y)).unwrap_or(false);
            if let Some(t) = e.target {
                let h = HWND(t as *mut _);
                let (pid, exe, el) = window_owner(h);
                let blocked = me_elev == Some(false) && el != Some(false);
                println!(
                    "click {click} lands on: {:?}  [{} pid {}]  elevated: {}{}",
                    window_title(h),
                    exe,
                    pid,
                    el.map(|b| b.to_string()).unwrap_or("unknown (access denied)".into()),
                    if blocked {
                        "  !! target may be elevated and we are not - Windows silently drops clicks (UIPI)"
                    } else {
                        ""
                    }
                );
            }
            println!(
                "click {click} at ({},{}): settle {}  hold {}  dwell {}{}",
                e.x,
                e.y,
                settle.map(|s| format!("{s:.2} ms")).unwrap_or("n/a".into()),
                hold.map(|h| format!("{h:.2} ms")).unwrap_or("n/a".into()),
                dwell,
                if up_moved { "  !! released at a different position" } else { "" }
            );
        }
    }
}
