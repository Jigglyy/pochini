# Open questions

Decisions the design rests on. Each lists the assumption in force, so work can proceed;
confirm or overturn them and update the relevant doc.

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

The original description was entirely about hand-building ("you can input it manually"), so this
matches. But recording is usually the feature that makes this category of app pleasant, and
building it later means the mouse hook arrives later too. Worth confirming it is not v1.

## 7. Name

**Decided (2026-10-07): Pochini.** *Pochi* (ぽち) is the Japanese sound of pressing a button;
"-ini" echoes [Kanbini](https://github.com/Jigglyy/kanbini), a sibling project. The app, executable, window title, `%APPDATA%` folder
(`com.pochini.app`) and GitHub repo (`Jigglyy/pochini`) use it; the local project folder keeps
the working title `coordsclickermacro`.

## 8. Toggle hotkey default

**Decided (2026-10-07): keep Ctrl+Shift+F12.** It was chosen as unlikely to collide with a game
binding. Screenshot tools often own the bare F12 to F14 keys, which Ctrl+Shift+F12 does not
trigger. It can be rebound in Settings.

## 9. Toggle hotkey ignored (resolved in 0.2.1)

**Resolved.** A real Ctrl+Shift+F12 was reported doing nothing; after 0.2.1 it works. In
the built exe Windows accepted the combo, so no other program owned it, which points at the
low-level hook having missed the key (Windows removes a slow hook silently and permanently, and
other programs' hooks run before older ones). 0.2.1 registers the toggle with `RegisterHotKey`,
reinstalls the hook every 30 s, and adds Settings > Hotkey check. Which of the first two fixed
it is unknown; both stay.
