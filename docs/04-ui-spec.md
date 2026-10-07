# UI spec

Three screens behind one header. The look follows the user's Kanbini app: neutral oklch
greys, an indigo primary, ShadCN components, small uppercase section headings over bordered
panels. Conventions for building more of it are in [CLAUDE.md](../CLAUDE.md#ui-conventions).

---

## Header (every screen)

```
[icon] Pochini  |  < Macros / Demo        ( * Macros on  [==o] )  [gear]
```

- App mark and name on the left. Off the home screen, a divider, a back link and a
  breadcrumb ("Macros / <macro name>", or "Settings").
- **Master switch**, right side: a pill with a status dot, "Macros on" / "Macros off", and a
  switch. Off means every hotkey is ignored; the toggle hotkey and the panic key still work.
  Its tooltip names the toggle hotkey. It follows changes made by the toggle hotkey while the
  window is in the background (the backend emits `settings-changed`).
- **Gear** opens Settings; Back returns to wherever you came from.
- Leaving the editor with unsaved changes asks "Discard unsaved changes?" first.

## Screen 1: Macros (home)

```
Your macros                                                    [+ New macro]

| Demo                                   Space   [o==]  [> Run]  [...] |
| 3 steps · 480 ms to 705 ms                                                |

Panic stop [Esc] stops a running macro at once.
```

- When the master switch is off, a muted banner says hotkeys are ignored and how to turn
  them back on (switch or toggle hotkey).
- Rows show an app badge for App only macros and a "Queue" badge when queueing is on.
- Each row: name and a summary line (step count, estimated duration), a "Hotkey clash" badge
  if another macro uses the same combo, the hotkey as keycaps, the macro's **own switch**
  (hotkey on/off for just this macro; dims the row when off), **Run**, and a menu (Edit,
  Duplicate, Delete).
- **Run** starts after a 3 second countdown, so you can switch to the target and place the
  mouse. See "Run pill" below.
- Delete confirms in an in-app dialog (no `window.confirm`).
- Empty state: a dashed panel with "Create your first macro".

## Screen 2: Editor

```
[ Demo                                        ]  [> Test]  [Save]

TRIGGER
  Hotkey   [Space] [Change] [x Clear]
  Mode     [Run once per press        v]
  Repeat   [Once v]
  | Hotkey on                                                   [o==] |
  | Block the key from other apps                               [==o] |

STEPS                                              Takes 480 ms to 705 ms
  | 1 [icon] Click at (1623, 592) ±3px           ^ v [copy] [bin]  > |
  | 4 [icon] Click where the mouse started       ^ v [copy] [bin]  v |
  |   Target   [Fixed position | Where the mouse is at activation]  |
  |   Jitter / Travel / Button / Hold / Settle ...                   |
  [+ Click] [+ Click at mouse] [+ Move] [+ Key] [+ Type text] [+ Wait] [+ Scroll]
```

- **Name** is a large inline input. **Test** runs the current, unsaved steps after the same
  3 second countdown. **Save** (or Ctrl+S) is enabled only when there are changes.
- **Trigger** section:
  - Hotkey: press Record, then the key combo. Escape cancels rather than binding Escape.
  - Mode: run once per press / repeat while held / press to start, press again to stop.
  - "Hotkey on" mirrors the row switch on the home screen.
  - **App only**: when on, a picker lists apps that have a window open (executable and window
    title, with Refresh); the hotkey then only fires while the mouse is over that app. A saved
    app that is not running stays selectable, marked "not running".
  - "Block the key from other apps" is off by default. Turning it on for a bare key you type
    all the time (Space, letters, digits, Enter...) shows an amber warning.
- **When it runs** section:
  - Repeat: once / a set number of times / until stopped.
  - **Queue presses**: presses while this macro runs are queued instead of ignored. Disabled
    (with a note) unless the mode is "Run once per press".
  - **Move mouse back to where it started**: after the run, the cursor returns to the press
    point. Not after Panic or Stop.
- **Steps**: each step is a card with a number, a type icon and a plain-English summary;
  reorder (arrows or Alt+Up/Down), duplicate, delete, expand. A newly added step opens
  expanded.
  - Click / Move: **Target** switch (fixed position, or where the mouse was at activation).
    Fixed shows X/Y inputs, **Pick** (3 second countdown, then reads the real cursor
    position, works over fullscreen apps) and **Show me** (moves the cursor to the point).
    Then Jitter (px), Travel (ms).
  - Click also has Button, Action (click / double / press and hold / release), Hold, and
    **Settle** (pause before the press and after the release; raise it if clicks get
    dropped).
  - Key: record the key, action, modifier switches, Hold.
  - Type text: the text and a per-character delay (Unicode; games usually ignore it).
  - Wait: a duration.
  - Every duration is a number plus a "Random extra" switch that reveals the maximum added,
    with the resulting range spelled out underneath.
- The Steps heading shows the estimated run time (and "N times" for a counted repeat).

## Screen 3: Settings

- **Hotkeys**: "Macros on/off" (the toggle hotkey; record, change or clear) and "Panic stop"
  (single key). Changes apply immediately; there is no Save button.
- **Appearance**: System / Light / Dark as bordered radio cards.

## Run pill

A floating pill at the bottom centre whenever something is running or counting down:

- "Starting in 3: switch to your target and place the mouse" with **Cancel** during the
  countdown. The countdown runs in the backend, so it keeps time while the window is hidden.
- "Running <name>" with **Stop** while running, for hotkey runs too. When presses are queued
  it shows "· N queued" and the button becomes **Stop all** (it also clears the queue).

The user must always be able to tell that something is driving their mouse, and stop it.

## Not built yet

Tray icon (closing the window currently quits the app and its hotkeys), drag-to-reorder for
macros and steps, the hook-armed F2 coordinate capture with a magnifier, first-run notice
about the keyboard hook, import/export of a single macro.
