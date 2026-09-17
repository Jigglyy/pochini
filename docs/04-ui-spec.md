# UI spec

Two screens. Resist adding a third.

---

## Screen 1 — Macro list

The app opens here.

```
┌────────────────────────────────────────────────────────────┐
│  coordsclickermacro                    [●] Enabled   ⚙︎     │
├────────────────────────────────────────────────────────────┤
│  [ + New macro ]                          🔍 filter…        │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ ⠿  Harvest loop          Space          ▸  ⋯         │  │
│  │ ⠿  Buy stack             Ctrl+Shift+B   ▸  ⋯         │  │
│  │ ⠿  Close popups          F8  (disabled) ▸  ⋯         │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  Panic stop: Esc                                           │
└────────────────────────────────────────────────────────────┘
```

- **Master toggle** in the header. Off = the hook stays installed but every binding is
  inert. One switch to make the app harmless without quitting it.
- Each row: drag handle, name, bound hotkey, a **run now** button (▸, for testing without
  touching the hotkey), and an overflow menu (Edit, Duplicate, Export, Delete).
- Clicking the row opens the editor.
- A row whose hotkey conflicts with another macro's shows an inline warning badge.
- The panic key is always visible in the footer. The user must never have to hunt for it.

Empty state: a single "Create your first macro" card, not a blank page.

---

## Screen 2 — Editor

```
┌────────────────────────────────────────────────────────────┐
│  ← Back        Harvest loop                  [Test] [Save] │
├────────────────────────────────────────────────────────────┤
│  Name     [ Harvest loop                              ]    │
│  Hotkey   [ Space                    ] [ Record ]          │
│           Mode ( ●Once  ○Hold to repeat  ○Toggle )         │
│           ☐ Block this key from other apps                 │
│  Repeat   ( ●Once  ○ [10] times  ○ Until stopped )         │
├────────────────────────────────────────────────────────────┤
│  Steps                                     [ + Add step ▾] │
│                                                            │
│  ⠿ 1  Click     (1920, 540)  left   [Pick] [◎]        ⋯   │
│  ⠿ 2  Wait      500 ms  ☑ random + [200] ms           ⋯   │
│  ⠿ 3  Key       Shift+A                               ⋯   │
│  ⠿ 4  Click     (400, 220)   left   [Pick] [◎]        ⋯   │
│                                                            │
│           Estimated run time: 0.55 – 0.75 s                │
└────────────────────────────────────────────────────────────┘
```

### Hotkey recording

`Record` arms a capture mode in the hook thread: the next key-down (plus the modifiers held
with it) becomes the binding. Escape cancels capture rather than binding Escape. While armed,
the key is swallowed so recording `Space` does not scroll the UI.

Warn inline, at the moment of choice, when the user binds a bare printable key with **Block
this key from other apps** checked — that is the setting that makes their keyboard feel broken.

### Coordinate picking

`[Pick]` arms global capture: the editor window dims, a floating HUD shows the live cursor
position and a magnified view around it, and pressing the capture key (default `F2`, never the
mouse — clicking would activate whatever is underneath) writes the coordinate into the step.
Escape cancels.

`[◎]` is *show me*: moves the real cursor to the stored coordinate and flashes a marker there,
so the user can confirm a saved point still lands where they think.

### Step rows

- Drag to reorder; the row is collapsed by default and expands to show all fields.
- The collapsed summary is a plain-English sentence, not a field dump — "Wait 500 ms (±200)",
  "Double-click (1920, 540)".
- **Add step** is a dropdown with the six types from [03-macro-format.md](03-macro-format.md).
- Duplicating a step is one click. Building these lists is repetitive by nature.

### Randomness UI

Exactly as the user described it: a number field for the base, a checkbox labelled
**random extra**, and, when ticked, a second number field for the maximum added amount. The
row summary shows the resulting range so the meaning of "adds" is never ambiguous.

### Test

`[Test]` runs the macro immediately with a 3-second countdown overlay, so the user can focus
the target window first. The overlay also shows which step is executing and offers Stop. The
countdown is cancellable.

---

## Global behaviours

- **Tray icon.** Closing the window minimizes to tray; the app must keep running for hotkeys
  to work, and users will otherwise close it and think it broke. Tray menu: Enabled toggle,
  open, quit.
- **Running indicator.** While a macro runs, the tray icon changes and an always-on-top,
  click-through toast shows the macro name and a Stop hint. The user must always be able to
  tell that something is driving their mouse.
- **First-run notice.** One-time explanation that the app uses a global keyboard hook, why
  antivirus may flag it, and that it never stores keystrokes. Honest and once.

## Accessibility and theming

Follow the system dark/light preference. Full keyboard navigation through the editor,
including step reordering (Alt+Up/Down), since this is a keyboard-centric tool. Never rely on
color alone for the conflict/disabled states.
