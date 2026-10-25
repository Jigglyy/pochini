# Changelog

All notable changes to Pochini. Versions follow [semantic versioning](https://semver.org/);
while the major version is 0, a minor bump may change behaviour or the macro file format.
Each version is built with `npm run release` into `release/Pochini-<version>.exe`.

## Unreleased

### Added

- **Record steps**: press it in the editor, then click, type and scroll in any app; your
  actions become steps, with the pauses between them as waits (up to 10 s each). Two quick
  clicks become a double click, a press here and release there a drag, Ctrl+C one key step.
  Stop with the button or the panic key; clicks on Pochini's own window are left out. Undo
  takes a recording back.
- **Pick by clicking**: Pick now waits for you to click the point (the click does not reach
  the app there; Esc cancels), with a magnifier beside the cursor showing the pixels, the
  coordinates and the color under it.
- **App window + offset**: a new target for clicks and moves, measured from the top-left of the
  App only app's window, so it keeps working when the window moves. Pick in the window sets it.
- **Dry run** in the editor: after the countdown, the mouse visits each click and move point in
  turn without clicking or typing.
- The step a run is on lights up in the editor, for any run of that macro.

### Changed

- The macros file is now version 3 (for the new target); older versions refuse it rather than
  misread it.
- The privacy notes (README, SECURITY.md, the welcome) say what record mode keeps: your
  actions, as steps, in memory, while the red banner shows.

## 0.13.0 - 2026-10-25

### Added

- **Tray icon.** Pochini keeps running in the tray with the window closed, so hotkeys keep
  working; the first time you close the window it asks whether to keep running or quit (change
  it in Settings > Window). The tray menu opens the window, turns macros on or off, stops a
  running macro, or quits.
- **Start with Windows**, off unless you turn it on in Settings > Window: Pochini starts in
  the tray when you sign in.
- **Wait for color**: a new step that waits until a point on screen turns a color (within a
  tolerance), then carries on. If it never does, the macro stops and says which color it saw,
  or carries on, as you choose. Read color takes the point's color as it is now.
- **Run history** in Settings: the last runs and how each ended.
- **Clear reasons when a run fails.** The run pill stays with what went wrong. When Windows
  blocks the input because the app in front runs as administrator (it would otherwise drop
  every click silently), the run stops, says so, and offers to restart Pochini as
  administrator. Settings > Window shows whether it runs as administrator.
- A run that finishes shows "Finished" for a moment.

### Changed

- The run pill follows the app's run events instead of asking every 200 ms.
- The macros file is now version 2 (for the new step). Older versions refuse it rather than
  lose macros that use it; 0.11.1 and later say so plainly.

## 0.12.0 - 2026-10-25

### Added

- **Undo and redo in the editor**: Ctrl+Z / Ctrl+Y, or the arrows beside the name. Typing into
  one field undoes in one go, and undoing back to what was saved shows "Saved" again. A deleted
  step leaves an Undo line.
- **Delete a macro without a dialog**: it goes at once, with Undo (or Ctrl+Z) to put it back
  where it was, exactly as it was.
- **Keyboard shortcuts** in the window: Ctrl+N new macro, Ctrl+F find, Ctrl+V paste, Ctrl+S
  save, Ctrl+Enter test, Delete or Ctrl+D on a focused step, Alt+Left back. Settings lists
  them all, and tooltips show them.
- **Find a macro**: a search box (by name, hotkey or app) once the list has five or more.
- **Copy as text** in a macro's menu puts it on the clipboard as one line, ready to paste into
  a chat. **Paste** (or Ctrl+V on the list) adds a copied macro, checked like an import.
- **Export all macros** to one file, in Settings > Backup; Import reads it back.
- **Hotkey clashes while recording**: the editor says when a hotkey is already used by another
  macro, the panic key or the on/off hotkey. While you record a key, hotkeys stand aside, so
  recording one that is already bound no longer fires it.
- **Stop after a while**: an optional time limit for a run, for macros that repeat until
  stopped.
- A first-run welcome with the four things worth knowing: real input, the panic key, what the
  keyboard hook does (nothing kept), and apps running as administrator.
- The run pill names the panic key.
- Pochini remembers its window's size, position and maximized state.
- Pick also records which monitor the point is on (for noticing a changed display layout
  later); typing a number instead forgets it.
- Settings > About lists the open source software inside Pochini and its licenses, and can open
  or copy the data folder.
- Pochini is now MIT licensed. Each release also comes with SHA256 checksums and the
  third-party license notices.

### Changed

- A dragged step or macro eases into your grip instead of snapping to the pointer, and its
  shadow travels with it as it drops.
- Small confirmations: the "Saved" check pops, a picked point's numbers flash, a clashing
  hotkey shakes.
- If a screen ever crashes, it says so and offers Try again, instead of leaving the window
  blank while hotkeys keep running.
- Each release exe checks itself (`--smoke`) before it is published.

## 0.11.1 - 2026-10-25

### Fixed

- **A macros file Pochini cannot read is never saved over.** A file that was valid but not
  readable by this version (a newer Pochini's, or a step type it does not know) used to start
  an empty list, and the next two saves replaced both the file and its backup with it. Now the
  file is copied aside untouched, the backup from before the last save loads if it can, and a
  banner says what happened. If nothing can be read, nothing is saved until you choose Start
  fresh. The banner can open the data folder.
- **Imported macros are checked before they run.** A shared macro can type and press
  shortcuts, so switching an imported macro on, or pressing Run, first lists every step in
  plain words, with the ones that type text or press Ctrl/Alt/Win shortcuts flagged. Imported
  rows say "Imported, check it before use" until then. Saving it from the editor counts too.
- **Exports leave out what is about you**: the window title an "App only" app was picked from,
  and the monitor each point was picked on.
- A macro holding a key (a shift-click) no longer stops your own hotkeys from matching while it
  holds it, so a toggle-mode macro's second press and queued presses work during those steps.
- A macro on the panic key, or on the on/off hotkey, never runs; the list now shows "Hotkey
  clash" for those too, and every clash says why when you point at it.
- "Until stopped" (and repeat-while-held) with no steps, or with only instant steps such as
  scrolls, no longer spins a CPU core; every pass takes at least a millisecond.
- Escape can be recorded: a Key step can press Esc, and the panic key can be set back to it.
  Cancel recording with the Cancel button.
- If a step ever crashes, the keys and buttons the macro held are still let go, instead of
  staying held down in Windows.
- The time estimate for a double click was short by one hold; a lone press or release no
  longer counts one. A horizontal scroll step reads "left" or "right", not "up" or "down".
- The favorites group headings are no longer in capitals.

### Security

- The window runs under a strict content security policy and may only listen for events, so
  script that was not shipped with the app cannot run, let alone move the mouse.
- An imported file is read with a hard 2 MB limit, whatever size it claims to be.

## 0.11.0 - 2026-10-21

### Added

- **Hold keys while clicking.** A click step's "While holding" row holds Ctrl, Alt, Shift, Win
  or any recorded key for that click (a shift-click, say). They go down once the cursor
  arrives and come up after the release, with the settle pause on both sides, so games that
  read input once per frame see them too.
- **Shuffle.** Turn Shuffle on for some steps (in the step, or from its right-click menu) and
  they run in a random order, a new one every pass, while the other steps keep their places.
  Marked steps show a shuffle icon on their header.

### Fixed

- Dragging a step or macro right as a screen appeared could drop it one place off, because
  the dragged copy was drawn one row low while the screen slid in.

## 0.10.2 - 2026-10-12

### Fixed

- Expanding a tall step near the bottom (a Click step) still left part of it off-screen. The
  screen now moves along with the step as it opens, frame by frame, until all of it shows.
  It also no longer misses when the PC is busy (with a game running, say). If you scroll
  yourself while it opens, it stops following.

## 0.10.1 - 2026-10-12

### Fixed

- **Things that open now stay in view.** Expanding a step near the bottom scrolls so the whole
  step shows, smoothly while it opens. The same goes for options that open under a switch, a
  step you just added, a step you move past the edge, and a macro duplicated or imported to
  the end of a long list. Export and import confirmations stay pinned at the top while you
  scroll.
- **Saving could, for an instant, leave no macros.json.** A crash or power cut at exactly that
  moment would have started Pochini with an empty library. Saving now replaces the file in one
  step, and if macros.json is ever missing, Pochini recovers your macros from macros.bak.

## 0.10.0 - 2026-10-12

### Added

- **Share macros.** Export a macro from its menu (or right-click) to a `.pochini.json` file,
  and bring macros in with the new Import button. Imported macros are new macros with their
  hotkey turned off, so a macro from someone else never fires until you have looked at it.
  A name that is already taken gets " (imported)".
- **Smooth animations, like Kanbini.** Steps open and close smoothly instead of jumping; so do
  options that appear under a switch. Steps and macros glide into place when you move, add,
  duplicate, delete, sort, star or import them. Screens fade in, the star pops, and the run
  pill eases in. Nothing waits for an animation, and it all turns off when Windows'
  "Animation effects" is off.

## 0.9.1 - 2026-10-09

### Fixed

- Queued runs drifted to a new spot after the second press. That happened with "Queued runs
  start from: Each press", which was the default: a press made while the macro runs catches
  the mouse where the macro left it, and "Move mouse back" then kept returning there. **The
  first press** is now the default, and turning Queue presses on selects it.

### Added

- While a macro has unsaved changes, the editor says that its hotkey still runs the saved
  version.

## 0.9.0 - 2026-10-08

### Added

- **Queued runs can start from the first press.** With Queue presses on, choose "Queued runs
  start from": Each press (as before) or The first press. A press made while the macro runs
  catches the mouse wherever the macro moved it, so a queued "Click where the mouse started"
  used to click the macro's own last spot; with The first press, every queued run starts where
  the first press was. A press after the queue has emptied starts fresh.

## 0.8.2 - 2026-10-08

### Fixed

- A colored macro whose hotkey is switched off showed only the colored left edge. It now gets
  the full colored outline and wash like any other colored macro.

## 0.8.1 - 2026-10-08

### Changed

- Colored steps and macros are outlined all the way round in their color, like colored lists
  and boards in Kanbini, not only on the left edge. A switched-off macro keeps just the
  colored edge.

## 0.8.0 - 2026-10-08

### Added

- **Color your macros.** Right-click a macro on the list (or use its menu > Color) and pick a
  color: the row gets a colored edge and a faint wash of it. The colors are the same as for
  steps, plus "No color". The color is saved with the macro and does not count as an edit.
- The right-click menu on a macro also has Edit, Add to favorites, Duplicate, Move up / down
  and Delete.

## 0.7.1 - 2026-10-07

### Changed

- The "?" next to a label is hover only: its explanation shows while the mouse is on it, and
  clicking it does nothing.

## 0.7.0 - 2026-10-07

### Changed

- **Shorter screens.** Long descriptions are gone from the editor and Settings. Each label has
  a small "?" instead: hover it to read the explanation, click it to keep it open (Escape or a
  click elsewhere closes it). What stays on screen is live information, like where an offset
  click lands or a duration's random range, and short warnings.
- **Faster releases.** GitHub builds a release in a few minutes instead of about 20: it now
  reuses its build cache between releases, skips a second compile for tests (they run on the
  PC before every release), and the app is optimized with thin LTO (the exe is 5.4 MB instead
  of 4.8 MB). Local release builds are faster too.
- TypeScript 7 (the new native compiler) and Vite 8.3. Tauri was already on the newest
  stable release, 2.12.

## 0.6.1 - 2026-10-07

### Changed

- A design pass over every screen:
  - The header, page titles, panels and rows now line up on one left edge, and pages no
    longer shift sideways when a scrollbar appears.
  - Sections are one panel of divided rows instead of boxes inside boxes, with form labels
    in one column.
  - Macro rows put the app, queue and hotkey-clash notes under the name, so hotkeys,
    switches and Run buttons line up as columns.
  - A step's move, duplicate and delete buttons appear on hover (right-click still has them).
  - Settings > Step colors is a compact two-column list with a color button per kind.
  - Text uses Windows 11's Segoe UI Variable; headings are no longer all caps; buttons,
    fields and menus in a row are the same height.

## 0.6.0 - 2026-10-07

### Added

- **Offset targets** for Click and Move steps. Next to "Fixed position" there is now
  **Mouse start + offset** (e.g. 20 px right of where you pressed the hotkey) and **Previous
  point + offset** (e.g. 20 px right of where the step before aimed), so a few steps can walk
  along a row. The editor shows where each step lands ("mouse start + (40, 0)"). Random
  jitter never adds up along a chain. With Repeat, a chain that starts with "previous point"
  keeps going on the next pass; one that starts from the mouse start begins again. Existing
  "Click at mouse" steps behave exactly as before.
- **End-to-end tests** (Playwright, like Kanbini's): each test starts the real app, headless
  and in a throwaway data folder, with a fake mouse and keyboard and no hotkey hook. Run them
  with `npm run e2e`.

## 0.5.0 - 2026-10-07

### Added

- **Color-coded steps**: every kind of step (Click, Click at mouse, Move, Key, Type text, Wait,
  Scroll) has its own color on its card and on the Add buttons.
- **Right-click a step** for a menu like Kanbini's: recolor that kind of step, reset it to the
  default, move, duplicate or delete.
- **Settings > Step colors** to set or reset every kind's color in one place.
- **GitHub Releases**: each version is built on GitHub and published as a release with
  `Pochini-<version>.exe` attached.

## 0.4.0 - 2026-10-07

### Added

- **Drag to reorder steps** in the editor: grab a step's header and drop it where it belongs.
  The arrow buttons and Alt+Up/Down still work.
- **Favorites**: star a macro from its row (or the row menu).
- **Sort** the macro list: Custom order, Favorites first, Name, Newest first, Recently edited.
  Your choice is remembered.
- **Drag to reorder macros** in Custom order, or inside the Favorites and Other macros groups
  in Favorites first. Both edit the same order, so arranging your favorites leaves the rest
  where they were. The row menu has Move up / Move down too.

## 0.3.0 - 2026-10-07

### Added

- **Move mouse back to where it started** (per macro): when the run ends, the cursor jumps back
  to where it was when you pressed the hotkey (or when the Run countdown ended). Happens once,
  after the last repeat; also when you end a run with its own hotkey (releasing a hold-to-repeat
  key, pressing a toggle again). Not after Panic or Stop, which leave the mouse alone.

### Changed

- The editor's Trigger section is split: **Trigger** (hotkey, mode, on/off, blocking, App only)
  and **When it runs** (repeat, Queue presses, Move mouse back).

## 0.2.1 - 2026-10-07

### Fixed

- The on/off hotkey (Ctrl+Shift+F12) could do nothing. It is now also registered with Windows,
  which delivers it whichever window has focus, even if the keyboard hook misses it. While
  Windows owns it, the keyboard hook leaves it alone, so one press cannot toggle twice.
- The keyboard hook is reinstalled every 30 seconds. Windows silently removes a hook it
  considers too slow (for example while the PC is under heavy load) and never says so; this
  brings it back, and keeps Pochini ahead of other programs' hooks that might swallow keys.
- Starting Pochini while it is already running now brings the open window to the front instead
  of starting a second copy, which made every hotkey fire twice.
- The release script no longer fails when the previous build is still running: it writes the
  new exe first and reports any old one it could not delete.

### Added

- Settings > **Hotkey check**: shows whether the keyboard hook is running, whether Windows
  accepted the on/off hotkey (and warns if another program already owns it), and a live list of
  what happened each time you pressed one of your hotkeys ("Ran Fill form", "Ignored: the mouse
  was not over notepad.exe", "No hotkey uses this combination"...). Only your own hotkeys
  are listed, never other typing.

### Changed

- Bigger icon: the artwork now fills the tile, so it reads at taskbar and title-bar sizes. The
  header logo is larger too.

## 0.2.0 - 2026-10-07

### Added

- **Queue presses** (per macro): pressing the hotkey while the macro is running queues another
  run instead of ignoring the press. Press Space five times and it runs five times, back to
  back, without interrupting the run in progress. Each queued run remembers where the mouse was
  at its own press. Up to 50 can wait; Panic stop, the master switch, and Stop all clear them.
- **App only** (per macro): pick an app from the ones currently open, and the hotkey only fires
  while the mouse is over that app's window. Anywhere else the key works normally and is never
  blocked. The same key can be bound to different macros for different apps.
- The run pill names the running macro for hotkey runs too, and shows how many are queued.

### Changed

- "Click where the mouse started" now uses the exact position at the moment of the key press
  (previously read a moment later, when the run started).

## 0.1.1 - 2026-10-07

### Added

- Pochini app icon: a pastel button being pressed by a cursor, on a navy tile in the style of
  Kanbini's mark. Used for the executable, the window, and the header. Regenerate every size
  from `assets/pochini-icon.svg` with `npm run icons`.

## 0.1.0 - 2026-10-07

First versioned build.

### Added

- Macros made of steps: click (fixed position, or **where the mouse is when the macro starts**),
  move, key press, type text, wait, scroll. Any duration or click position can be randomized.
- Global hotkeys per macro, with run once / repeat while held / press to start and stop.
- **On/off control**: a master switch in the header, a switch on each macro, and a global toggle
  hotkey (Ctrl+Shift+F12, changeable) that works from inside a fullscreen game.
- Run and Test start after a 3 second countdown, so you can switch to the target and place the
  mouse; a bottom pill shows the countdown and a Stop button.
- Panic key (Esc) stops a running macro or countdown at once.
- Settings screen: toggle hotkey, panic key, light / dark / system theme, version and data folder.
- Kanbini-style interface built on ShadCN and Tailwind.

### Fixed

- Clicks registered as a held button in games: the cursor now settles on the target before the
  press and after the release (default 50 to 75 ms, adjustable per click).
- The panic key, releasing a "repeat while held" key, and the second press of a toggle-mode
  hotkey now stop a running macro immediately instead of waiting for it to finish.
- A modifier key released inside an admin window no longer leaves every Ctrl/Alt/Shift hotkey
  dead until restart.
- Releasing a modifier before the main key no longer jams that hotkey.

### Changed

- Renamed from the working title "coordsclickermacro" to Pochini. Existing macros and settings
  are copied to the new data folder on first start.
