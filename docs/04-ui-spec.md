# UI spec

Three screens behind one header. The look follows the user's Kanbini app: neutral oklch
greys, an indigo primary, ShadCN components. Every screen sits in one 896 px column that the
header shares, sections are a sentence-case heading over one panel of hairline-divided rows,
and the type is Windows 11's Segoe UI Variable. Labels stay short; each explanation is behind a
"?" after its label (hover to read; clicking does nothing). Conventions for building more of it are in
[CLAUDE.md](../CLAUDE.md#ui-conventions).

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
Your macros                          Sort [Custom order  v]   [+ New macro]

| :: * Demo                              Space   [o==]  [> Run]  [...] |
|      3 steps, 480 ms to 705 ms   [] Only in game.exe   Queues ...  |

Panic stop [Esc] stops a running macro at once.
```

- When the master switch is off, a muted banner says hotkeys are ignored and how to turn
  them back on (switch or toggle hotkey).
- The line under the name says what the macro is: step count and duration, "Only in
  <app>" for App only, "Queues presses", and a warning "Hotkey clash". The right side is
  fixed columns (hotkey, switch, Run, menu) so they line up down the list.
- **Favorites**: a star before the name (shown on hover until set, then always, filled). Also
  in the row menu.
- **Sort** (shown with two or more macros, remembered in localStorage): Custom order,
  Favorites first, Name (A to Z), Newest first, Recently edited.
  - **Custom order**: drag a row to reorder. Drag works like Kanbini's cards: the whole row is
    the handle, a press becomes a drag after 6 px, a lifted copy follows the pointer. The star,
    switch, Run and menu never start a drag. The menu also has Move up / Move down.
  - **Favorites first**: a Favorites group above an "Other macros" group, each in custom
    order. Dragging works inside a group, never across (starring moves a macro between
    groups). Both drag views edit the same stored order.
  - Name and date sorts are automatic, so rows cannot be dragged there.
- Each row: grip (drag views) and star in a fixed-width lead, name and its facts line, the
  hotkey as keycaps (or "No hotkey"), the macro's **own switch**
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
  |   Target   [Fixed position | Mouse start + offset | Previous..]  |
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
  the move / duplicate / delete buttons show on hover or keyboard focus (right-click has them
  too); reorder by dragging its header (grip icon; 6 px before a drag starts, so clicks still
  expand), by the arrows, or Alt+Up/Down; duplicate, delete, expand. The open body (inputs)
  never starts a drag. Reordering marks the macro unsaved, like any other edit.
  - **Color coding**: each kind of step (Click, Click at mouse, Move, Key, Type text, Wait,
    Scroll) has a color: a 3 px left edge on the card and a tinted icon chip. The Add buttons
    show the same colors. Defaults: blue, purple, teal, orange, amber, green, pink.
  - **Right-click a step header** (Kanbini's card menu): "Color for every <kind> step" with the
    14 Kanbini accents plus "No color", "Reset to <default>" when changed, then Move up / Move
    down / Duplicate / Delete. The color applies to that kind everywhere, not one step.
  - A newly added step opens expanded.
  - Click / Move: **Target** switch: Fixed position / Mouse start + offset / Previous point +
    offset.
    - Fixed shows X/Y inputs, **Pick** (3 second countdown, then reads the real cursor
      position, works over fullscreen apps) and **Show me** (moves the cursor to the point).
    - The two offset targets show **Offset** X/Y (px, right and down positive) and a "Lands
      at" readout for the first pass, following the chain: "mouse start + (40, -5)", or
      screen coordinates when the chain starts at a fixed step. A "previous point" step with
      nothing before it says it counts from where the mouse started.
    - Summaries read "Click 20 px right of where the mouse started", "Click 20 px right and
      5 px up from the previous point".
    - Then Jitter (px), Travel (ms).
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
- **Step colors**: every step kind with its chip and a color button (swatch + name) in two
  columns; the button opens the palette and "Reset to <default>". "Reset all" in the section
  header. Stored renderer-only in localStorage
  `pochini.settings` (`stepColors`, only the kinds that differ from the default).

## Run pill

A floating pill at the bottom centre whenever something is running or counting down:

- "Starting in 3: switch to your target and place the mouse" with **Cancel** during the
  countdown. The countdown runs in the backend, so it keeps time while the window is hidden.
- "Running <name>" with **Stop** while running, for hotkey runs too. When presses are queued
  it shows "· N queued" and the button becomes **Stop all** (it also clears the queue).

The user must always be able to tell that something is driving their mouse, and stop it.

## Not built yet

Tray icon (closing the window currently quits the app and its hotkeys), the hook-armed F2 coordinate capture with a magnifier, first-run notice
about the keyboard hook, import/export of a single macro.
