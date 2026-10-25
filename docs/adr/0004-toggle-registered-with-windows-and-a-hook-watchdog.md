# 4. The on/off toggle is registered with Windows, and the hook is reinstalled

- **Status:** accepted
- **Date:** 2026-10-07

## Context

A real Ctrl+Shift+F12 toggle once did nothing (docs/06-open-questions.md #9). Windows removes
a low-level hook that is slow to answer, silently and for good, and other programs' hooks run
before older ones and can swallow keys. A hotkey that quietly stops working is the worst
failure this app has.

## Decision

Two safety nets, both on the hook thread (`hotkey/hook.rs`):

- The toggle is also registered with `RegisterHotKey`. Windows then delivers it as WM_HOTKEY
  whatever has focus, even if the hook missed it. While that registration holds, the hook
  leaves the toggle to it, so one press cannot flip the switch twice. While a key is being
  recorded in Pochini's window, the registration is dropped so the combo can be recorded.
- A 30 s thread timer reinstalls the hook, new before old, which revives it if Windows
  removed it and keeps it ahead of hooks installed later.

Settings > Hotkey check shows the hook's state and what happened to the last presses of the
user's own hotkeys (never other keys).

## Consequences

- Which net fixed the original report is unknown; both stay.
- Macro hotkeys still rely on the hook alone: `RegisterHotKey` always consumes its key, which
  would break binding a plain key such as Space (ADR 2).
