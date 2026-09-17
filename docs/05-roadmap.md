# Roadmap

Build order chosen so the riskiest, least-reversible things are proven before any UI polish.

## M0 — Prove the input layer (no UI)

A Rust binary with no window that hardcodes one macro and runs it.

- [ ] DPI awareness v2 set in `main` and declared in the manifest
- [ ] Virtual-desktop coordinate math, verified on a multi-monitor, mixed-scaling setup
- [ ] `SendInput` mouse move + click, absolute, `VIRTUALDESK`
- [ ] `SendInput` keyboard via scan codes, including the extended-key table
- [ ] High-resolution waitable timer; measure actual vs requested wait over 1000 iterations
- [ ] `dwExtraInfo` stamp applied to everything injected

**Exit criterion:** clicks land within 1 px of the requested coordinate on both a 100 % primary
and a 150 % secondary monitor, and a 5 ms wait measures under 6 ms at p99.

Everything downstream is worthless if this is wrong, and it is the part that fails silently.

## M1 — Hook and trigger

- [ ] Hook thread with message pump; install/uninstall cleanly
- [ ] Binding table via `ArcSwap`; callback does no allocation
- [ ] Self-injection filtered by the stamp — verify a macro can press its own trigger key
- [ ] Pass-through vs swallow per binding
- [ ] Panic stop aborts a running macro mid-wait
- [ ] Release pass: no key or button is ever left held after abort

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
