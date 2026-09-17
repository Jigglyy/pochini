# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this project is

**coordsclickermacro** — a Windows desktop app for building and running click/keyboard
macros driven by absolute screen coordinates.

The user flow: a main screen lists saved macros → create or edit one → a macro is an
ordered list of steps (click at X,Y / press a key / wait N ms with optional randomness) →
bind the macro to a hotkey → press the hotkey anywhere and the macro runs against whatever
is on screen.

Because input is synthesized at the OS level, macros work against **any** target — native
apps, browsers, Electron apps, emulators — not just windows this app owns.

## Status

Pre-implementation. Docs plus a validation harness. Read [docs/README.md](docs/README.md)
first; the design is already written down and should be followed rather than re-invented.

The M0 assumptions have been **measured, not assumed**, by `tools/m0-probe` (PowerShell +
inline C#, no toolchain needed). Every rule below that carries a number came out of a real
run on this machine — see [tools/m0-probe/README.md](tools/m0-probe/README.md). Re-run it
before porting each piece to Rust, and delete the directory once `src-tauri/` covers the same
ground in `cargo test`.

## Stack

| Layer | Choice |
|---|---|
| Shell | Tauri v2 |
| Core | Rust, `windows` crate (windows-rs) for Win32 |
| UI | React + TypeScript + Vite |
| Storage | Plain JSON on disk under the app config dir |

See [docs/adr/0002-stack-tauri-rust.md](docs/adr/0002-stack-tauri-rust.md) for why, and
what was rejected (Electron, C#/WPF, Python, AutoHotkey).

## Commands

Not yet scaffolded. Once `npm create tauri-app` has been run, the commands will be:

```powershell
npm install
npm run tauri dev            # dev build, hot-reloading UI
npm run tauri build          # release installer
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
npm run lint
```

Keep this table current when the scaffold lands.

## Planned layout

```
src/                      React UI
  routes/                 MacroList, MacroEditor
  components/             StepRow, HotkeyCapture, CoordPicker
  lib/ipc.ts              typed wrappers over Tauri commands
src-tauri/src/
  main.rs                 entry; DPI awareness is set HERE, first thing
  commands.rs             #[tauri::command] IPC surface
  model/                  Macro / Step / Trigger serde types
  storage/                macros.json load+save, atomic writes
  input/                  SendInput wrappers, scancode tables, DPI + coord math
  hotkey/                 WH_KEYBOARD_LL hook thread, binding registry
  engine/                 executor, timing, cancellation, panic stop
docs/                     design docs; docs/adr/ for decisions
```

## Non-negotiable technical rules

These are the things that silently break this category of app. Full reasoning in
[docs/02-windows-input-research.md](docs/02-windows-input-research.md).

1. **Set per-monitor DPI awareness v2 before any window or input work.**
   `SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)` in `main.rs`,
   and declare it in the manifest. Without it, coordinates are silently virtualized on any
   monitor whose scale differs from the primary, and clicks land in the wrong place.

2. **Absolute mouse moves always use `MOUSEEVENTF_VIRTUALDESK`.** Without it, coordinates
   normalize against the primary monitor only and secondary monitors are unreachable.
   The pixel→normalized conversion is `ceil(px * 65536 / w)`, **not** the `65535 / (w - 1)`
   the MSDN wording implies — measured, the latter is off by a pixel and plain `floor` against
   65536 is off by thousands.

3. **Keyboard synthesis uses scan codes (`KEYEVENTF_SCANCODE`), not virtual key codes.**
   DirectInput/Raw Input consumers (most games, some emulators) ignore VK-only injection.

4. **The low-level hook callback does no work.** It matches the key, enqueues to a worker
   channel, and returns. Windows silently unhooks a callback that exceeds
   `LowLevelHooksTimeout` (300 ms default).

5. **Tag our own injected input and ignore it in the hook.** Set a magic constant in
   `MOUSEINPUT.dwExtraInfo` / `KEYBDINPUT.dwExtraInfo` and skip those events, or a macro that
   presses its own trigger key re-triggers itself forever. The constant must be **below
   `i32::MAX`** — a high-bit value sign-extends on x64 when written and zero-extends when read
   back, so the filter silently never matches.

6. **Never sleep naively.** Default timer granularity is ~15.6 ms, so `sleep(5ms)` overshoots
   badly. Use a high-resolution waitable timer (`CREATE_WAITABLE_TIMER_HIGH_RESOLUTION`).

7. **Every macro run is cancellable and there is always a panic stop.** A runaway macro
   clicking at 20 Hz across the desktop is genuinely destructive. The panic key is handled in
   the hook thread, not the engine.

8. **Do not ship elevated by default.** A non-elevated process cannot inject into an elevated
   window (UIPI). Surface that as an explicit, user-initiated "restart as administrator"
   action with an explanation — never a silent manifest-level `requireAdministrator`.

## Scope boundary

This is an automation tool. It uses documented Win32 APIs and makes no attempt to hide that
its input is synthetic. Do not add anti-cheat evasion, `LLMHF_INJECTED` flag laundering,
kernel input drivers, or process/driver hiding. If a target application rejects synthetic
input, the answer is "that target is unsupported," documented in
[docs/02-windows-input-research.md](docs/02-windows-input-research.md#what-this-project-will-not-do).

## Conventions

- Rust: `thiserror` for error enums, `anyhow` only at the command boundary. No `unwrap()` in
  `engine/` or `hotkey/` — a panic in the hook thread takes the hook down.
- All `unsafe` Win32 calls live in `input/` and `hotkey/`, each with a `// SAFETY:` comment.
  The rest of the codebase is safe Rust.
- The macro JSON schema is versioned. Adding a step type means bumping `schema_version` and
  adding a migration in `storage/`. See [docs/03-macro-format.md](docs/03-macro-format.md).
- TypeScript types for macros are generated from the Rust types (`ts-rs`) rather than
  hand-maintained, so the two cannot drift.
- Coordinates in the model are **virtual-desktop pixels**, signed (a left/above monitor gives
  negative values). Never store normalized 0..65535 — that is a transport detail of `SendInput`.
