# 2. Tauri v2 with a Rust core

- **Status:** accepted
- **Date:** 2026-09-17

## Context

The app needs three things that pull in different directions:

1. **Precise, low-level Win32 access** — `SendInput` with exact flags, `WH_KEYBOARD_LL` on a
   dedicated thread with a callback that returns in microseconds, high-resolution waitable
   timers, per-monitor DPI awareness set before any window exists.
2. **A comfortable list/form UI** — a macro list and a drag-reorderable step editor. This is
   ordinary CRUD UI work, and web tech is simply the fastest way to build it well.
3. **A small, self-contained binary** users will trust. An app that installs a global keyboard
   hook already looks like a keylogger to antivirus; a 150 MB bundle does not help.

## Decision

**Tauri v2.** Rust backend, WebView2 frontend rendering React + TypeScript.

The Win32 layer uses the `windows` crate (windows-rs) directly rather than a
cross-platform abstraction, because the flags this app needs — `MOUSEEVENTF_VIRTUALDESK`,
`KEYEVENTF_SCANCODE` plus per-key `KEYEVENTF_EXTENDEDKEY`, `dwExtraInfo` stamping, per-binding
hook pass-through — are precisely the details such abstractions hide.

Tauri's `global-shortcut` plugin is **not** used: it is built on `RegisterHotKey` semantics
and unconditionally consumes the bound key, which breaks the central use case of binding a
plain key like Space. The hook thread is written directly.

## Alternatives considered

**Electron + `uiohook-napi` / `nut.js`.** The obvious choice for UI, and the ecosystem is
mature. Rejected on two grounds: bundle size (~150 MB, versus ~10 MB for Tauri) for an app
users already have reason to be suspicious of, and the fact that the time-critical hook
callback would sit behind an N-API boundary into a JS event loop. A GC pause in a callback
that must return within 300 ms is a system-wide input stall. The old `iohook` is
unmaintained, which is a warning about how much of this ecosystem is drive-by work.

**C# / WPF or WinUI 3.** Genuinely strong: P/Invoke to `SendInput` and `SetWindowsHookEx` is
well-trodden, the tooling is excellent on Windows, and there is more reference material for
exactly this app than for any other stack. Rejected mainly on the hook callback again — a
managed callback can be interrupted by GC, and keeping the delegate alive and pinned is a
classic source of "the hook randomly stops working" bugs. Rust's deterministic memory
behaviour removes a whole class of failure from the one place it hurts most. Closer call than
the others; if the team were C#-shaped rather than Rust-shaped, this would be defensible.

**Python + PySide/Tkinter with `pynput` / `pyautogui`.** Fastest to a prototype, worst to
ship. `pyautogui` does not handle the virtual-desktop and DPI cases correctly out of the box,
timing is at the mercy of the interpreter, and packaging produces a large PyInstaller bundle
that antivirus flags even harder than a signed native binary.

**AutoHotkey v2.** Already solves this problem and solves it well — if the user were happy
writing scripts. The entire premise here is a GUI for people who do not want to write AHK, so
building on it would mean generating and shepherding scripts through a separate process,
inheriting its distribution and antivirus profile without inheriting a UI toolkit. Worth
knowing as prior art for behaviour details; not worth building on.

## Consequences

- Two languages and an IPC boundary. Mitigated by generating TypeScript types from the Rust
  model with `ts-rs`, so the two cannot drift.
- Windows-only in practice. The `InputBackend` trait leaves the door open, but no macOS or
  Linux implementation is planned, and macOS in particular would need an entirely different
  permissions story (Accessibility + Input Monitoring grants).
- Rust's Win32 work is more verbose than C#'s, and every `unsafe` block needs a `// SAFETY:`
  comment. Confined to `input/` and `hotkey/`.
- WebView2 is a runtime dependency. It ships with Windows 11, which is the target, so this is
  a non-issue here; the installer should still handle the evergreen bootstrapper.
- Not using Tauri's global-shortcut plugin means owning hook lifecycle, install/uninstall, and
  the crash-safety of a system-wide hook. That is deliberate — it is the core of the product.
