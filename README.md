# Pochini

A Windows app for building and running click macros driven by screen coordinates. The name
comes from *pochi* (ぽち), the Japanese sound of pressing a button.

Make a macro - click at (1920, 540), wait 500 ms give or take 200, press Shift+A, click
somewhere else - give it a name, bind it to a key, and press that key to run it against
whatever is on screen. Because input is synthesized at the OS level, macros work against any
application: native apps, browsers, Electron apps, emulators.

- Bind each macro to a hotkey; a master switch, and a global toggle hotkey (default
  Ctrl+Shift+F12), turn every hotkey on or off, and each macro has its own switch too.
- Click a fixed position, or **click wherever the mouse is** when you press the hotkey.
- Randomize any wait or click position; a panic key (Esc) stops a running macro at once.

## Running it

```powershell
npm install
npm run tauri dev
```

Needs Node, the Rust toolchain (rustup) and the Visual Studio C++ build tools. Design notes
start at [docs/](docs/); working rules for contributors (human or AI) are in
[CLAUDE.md](CLAUDE.md).

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

Tauri v2 · Rust (`windows` crate for Win32) · React + TypeScript · Tailwind v4 + ShadCN/UI.

## A note on antivirus

This app installs a global keyboard hook (`WH_KEYBOARD_LL`) so it can notice your hotkey no
matter which window has focus. That is the same mechanism a keylogger uses, so SmartScreen and
some antivirus products will flag it. The hook compares each key against your configured
bindings and discards it - no keystroke content is stored, logged, or transmitted, and the
source is here to check.

## Scope

This is an automation tool built on documented Windows APIs. It makes no attempt to disguise
that its input is synthetic, and it will not gain anti-cheat evasion, an input driver, or
flag laundering. Applications that reject synthetic input are unsupported.
