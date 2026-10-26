# Overview

## The product in one paragraph

A Windows app that lets you record a sequence of screen actions - click here, wait a moment,
press a key, click there - save it under a name, bind it to a hotkey, and replay it against
any application on your screen by pressing that hotkey.

## Why coordinates

Deliberately dumb and universal. UI-automation approaches (UIA, Accessibility APIs, DOM
selectors) are more robust but only work on applications that cooperate. Screen coordinates
plus OS-level input synthesis work everywhere the cursor can go: native Win32, WinUI,
Electron, browsers, Java apps, emulators, remote desktop sessions, fullscreen games.

The cost is fragility: coordinates break when a window moves, a resolution changes, or DPI
scaling changes. The design mitigates this rather than solving it - see
[03-macro-format.md](03-macro-format.md) on anchoring and [05-roadmap.md](05-roadmap.md) on
window-relative coordinates.

## The user's mental model

1. **Main screen** - a list of macros, each with a name and its bound hotkey. Buttons: New, Edit,
   Delete, Duplicate. A master enable/disable toggle.
2. **Editor** - name field, hotkey binding field, and an ordered list of steps you can add,
   reorder, and delete.
3. **Steps** - the vocabulary:
   - Click at (X, Y) - left/right/middle, single/double, or down / up separately
   - Move to (X, Y)
   - Scroll
   - Key press - down, up, or a full press, with modifiers
   - Type text
   - Wait - a base duration in ms, with an optional **randomness** checkbox and a jitter amount
4. **Run** - press the bound hotkey anywhere; the macro executes. Press the panic key to abort.

Randomness is a first-class idea, not an afterthought: it applies to wait durations and
optionally to click coordinates, because perfectly identical timing is both unnatural and
unreliable against animated UIs.

## Glossary

| Term | Meaning |
|---|---|
| **Macro** | A named, ordered list of steps plus a trigger |
| **Step** | One unit of work: a click, a key event, a wait |
| **Trigger** | The hotkey and its mode (fire once / repeat while held / toggle on-off) |
| **Binding** | A trigger registered with the hook thread and mapped to a macro id |
| **Virtual desktop** | The bounding rectangle of all monitors combined; the coordinate space we store |
| **Panic stop** | A reserved global key that aborts any running macro immediately |
| **Injected input** | Synthetic input produced by `SendInput`, flagged as such by the OS |

## Non-goals

- Cross-platform. Windows-first; the input layer is abstracted behind a trait so macOS/Linux
  *could* follow, but nothing is built for them.
- Image recognition / OCR driven automation. Possibly later as a step type; not v1.
- Cloud sync, accounts, telemetry. Macros are local JSON files the user owns.
