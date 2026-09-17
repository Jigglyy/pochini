# Windows input research

Everything here is about making "click at X,Y in any app" actually work. Most of it is
counter-intuitive failure modes rather than API discovery.

---

## 1. Injecting input

### `SendInput` is the answer

`user32!SendInput` is the supported way to synthesize mouse and keyboard input. It writes into
the same input stream as real hardware, so every consumer sees it: Win32 message loops,
Raw Input, and DirectInput.

Two older APIs exist and should not be used: `mouse_event` and `keybd_event` are superseded,
and `PostMessage`/`SendMessage(WM_LBUTTONDOWN)` only reaches apps that read the classic message
queue — it does not move the real cursor and is invisible to games, most Electron apps, and
anything using Raw Input.

**Batch related events into one `SendInput` call.** A call with several `INPUT` structs is
inserted atomically; no other process's input can interleave. A mouse-down and mouse-up that
must not be split, or a modifier + key combination, should be one call.

### Absolute mouse positioning is the fiddly part

For `MOUSEEVENTF_ABSOLUTE`, `dx`/`dy` are **not pixels**. They are normalized values in
`0..=65535`, and by default they normalize against the **primary monitor only** — which makes
every other monitor unreachable.

Adding `MOUSEEVENTF_VIRTUALDESK` normalizes against the whole virtual desktop instead. Always
set it.

```rust
// Virtual-desktop pixel -> normalized SendInput coordinate.
// SM_XVIRTUALSCREEN / SM_YVIRTUALSCREEN can be negative
// (a monitor placed left of, or above, the primary).
fn to_normalized(x: i32, y: i32) -> (i32, i32) {
    let vx = GetSystemMetrics(SM_XVIRTUALSCREEN);
    let vy = GetSystemMetrics(SM_YVIRTUALSCREEN);
    let vw = GetSystemMetrics(SM_CXVIRTUALSCREEN) as i64;
    let vh = GetSystemMetrics(SM_CYVIRTUALSCREEN) as i64;
    let nx = ((x - vx) as i64 * 65535 + (vw - 1) / 2) / (vw - 1);
    let ny = ((y - vy) as i64 * 65535 + (vh - 1) / 2) / (vh - 1);
    (nx as i32, ny as i32)
}
```

The rounding term matters: naive truncation loses up to a pixel on large virtual desktops, and
off-by-one at a button edge is a miss.

Always emit `MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK` as its own
event *before* the button event, rather than assuming a button event carries a position. Some
targets latch the cursor position on the move.

### DPI awareness — the single most common silent bug

In a process that is only *system*-DPI-aware, Windows virtualizes the coordinate space:
`SetCursorPos`, `GetCursorPos`, `SendInput` with absolute coordinates, and
`GetSystemMetrics(SM_*VIRTUALSCREEN)` all get scaled. On a multi-monitor setup where the
secondary monitor has a different scale factor, input lands off by exactly the scale ratio —
and only on that monitor, which makes it look like a random bug.

Fix, executed before creating any window:

```rust
// SAFETY: must run on the main thread before any HWND exists.
SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
```

Also declare it in the application manifest (`<dpiAwareness>PerMonitorV2</dpiAwareness>`), so
it is correct even before `main` runs. Belt and braces: the manifest is authoritative, and the
API call covers odd launch paths.

Consequence: the UI must handle per-monitor DPI itself. Tauri/WebView2 does this correctly.

### Keyboard: scan codes, not virtual keys

```
KEYBDINPUT { wVk: 0, wScan: <scan code>, dwFlags: KEYEVENTF_SCANCODE, .. }
```

Virtual-key injection is translated by the OS and reaches normal apps, but DirectInput and
Raw Input consumers read scan codes directly and will ignore a VK-only event. Since "works in
any app" is the whole premise, scan codes are the default and VK is not offered.

Three details that bite:

- **Extended keys.** Arrows, Insert/Delete/Home/End/PageUp/PageDown, right Ctrl, right Alt,
  Numpad Enter, and the Windows keys need `KEYEVENTF_EXTENDEDKEY` alongside the scan code.
  A hardcoded table of these is required; getting it wrong makes Right Alt behave as Left Alt.
- **Layout independence.** `MapVirtualKeyW(vk, MAPVK_VK_TO_VSC_EX)` converts a VK to a scan
  code using the *current* layout. Store scan codes in the macro file so a macro does not
  change meaning when the user switches between QWERTY and AZERTY; keep the VK alongside it
  for display purposes only.
- **Unicode text.** For a "type text" step, `KEYEVENTF_UNICODE` with `wScan` set to the UTF-16
  code unit handles arbitrary characters without layout games. Surrogate pairs go as two
  consecutive events. Note that `KEYEVENTF_UNICODE` is the one case where a game may not see
  the input — it is the right tool for text fields, not for gameplay keys.

### What sees that our input is synthetic

Injected events carry `LLMHF_INJECTED` (mouse) / `LLKHF_INJECTED` (keyboard) when observed
through a low-level hook, and `LLMHF_LOWER_IL_INJECTED` when the injector runs at lower
integrity. `dwExtraInfo` propagates too, readable via `GetMessageExtraInfo`. There is no
user-mode way to clear these flags, by design.

That is fine. It also means some targets will refuse us; see §5.

### UIPI: elevated targets

User Interface Privilege Isolation blocks a lower-integrity process from injecting input into
a higher-integrity window. A normal-integrity instance of this app cannot click on Task
Manager, Registry Editor, or any game launched as administrator — and nothing at any integrity
level can touch a UAC prompt, which lives on the secure desktop.

Design response: detect the failure rather than mystify the user. `SendInput` returns the
number of events inserted; a short return with `GetLastError() == ERROR_ACCESS_DENIED` means
UIPI blocked us. Surface a clear message offering to relaunch elevated, and keep
`requireAdministrator` out of the manifest.

---

## 2. Global hotkeys

Two mechanisms, and the choice is not obvious.

### `RegisterHotKey`

Simple, cheap, no hook, delivered as `WM_HOTKEY` to a window or thread.

The disqualifying problem for this project: **`RegisterHotKey` consumes the key.** If the user
binds Space, as in the original example, Space stops working in every other application for as
long as the app runs. That is unacceptable as a default. It also fails *silently* when another
process already owns the combination — it returns `FALSE`, and the app just looks broken.

### `WH_KEYBOARD_LL` (chosen)

A low-level keyboard hook sees every key event before it is dispatched, and the callback
decides: return `CallNextHookEx(...)` to pass the key through to the rest of the system, or
return `1` to swallow it.

That pass-through control is exactly what is needed — binding Space can leave Space working
everywhere, with "swallow the trigger key" as a per-binding opt-in for the cases where the user
does want it eaten.

Cost and constraints:

- **It needs its own thread with a message pump.** `SetWindowsHookExW` requires a message loop
  on the installing thread; without `GetMessage`/`TranslateMessage`/`DispatchMessage` the
  callback never fires.
- **The callback must return fast.** If it exceeds `LowLevelHooksTimeout`
  (`HKCU\Control Panel\Desktop`, 300 ms default), Windows silently removes the hook and input
  handling degrades system-wide. So the callback does one thing: match the event against the
  binding table and push a message onto a channel. Macro execution happens on a separate
  worker thread. Never allocate, log to disk, or take a mutex the UI thread can hold.
- **It must ignore our own input.** Every event we inject is stamped with a magic value in
  `dwExtraInfo` (e.g. `0xC0DE_C11C`), and the hook drops any event carrying it. Checking
  `LLKHF_INJECTED` alone is too broad — that would also ignore input from other legitimate
  tools. Without the stamp, a macro that presses its own bound key re-triggers itself forever.
- **UIPI applies here too.** A non-elevated hook does not observe keystrokes going to an
  elevated foreground window, so a hotkey will appear dead while such a window has focus.
- **Anti-virus friction.** A global keyboard hook is the defining behaviour of a keylogger.
  Expect SmartScreen and heuristic AV flags. Mitigations: sign the binary, publish source, log
  no key *content* anywhere (the hook compares against bindings and discards), and say so
  plainly in the README.

A mouse hook (`WH_MOUSE_LL`) is only needed if mouse buttons become bindable triggers. Same
rules apply. Deferred.

### Trigger modes

| Mode | Behaviour |
|---|---|
| `Once` | Key-down starts one run. Further key-downs while running are ignored (or queued — see [06-open-questions.md](06-open-questions.md)). |
| `HoldRepeat` | Loops while the key is physically held; key-up stops after the current step. Must debounce auto-repeat: the OS sends repeated key-downs with no intervening key-up, so track held state rather than counting downs. |
| `Toggle` | Key-down starts; next key-down stops. |

### Panic stop

A reserved global key (default `Esc`, configurable, never swallowed) that sets the cancel flag
on any running macro. It is evaluated in the hook thread, so it works even while the worker
thread is mid-sleep. The engine checks cancellation between steps *and* wakes early from
waits, so a `Wait 30000` step cannot hold the abort hostage.

Optional secondary guard: "abort if the physical mouse moves." Distinguishing a physical move
from our own injected move is exactly what the `dwExtraInfo` stamp gives us.

---

## 3. Timing

The naive `thread::sleep(Duration::from_millis(50))` is wrong here.

The default Windows timer resolution is **~15.6 ms**. A 50 ms sleep may take 62 ms; a 5 ms
sleep takes 15 ms. For macros whose whole value is "wait a precise, slightly randomized
moment," that is a real defect.

Options, best first:

1. **High-resolution waitable timer** — `CreateWaitableTimerExW` with
   `CREATE_WAITABLE_TIMER_HIGH_RESOLUTION` (Windows 10 1803+). Sub-millisecond scheduling
   without changing global system state. It also gives cancellation for free:
   `WaitForMultipleObjects` on `[timer, cancel_event]` means the panic stop interrupts a long
   wait instantly. **This is the design.**
2. `timeBeginPeriod(1)` (winmm) — raises timer resolution process-wide and, on builds before
   Windows 10 2004, system-wide, increasing power draw. Fallback only, and pair every call
   with `timeEndPeriod`.
3. Spin-waiting on `QueryPerformanceCounter` — accurate, burns a core. Acceptable only for the
   final sub-millisecond tail of a wait, if ever.

Also budget for the cost of `SendInput` itself and for the target app's own processing; a step
list is not a precise schedule. Accumulate against a monotonic start time rather than summing
per-step sleeps, or drift compounds over a long macro.

### Randomness

Per the user's spec, each wait has a base and an optional jitter:

```
actual = base_ms + uniform(0, jitter_ms)
```

Uniform is the right default — it is what the user can reason about ("50 ms, up to 30 ms
extra"). A Gaussian option is a possible later refinement, not a v1 requirement.

The same applies optionally to click coordinates (`jitter_px`, sampled in a disc around the
target) and to the gap between a mouse-down and its mouse-up, which is what makes a click look
like a click rather than a zero-duration event. Some targets ignore a down/up pair with no
delay between them, so a small randomized default (≈15–40 ms) is a correctness measure, not
cosmetics.

---

## 4. Capturing coordinates

Two mechanisms, both needed:

- **Hotkey capture (primary).** In the editor, "Pick coordinate" arms a temporary hook binding;
  the user moves the physical cursor over the target anywhere on screen — including over a
  fullscreen app — and presses the capture key. We read `GetCursorPos` and fill the step. This
  works over targets an overlay window cannot cover.
- **Magnifier preview.** While armed, show a small zoomed view around the cursor with a
  crosshair and the live coordinate, so single-pixel targets are hittable. Sourced from a
  periodic `BitBlt` of a small rect around the cursor.

Store context alongside the raw point: the monitor's device name, that monitor's rect, and the
DPI at capture time. None of it is used in v1, but it is what makes a later "your display
layout changed — remap these macros?" feature possible instead of impossible.

---

## 5. What this project will not do

Anti-cheat systems detect synthetic input, and the escalation ladder is well documented:
kernel input filter drivers (Interception and similar) suppress the `LLMHF_INJECTED` flag and
are themselves detected and blocked by current anti-cheat — a known-signature arms race, not a
solution. Beyond that lies hardware HID emulation (an RP2040 or Arduino presenting as a real
USB keyboard/mouse), undetectable in software precisely because it is not software.

**This project stays in user mode and uses documented APIs.** It does not launder injection
flags, ship a driver, or hide itself. A target that rejects `SendInput` is an unsupported
target, and the app should say so rather than escalate.

The hardware-HID route is worth knowing as *context* for why a given game does not work. A
future "send steps to a serial HID device" output backend would be a legitimate, transparent
feature for users who own such hardware — it is not on the roadmap.

---

## Sources

- [LowLevelKeyboardProc — Microsoft Learn](https://learn.microsoft.com/en-us/windows/win32/winmsg/lowlevelkeyboardproc)
- [mouse_event / MOUSEEVENTF flags — Microsoft Learn](https://learn.microsoft.com/en-us/windows/desktop/api/winuser/nf-winuser-mouse_event)
- [Simulating mouse movement on multi-monitor setups via WinAPI](https://filipvalentin.github.io/blog/2024/08/how-to-simulate-moving-the-mouse-cursor-through-winapi-multimonitor-setup)
- [Per-monitor DPI awareness fix for input landing on secondary monitors](https://github.com/LanternOps/breeze/pull/5599)
- [Detecting injected mouse events via LLMHF_INJECTED](https://github.com/errorc0de404/DetectMouseEvents)
- [Low-level hook not filtering LLKHF_INJECTED / dwExtraInfo](https://github.com/Raaif-Yousuf/Wingman/issues/209)
- [Low-level keyboard hook in C# — Microsoft archive](https://learn.microsoft.com/en-us/archive/blogs/toub/low-level-keyboard-hook-in-c)
- [Tauri v2 Global Shortcut plugin](https://v2.tauri.app/plugin/global-shortcut/)
- [tauri-plugin-user-input (enigo-backed input simulation)](https://lib.rs/crates/tauri-plugin-user-input)
