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

**Assumed:** the second trigger is ignored, and the running macro is left alone.

Alternatives: queue it, or cancel the running macro and start the new one. Ignoring is the
safest default and the easiest to reason about, but "press the key again to restart" is a
common expectation. A per-macro setting is possible but adds a knob.

Related: should two *different* macros be allowed to run simultaneously? Assumed **no** -
interleaved cursor movement from two macros produces nonsense.

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

## 8. Toggle hotkey default vs the user's screenshot tool keys

**Assumed:** Ctrl+Shift+F12, chosen as unlikely to collide with a game binding.

On the dev machine F12, F13 and F14 are screenshot tool hotkeys. Ctrl+Shift+F12 is a different combo,
so it should not trigger screenshot tool unless screenshot tool also binds that exact combination, but a key
outside F12 to F14 would remove the question entirely. The user can rebind it in Settings; the
open question is whether the shipped default should move.

## 9. Toggle hotkey sometimes ignored while this app has focus (unresolved)

**Observed, cause unknown.** With another window focused (Discord, a game) the toggle hotkey
worked every time it was tried, and the trace showed hook, logic and worker all firing. With
this app's own window focused, three experiments gave mixed results: twice the hook logged no
event at all, not even the Ctrl press (once after bringing the window forward with
`AttachThreadInput`, once after an ordinary click on it), and once it did see an injected F12. That last result
rules out "the hook is blind whenever our window has focus" as a simple explanation.

Ruled out so far: tao/wry installing a competing `WH_KEYBOARD_LL` hook (they do not), and
stale modifier tracking (fixed separately; see CLAUDE.md rule 5).

Practical impact is small, since with the app focused the on-screen switch is right there,
but it should be understood before shipping. Next step: repeat the experiment many times with
keys that have no global binding (never F12 to F14), while nobody is typing, logging only
bound-key outcomes (never key content; CLAUDE.md rule 11), to find what separates the runs
that fail from the one that worked.
