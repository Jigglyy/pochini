# coordsclickermacro

A Windows app for building and running click macros driven by screen coordinates.

Make a macro — click at (1920, 540), wait 500 ms give or take 200, press Shift+A, click
somewhere else — give it a name, bind it to a key, and press that key to run it against
whatever is on screen. Because input is synthesized at the OS level, macros work against any
application: native apps, browsers, Electron apps, emulators.

> **Status: pre-implementation.** Only the design docs exist. Start at [docs/](docs/).

## Docs

| | |
|---|---|
| [Overview](docs/00-overview.md) | What this is and what it deliberately isn't |
| [Architecture](docs/01-architecture.md) | Thread model, modules, testing strategy |
| [Windows input research](docs/02-windows-input-research.md) | The Win32 details that make or break it |
| [Macro format](docs/03-macro-format.md) | On-disk JSON schema |
| [UI spec](docs/04-ui-spec.md) | Screens and interactions |
| [Roadmap](docs/05-roadmap.md) | Build order |
| [Open questions](docs/06-open-questions.md) | Decisions still to confirm |
| [ADRs](docs/adr/) | Why the stack is what it is |

## Stack

Tauri v2 · Rust (`windows` crate for Win32) · React + TypeScript.

## A note on antivirus

This app installs a global keyboard hook (`WH_KEYBOARD_LL`) so it can notice your hotkey no
matter which window has focus. That is the same mechanism a keylogger uses, so SmartScreen and
some antivirus products will flag it. The hook compares each key against your configured
bindings and discards it — no keystroke content is stored, logged, or transmitted, and the
source is here to check.

## Scope

This is an automation tool built on documented Windows APIs. It makes no attempt to disguise
that its input is synthetic, and it will not gain anti-cheat evasion, an input driver, or
flag laundering. Applications that reject synthetic input are unsupported.
