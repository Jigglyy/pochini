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
  "trigger": { /* Trigger */ },
  "repeat": { "kind": "once" },  // or {"kind":"count","n":10} | {"kind":"forever"}
  "steps": [ /* Step */ ],
  "guard": null,                 // optional Guard, see below
  "created_at": "2026-09-17T12:00:00Z",
  "updated_at": "2026-09-17T12:00:00Z"
}
```

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
  "coord_jitter_px": 0,          // radius of a uniform disc around (x,y)
  "hold_ms": { "base": 25, "jitter": 15 },   // gap between down and up
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

`move_duration_ms > 0` interpolates the cursor over that many milliseconds instead of jumping.
Some targets only register hover state on real movement, and some reject a click that arrives
in the same frame the cursor appeared. Curve: ease-in-out, with a small per-point jitter.

### `move`

Same shape as `click` minus `button` / `action` / `hold_ms`.

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

Uses `KEYEVENTF_UNICODE`. Not suitable for game input — the UI should say so inline.

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

## Guard (post-v1, reserved)

```jsonc
{ "foreground_process": "notepad.exe", "on_mismatch": "abort" }
```

Refuses to run unless the foreground window belongs to a matching process. The single best
safety feature for coordinate macros — it stops a macro meant for one game from clicking
through your email client. Reserved in the schema now so adding it later is not a migration.

## Design notes

- **Coordinates are stored raw, not normalized.** Normalized 0..65535 values are a `SendInput`
  transport detail and would make the file unreadable and un-editable by hand.
- **No nested control flow in v1.** No loops-within-loops, no conditionals. The step list is
  flat. `repeat` at the macro level covers the common case; anything more is a scripting
  language, and that is a different product.
- **The file is meant to be hand-editable and diffable.** Pretty-printed, stable key order,
  stable step ids. Users will want to share macros as gists.
