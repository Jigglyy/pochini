# Architecture

## Stack

Tauri v2: a Rust backend process hosting a WebView2 window that renders a React + TypeScript
UI. See [adr/0002-stack-tauri-rust.md](adr/0002-stack-tauri-rust.md) for the decision.

Rust owns everything that touches Win32. The UI never sees a scan code or a normalized
coordinate; it deals in the model types from [03-macro-format.md](03-macro-format.md) and
calls typed IPC commands.

## Thread model

This is the part that has to be right. Four threads, with strict rules about what each may do.

```
┌──────────────────┐   IPC commands      ┌───────────────────────┐
│  WebView2 (UI)   │ ──────────────────▶ │  Main / Tauri thread  │
│  React           │ ◀────────────────── │  owns AppState        │
└──────────────────┘   events            └───────────┬───────────┘
                                                     │ mutates binding table
                                                     ▼
                                         ┌───────────────────────┐
                                         │  Hook thread          │
                                         │  WH_KEYBOARD_LL +     │
                                         │  message pump         │
                                         │  ONLY matches + sends │
                                         └───────────┬───────────┘
                                                     │ mpsc<TriggerEvent>
                                                     ▼
                                         ┌───────────────────────┐
                                         │  Engine thread        │
                                         │  executes steps,      │
                                         │  SendInput, waits     │
                                         └───────────────────────┘
```

**Main / Tauri thread.** Sets DPI awareness before anything else. Owns `AppState` (macros,
settings, the binding table snapshot). Handles IPC. May block; nothing time-critical.

**Hook thread.** Created once at startup and never restarted casually. Installs
`WH_KEYBOARD_LL`, runs a `GetMessage` pump, and does nothing else. The callback:

1. Reject events carrying our `dwExtraInfo` stamp.
2. Look up `(vk, scancode, modifiers, direction)` in a lock-free snapshot of the binding table
   (`arc_swap::ArcSwap<BindingTable>` — the UI thread swaps in a new table; the callback never
   waits on a lock).
3. On a match, `try_send` a `TriggerEvent` on a bounded channel and return `1` if that binding
   swallows the key, else `CallNextHookEx`.

No allocation, no logging, no I/O. Budget is well under the 300 ms `LowLevelHooksTimeout`; the
target is single-digit microseconds.

**Engine thread.** Receives `TriggerEvent`s, resolves them to a macro, and runs the step list.
Owns the high-resolution waitable timer and the cancel event. One macro runs at a time;
concurrency policy is in [06-open-questions.md](06-open-questions.md).

**WebView2 thread(s).** Managed by Tauri; UI only.

## Cancellation

A single `CancelToken` per run: a Win32 event handle plus an `AtomicBool`.

- The panic key, the UI stop button, and `HoldRepeat` key-up all signal it.
- The engine waits on `WaitForMultipleObjects([timer, cancel])`, so a 30-second wait aborts
  instantly instead of on the next step boundary.
- On cancel, the engine runs a **release pass**: any key or mouse button it pressed and has not
  released gets an explicit up event. Otherwise aborting mid-macro leaves Shift stuck down
  across the whole OS, which is the worst bug this app can ship.

The release pass also runs on normal completion and on process exit
(`SetConsoleCtrlHandler` / Tauri's exit hook), for the same reason.

## Module boundaries

| Module | Responsibility | May use `unsafe` |
|---|---|---|
| `model/` | `Macro`, `Step`, `Trigger`, `Jitter` — serde + `ts-rs` types. Pure data. | no |
| `storage/` | Load/save `macros.json`, atomic write (temp + rename), schema migrations, backups | no |
| `input/` | `SendInput` wrappers, scancode tables, DPI setup, virtual-desktop coordinate math | yes |
| `hotkey/` | Hook thread, binding table, trigger matching | yes |
| `engine/` | Step execution, timing, jitter, cancellation, release pass | no (calls `input/`) |
| `commands.rs` | `#[tauri::command]` surface; the only place `anyhow` appears | no |

`input/` is defined by a trait (`InputBackend`) so the engine can be tested against a recording
fake. That is what makes the engine unit-testable without moving a real cursor — see below.

## Testing

The hard part of testing an app like this is that its whole job is a side effect on the entire
machine. Three layers:

1. **Pure unit tests** — coordinate normalization against synthetic virtual-desktop rects
   (including negative origins), jitter bounds, scancode/extended-key mapping, schema
   migrations. Fast, no Windows APIs.
2. **Engine tests against a fake backend** — `InputBackend` records the `INPUT` events and the
   requested waits instead of performing them. Asserts ordering, that every press has a
   matching release, that cancellation triggers the release pass, and that jitter stays in
   range over many seeded runs.
3. **Manual integration** — a scratch Notepad/browser checklist in the repo. Never automated in
   CI: a CI runner has no interactive desktop session, and `SendInput` in Session 0 is
   meaningless.

Use a seeded RNG (`StdRng::seed_from_u64`) behind a setting so a macro run can be made
deterministic when debugging.

## Storage

`%APPDATA%\coordsclickermacro\macros.json` (via Tauri's `app_config_dir`).

Writes are atomic: serialize to `macros.json.tmp`, `fsync`, then rename over the original. The
previous version is kept as `macros.json.bak`. Losing a user's macro library to a crash during
save is unacceptable for a file this small.

Settings (panic key, timer strategy, theme, start-with-Windows) live in a separate
`settings.json` so a corrupt macro file cannot take the app down with it.
