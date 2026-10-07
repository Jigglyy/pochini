# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this project is

**Pochini** (from *pochi*, the Japanese sound of pressing a button, plus Kanbini's "-ini"):
a Windows desktop app for building and running click/keyboard macros driven by absolute
screen coordinates. The project folder is still named `coordsclickermacro`, its working title.

The user flow: a main screen lists saved macros, you create or edit one, a macro is an
ordered list of steps (click at X,Y / click where the mouse is / press a key / wait N ms
with optional randomness), you bind it to a hotkey, and pressing the hotkey anywhere runs it
against whatever is on screen. A master switch (and a global toggle hotkey) turns every
hotkey on or off; each macro also has its own switch, can **queue** repeated presses, and can
be restricted to **one app** (the hotkey only fires while the mouse is over that app), and
can **move the mouse back** to where it started when the run ends.

Because input is synthesized at the OS level, macros work against **any** target (native
apps, browsers, Electron apps, emulators, games without kernel anti-cheat), not just windows
this app owns.

## Status

Implemented and building. `src-tauri/` has the full Rust core (model, storage, input,
hotkey, engine, IPC) with **114 passing unit tests**; `src/` is a ShadCN + Tailwind v4 UI
styled after Kanbini (macro list, step editor, settings). `npm run tauri dev` opens the app.

The M0/M1 Win32 assumptions were measured before being ported; see
[tools/m0-probe/README.md](tools/m0-probe/README.md). That harness found three errors in the
original design docs; the numbered rules below are the corrected versions and each one has a
regression test. Read [docs/README.md](docs/README.md) before changing behaviour.

Not yet done: tray icon, ts-rs type generation, code signing, installer.
The toggle hotkey once did nothing; fixed in 0.2.1 by RegisterHotKey plus a hook watchdog
([docs/06-open-questions.md](docs/06-open-questions.md) #9).
See [docs/05-roadmap.md](docs/05-roadmap.md).

## Stack

| Layer | Choice |
|---|---|
| Shell | Tauri v2 |
| Core | Rust, `windows` crate (windows-rs) for Win32 |
| UI | React 19 + TypeScript + Vite, Tailwind v4 (CSS-first), ShadCN/UI (Radix), lucide icons |
| Storage | Plain JSON on disk under the app config dir |

See [docs/adr/0002-stack-tauri-rust.md](docs/adr/0002-stack-tauri-rust.md) for why, and
what was rejected (Electron, C#/WPF, Python, AutoHotkey).

## Commands

```powershell
npm install
npm run tauri dev                                  # run the app
npm run release -- patch                           # versioned .exe, see Releases below
npm run icons                                      # regenerate all icons from assets/pochini-icon.svg
npm run build                                      # type-check + build the frontend alone
cargo test  --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets
cargo run --manifest-path src-tauri/Cargo.toml --example trace_macro -- "<macro name>"
```

`cargo` is at `%USERPROFILE%\.cargo\bin`; it is on the user PATH, but a shell (or a VS Code
window) opened before the install will not have it.

`trace_macro` runs a saved macro through the real engine with a mouse hook recording every
event, and reports settle/hold/dwell timing plus which window each click lands on. Clicks
are swallowed unless `--live` is given; `--first N` stops after N steps.

The Win32 probe still runs standalone and needs no toolchain:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\m0-probe\probe.ps1 safe
```

## Releases

Every version gets a new executable and the previous one is deleted:

```powershell
npm run release -- patch     # or minor / major / X.Y.Z / current
```

`scripts/release.mjs` bumps the version in `package.json` + `package-lock.json` (the single
source; `tauri.conf.json` reads it) and in `src-tauri/Cargo.toml`, runs
`tauri build --no-bundle`, writes **`release/Pochini-<version>.exe`** (gitignored), and deletes
any older `Pochini-*.exe` there. Add a `CHANGELOG.md` entry for each version. Semver; while the
major is 0, a minor bump may change behaviour or the macro file format.

## Layout

```
src/                      React UI
  App.tsx                 shell: header, master switch, routes, run pill, discard guard
  screens/                MacroList, MacroEditor, Settings
  components/ui/          ShadCN components (CLI copy-in; ours to evolve)
  components/layout.tsx   Section, Field, ToggleRow, Kbd, KeyCombo, Notice primitives
  components/             StepRow, JitterField, CoordPicker, KeyCapture, RunIndicator
  components/sortable.tsx shared dnd-kit setup (Kanbini's drag feel) for steps and macros
  lib/ipc.ts              typed wrappers over the Tauri commands
  lib/steps.ts            step construction, plain-English summaries, duration estimates
  lib/order.ts            macro list sort modes and drag-group ordering
  lib/prefs.ts            renderer-only prefs (localStorage "pochini.settings")
  lib/theme.ts            system/light/dark preference
  index.css               theme tokens: ShadCN names, Kanbini oklch values
  types.ts                mirrors model.rs by hand (ts-rs generation is still TODO)
src-tauri/src/
  main.rs                 thin bin entry
  lib.rs                  run(): DPI first, then state, worker, hook, Tauri
  app.rs                  AppState + the non-blocking macro worker (tested)
  commands.rs             the #[tauri::command] surface
  model.rs                Macro / Step / Trigger / Jitter / Anchor / Settings serde types
  storage.rs              atomic macros.json + settings.json
  input/coords.rs         pixel <-> normalized math       (pure, heavily tested)
  input/keys.rs           VK <-> scan code, extended bit  (pure)
  input/win.rs            SendInput + DPI + monitors      (unsafe)
  input/fake.rs           recording backend for tests
  engine/mod.rs           step execution, jitter, settle, activation point, release pass
  engine/timer.rs         high-resolution interruptible wait
  hotkey/bindings.rs      binding table + matching        (pure, tested)
  hotkey/logic.rs         per-key decision state machine  (pure, tested)
  hotkey/hook.rs          WH_KEYBOARD_LL thread           (unsafe, thin)
assets/pochini-icon.svg   app icon source of truth (also the header logo and favicon)
src-tauri/examples/       trace_macro diagnostic
tools/m0-probe/           standalone Win32 validation harness
docs/                     design docs; docs/adr/ for decisions
```

## Non-negotiable technical rules

These are the things that silently break this category of app. Full reasoning in
[docs/02-windows-input-research.md](docs/02-windows-input-research.md).

1. **Set per-monitor DPI awareness v2 before any window or input work.**
   `SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)` in `run()`,
   and declared in the manifest (`build.rs`). Without it, coordinates are silently virtualized
   on any monitor whose scale differs from the primary, and clicks land in the wrong place.
   The manifest must also keep the Common-Controls v6 dependency, or the app fails to start
   with STATUS_ENTRYPOINT_NOT_FOUND. The same applies to any helper script that injects or
   measures: call EnsurePerMonitorV2 first or its numbers are 1.25x off on this machine.

2. **Absolute mouse moves always use `MOUSEEVENTF_VIRTUALDESK`.** Without it, coordinates
   normalize against the primary monitor only and secondary monitors are unreachable.
   The pixel to normalized conversion is `ceil(px * 65536 / w)`, **not** the `65535 / (w - 1)`
   the MSDN wording implies. Measured: the latter is off by a pixel and plain `floor` against
   65536 is off by thousands.

3. **Keyboard synthesis uses scan codes (`KEYEVENTF_SCANCODE`), not virtual key codes.**
   DirectInput/Raw Input consumers (most games, some emulators) ignore VK-only injection.

4. **The low-level hook callback does no blocking work.** It reads the modifier state, asks
   `hotkey::logic::KeyLogic` what to do, enqueues the result, and returns. Windows silently
   unhooks a callback that exceeds `LowLevelHooksTimeout` (300 ms default). Through
   `KeyContext` it may read the cursor position, and, only when an "App only" binding is a
   candidate, the executable under the cursor (a few user32 calls; the process query is cached
   per pid in a thread-local, no locks).
   The on/off toggle is additionally registered with `RegisterHotKey` on the hook thread;
   while that holds, the hook does not send the toggle itself (no double flip). A 30 s thread
   timer reinstalls the hook (new before old is removed), because Windows removes a slow hook
   silently and permanently.

5. **Ask Windows for the modifier state; never track it from the event stream.** The hook
   reads `GetAsyncKeyState` for Ctrl/Alt/Shift/Win on every key. A tracker built from
   key-down/key-up events goes permanently wrong the first time a key-up is hidden from the
   hook (released in an elevated window, on the secure desktop, or held when the app
   started), and then every hotkey with exact modifiers stops matching. Reproduced live.

6. **Tag our own injected input and ignore it in the hook.** Set a magic constant in
   `MOUSEINPUT.dwExtraInfo` / `KEYBDINPUT.dwExtraInfo` and skip those events, or a macro that
   presses its own trigger key re-triggers itself forever. The constant must be **below
   `i32::MAX`**: a high-bit value sign-extends on x64 when written and zero-extends when read
   back, so the filter silently never matches.

7. **Never sleep naively.** Default timer granularity is ~15.6 ms, so `sleep(5ms)` overshoots
   badly. Use a high-resolution waitable timer (`CREATE_WAITABLE_TIMER_HIGH_RESOLUTION`).

8. **Every run is cancellable, there is always a panic stop, and the worker never blocks.**
   Each macro runs on its own thread so the worker loop handles Panic, Stop and Toggle the
   moment they arrive. (The first version ran macros inline in the loop, so the panic key
   and the release of a "repeat while held" key both waited behind the macro they were meant
   to stop.) Turning the master switch off also stops whatever is running.

9. **Click steps settle.** Pause after the cursor arrives and again after the release
   (`settle_ms`, default 50 to 75 ms). Without it the cursor left the target 0.05 ms after
   the button came up and frame-polling targets (games) registered the release elsewhere.

10. **Do not ship elevated by default.** A non-elevated process cannot inject into an
    elevated window (UIPI). Surface that as an explicit, user-initiated "restart as
    administrator" action with an explanation, never a silent manifest-level
    `requireAdministrator`.

11. **Never log keystroke content, not even temporarily while debugging.** The README promises
    the hook discards keys after matching. A debug `eprintln!` in the hook once wrote the
    user's real typing to a log file. To debug hotkeys, use Settings > Hotkey check (it reports
    only keys the user has bound, via `BindingTable::is_watched`) or `KeyLogic` unit tests.

## Scope boundary

This is an automation tool. It uses documented Win32 APIs and makes no attempt to hide that
its input is synthetic. Do not add anti-cheat evasion, `LLMHF_INJECTED` flag laundering,
kernel input drivers, or process/driver hiding. If a target application rejects synthetic
input, the answer is "that target is unsupported," documented in
[docs/02-windows-input-research.md](docs/02-windows-input-research.md#5-what-this-project-will-not-do).

## How to work here

Adopted from Kanbini:

- **Conventional Commits** (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`) with a
  descriptive body. The git log is read as the project's design narrative.
- **No `Co-Authored-By` trailer** on commits.
- **No em dashes.** Never use the em-dash character (U+2014) anywhere: code comments, docs,
  README, commit messages, or UI copy. Use a hyphen, a comma, parentheses, or split into two
  sentences. Plain hyphens and en dashes are fine.
- **Permissive dependencies only** (MIT / Apache-2.0 / BSD / ISC). Check the license before
  adding a dependency and say which it is in the commit body. Current front-end deps: React,
  Radix (`radix-ui`), Tailwind, tw-animate-css, clsx, tailwind-merge (all MIT), lucide-react
  (ISC), class-variance-authority (Apache-2.0).
- **Tests are part of the work.** New behaviour ships with tests in the same commit; a bug
  fix starts with a failing regression test.
- **Real-machine tests:** never inject F12, F13 or F14 (the user's screenshot tool hotkeys), and do
  not inject keystrokes while the user is actively typing; they land in whatever is focused.

## UI conventions

Mostly carried over from Kanbini, whose renderer this UI copies the look of:

- **ShadCN components live in `src/components/ui/`.** Added with `npx shadcn@latest add`, then
  owned and edited freely. After any `add`, check imports: the CLI once rewrote every
  `cn` import to an npm package literally named `cn` (and installed it). The real helper is
  `src/lib/utils.ts`.
- **Theme tokens are the only source of colour.** `src/index.css` defines ShadCN's token names
  with Kanbini's oklch values: dark is the default `:root`, light overrides under
  `:root[data-theme='light']`, plus `--warning` and `--success`. Anything that varies by
  theme must use a token (`bg-card`, `text-muted-foreground`, `border-warning/50`...), never
  a hardcoded colour or fixed Tailwind shade.
- **Theme preference** (system / light / dark) is renderer-only, stored in localStorage under
  `pochini.settings`, and applied before first paint by the inline script in `index.html`.
- **Build screens from the primitives in `components/layout.tsx`**: `Section` (uppercase
  heading over a bordered `bg-card/40` panel), `Field` (label column + control), `ToggleRow`,
  `Kbd`/`KeyCombo`, `Notice`. Page bodies are `mx-auto max-w-4xl` (settings `max-w-3xl`).
- **No `window.confirm` / `alert` / `prompt`.** Use `AlertDialog` (with
  `variant="destructive"` on the action for destructive choices).
- **Flex children holding user text** (macro names) need `min-w-0` plus `truncate`, or long
  names blow out the row.
- **Icons are lucide**, `size-4` in buttons. Tooltips use the ShadCN `Tooltip` with the
  provider's 200 ms delay.

## Testing

`cargo test` is the gate: 114 tests, no Windows APIs required for most of them.

- `input/coords.rs` walks **every pixel** of six virtual-desktop layouts (including negative
  origins and odd sizes) through the round trip, and has an explicit regression test that
  fails if someone reverts `to_normalized` to either formula that measured wrong.
- `engine/` runs against `input::fake::FakeInput`, which records timestamped events instead of
  performing them. `FakeInput::still_held()` asserts no key or button survives an abort;
  `timeline()` asserts the settle/dwell gaps; `with_cursor()` sets the activation point.
- `hotkey/logic.rs` covers every hook decision: auto-repeat, release order, swallow pairing,
  toggle debounce, and the modifier contract.
- `app.rs` drives the real worker against a fake backend: panic mid-run, hold-repeat release,
  toggle-mode second press, countdown cancel, master switch off stops the run, and the queue
  (order, no overlap, per-press positions, cap, clearing).
- Anything that needs a real desktop session belongs in `tools/m0-probe` or the
  `trace_macro` example, not in CI: a CI runner has no interactive session and `SendInput`
  in Session 0 is meaningless.

## Conventions

- Rust: `thiserror` for error enums, string errors only at the command boundary. No
  `unwrap()` in `engine/` or `hotkey/`: a panic in the hook thread takes the hook down.
- All `unsafe` Win32 calls live in `input/` and `hotkey/`, each with a `// SAFETY:` comment.
  The rest of the codebase is safe Rust.
- The macro JSON schema is versioned. Removing or changing the meaning of a field means
  bumping `schema_version` and adding a migration in `storage.rs`; an additive field with a
  serde default does not. See [docs/03-macro-format.md](docs/03-macro-format.md).
- TypeScript types in `src/types.ts` mirror the Rust model by hand for now; keep them in step
  until `ts-rs` generation lands.
- Coordinates in the model are **virtual-desktop pixels**, signed (a left/above monitor gives
  negative values). Never store normalized 0..65535; that is a transport detail of `SendInput`.
