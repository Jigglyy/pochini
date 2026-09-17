# M0 probe

A throwaway harness that validates the Win32 claims in
[../../docs/02-windows-input-research.md](../../docs/02-windows-input-research.md) before any
Rust is written.

It is PowerShell + inline C# specifically so it needs **no toolchain** — no Rust, no MSVC
build tools, no npm. It calls exactly the same Win32 APIs with exactly the same flags the Rust
implementation will, so what it proves carries over. Once `src-tauri/` exists, these become
Rust tests and this directory can be deleted.

## Running

```powershell
cd tools\m0-probe

# read-only, no side effects at all
powershell -NoProfile -ExecutionPolicy Bypass -File .\probe.ps1 safe

# these move your mouse / send real keystrokes, so they need -Yes
powershell -NoProfile -ExecutionPolicy Bypass -File .\probe.ps1 cursor -Yes
powershell -NoProfile -ExecutionPolicy Bypass -File .\probe.ps1 keys   -Yes
powershell -NoProfile -ExecutionPolicy Bypass -File .\probe.ps1 echo   -Yes
powershell -NoProfile -ExecutionPolicy Bypass -File .\probe.ps1 hook   -Yes -Seconds 20

# hook, fully self-driving - injects its own unstamped trigger presses, no human needed,
# and makes the macro press the trigger key itself to prove there is no runaway loop
powershell -NoProfile -ExecutionPolicy Bypass -File .\probe.ps1 hook -Yes -SelfPress -Simulate 6
```

Each invasive test prints a 3-second countdown first (`-Countdown 0` to skip, `-Countdown 10`
for more breathing room). Exit code 0 = no failures, 1 = failures, 2 = consent not given.

Other flags: `-Settle <ms>` (cursor read-back delay, default 20), `-TriggerVk <int>` (hook
binding, default `0x78` = F9), `-Swallow` (block the trigger key from other apps).

## What each test proves

| Test | Side effects | Claim under test |
|---|---|---|
| `info` | none | DPI awareness can be set to PerMonitorV2; reports the real monitor layout, scales, and virtual-desktop origin |
| `coords` | none | The pixel↔normalized formulas are self-inverse across synthetic layouts, including negative origins and odd sizes |
| `timer` | none | `CREATE_WAITABLE_TIMER_HIGH_RESOLUTION` beats `Thread.Sleep`'s ~15.6 ms granularity |
| `cursor` | moves the cursor | The cursor actually lands on the requested pixel, on every monitor, via `MOUSEEVENTF_ABSOLUTE\|VIRTUALDESK`. Runs all three candidate formulas and reports which wins. |
| `keys` | presses Right Ctrl | `MAPVK_VK_TO_VSC_EX` scan codes work, and `KEYEVENTF_EXTENDEDKEY` is what distinguishes Right Ctrl from Left Ctrl. Also asserts nothing is left stuck down. |
| `echo` | opens a window, clicks and types into it | End-to-end: a real window receives clicks at the exact pixels requested and receives the exact text sent |
| `hook` | installs a global keyboard hook | `WH_KEYBOARD_LL` installs on a pumped thread, passes keys through by default, filters our own injected events by `dwExtraInfo` stamp (no runaway self-trigger), and the callback stays far inside `LowLevelHooksTimeout` |

The `hook` test logs nothing to disk and keeps only key codes in memory for the duration of
the run.

## Results on the dev machine (2026-09-17)

Windows 11 IoT Enterprise LTSC 2024, three monitors, **mixed DPI**, **negative virtual-desktop
origin** — the layout that breaks naive implementations:

```
virtual desktop: origin (-1920, 0)  size 6400 x 1440
\.\DISPLAY1             rect [-1920,156 1920x1080]   96 dpi  100% scale
\.\DISPLAY2 (primary)   rect [0,0 2560x1440]        120 dpi  125% scale
\.\DISPLAY3             rect [2560,159 1920x1080]    96 dpi  100% scale
```

**All seven tests pass.** What they established:

### Coordinates — the documented formula was wrong

Comparing the requested pixel against `GetCursorPos` after a real `SendInput`, 90 points
spread across all three monitors:

| forward formula | max error | mean |
|---|---|---|
| `round(px * 65535 / (w - 1))` — the MSDN reading | 1 px | 0.03 px |
| `floor(px * 65536 / w)` | **4480 px** | 102 px |
| `ceil(px * 65536 / w)` | **0 px** | 0.00 px |

Windows inverts with `floor(n * w / 65536)`, so the correct forward direction is a *ceiling*
against 65536. The `floor` variant sent a click aimed at the top-left of the leftmost monitor
to a completely different monitor. The `65535 / (w - 1)` variant is the dangerous one: it is
right 97 % of the time and will pass casual testing.

### Timing — the 15.6 ms claim, confirmed exactly

| requested | waitable timer p50 | p99 | `Thread.Sleep` p50 |
|---|---|---|---|
| 1 ms | 1.50 ms | 1.91 ms | 15.45 ms |
| 5 ms | 5.17 ms | 5.74 ms | 15.46 ms |
| 15 ms | 15.30 ms | 15.65 ms | 15.57 ms |
| 50 ms | 50.30 ms | 50.62 ms | 62.17 ms |

`CREATE_WAITABLE_TIMER_HIGH_RESOLUTION` is available and does what the docs claim.

### Keyboard

- `MAPVK_VK_TO_VSC_EX` returns the scan code *and* the `0xE0` extended prefix, so the
  hardcoded extended-key table the design called for is unnecessary.
- Scan code `0x1D` + `KEYEVENTF_EXTENDEDKEY` → `VK_RCONTROL`; the same scan code without the
  flag → `VK_LCONTROL`. The flag is load-bearing.
- No modifier left stuck down after the test.

### End-to-end

8 of 8 clicks delivered to a real window at the **exact pixel** requested, and
`KEYEVENTF_UNICODE` text arrived intact.

### Hook

- Installs on a dedicated pumped thread.
- Worst callback latency **67 us** against the 300,000 us `LowLevelHooksTimeout` budget, over
  844 real key events.
- With `-SelfPress -Simulate 6`: the macro presses its own trigger key 6 times and **does not
  re-trigger**. All 12 of the macro's injected events round-trip their `dwExtraInfo` stamp.

## Bugs this harness caught before they reached Rust

Worth reading — each one would have been much harder to find later:

1. **The coordinate formula in the design doc was wrong.** Fixed in
   [../../docs/02-windows-input-research.md](../../docs/02-windows-input-research.md).
2. **`dwExtraInfo` stamp sign extension.** The original stamp `0xC0DEC11C` has the high bit
   set, so `IntPtr` sign-extended it to `0xFFFFFFFFC0DEC11C` on write and the hook compared it
   against a zero-extended `0x00000000C0DEC11C` on read. The self-injection filter silently
   never matched — the guard existed and did nothing. Stamps must stay below `int.MaxValue`;
   it is now `0x434C4943`.
3. **Running the macro inside the hook callback loses events.** The first version called the
   handler from the callback. The handler threw, the `catch` swallowed it, and the event never
   even made it into the log — the symptom was "21 triggers fired, 0 trigger key-downs
   observed." This is exactly why the architecture says the callback enqueues and a worker
   executes.
4. **A 4 ms settle before reading the cursor back is too short**, producing a phantom 24 px
   error that vanished at 20 ms. Measurement harnesses need their own correctness.

## Known quirk worth remembering

PowerShell's comma operator binds **tighter** than `+`/`-`, so `@($a, $a + 1)` silently
evaluates to `@($a, $a, 1)` — an array, not two numbers. Every arithmetic element inside an
array literal in `probe.ps1` is parenthesized for this reason. Do not "clean up" those parens.
