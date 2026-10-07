# Macro format

On-disk schema for `macros.json`. Rust types in `src-tauri/src/model/` are the source of
truth; TypeScript types are generated from them with `ts-rs`.

## Top level

```jsonc
{
  "schema_version": 1,
  "macros": [ /* Macro */ ]
}
```

`schema_version` is bumped whenever a field is removed or its meaning changes. Adding an
optional field with a serde default does not require a bump. Every bump needs a migration
function in `storage/migrations.rs` and a round-trip test with a real file from the previous
version.

## Macro

```jsonc
{
  "id": "01J9X...",              // ULID, stable, never reused
  "name": "Harvest loop",
  "enabled": true,
  "favorite": false,             // starred on the macro list; sorting only
  "trigger": { /* Trigger */ },
  "repeat": { "kind": "once" },  // or {"kind":"count","n":10} | {"kind":"forever"}
  "queue": false,                // true: presses while running are queued, not ignored
  "return_to_start": false,      // true: move the cursor back to where the run started
  "steps": [ /* Step */ ],
  "guard": null,                 // optional Guard, see below
  "created_at": "2026-09-17T12:00:00Z",
  "updated_at": "2026-09-17T12:00:00Z"
}
```

The order of `macros` in the file is the user's **custom order** (what dragging on the macro
list edits). Sorting by name or date is a view in the UI and never rewrites the file.
`reorder_macros` takes the new order of all macros, or of one group of them (the favorites, or
the rest): the listed macros swap among the places they already hold and every other macro
keeps its place, so reordering favorites never shuffles the others (`MacroFile::reorder`).
Starring a macro does not change `updated_at`.

`repeat` wraps the whole step list. `{"kind":"forever"}` is only reachable via the panic stop
or a `Toggle` trigger, and the UI must say so at the point of choice.

## Trigger

```jsonc
{
  "key": { "vk": 32, "scancode": 57, "extended": false, "label": "Space" },
  "modifiers": ["ctrl"],         // any of ctrl | alt | shift | win; [] means bare key
  "mode": "once",                // once | hold_repeat | toggle
  "swallow": false               // true = the target app never sees the key
}
```

`swallow` defaults to **false**. Binding Space with `swallow: true` means Space stops working
everywhere else while the app runs; the editor warns when a bare, unmodified, commonly typed
key is bound with swallow on.

Both `vk` and `scancode` are stored. `scancode` is what gets injected and matched (layout
independent); `vk` and `label` exist so the UI can show something readable.

## Step

A tagged union on `"type"`. Every step carries an `"id"` (ULID) so the UI can key list rows
and reorder without re-rendering the world.

### `click`

```jsonc
{
  "id": "…", "type": "click",
  "x": 1920, "y": 540,           // virtual-desktop pixels; may be negative
  "button": "left",              // left | right | middle | x1 | x2
  "action": "click",             // click | double | down | up
  "anchor": "fixed",             // fixed | activation | previous (see below)
  "dx": 0, "dy": 0,              // offset for activation / previous; right and down are positive
  "coord_jitter_px": 0,          // radius of a uniform disc around (x,y)
  "hold_ms": { "base": 25, "jitter": 15 },   // gap between down and up
  "settle_ms": { "base": 50, "jitter": 25 }, // pause before the press AND after the release
  "move_duration_ms": 0,         // 0 = teleport; >0 = interpolated move, see below
  "capture": {                   // metadata from when the coordinate was picked
    "monitor": "\\\\.\\DISPLAY2",
    "monitor_rect": [1920, 0, 3840, 1080],
    "dpi": 96
  }
}
```

`action: "down"` / `"up"` exist so a macro can hold a button across other steps (drag
operations). The engine tracks these and releases anything still held when the macro ends or
is cancelled.

`settle_ms` is paused twice: after the cursor arrives, before the press; and after the
release, before the next step moves the cursor away. It exists because of a real failure:
without it the cursor left the target **0.05 ms** after the button came up (measured with
`cargo run --example trace_macro`), so any target that samples input once per frame saw the
release happen over the *next* target and dropped the click - it looked like the button was
held and abandoned. The 50–75 ms default spans at least two frames at 60 fps. Files written
before this field existed pick up the default on load; no schema bump, since it is an
additive field with a serde default.

`move_duration_ms > 0` interpolates the cursor over that many milliseconds instead of jumping.
Some targets only register hover state on real movement, and some reject a click that arrives
in the same frame the cursor appeared. Curve: ease-in-out, with a small per-point jitter.

`anchor` picks what the step aims at. `"fixed"` (the default) uses the step's own `x`/`y`
and ignores `dx`/`dy`.

`"activation"` ignores `x`/`y` and aims `dx`/`dy` away from wherever the mouse was when the
macro was activated: where the cursor sat when the hotkey was pressed, or when the Run/Test
countdown ended. The engine captures that point once, at the start of the run, so a later
step can still return to it after earlier steps moved the cursor, and every pass of a
repeating macro reuses the same point. With `dx`/`dy` at 0 (the default, and every file
written before offsets existed) it is the point itself.

`"previous"` aims `dx`/`dy` away from the point the previous click or move step **aimed at**
(before jitter and clamping, so random offsets never pile up along a chain). Steps without a
point (key, text, wait, scroll) do not count. Before the first click or move of a run, the
previous point is the activation point. It carries over between passes of a repeating macro:
a chain whose first pointer step is `"previous"` keeps going on the next pass (step across
inventory slots), one that starts with `"activation"` starts over each pass. Each run (and
each queued run) starts its chain from its own activation point.

`coord_jitter_px` is applied around the aimed point in every case. In the editor this is the
Target switch: "Fixed position" / "Mouse start + offset" / "Previous point + offset", with an
Offset field and a "Lands at" readout that follows the chain for the first pass
(`aimPoints` in `src/lib/steps.ts`, mirroring `Engine::resolve_point`). "Click at mouse" adds
a click aimed at the activation point.

### `move`

Same shape as `click` minus `button` / `action` / `hold_ms` / `settle_ms`, including
`anchor`, `dx` and `dy`.

### `scroll`

```jsonc
{ "id": "…", "type": "scroll", "amount": -3, "axis": "vertical", "at": null }
```

`amount` is in notches (multiplied by `WHEEL_DELTA` = 120). `at` is an optional `{x, y}`;
`null` scrolls at the current cursor position.

### `key`

```jsonc
{
  "id": "…", "type": "key",
  "key": { "vk": 65, "scancode": 30, "extended": false, "label": "A" },
  "action": "press",             // press | down | up
  "modifiers": ["shift"],        // held for the duration of this step only
  "hold_ms": { "base": 25, "jitter": 15 }
}
```

Modifiers listed here are pressed before and released after, in reverse order. As with mouse
buttons, `down` without a matching `up` is tracked and force-released at macro end.

### `text`

```jsonc
{ "id": "…", "type": "text", "value": "hello world", "per_char_ms": { "base": 20, "jitter": 15 } }
```

Uses `KEYEVENTF_UNICODE`. Not suitable for game input - the UI should say so inline.

### `wait`

```jsonc
{ "id": "…", "type": "wait", "ms": { "base": 500, "jitter": 200 } }
```

This is the user's "wait a bit, with a tick for randomness and how much time the randomness
adds." `jitter: 0` means exact; `jitter: n` means `base + uniform(0, n)`.

## Jitter

A `Jitter` is `{ "base": <u32 ms>, "jitter": <u32 ms> }` and appears anywhere a duration does.
Sampling is `base + rng.gen_range(0..=jitter)`, uniform. The UI renders it as a number field
plus a checkbox that reveals a second number field, matching the user's description.

## Settings

`settings.json`, separate from the macro file so a corrupt one cannot take down the other.

```jsonc
{
  "panic_key": { "vk": 27, "scancode": 1, "extended": false, "label": "Esc" },
  "enabled": true,               // master switch: false = every hotkey ignored
  "rng_seed": null,              // set to make runs reproducible while debugging
  "toggle_hotkey": {             // flips `enabled` from anywhere; null = none
    "key": { "vk": 123, "scancode": 88, "extended": false, "label": "F12" },
    "modifiers": ["ctrl", "shift"]
  }
}
```

The toggle hotkey and the panic key both work while `enabled` is false; that is how macros get
turned back on, or stopped, from inside a fullscreen game. A file written before
`toggle_hotkey` existed gets the Ctrl+Shift+F12 default; an explicit `null` means the user
cleared it and stays cleared.

Theme (system / light / dark) is a renderer-only preference kept in localStorage, not here.

## Return to start

`"return_to_start": true` moves the cursor back to the activation point (where the mouse was at
the press, or when the Run countdown ended) once the run is over: after the last repeat, not
after every pass. The release pass runs first, so a held button is let go before the cursor
moves. It also happens when the hotkey itself ends the run (releasing a hold-to-repeat key, the
second press of a toggle), which `CancelToken::stop` marks as a normal end. It does not happen
after Panic, the Stop button, or switching macros off (`CancelToken::cancel`): those mean "stop
moving my mouse". A queued run returns to the point from its own press.

## Guard ("App only")

```jsonc
"guard": { "process": "game.exe", "label": "Game" }   // or null
```

When set, the macro's hotkey fires only while the mouse is over a top-level window that
belongs to that executable (compared ignoring case). Anywhere else the key is treated as
unbound: it passes through to the app under the cursor and is never swallowed, even if the
trigger has `swallow` on. `label` is the window title the user picked from, for display only.

The check runs in the hook callback at the moment of the press: `GetCursorPos`,
`WindowFromPoint`, `GetAncestor(GA_ROOT)`, `GetWindowThreadProcessId`, then the executable
name, cached per process id for a few seconds. It is only done when an app-only binding is a
candidate for the key. An app-only binding beats an unrestricted one on the same key while the
mouse is over its app, and the same key bound for two different apps is not a clash.

Matching by executable name (not window handle or process id) keeps the choice valid across
restarts of the target app. The shape replaces a reserved, never-written
`{ "foreground_process", "on_mismatch" }` placeholder, so no migration was needed.

## Queue

`"queue": true` changes what a press does while something is already running: instead of being
ignored, it is appended to a FIFO queue (at most 50 entries), and each queued run starts right
after the previous one finishes, without interrupting it. Every queued press carries the mouse
position from its own press, so "click where the mouse started" steps aim where the user
pointed at that press rather than wherever the previous run left the cursor. Panic stop, the
master switch going off, and switching the macro off (or deleting it) all clear its queued
runs. Only meaningful for `"mode": "once"`; hold-to-repeat and toggle-mode macros never queue.

## Design notes

- **Coordinates are stored raw, not normalized.** Normalized 0..65535 values are a `SendInput`
  transport detail and would make the file unreadable and un-editable by hand.
- **No nested control flow in v1.** No loops-within-loops, no conditionals. The step list is
  flat. `repeat` at the macro level covers the common case; anything more is a scripting
  language, and that is a different product.
- **The file is meant to be hand-editable and diffable.** Pretty-printed, stable key order,
  stable step ids. Users will want to share macros as gists.
