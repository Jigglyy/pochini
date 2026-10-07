# Architecture

## Stack

Tauri v2: a Rust backend process hosting a WebView2 window that renders a React + TypeScript
UI. See [adr/0002-stack-tauri-rust.md](adr/0002-stack-tauri-rust.md) for the decision.

Rust owns everything that touches Win32. The UI never sees a scan code or a normalized
coordinate; it deals in the model types from [03-macro-format.md](03-macro-format.md) and
calls typed IPC commands.

## Thread model

This is the part that has to be right. Each thread has strict rules about what it may do.

```
+------------------+   IPC commands      +-----------------------+
|  WebView2 (UI)   | ------------------> |  Main / Tauri thread  |
|  React           | <------------------ |  owns AppState        |
+------------------+   events            +-----------+-----------+
                       (settings-changed)            | swaps binding table (ArcSwap)
                                                     v
                                         +-----------------------+
                                         |  Hook thread          |
                                         |  WH_KEYBOARD_LL +     |
                                         |  message pump         |
                                         |  decides + sends only |
                                         +-----------+-----------+
                                                     | mpsc<TriggerEvent>
                                                     v
                                         +-----------------------+
                                         |  Worker thread        |
                                         |  never blocks: Panic, |
                                         |  Stop, Toggle at once |
                                         +-----------+-----------+
                                                     | spawns, at most one at a time
                                                     v
                                         +-----------------------+
                                         |  Run thread           |
                                         |  countdown, steps,    |
                                         |  SendInput, waits     |
                                         +-----------------------+
```

**Main / Tauri thread.** Sets DPI awareness before anything else. Owns `AppState` (macros,
settings, the running-macro slot). Handles IPC. May block; nothing time-critical.

**Hook thread.** Created once at startup and never restarted casually. Installs
`WH_KEYBOARD_LL`, runs a `GetMessage` pump, and does nothing else. The callback:

1. Passes through events carrying our `dwExtraInfo` stamp.
2. Reads the modifier state from Windows (`GetAsyncKeyState`), never from its own tracking.
3. Asks `hotkey::logic::KeyLogic` (pure, unit-tested) what this key means, against a
   lock-free snapshot of the binding table (`arc_swap::ArcSwap<BindingTable>`).
4. Sends any resulting `TriggerEvent` and returns `1` if the binding swallows the key, else
   `CallNextHookEx`.

No allocation, no logging, no I/O. Budget is well under the 300 ms `LowLevelHooksTimeout`; the
measured worst case is tens of microseconds.

**Worker thread.** Drains `TriggerEvent`s and never runs a macro itself. Panic and Stop cancel
the running macro; Toggle flips the master switch (which also stops a run when turning off);
Start claims the single running slot and spawns a run thread. The first version ran macros
inline here, which meant the panic key and the release of a "repeat while held" key both
waited behind the macro they were meant to stop.

**Run thread.** One per macro run. Waits out the Run/Test countdown (cancellable), then runs
the engine, which owns the high-resolution waitable timer and the cancel event. One macro at
a time; concurrency policy is in [06-open-questions.md](06-open-questions.md).

**WebView2 thread(s).** Managed by Tauri; UI only.

## Cancellation

A single `CancelToken` per run: a Win32 event handle plus an `AtomicBool`.

- The panic key, the UI stop button, and `HoldRepeat` key-up all signal it.
- The engine waits on `WaitForMultipleObjects([timer, cancel])`, so a 30-second wait aborts
  instantly instead of on the next step boundary.
- On cancel, the engine runs a **release pass**: any key or mouse button it pressed and has not
  released gets an explicit up event. Otherwise aborting mid-macro leaves Shift stuck down
  across the whole OS, which is the worst bug this app can ship.

The release pass also runs on normal completion and on error. **Not yet done:** running it on
process exit (Tauri's exit hook) as well, so quitting the app mid-macro cannot strand a key.

## Module boundaries

| Module | Responsibility | May use `unsafe` |
|---|---|---|
| `model/` | `Macro`, `Step`, `Trigger`, `Jitter` - serde + `ts-rs` types. Pure data. | no |
| `storage/` | Load/save `macros.json`, atomic write (temp + rename), schema migrations, backups | no |
| `input/` | `SendInput` wrappers, scancode tables, DPI setup, virtual-desktop coordinate math | yes |
| `hotkey/` | Hook thread, binding table, trigger matching | yes |
| `engine/` | Step execution, timing, jitter, cancellation, release pass | no (calls `input/`) |
| `commands.rs` | `#[tauri::command]` surface; the only place `anyhow` appears | no |

`input/` is defined by a trait (`InputBackend`) so the engine can be tested against a recording
fake. That is what makes the engine unit-testable without moving a real cursor - see below.

## Testing

The hard part of testing an app like this is that its whole job is a side effect on the entire
machine. Three layers:

1. **Pure unit tests** - coordinate normalization against synthetic virtual-desktop rects
   (including negative origins), jitter bounds, scancode/extended-key mapping, schema
   migrations. Fast, no Windows APIs.
2. **Engine tests against a fake backend** - `InputBackend` records the `INPUT` events and the
   requested waits instead of performing them. Asserts ordering, that every press has a
   matching release, that cancellation triggers the release pass, and that jitter stays in
   range over many seeded runs.
3. **Manual integration** - a scratch Notepad/browser checklist in the repo. Never automated in
   CI: a CI runner has no interactive desktop session, and `SendInput` in Session 0 is
   meaningless.

Use a seeded RNG (`StdRng::seed_from_u64`) behind a setting so a macro run can be made
deterministic when debugging.

## Storage

`%APPDATA%\com.pochini.app\macros.json` (via Tauri's `app_config_dir`). On first start
after the rename from the working title, files are copied (never moved, never overwritten)
from the old `%APPDATA%\com.coordsclickermacro.app` folder; see `storage::migrate_legacy_dir`.

Writes are atomic: serialize to `macros.json.tmp`, `fsync`, then rename over the original. The
previous version is kept as `macros.json.bak`. Losing a user's macro library to a crash during
save is unacceptable for a file this small.

Settings (panic key, timer strategy, theme, start-with-Windows) live in a separate
`settings.json` so a corrupt macro file cannot take the app down with it.
