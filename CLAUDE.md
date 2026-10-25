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
can **move the mouse back** to where it started when the run ends. A click step can **hold
keys** while it clicks (Shift for a shift-click), and steps marked **Shuffle** trade places
at random on every pass while the others stay put.

Macros can be **exported** to a `.pochini.json` file and **imported** from one, so people
can share them; imported macros arrive with their hotkey off.

Because input is synthesized at the OS level, macros work against **any** target (native
apps, browsers, Electron apps, emulators, games without kernel anti-cheat), not just windows
this app owns.

## Status

Implemented and building. `src-tauri/` has the full Rust core (model, storage, input,
hotkey, engine, IPC) with **208 passing unit tests**; `src/` is a ShadCN + Tailwind v4 UI
styled after Kanbini (macro list, step editor, settings), with **98 Vitest tests** for its
helpers and components, and **109 Playwright e2e tests** against the real app. `npm run tauri dev` opens the app.

The M0/M1 Win32 assumptions were measured before being ported; see
[tools/m0-probe/README.md](tools/m0-probe/README.md). That harness found three errors in the
original design docs; the numbered rules below are the corrected versions and each one has a
regression test. Read [docs/README.md](docs/README.md) before changing behaviour.

Not yet done: ts-rs type generation, code signing, installer.
The toggle hotkey once did nothing; fixed in 0.2.1 by RegisterHotKey plus a hook watchdog
([docs/06-open-questions.md](docs/06-open-questions.md) #9).
See [docs/05-roadmap.md](docs/05-roadmap.md).

## Stack

| Layer | Choice |
|---|---|
| Shell | Tauri v2 |
| Core | Rust, `windows` crate (windows-rs) for Win32 |
| UI | React 19 + TypeScript 7 (the native compiler) + Vite 8, Tailwind v4 (CSS-first), ShadCN/UI (Radix), lucide icons |
| Storage | Plain JSON on disk under the app config dir |

See [docs/adr/0002-stack-tauri-rust.md](docs/adr/0002-stack-tauri-rust.md) for why, and
what was rejected (Electron, C#/WPF, Python, AutoHotkey).

## Commands

```powershell
npm install
npm run tauri dev                                  # run the app
npm run release -- patch                           # versioned .exe + GitHub Release, see Releases
npm run icons                                      # regenerate all icons from assets/pochini-icon.svg
npm run build                                      # type-check + build the frontend alone
npm test                                           # Vitest unit tests for src/ (milliseconds)
npm run e2e                                        # Playwright suite, headless (builds a debug app first)
npm run e2e:headed                                 # same, with the windows on screen, one at a time
npm run verify                                     # typecheck + guards + clippy -D warnings + cargo test
npm run notices                                    # regenerate THIRD_PARTY_NOTICES.md (after dependency changes)
cargo test  --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets
cargo run --manifest-path src-tauri/Cargo.toml --example trace_macro -- "<macro name>"
```

`cargo` installs to `%USERPROFILE%\.cargo\bin`; a shell (or a VS Code window) opened before
rustup was installed will not have it on PATH.

`trace_macro` runs a saved macro through the real engine with a mouse hook recording every
event, and reports settle/hold/dwell timing plus which window each click lands on. Clicks
are swallowed unless `--live` is given; `--first N` stops after N steps.

The Win32 probe still runs standalone and needs no toolchain:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\m0-probe\probe.ps1 safe
```

## Releases

**No releases unless the owner asks for one.** Do not run `npm run release`, bump the
version, make or push a `chore(release):` commit, or approve the `release` environment's
publish job until the owner explicitly asks for a release (the owner's rule since
2026-10-26). Ordinary commits and pushes to main are fine: they never publish anything. New
changes collect under `## Unreleased` in `CHANGELOG.md` until then.

When a release is asked for, every version gets a new executable and the previous one is
deleted:

```powershell
npm run release -- patch     # or minor / major / X.Y.Z / current
```

`scripts/release.mjs` bumps the version in `package.json` + `package-lock.json` (the single
source; `tauri.conf.json` reads it) and in `src-tauri/Cargo.toml`, regenerates
`THIRD_PARTY_NOTICES.md` (the exe embeds it), runs `tauri build --no-bundle`, writes
**`release/Pochini-<version>.exe`** (gitignored), and deletes any older `Pochini-*.exe` there. Semver; while the major is 0, a minor bump may change
behaviour or the macro file format.

**Every version is also published as a GitHub Release.** After the local build:

1. Run `cargo test` and `npm run e2e`. The release workflow runs no tests (they run here, and
   a debug compile on the runner cost ~6 minutes per release); pull requests get them in
   `ci.yml`.
2. Rename `## Unreleased` in `CHANGELOG.md` to `## X.Y.Z - <date>` (and start a new empty
   `## Unreleased` above it); that section becomes the release notes.
3. `git commit -am "chore(release): X.Y.Z"` and `git push origin main`. No tag push.
4. `.github/workflows/release.yml` (Kanbini's pattern) runs on that push because the head
   commit starts with `chore(release):`. The `build` job (read-only token) fails if the commit
   message, `package.json` and `Cargo.toml` disagree or the notices are stale, builds with
   `tauri build --no-bundle`, and hashes the exe. The `publish` job (the only one that can
   write, in the `release` environment, only for pushes by the repository owner) publishes
   "Pochini vX.Y.Z" (creating the tag on the release commit) with `Pochini-X.Y.Z.exe`,
   `SHA256SUMS.txt` and `THIRD_PARTY_NOTICES.md` attached, plus a signed build provenance
   attestation. Watch it with `gh run watch`, then check `gh release view vX.Y.Z`.
5. **The publish job waits for approval**: the `release` environment requires the owner's
   review (and deploys from `main` only). Approve it on the run's page, or, when the owner
   asked for this release:
   ```bash
   RUN=$(gh run list --workflow release.yml --limit 1 --json databaseId --jq '.[0].databaseId')
   ENV=$(gh api repos/Jigglyy/pochini/environments/release --jq .id)
   gh api -X POST repos/Jigglyy/pochini/actions/runs/$RUN/pending_deployments      -F "environment_ids[]=$ENV" -f state=approved -f comment="Release requested by the owner"
   ``` Other pushes to main skip both jobs. A manual run (Actions tab)
   is a dry run with the files as an artifact.
   - Every action is pinned to a commit SHA with the version in a comment; Dependabot bumps
     them. Never go back to `@v7` style tags: the repository settings require SHA pinning and
     allow only GitHub's own actions, verified ones, `dtolnay/rust-toolchain` and
     `Swatinem/rust-cache`. A new third-party action needs adding there first.
   - Releases build from main, not from a tag, because GitHub scopes the build cache per
     ref: tag runs could never reuse a cache and compiled everything (~20 minutes).
   - The release profile uses thin LTO: an incremental release build is 30 s instead of
     104 s with fat LTO and one codegen unit, for a 5.4 MB instead of 4.8 MB exe.

Pushing changes under `.github/workflows/` needs the `workflow` scope on the gh login
(`gh auth refresh -h github.com -s workflow`).

When an agent cuts a release, it reports both the local exe path and the GitHub release link.

**The repository is public.** `main` is protected by the "Protect main" ruleset: no force
pushes or deletion, and changes from anyone else arrive as a pull request with both CI jobs
green and a code owner's approval; the admin role bypasses it, so the owner's direct pushes
(and release commits) still work. Workflows from outside contributors' pull requests wait
for approval. Private vulnerability reporting, secret scanning with push protection, and
Dependabot alerts and security updates are on.

**Pull requests** run `.github/workflows/ci.yml` on Windows: typecheck, guards, clippy
`-D warnings`, `cargo test`, and the e2e suite (WebView2 is on the runner image). Rust is not
rustfmt-formatted; do not reformat files you are not otherwise changing.

## Layout

```
src/                      React UI
  App.tsx                 shell: header, master switch, routes, run pill, discard guard
  screens/                MacroList, MacroEditor, Settings (Kanbini's sidebar layout)
  components/ui/          ShadCN components (CLI copy-in; ours to evolve)
  components/layout.tsx   Section, Field, ToggleRow, Kbd, KeyCombo, Notice primitives
  components/             StepRow (+ StepFields), JitterField, CoordPicker, KeyCapture, RunIndicator
  components/BulkEdit.tsx changing many selected steps at once ("Mixed" fields)
  components/sortable.tsx shared dnd-kit setup (Kanbini's drag feel) for steps and macros
  components/StepColors.tsx step-kind icons, colour chips, swatches, Settings > Step colors
  lib/ipc.ts              typed wrappers over the Tauri commands
  lib/steps.ts            step construction, plain-English summaries, duration estimates
  lib/selection.ts        ticking steps: by kind, ranges, duplicate/delete the selection
  lib/bulk.ts             bulk edit rules: shared values, per-type updates, shifting points
  lib/describe.ts         one-line summaries of the folded Trigger / When it runs sections
  lib/order.ts            macro list sort modes and drag-group ordering
  lib/motion.ts           useFlip (smooth list reordering) and the easing curve
  components/Collapse.tsx animated open / close (step bodies, toggle options)
  lib/colors.ts           step colour palette (Kanbini accents), defaults, the colour store
  lib/prefs.ts            renderer-only prefs (localStorage "pochini.settings")
  lib/theme.ts            system/light/dark preference
  lib/shortcuts.ts        in-window shortcuts: the list (Settings shows it), matching, useShortcut
  lib/history.ts          editor undo/redo (pure; coalesces typing into one step)
  lib/pickup.ts           drag smooth pickup (Kanbini's), used by FloatingOverlay
  lib/review.ts           what an imported macro does that deserves a look
  components/ErrorBoundary.tsx, Welcome.tsx, StorageNotice.tsx, ImportReview.tsx
  index.css               theme tokens: ShadCN names, Kanbini oklch values
  types.ts                mirrors model.rs by hand (ts-rs generation is still TODO)
src-tauri/src/
  main.rs                 thin bin entry
  lib.rs                  run(): DPI first, then state, worker, hook, Tauri
  app.rs                  AppState + the non-blocking macro worker (tested)
  commands.rs             the #[tauri::command] surface
  model.rs                Macro / Step / Trigger / Jitter / Anchor / Settings serde types
  storage.rs              atomic macros.json + settings.json
  share.rs                export / import format for shared macros (pure, tested)
  input/coords.rs         pixel <-> normalized math       (pure, heavily tested)
  input/keys.rs           VK <-> scan code, extended bit  (pure)
  input/win.rs            SendInput + DPI + monitors      (unsafe)
  input/fake.rs           recording backend for tests
  input/clipboard.rs      plain-text clipboard (Copy as text / Paste)  (unsafe)
  tray.rs                 tray icon and menu; closing the window hides it there (lib.rs)
  record.rs               record mode: captured input -> steps   (pure, tested)
  magnifier.rs            the click-to-pick magnifier window (page: components/Magnifier.tsx)
  engine/mod.rs           step execution, jitter, settle, activation point, release pass
  engine/timer.rs         high-resolution interruptible wait
  hotkey/bindings.rs      binding table + matching        (pure, tested)
  hotkey/logic.rs         per-key decision state machine  (pure, tested)
  hotkey/hook.rs          WH_KEYBOARD_LL thread           (unsafe, thin)
assets/pochini-icon.svg   app icon source of truth (also the header logo and favicon)
src-tauri/examples/       trace_macro diagnostic
tools/m0-probe/           standalone Win32 validation harness
e2e/                      Playwright specs; _launch.ts starts the app per test
src-tauri/src/e2e.rs      the test mode those specs launch (debug builds only)
docs/                     design docs; docs/adr/ for decisions
scripts/release.mjs       versioned exe (see Releases); notices.mjs, guards.mjs (CI checks)
.github/                  release.yml, ci.yml (pull requests), issue forms, dependabot
LICENSE, THIRD_PARTY_NOTICES.md, SECURITY.md, CONTRIBUTING.md, CODE_OF_CONDUCT.md
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
   measures: call EnsurePerMonitorV2 first or its numbers are off by the display scale (1.25x
   at 125%).

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
   while that holds, the hook does not send the toggle itself (no double flip). While a key
   is being recorded in the window (`set_recording`), the table is `paused`: macros and the
   toggle stand aside (and the registration is dropped) so the combo is recorded instead of
   firing; the panic key still works, and a forgotten recording expires after 60 s.
   Record mode and click-to-pick are `hotkey::Capture` modes (`set_capture`): no hotkeys,
   the panic key ends them, and a `WH_MOUSE_LL` hook is installed on the hook thread only
   while they last. Its callback follows the same rules, ignores all injected input
   (`LLMHF_INJECTED`), and in pick mode swallows only the picking left click. A 30 s thread
   timer reinstalls the hook (new before old is removed), because Windows removes a slow hook
   silently and permanently.

5. **Ask Windows for the modifier state; never track it from the event stream.** The hook
   reads `GetAsyncKeyState` for Ctrl/Alt/Shift/Win on every key. A tracker built from
   key-down/key-up events goes permanently wrong the first time a key-up is hidden from the
   hook (released in an elevated window, on the secure desktop, or held when the app
   started), and then every hotkey with exact modifiers stops matching. Reproduced live.
   `GetAsyncKeyState` also reports modifiers our own macro holds (a shift-click), so the
   hook leaves out the ones in `input::INJECTED`, which the Win32 backend updates as it
   sends them (`hotkey::logic::held_modifiers`).

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
    `requireAdministrator`. `SendInput` reports success even when UIPI drops the input, so
    the engine asks `InputBackend::blocked` before clicks, scrolls, keys and text (the window
    under the point, or the foreground window) and stops the run with
    `InputError::AccessDenied`; the run pill then offers Restart as administrator
    (`win::restart_elevated`, `runas`, with `--restarted` so the new copy skips the
    single-instance handover). A process we may not inspect counts as not blocked.

11. **Never log keystroke content, not even temporarily while debugging.** The README promises
    the hook discards keys after matching. Record mode is the one place keys are kept: as
    `record::Rec` events in memory, turned into steps when it ends, never written elsewhere. A debug `eprintln!` in the hook once wrote the
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
- **Permissive dependencies only** (MIT / Apache-2.0 / BSD / ISC / Zlib / Unicode). Check the
  license before adding a dependency and say which it is in the commit body, then run
  `npm run notices`. One accepted exception: Tauri itself pulls in five MPL-2.0 crates
  (cssparser, cssparser-macros, selectors, dtoa-short, option-ext), used unmodified, which is
  compatible with MIT. Pochini is MIT licensed ([LICENSE](LICENSE)). Current front-end deps: React,
  Radix (`radix-ui`), Tailwind, tw-animate-css, clsx, tailwind-merge (all MIT), lucide-react
  (ISC), class-variance-authority (Apache-2.0).
- **Tests are part of the work.** New behaviour ships with tests in the same commit; a bug
  fix starts with a failing regression test.
- **Real-machine tests:** never inject F12, F13 or F14 (screenshot tools commonly own them,
  the maintainer's included), and never inject keystrokes while someone is typing; they land
  in whatever is focused.

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
- **User-picked colours are data, not theme.** Step colours come from the accent palette in
  `lib/colors.ts` (Kanbini's), stored by name. Surfaces built from them mix toward a token
  (`color-mix(in oklab, <accent> 24%, var(--card))`) so they read in both themes; see `tone()`.
  A colored card (step, macro row) is outlined all round in its accent, as Kanbini colors
  its lists and boards, with a thicker left edge: use `outlineStyle()`, which sets the four
  border-color longhands so React never mixes them with a shorthand.
- **Right-click menus** use the ShadCN `ContextMenu` (`components/ui/context-menu.tsx`), on step
  headers and macro rows, never over inputs (which keep the native copy/paste menu). Color
  pickers in any menu use `SwatchGrid` with that menu's own Item component.
- **Theme preference** (system / light / dark) is renderer-only, stored in localStorage under
  `pochini.settings`, and applied before first paint by the inline script in `index.html`.
- **One column, one left edge.** The header's contents and every page body share the
  `page-column` utility (`index.css`), and `<main>` reserves its scrollbar gutter on both
  edges, so the logo, page titles, panels and rows start at the same x on every screen and
  nothing shifts when a page starts to scroll. Don't give a page its own width. The column
  grows with the window (56rem, 72rem from `xl`, 80rem from `2xl`) because a maximized window
  was a narrow strip with empty sides; wide windows use the room inside it (the editor puts
  Trigger and When it runs side by side from `xl`), never a wider page of their own.
- **Settings is laid out like Kanbini's**: a sidebar of sections in groups (sentence-case
  group headers, no all-caps; a header-less group sits under a hairline) and one section at a
  time beside it, fading in. The last section is remembered in its own localStorage key,
  `pochini.lastSettingsSection` (UI state, not a pref, as in Kanbini), Hotkeys the first
  time. Below `md` the sidebar becomes a row that scrolls sideways. A new setting goes in the
  section it belongs to; a new section goes in `SECTION_GROUPS`. In e2e, `openSettings(page,
  "<section>")` from `_launch.ts` opens one.
- **Build screens from the primitives in `components/layout.tsx`**: `Section` (a sentence-case
  heading, then one `bg-card/40` panel whose direct children are rows divided by hairlines;
  `bare` for content with its own cards, like the step list), `Field` (8rem label column +
  controls), `ToggleRow` (a row, not a box), `Kbd`/`KeyCombo`, `Notice`. Put rows straight
  into a Section; a wrapper div turns them into one row. No cards inside cards.
- **Controls in a row are one height**: 36 px (`h-9`, the default Button/Input/Select size).
  The editor's title row is 40 px (`size="lg"` buttons beside the `h-10` name).
- **Type**: Segoe UI Variable (`--font-sans`, the Text cut) for the UI and `font-display` (the
  Display cut) for page titles and the macro name. No all-caps labels; keycaps are sans.
- **Explanations live behind a "?"**, not on screen. Give `Field`, `ToggleRow`, `Section` or
  `JitterField` a `help` prop and it renders a `HelpTip` after the label: a tooltip on hover
  (or keyboard focus) only; clicking it does nothing, by the maintainer's choice. On-screen `hint` text is only for live values ("Lands at
  (1623, 638)", "A random 50 to 75 ms each time") and short warnings or reasons ("Only in
  'Run once per press' mode"). Keep labels self-explanatory and help to two or three
  sentences. `ToggleRow` labels its switch by id, so the "?" never takes the switch's label.
- **Motion, the Kanbini way**: 200 to 220 ms on one curve, `ease-smooth`
  (`cubic-bezier(0.22, 1, 0.36, 1)`), `animate-pop` (springy) for small confirmations like
  starring. Expand / collapse uses `Collapse` (grid-template-rows 0fr to 1fr, Kanbini's
  technique). Lists that change by a click (sort, star, menus, add, duplicate, delete,
  import) glide with `useFlip()`: give items `data-flip`, call `prepare()` right before the
  state change. Drag drops do not call it; dnd-kit animates those. Screens fade in on
  arrival.
- **Nothing opens or appears out of view.** `Collapse` moves the screen with its card as it
  opens (`follow()`: every frame until the card stops growing, its bottom into view, its top
  never pushed off; not on a screen's first render unless `revealOnMount`). Two lessons:
  scrolling once at the start is capped by the browser because the page is not taller yet
  (a tall click step stayed half hidden, while a test with small wait steps passed); and the
  opening must start only after React has drawn the box, or on a busy machine there is
  nothing to animate or follow. `e2e/reveal.spec.ts` covers both with click steps at two
  window sizes. `useFlip` reveals the first new item, or
  the one passed to `prepare(key)` (a step being moved). Confirmations and errors on the
  list are sticky. Menus that add or move things give focus back without scrolling
  (`refocusWithoutScroll`), or Radix's focus return undoes the reveal. **Not View Transitions**: while one runs, Chromium sends every click to the page
  root, so quick repeated clicks were swallowed (an e2e test guards this). Windows'
  "Animation effects" off (prefers-reduced-motion) turns all of it off: a global rule in
  `index.css`, plus `useFlip` and `motion-reduce:` checks.
- **The step list has three layouts** (`StepView` in `lib/prefs.ts`, remembered): Cards,
  Compact (dense rows in one panel, a colour bar instead of an outline) and Side by side (the
  dense list, with the chosen step's `StepFields` in a sticky panel). The editor owns which
  steps are open (`open`), the side-by-side step (`current`) and the selection; `StepRow` only
  draws them. Selecting steps (Select, Ctrl+A, Ctrl+click) turns a header click into a tick
  (Shift for a range) and shows a sticky toolbar; `BulkEdit` changes the ticked steps in a
  dialog, or in the side panel in Side by side. A bulk change is one ordinary edit, keyed
  `bulk:<type>:<field>` so typing undoes as one step. Locate step headers in tests by
  `[data-step-header]` (Side by side headers have no `aria-expanded`).
- **Foldable sections**: `Section`'s `fold` prop folds the panel to a one-line `summary`
  (`lib/describe.ts`); which are folded is remembered (`folded` in prefs). `Collapse` that is
  open when it mounts is drawn open, not animated, unless `revealOnMount`.
- **Quiet chrome**: secondary actions that also live in a menu (a step's move / duplicate /
  delete buttons) show on hover or keyboard focus only. Facts about a macro go on the line
  under its name, so the right side of every row stays aligned columns.
- **Screenshots for design work**: `POCHINI_SCREENS=<folder> npx playwright test screens`
  captures every screen in dark and light from seeded macros (skipped in normal runs).
- **No `window.confirm` / `alert` / `prompt`.** Use `AlertDialog` (with
  `variant="destructive"` on the action for destructive choices). Prefer Undo to asking:
  deleting a macro or a step happens at once, with an Undo button (and Ctrl+Z) in its
  confirmation line, as in Kanbini.
- **In-window shortcuts** live in `lib/shortcuts.ts` (`SHORTCUTS`, shown in Settings) and use
  `useShortcut`, which ignores keys while typing in a field or while a dialog is open. Never a
  bare letter (macros bind them) and never Escape (the default panic key). Show the keys in
  the control's tooltip with `withKeys`.
- **Flex children holding user text** (macro names) need `min-w-0` plus `truncate`, or long
  names blow out the row.
- **Icons are lucide**, `size-4` in buttons. Tooltips use the ShadCN `Tooltip` with the
  provider's 200 ms delay.

## Testing

`cargo test` is the gate: 208 tests, no Windows APIs required for most of them. The UI has
`npm test` (98 Vitest tests: the pure helpers in `src/lib`, and components with their IPC
mocked, in jsdom) and `npm run e2e` (109 Playwright tests), all run locally before every release and by
CI on pull requests.

- Vitest is for logic that needs no app: summaries and estimates (`lib/steps.ts`, which
  mirrors `Step::duration_range` and has the same test), sorting, colors, undo history,
  shortcut matching, the import review. New pure helpers get a `*.test.ts` beside them.
- Components are tested with `src/test/render.tsx` (render, `settle`, `text`, `button`,
  `click`, `type`, `input`; no Testing Library) and `vi.mock("@/lib/ipc", ...)` standing in for the backend:
  the run pill against hand-fired run events, Pick's cancel-on-leave, the magnifier, hotkey
  recording, the import review, the storage notice. `src/test/setup.ts` cleans up and stubs
  what jsdom lacks (matchMedia, ResizeObserver).
- To shake out timing flakes before they reach CI: `npx playwright test --repeat-each=2
  --workers=5` (still headless).

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
- `e2e/` works like Kanbini's desktop-e2e: `_launch.ts` starts the **real app** per test with
  `POCHINI_E2E=1` and a throwaway `POCHINI_DATA_DIR` (seeded via `test.use({ seed })`), then
  attaches Playwright to WebView2 through a DevTools port. Test mode (`src-tauri/src/e2e.rs`,
  debug builds only, a release exe ignores it) uses `FakeInput`, installs no keyboard hook
  and no toggle hotkey, skips the single-instance check, and runs headless. Specs check
  persistence by reading the data folder's `macros.json`. Lessons learned:
  - Headless means **never shown** (`visible(false)`), as in Kanbini. An off-screen position
    is not enough: Windows put those windows on the main monitor. No window may appear while
    tests run; keep it that way.
  - Raw `page.mouse` moves do not scroll: `drag()` scrolls the source into view first, and
    grabs it a third of the way across (the star and buttons never start a drag).
  - dnd-kit swallows clicks for 50 ms after a drop; Radix leaves `pointer-events: none` on the
    body for a moment after a Select closes. The helpers wait for both.
  - Export / Import dialogs: test mode answers them with `POCHINI_E2E_DIALOG_FILE`; specs
    set it with `test.use({ seed: { dialog: "<file in the data folder>", files: {...} } })`.
  - Locate rows and steps by `data-macro-id` / `data-step-id`; a step header's accessible
    name contains its buttons' names, so use `exact: true` for "Move up" and friends (and
    for "Back", which "About Backup" also contains).
  - The launcher writes `settings.json` with `welcomed: true` so the first-run welcome stays
    out of the way; `test.use({ seed: { welcome: true } })` shows it.
  - Copy as text and Paste use `clipboard.txt` in the data folder in test mode, never the
    real clipboard.
  - A poll that reads a file the app is about to write must treat "not there yet" as a value
    (`.catch(() => null)`), not throw: `expect.poll` fails at once on an exception, which on a
    slow runner looked like a bug in the app.
  - Content under a switch opens with `Collapse` and is `inert` until it has; wait for it
    (no `[inert]` ancestor) before typing into it.
  - CI shows the windows (`POCHINI_E2E_HEADED=1` in `ci.yml`): on a runner, a hidden window's
    timers stopped mid-test. Tests that depend on animations set `emulateMedia` themselves,
    and check that an animation started rather than that one is still running.
  - Record steps reads its events from `record.json` in the data folder in test mode (no
    hooks there), and Pick makes the magnifier window (hidden) and picks wherever the fake
    mouse is, at once.
  - Test mode has no tray icon, never intercepts closing the window, keeps "start with
    Windows" in `autostart.txt` in the data folder (never the registry), and its fake screen
    has the color `[x, y, 0]` at (x, y), so a "wait for a color" test can name a color that
    is already there.
- Anything that needs a real desktop session belongs in `tools/m0-probe` or the
  `trace_macro` example, not in CI: a CI runner has no interactive session and `SendInput`
  in Session 0 is meaningless.

## Conventions

- **Never create a window in a synchronous command or event handler.** On Windows it
  deadlocks the main thread (Tauri's docs; the WebView2 issue), and then nothing answers:
  0.14.0's Pick did it with the magnifier window, and the pick never arrived, the tray menu
  went dead and the macro list stopped loading. Commands that build a window (or wait on a
  UAC prompt) are `async`. Test mode still creates the magnifier, hidden, so the e2e suite
  would hang on a regression.
- Rust: `thiserror` for error enums, string errors only at the command boundary. No
  `unwrap()` or `expect()` in `engine/` or `hotkey/`: a panic in the hook thread takes the
  hook down. The release profile unwinds (`panic = "unwind"`), so `Engine::run_at` can catch
  a panic in a step and still run the release pass; never switch it back to `abort`.
- All `unsafe` Win32 calls live in `input/`, `hotkey/` and the waitable timer in
  `engine/timer.rs`, each with a `// SAFETY:` comment. The rest of the codebase is safe Rust.
- `macros.json` is never written over when it could not be read: see "When macros.json
  cannot be read" in [docs/03-macro-format.md](docs/03-macro-format.md).
- The macro JSON schema is versioned. Removing or changing the meaning of a field means
  bumping `schema_version` and adding a migration in `storage.rs`; an additive field with a
  serde default does not. See [docs/03-macro-format.md](docs/03-macro-format.md).
- TypeScript types in `src/types.ts` mirror the Rust model by hand for now; keep them in step
  until `ts-rs` generation lands.
- Coordinates in the model are **virtual-desktop pixels**, signed (a left/above monitor gives
  negative values). Never store normalized 0..65535; that is a transport detail of `SendInput`.
