# Changelog

All notable changes to Pochini. Versions follow [semantic versioning](https://semver.org/);
while the major version is 0, a minor bump may change behaviour or the macro file format.
Each version is built with `npm run release` into `release/Pochini-<version>.exe`.

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
  what happened each time you pressed one of your hotkeys ("Ran Demo", "Ignored: the mouse
  was not over game.exe", "No hotkey uses this combination"...). Only your own hotkeys
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
