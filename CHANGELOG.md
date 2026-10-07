# Changelog

All notable changes to Pochini. Versions follow [semantic versioning](https://semver.org/);
while the major version is 0, a minor bump may change behaviour or the macro file format.
Each version is built with `npm run release` into `release/Pochini-<version>.exe`.

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
