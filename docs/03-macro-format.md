# Macro format

On-disk schema for `macros.json`. The Rust types in `src-tauri/src/model.rs` are the source
of truth; `src/types.ts` mirrors them by hand (generating it with `ts-rs` is still to do).

## Top level

```jsonc
{
  "schema_version": 1,
  "macros": [ /* Macro */ ]
}
```

`schema_version` is bumped whenever a field is removed or its meaning changes, or a value
appears that older builds cannot read (2: the `wait_color` step; 3: the `window` anchor). Adding an
optional field with a serde default does not require a bump. Every bump needs a migration
step in `migrate` (`src-tauri/src/storage.rs`) and a round-trip test with a real file from the
previous version.

## Macro

```jsonc
{
  "id": "01J9X...",              // ULID, stable, never reused
  "name": "Harvest loop",
  "enabled": true,
  "favorite": false,             // starred on the macro list; sorting only
  "color": null,                 // accent name for the macro list ("red", "teal"...), or null
  "review": false,               // true: imported, steps not looked at yet (see Sharing)
  "trigger": { /* Trigger */ },
  "repeat": { "kind": "once" },  // or {"kind":"count","n":10} | {"kind":"forever"}
  "queue": false,                // true: presses while running are queued, not ignored
  "queue_from": "first_press",   // or "each_press": where queued runs start (see Queue)
  "return_to_start": false,      // true: move the cursor back to where the run started
  "stop_after_ms": null,         // or e.g. 600000: end the run after 10 minutes (normal end)
  "feel": { "bell": null, "hesitate": null, "curve": null },  // see Feel; all off
  "steps": [ /* Step */ ],
  "guard": null,                 // optional Guard, see below
  "created_at": "2026-09-17T12:00:00Z",
  "updated_at": "2026-09-17T12:00:00Z"
}
```

The order of `macros` in the file is the **custom order** (what dragging on the macro
list edits). Sorting by name or date is a view in the UI and never rewrites the file.
`reorder_macros` takes the new order of all macros, or of one group of them (the favorites, or
the rest): the listed macros swap among the places they already hold and every other macro
keeps its place, so reordering favorites never shuffles the others (`MacroFile::reorder`).
Starring or coloring a macro does not change `updated_at`. `color` is a name from the UI's
accent palette (`src/lib/colors.ts`), normalized by `normalize_color` (lower case; empty or
"none" means no color); an unknown name simply shows no color.

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

Both `vk` and `scancode` are stored. Hotkeys are matched on `vk` (what the keyboard hook
reports); keys a step presses are injected by `scancode` (layout independent, and what games
reading raw input see). `label` exists so the UI can show something readable.

## Step

A tagged union on `"type"`. Every step carries an `"id"` (ULID) so the UI can key list rows
and reorder without re-rendering the world.

Every step also carries `"shuffle"` (default `false`). On each pass the engine takes the slots
the marked steps occupy and deals those steps back into them in a random order; unmarked steps
never move. So in click / wait / click / wait with only the clicks marked, the waits stay
between them. A new order is drawn every pass and every run (from the run's RNG, so a seeded
run is reproducible). One marked step has nothing to trade with and stays put. A `"previous"`
anchor follows execution order, so after a shuffle it measures from whichever pointer step ran
just before it; the editor's "Lands at" readout shows the unshuffled first pass.

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
  "dwell_ms": { "base": 2, "jitter": 0 },    // optional: the pause after the release instead
  "move_duration_ms": 0,         // 0 = teleport; >0 = interpolated move, see below
  "path": [{ "x": 30, "y": 25, "t": 0 }, { "x": 120, "y": 60, "t": 400 }], // optional, see below
  "modifiers": ["shift"],        // held while clicking (any of ctrl | alt | shift | win)
  "held_key": null,              // or a key object like `key` steps use, held the same way
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

`dwell_ms` (optional, absent when not set) is the pause after the release when it differs
from the one before the press; `settle_ms` is then only the pause before. Record mode sets
both from what the user did: how long the cursor rested on the target before the press, and
how soon it set off again after the release (when that is under 15 ms; a longer rest is a
Wait step and `dwell_ms` is 0). One value for both sides used to be cut to the shorter of
the two, and as people set off again almost at once after letting go, a replay moved late
and arrived just as it pressed. Typing one settle for several clicks at once drops it.
Additive with a default, so no schema bump.

`modifiers` and `held_key` are held for this step only ("While holding" in the editor): pressed
after the cursor arrives (so nothing sees Shift+move), held through the settle on both sides of
the press, and released after the second settle, `held_key` first, then the modifiers in
reverse. A frame-polling target therefore sees Shift down before the press and still down at
the release. A `held_key` that an earlier step is already holding down (a `key` step with
`action: "down"`) is left alone, so the click never releases it early. On cancellation the
release pass lets go of all of them. Both fields default to empty on files written before
they existed.

`move_duration_ms > 0` interpolates the cursor over that many milliseconds instead of jumping.
Some targets only register hover state on real movement, and some reject a click that arrives
in the same frame the cursor appeared. The glide is a straight line timed by minimum jerk
(`engine::curve::min_jerk`, `10t³ − 15t⁴ + 6t⁵` of the way at `t` of the time): it sets off
and arrives at rest and is fastest halfway, as a hand is. With the macro's `feel.curve` it
arcs instead (see Feel).

`path` (optional, absent when empty) is the way the cursor went to this point when the step
was recorded: points in virtual-desktop pixels, `t` ms after the cursor set off. Record mode
keeps every report the mouse makes (a 2000 Hz mouse makes one every half millisecond), less
repeats of the same position. It is saved packed, as a string: `"1:"`, then URL-safe base64
without padding of each point's change from the one before (x, y, t) as zigzag LEB128 varints
(about four characters a point; `model::packed_path`, read back by `src/lib/path.ts`). A plain
list of `{x, y, t}` objects is read too. Points that share a millisecond replay spread evenly
across it, which puts a 2000 Hz recording's reports back within about a quarter of a
millisecond. When it has two or more points and
`move_duration_ms > 0`, the engine replays it instead of the eased glide, on the recording's
own timing stretched to `move_duration_ms` (so changing the travel speeds it up or slows it
down). The path is bent to fit: each point is shifted by the difference between the recorded
start and where the cursor really is, fading out along the path, and by the difference between
the recorded end and the step's point (jitter and anchors included), fading in. Replayed from
where it was recorded it is exact; with a moved target it still arrives without a jump. The
editor's "Straight line instead" drops it. Additive with a serde default: no schema bump, and
an older Pochini reading the file simply glides.

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

#### The `window` anchor (schema 3)

`"anchor": "window"` aims `dx`/`dy` from the top-left of the client area of the macro's
"App only" app's window: the foreground window if it is that app's, otherwise its first
visible top-level window. The point follows the window when it moves or the app starts
somewhere else. A run stops with a reason if the macro has no App only app or the app has no
window open. `x`/`y` are ignored.

### `move`

Same shape as `click` minus `button` / `action` / `hold_ms` / `settle_ms`, including
`anchor`, `dx`, `dy` and `path`.

### `scroll`

```jsonc
{ "id": "…", "type": "scroll", "amount": -3, "axis": "vertical", "at": null,
  "ticks": [{ "t": 0, "delta": -30 }, { "t": 20, "delta": -90 }] }   // optional, see below
```

`amount` is in notches (multiplied by `WHEEL_DELTA` = 120). `at` is an optional `{x, y}`;
`null` scrolls at the current cursor position.

`ticks` (optional, absent when empty) is a recorded scroll: each turn of the wheel in raw wheel
units (`delta`, 120 a notch; a smooth wheel or a touchpad turns by less) and `t` ms after the
first. When present, the engine replays the turns one by one on their own timing (the first at
`at`) instead of `amount` notches at once; `amount` is then only the rounded total, shown in the
editor. Typing an amount, or "Plain scroll instead", drops them.

### `key`

```jsonc
{
  "id": "…", "type": "key",
  "key": { "vk": 65, "scancode": 30, "extended": false, "label": "A" },
  "action": "press",             // press | down | up
  "modifiers": ["shift"],        // held for the duration of this step only
  "hold_ms": { "base": 25, "jitter": 15 },
  "repeat": { "delay_ms": 500, "every_ms": 33 }   // optional, see below
}
```

Modifiers listed here are pressed before and released after, in reverse order. As with mouse
buttons, `down` without a matching `up` is tracked and force-released at macro end.

`repeat` (optional) is how a recorded key repeated while held. Windows repeats a key a person
holds but never one a program holds, so the engine does it: from a `press` or `down`, a key-down
again after `delay_ms` and then every `every_ms`, until the step's own release (a `press`) or
the `up` step (or the end of the run). Record mode takes both from the repeats Windows sent
(Windows' usual 33 ms when only one was caught). "Don't repeat" in the editor drops it.

### `text`

```jsonc
{ "id": "…", "type": "text", "value": "hello world", "per_char_ms": { "base": 20, "jitter": 15 } }
```

Uses `KEYEVENTF_UNICODE`. Not suitable for game input - the UI should say so inline.

### `wait`

```jsonc
{ "id": "…", "type": "wait", "ms": { "base": 500, "jitter": 200 } }
```

### `wait_color` (schema 2)

```jsonc
{ "id": "…", "type": "wait_color",
  "x": 1623, "y": 592,         // the screen pixel to watch, virtual-desktop pixels
  "color": "#33aa55",
  "tolerance": 16,             // each of r, g, b may differ by this much (0 to 255)
  "timeout_ms": 5000,
  "on_timeout": "stop" }       // or "continue": carry on with the next step
```

Waits until the pixel has the color, checking every 25 ms (`COLOR_POLL_MS`). On a timeout
with `"stop"` the run ends with an error that says which color it saw. It reads the screen
with documented APIs (`GetPixel`); a game in exclusive fullscreen may read as black. Older
builds cannot read this step, which is why the schema went to version 2; a shared file says
`"version": 2` only if it contains one.

This is the original spec's "wait a bit, with a tick for randomness and how much time the randomness
adds." `jitter: 0` means exact; `jitter: n` means `base + uniform(0, n)`.

## Jitter

A `Jitter` is `{ "base": <u32 ms>, "jitter": <u32 ms> }` and appears anywhere a duration does.
Sampling is `base + rng.gen_range(0..=jitter)`, uniform, unless the macro has a bell (see
Feel). The UI renders it as a number field plus a checkbox that reveals a second number field,
matching the original description.

## Feel

Three optional touches that make a macro less mechanical, per macro, all off (`null`) by
default. Additive with serde defaults: no schema bump, and an older Pochini reading the file
plays it evenly, without hesitation, in straight lines.

```jsonc
"feel": {
  "bell": { "tightness": "medium", "peak": "middle" },   // loose | medium | tight; early | middle | late
  "hesitate": { "chance_pct": 10, "ms": { "base": 150, "jitter": 350 } },
  "curve": { "bend_pct": 10, "overshoot_pct": 0 }
}
```

- **`bell`**: every random amount the macro draws (waits, holds, settles, dwells, typing
  gaps, the hesitation, the curve's bend) comes from a Beta curve on its range instead of an
  even spread (`engine::random`). It never leaves the range, so estimates and the editor's
  "A random 50 to 75 ms" stay true. The peak is the curve's mode (early 0.2, middle 0.5, late
  0.8 of the range) and the tightness its concentration κ (4, 8, 20), giving
  `a = 1 + mode(κ − 2)`, `b = 1 + (1 − mode)(κ − 2)`. Medium and middle is Beta(4, 4), a bell
  whose standard deviation is a sixth of the range; an early peak is right-skewed (mostly
  short, the odd long one), the way people's timing is. Click spread (`coord_jitter_px`)
  becomes a 2D bell instead: a Rayleigh radius with σ = radius / 2, 2.5 or 3.5 by tightness,
  cut off at the radius (`jitter_point_bell`); the peak does not apply to positions.
- **`hesitate`**: before the press of a click, double click or press-and-hold, `chance_pct`
  times in a hundred, the step waits `ms` longer, on the target, before any held key goes
  down. Never a release, never between a double click's presses, never a click with a
  recorded `path` (it keeps the user's own timing) (`Step::hesitates`). The estimate's worst
  case allows the longest hesitation once per such click.
- **`curve`**: a glide (`move_duration_ms > 0`, no recorded `path`) follows a cubic Bezier
  arc instead of a straight line (`engine::curve::curve_path`): both control points on one
  random side, a third and two thirds of the way, each pushed off the line by half to all of
  `bend_pct` (at most 50) of the distance; under 8 px it stays straight. It is travelled with
  minimum-jerk timing over its length, a point about every 8 ms, replayed like a recorded
  path, clamped to the desktop. With `overshoot_pct`, that share of glides of 40 px or more
  ends 3% of the distance past the target (3 to 15 px) at 80% of the time and comes back in
  a straight correction. A jump (`move_duration_ms: 0`) stays a jump.

With every touch off the run's random numbers are drawn exactly as before, so a seeded run
(`rng_seed`) is unchanged.

## Settings

`settings.json`, separate from the macro file so a corrupt one cannot take down the other.

```jsonc
{
  "panic_key": { "vk": 27, "scancode": 1, "extended": false, "label": "Esc" },
  "welcomed": true,              // the first-run welcome has been closed
  "close_to_tray": null,         // true: closing keeps running in the tray; false: quits; null: ask
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
"guard": { "process": "notepad.exe", "label": "Untitled - Notepad" }   // or null
```

When set, the macro's hotkey fires only while the mouse is over a top-level window that
belongs to that executable (compared ignoring case). Anywhere else the key is treated as
unbound: it passes through to the app under the cursor and is never swallowed, even if the
trigger has `swallow` on. `label` is the window title it was picked from, for display only.

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
after the previous one finishes, without interrupting it. With `"queue_from": "first_press"`
(the default since 0.9.1) every queued run reuses the activation point of the run that started
the chain (the first press, or where the Run countdown ended); "move mouse back" returns there
too. `"each_press"` uses the mouse position from each run's own press instead, but a press made
while the macro runs catches the cursor wherever the macro has moved it, so a queued "click
where the mouse started" lands on the macro's own last click, and "move mouse back" then keeps
returning there (the drift that was reported; reproduced in app.rs `start_and_two_clicks_*` tests). A press
after the queue has emptied starts a new chain. Implemented in the run thread of `app.rs`
(`chain_start`), which drains the queue back to back. Panic stop, the
master switch going off, and switching the macro off (or deleting it) all clear its queued
runs. Only meaningful for `"mode": "once"`; hold-to-repeat and toggle-mode macros never queue.

## Sharing (export / import)

Export (a macro's menu > Export...) writes one macro to a `.pochini.json` file:

```jsonc
{
  "format": "pochini.macros",    // identifies the file
  "version": 1,                  // bumped if the format changes; newer files are refused
  "macros": [ /* Macro, as above */ ]
}
```

What is about the sender rather than the macro stays behind: the star (`favorite`), the
window title an "App only" app was picked from (`guard.label`), and the monitor each point was
picked on (`capture`). Everything else, including the color and the hotkey, travels. Import
(the Import button) accepts that file, a bare macro object, or a `macros.json` backup. Every
imported macro is a new macro: new macro and step ids, `created_at` and `updated_at` set to
now, not a favorite, its color checked against the palette, a name made unique
(" (imported)", " (imported 2)"...), **`enabled: false`** (its hotkey stays off, so someone
else's macro never fires on Space by surprise) and **`review: true`**.

A shared macro is a small program: it can type into whatever has focus and press shortcuts
that open things. While `review` is true it cannot be switched on or run (the backend refuses
both); switching it on or pressing Run first shows every step in plain words, with the ones
that type text or press Ctrl/Alt/Win shortcuts flagged. "Looks good" clears `review`, and so
does saving it from the editor, which shows every step. Files over 2 MB (read with a hard
limit, whatever size the file claims) or with more than 500 macros are refused, as is anything
that is not one of the three shapes, each with a plain reason. Rules and tests:
`src-tauri/src/share.rs`.

## When macros.json cannot be read

A missing file is an empty library. Anything else that cannot be read (damaged JSON, a step
type this build does not know, a newer `schema_version`) is copied aside untouched as
`macros.json.unreadable-<time>`, and the app says so in a banner instead of quietly showing an
empty list:

- If `macros.bak` (the version before the last save) reads, it is loaded, except for a newer
  `schema_version`, whose backup is most likely from that newer version too.
- Otherwise the library starts empty and **locked**: nothing is saved until the user chooses
  Start fresh. Before this, the next two saves replaced both the file and its backup with an
  empty library.

`Store::open_macros` in `src-tauri/src/storage.rs`, with tests there and in `app.rs`.

## Design notes

- **Coordinates are stored raw, not normalized.** Normalized 0..65535 values are a `SendInput`
  transport detail and would make the file unreadable and un-editable by hand.
- **No nested control flow in v1.** No loops-within-loops, no conditionals. The step list is
  flat. `repeat` at the macro level covers the common case; anything more is a scripting
  language, and that is a different product.
- **The file is meant to be hand-editable and diffable.** Pretty-printed, stable key order,
  stable step ids. Users will want to share macros as gists.
