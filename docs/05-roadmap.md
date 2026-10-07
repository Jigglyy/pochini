# Roadmap

Build order chosen so the riskiest, least-reversible things are proven before any UI polish.

## M0 - Prove the input layer (no UI)

**Done, ahead of the Rust port, via `tools/m0-probe`.** Every box below was verified against
the real Win32 APIs on a 3-monitor mixed-DPI desktop with a negative origin. The Rust
implementation now has a spec to match rather than a hypothesis to test.

- [x] DPI awareness v2 set before any window - `PER_MONITOR_AWARE_V2` confirmed
- [x] Virtual-desktop coordinate math - **0 px error** over 90 points once the formula was
      corrected to `ceil(px * 65536 / w)`; the two obvious alternatives are off by 1 px and
      4480 px respectively
- [x] `SendInput` mouse move + click, absolute, `VIRTUALDESK` - 8/8 clicks delivered to a real
      window at the exact pixel
- [x] `SendInput` keyboard via scan codes - `MAPVK_VK_TO_VSC_EX` gives both the scan code and
      the extended bit, so no hardcoded extended-key table is needed after all;
      `KEYEVENTF_EXTENDEDKEY` confirmed to be what separates Right Ctrl from Left Ctrl
- [x] High-resolution waitable timer - 1 ms requested measures 1.50 ms p50 / 1.91 ms p99,
      against 15.45 ms for `Thread.Sleep`
- [x] `dwExtraInfo` stamp applied to everything injected - and the stamp must be below
      `i32::MAX` or it sign-extends and the filter never matches

**Exit criterion: met.** Clicks land on the exact requested pixel across all three monitors
including the 125 %-scaled one, and a 1 ms wait measures 1.91 ms at p99.

Remaining for the Rust port: reproduce these as `cargo test` and wire up the manifest.

## M1 - Hook and trigger

Done in Rust (`hotkey/`, `app.rs`), with the decision logic unit-tested in `hotkey/logic.rs`.

- [x] Hook thread with message pump; install/uninstall cleanly
- [x] Binding table via `ArcSwap`; the callback takes no contended lock and does not allocate
- [x] Self-injection filtered by the stamp
- [x] Callback enqueues, worker executes
- [x] Worker never blocks: each macro runs on its own thread. Proven necessary: when runs
      were inline, the panic key and a "repeat while held" release both waited behind the
      macro they were meant to stop
- [x] Pass-through vs swallow per binding; a swallowed press also swallows its repeats and
      its release
- [x] Panic stop aborts a running macro (or countdown) mid-wait
- [x] Release pass: no key or button is left held after abort
- [x] Modifier state read from Windows (`GetAsyncKeyState`), not tracked from events.
      Reproduced live: one missed Alt key-up broke every modified hotkey until restart
- [x] Toggle-mode hotkeys stop their own run on the second press
- [ ] The toggle hotkey has failed to fire in some runs while this app's own window had
      focus; cause not found (see 06-open-questions.md)

**Exit criterion:** bind Space without swallow, run a macro that types spaces, and confirm both
that the macro fires and that typing a space in Notepad still works normally.

## M2 - Model, storage, engine

- [x] `Macro` / `Step` / `Trigger` / `Settings` types with serde (`ts-rs` still TODO; TS types
      are hand-mirrored in `src/types.ts`)
- [x] Atomic save with `.bak`; corrupt file quarantined rather than overwritten
- [x] Engine executes a full step list with jitter and `repeat`
- [x] `InputBackend` trait + recording fake (timestamped, with a configurable start cursor)
- [x] Click settle: pause before the press and after the release. Traced on a real game: the
      cursor used to leave the target 0.05 ms after the button came up
- [x] Activation-point anchor: a click or move can aim at where the mouse was when the macro
      started

## M3 - UI

Rebuilt on ShadCN + Tailwind v4 in Kanbini's style.

- [x] Tauri scaffold, typed IPC layer
- [x] Macro list: create, duplicate, delete (in-app confirm), per-macro on/off switch
- [x] Editor: step list with add / reorder / duplicate / delete, all step types, "Click at
      mouse", discard-changes guard, Ctrl+S
- [x] Hotkey recording (in-window)
- [x] Coordinate picking (3 second countdown) and "Show me"
- [x] Run and Test with a backend 3 second countdown and a Stop pill
- [x] Master on/off switch in the header plus a global toggle hotkey (default Ctrl+Shift+F12)
- [x] Settings screen: toggle hotkey, panic key, theme (system / light / dark)
- [x] Per-macro **Queue presses** (FIFO, cap 50, each run keeps its own press position)
- [x] Per-macro **App only** with a running-apps picker
- [x] Drag-to-reorder for macros and steps (dnd-kit, as in Kanbini)
- [x] Favorites and macro list sorting (custom, favorites first, name, newest, recently edited)
- [x] Step color coding by kind, recolorable (right-click a step, or Settings)
- [x] GitHub Releases: a `v*` tag builds the .exe on GitHub Actions and attaches it
- [x] Offset targets: mouse start + offset, previous point + offset (chains)
- [x] Playwright e2e suite against the real app in a headless test mode (`npm run e2e`)
- [ ] Coordinate picking via a hook-armed key, with a magnifier
- [ ] Tray icon (closing the window currently quits the app and its hotkeys)
- [ ] First-run notice about the keyboard hook

## M4 - Ship

- [ ] Code signing (removes most SmartScreen friction; a keyboard-hook app unsigned is a hard
      sell)
- [ ] Installer + optional start-with-Windows
- [ ] UIPI detection with a clear "relaunch as administrator?" prompt
- [ ] README with the antivirus explanation
- [ ] Import/export a single macro as JSON

## Later - in rough priority order

1. ~~**Guards**~~ Done in 0.2.0 as **App only** (by window under the mouse).
2. **Record mode** - capture real mouse/keyboard activity into a step list instead of building
   it by hand. Needs `WH_MOUSE_LL`. Probably the single most-requested feature once v1 lands.
3. **Window-relative coordinates** - anchor a point to a window's client rect so a moved or
   resized window does not break the macro. The real fix for coordinate fragility.
4. **Display-layout change detection** - compare stored `capture` metadata against the current
   layout on startup and offer to remap.
5. **Conditional steps** - `wait_for_pixel(x, y, color, tolerance, timeout)`. Turns fixed waits
   into reliable ones. Careful: this is the first step toward being a scripting language.
6. **Mouse-button triggers** - bind to X1/X2 side buttons.
7. **Profiles** - groups of macros enabled together, optionally auto-switched by foreground app.
8. **Serial HID output backend** - for users with a Pi Pico or similar. Transparent, opt-in,
   and explicitly not sold as evasion.

## Explicitly not planned

Cloud sync, accounts, telemetry, a marketplace, anti-cheat evasion, OCR.
