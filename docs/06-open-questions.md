# Open questions

Decisions the docs currently make on the user's behalf. Each lists the assumption in force, so
work can proceed; confirm or overturn them and update the relevant doc.

## 1. What are the real targets?

**Assumed:** ordinary desktop and browser applications - no kernel-level anti-cheat games.

This is the one that can invalidate the architecture. If the intended target is a game running
EAC/BattlEye/Vanguard, `SendInput` is likely to be blocked or flagged and no amount of work in
this repo fixes that (see
[02-windows-input-research.md §5](02-windows-input-research.md#5-what-this-project-will-not-do)).
Worth answering before M0.

"Should work in any app, not just desktop" was read as *any application on the machine,
including browsers and web apps* - which OS-level injection gives for free. If it instead
meant driving a remote or mobile device, that is a different architecture entirely.

## 2. Concurrency: what happens when a hotkey fires while a macro is running?

**Decided (2026-10-07):** one macro runs at a time. A press that arrives while something is
running is ignored, unless that macro has **Queue presses** on, in which case it waits in a
FIFO queue (cap 50) and runs right after. Panic stop and the master switch clear the queue.
Two macros never run simultaneously: interleaved cursor movement produces nonsense.

## 3. Panic key default

**Assumed:** `Esc`, pass-through (never swallowed).

`Esc` is the instinctive "stop" key, but it is also pressed constantly during normal use, so a
macro would abort whenever the user happens to hit it. The alternative is something like
`Ctrl+Shift+Esc`-adjacent or `Pause/Break`, which is safer but not instinctive in a panic.
A reasonable compromise: `Esc` aborts, and that is *desirable* - an accidental abort is
cheap, a runaway macro is not.

## 4. Auto-start with Windows

**Assumed:** offered in settings, off by default.

An app with a global keyboard hook that launches itself at boot is exactly the profile
antivirus heuristics dislike, so it should be a deliberate user choice.

## 5. Elevation

**Assumed:** never elevate automatically; detect UIPI failure and offer a relaunch.

Confirm whether any intended target runs as administrator. If the common case is an elevated
target, the UX should surface elevation earlier rather than as an error recovery path.

## 6. Recording vs hand-building

**Assumed:** v1 is hand-built step lists only; recording is M4+.

The user's description was entirely about hand-building ("you can input it manually"), so this
matches. But recording is usually the feature that makes this category of app pleasant, and
building it later means the mouse hook arrives later too. Worth confirming it is not v1.

## 7. Name

**Decided (2026-10-07): Pochini.** *Pochi* (ぽち) is the Japanese sound of pressing a button;
"-ini" echoes the user's Kanbini. The app, executable, window title, `%APPDATA%` folder
(`com.pochini.app`) and GitHub repo (`Jigglyy/pochini`) use it; the local project folder keeps
the working title `coordsclickermacro`.

## 8. Toggle hotkey default

**Decided (2026-10-07): keep Ctrl+Shift+F12.** It was chosen as unlikely to collide with a game
binding. The user's screenshot tool owns the bare F12 to F14 keys, which Ctrl+Shift+F12 does not
trigger; the user preferred to keep the default. It can be rebound in Settings.

## 9. Toggle hotkey ignored (mitigated in 0.2.1, root cause unconfirmed)

**History.** In injected-key tests the toggle worked every time with another window focused.
With Pochini focused, results were mixed: twice the hook logged nothing at all (not even the
Ctrl press), once it did see an injected F12. The user then reported that a real Ctrl+Shift+F12
"doesn't do anything".

**Candidate causes**, none confirmed:

- Windows silently and permanently removed the hook after one slow callback (it does this
  without notice; heavy CPU load during release builds is a plausible trigger).
- Another program's low-level hook, installed after ours, swallowed the key first. Hooks run
  newest first.
- The app was not running (closing the window quits it; there is no tray icon yet).
- Physical keyboard specifics (an Fn layer on F12).

**Mitigations in 0.2.1:** the toggle is also registered with `RegisterHotKey`, so Windows
delivers it regardless of focus or hook state; the hook is reinstalled every 30 s (revives a
removed hook and keeps ours first in the chain); and Settings > Hotkey check shows hook
health, whether Windows accepted the combo, and what each press of a bound key did.

**Next step:** ask the user to press Ctrl+Shift+F12 with Settings > Hotkey check open, and read
what it reports.
