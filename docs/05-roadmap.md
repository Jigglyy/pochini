# Roadmap

Build order chosen so the riskiest, least-reversible things are proven before any UI polish.

## M0 — Prove the input layer (no UI)

**Done, ahead of the Rust port, via `tools/m0-probe`.** Every box below was verified against
the real Win32 APIs on a 3-monitor mixed-DPI desktop with a negative origin. The Rust
implementation now has a spec to match rather than a hypothesis to test.

- [x] DPI awareness v2 set before any window — `PER_MONITOR_AWARE_V2` confirmed
- [x] Virtual-desktop coordinate math — **0 px error** over 90 points once the formula was
      corrected to `ceil(px * 65536 / w)`; the two obvious alternatives are off by 1 px and
      4480 px respectively
- [x] `SendInput` mouse move + click, absolute, `VIRTUALDESK` — 8/8 clicks delivered to a real
      window at the exact pixel
- [x] `SendInput` keyboard via scan codes — `MAPVK_VK_TO_VSC_EX` gives both the scan code and
      the extended bit, so no hardcoded extended-key table is needed after all;
      `KEYEVENTF_EXTENDEDKEY` confirmed to be what separates Right Ctrl from Left Ctrl
- [x] High-resolution waitable timer — 1 ms requested measures 1.50 ms p50 / 1.91 ms p99,
      against 15.45 ms for `Thread.Sleep`
- [x] `dwExtraInfo` stamp applied to everything injected — and the stamp must be below
      `i32::MAX` or it sign-extends and the filter never matches

**Exit criterion: met.** Clicks land on the exact requested pixel across all three monitors
including the 125 %-scaled one, and a 1 ms wait measures 1.91 ms at p99.

Remaining for the Rust port: reproduce these as `cargo test` and wire up the manifest.

## M1 — Hook and trigger

Prototyped and validated in the probe; still to be written in Rust.

- [x] Hook thread with message pump; install/uninstall cleanly — verified
- [ ] Binding table via `ArcSwap`; callback does no allocation
      *(probe used a lock; worst callback latency was still 67 us against a 300,000 us budget,
      so the budget is not tight — but the real thing should still be allocation-free)*
- [x] Self-injection filtered by the stamp — the probe's macro presses its own trigger key 6
      times and does not re-trigger; all 12 of its injected events round-trip the stamp
- [x] Callback enqueues, worker executes — proven necessary: running the macro inline in the
      callback swallowed an exception and lost the event entirely
- [ ] Pass-through vs swallow per binding *(pass-through verified; swallow not yet exercised)*
- [ ] Panic stop aborts a running macro mid-wait
- [ ] Release pass: no key or button is ever left held after abort
      *(the probe asserts this for its own modifier test and passes)*

**Exit criterion:** bind Space without swallow, run a macro that types spaces, and confirm both
that the macro fires and that typing a space in Notepad still works normally.

## M2 — Model, storage, engine

- [ ] `Macro` / `Step` / `Trigger` types with serde and `ts-rs`
- [ ] Atomic save with `.bak`; corrupt-file recovery path
- [ ] Engine executes a full step list with jitter and `repeat`
- [ ] `InputBackend` trait + recording fake; engine unit tests

## M3 — UI

- [ ] Tauri scaffold, typed IPC layer
- [ ] Macro list: create, rename, duplicate, delete, reorder, enable/disable
- [ ] Editor: step list with add/reorder/delete, all six step types
- [ ] Hotkey recording
- [ ] Coordinate picking with magnifier HUD
- [ ] Test-run with countdown overlay and stop
- [ ] Tray icon, master toggle, running indicator
- [ ] First-run notice

## M4 — Ship

- [ ] Code signing (removes most SmartScreen friction; a keyboard-hook app unsigned is a hard
      sell)
- [ ] Installer + optional start-with-Windows
- [ ] UIPI detection with a clear "relaunch as administrator?" prompt
- [ ] README with the antivirus explanation
- [ ] Import/export a single macro as JSON

## Later — in rough priority order

1. **Guards** (`foreground_process`) — reserved in the schema already. Biggest safety win.
2. **Record mode** — capture real mouse/keyboard activity into a step list instead of building
   it by hand. Needs `WH_MOUSE_LL`. Probably the single most-requested feature once v1 lands.
3. **Window-relative coordinates** — anchor a point to a window's client rect so a moved or
   resized window does not break the macro. The real fix for coordinate fragility.
4. **Display-layout change detection** — compare stored `capture` metadata against the current
   layout on startup and offer to remap.
5. **Conditional steps** — `wait_for_pixel(x, y, color, tolerance, timeout)`. Turns fixed waits
   into reliable ones. Careful: this is the first step toward being a scripting language.
6. **Mouse-button triggers** — bind to X1/X2 side buttons.
7. **Profiles** — groups of macros enabled together, optionally auto-switched by foreground app.
8. **Serial HID output backend** — for users with a Pi Pico or similar. Transparent, opt-in,
   and explicitly not sold as evasion.

## Explicitly not planned

Cloud sync, accounts, telemetry, a marketplace, anti-cheat evasion, OCR.
