// Mirrors src-tauri/src/model.rs. Kept by hand for now; the plan is to
// generate this with ts-rs once the schema settles (docs/01-architecture.md).

export type Jitter = { base: number; jitter: number };

export type MouseButton = "left" | "right" | "middle" | "x1" | "x2";
export type ClickAction = "click" | "double" | "down" | "up";
export type KeyActionKind = "press" | "down" | "up";
export type ScrollAxis = "vertical" | "horizontal";
export type Modifier = "ctrl" | "alt" | "shift" | "win";
export type TriggerMode = "once" | "hold_repeat" | "toggle";

/** Where a click or move aims: its own x/y ("fixed"), or dx/dy away from
 *  where the mouse was when the macro started ("activation") or from where the
 *  previous click or move aimed ("previous"). See Anchor in model.rs. */
export type Anchor = "fixed" | "activation" | "previous" | "window";

export type KeyRef = {
  vk: number;
  scancode: number;
  extended: boolean;
  label: string;
};

export type Hotkey = { key: KeyRef; modifiers: Modifier[] };

/** One point of a recorded mouse path (model.rs PathPoint): where the cursor
 *  was, `t` ms after it set off. Steps carry paths packed (lib/path.ts). */
export type PathPoint = { x: number; y: number; t: number };

/** How a recorded key repeated while held (model.rs KeyRepeat). */
export type KeyRepeat = { delay_ms: number; every_ms: number };

/** One wheel turn of a recorded scroll: `delta` wheel units (120 a notch),
 *  `t` ms after the first (model.rs WheelTick). */
export type WheelTick = { t: number; delta: number };

export type CaptureMeta = {
  monitor: string;
  monitor_rect: [number, number, number, number];
  dpi: number;
};

export type Step =
  | {
      type: "click";
      id: string;
      /** Trades places at random with the other marked steps, each pass. */
      shuffle: boolean;
      x: number;
      y: number;
      button: MouseButton;
      action: ClickAction;
      anchor: Anchor;
      /** Offset for "activation" / "previous"; right and down are positive. */
      dx: number;
      dy: number;
      coord_jitter_px: number;
      hold_ms: Jitter;
      settle_ms: Jitter;
      /** The pause after the release when it is not `settle_ms` (a recorded
       *  click: as long as the user stayed). Absent: `settle_ms` both sides. */
      dwell_ms?: Jitter;
      move_duration_ms: number;
      /** The way the cursor went here when recorded, replayed over
       *  `move_duration_ms`, packed (decodePath in lib/path.ts); absent or
       *  empty: a straight glide. */
      path?: string;
      /** Held from the cursor's arrival until the release has settled. */
      modifiers: Modifier[];
      /** Any other key held the same way. */
      held_key: KeyRef | null;
      capture: CaptureMeta | null;
    }
  | {
      type: "move";
      id: string;
      shuffle: boolean;
      x: number;
      y: number;
      anchor: Anchor;
      dx: number;
      dy: number;
      coord_jitter_px: number;
      move_duration_ms: number;
      path?: string;
      capture: CaptureMeta | null;
    }
  | {
      type: "scroll";
      id: string;
      shuffle: boolean;
      amount: number;
      axis: ScrollAxis;
      at: [number, number] | null;
      /** A recorded scroll, replayed turn by turn instead of `amount` at once. */
      ticks?: WheelTick[];
    }
  | {
      type: "key";
      id: string;
      shuffle: boolean;
      key: KeyRef;
      action: KeyActionKind;
      modifiers: Modifier[];
      hold_ms: Jitter;
      /** Repeats while held, as the recorded key did. */
      repeat?: KeyRepeat;
    }
  | { type: "text"; id: string; shuffle: boolean; value: string; per_char_ms: Jitter }
  | { type: "wait"; id: string; shuffle: boolean; ms: Jitter }
  | {
      /** Wait until the pixel at (x, y) has `color`, each channel within
       *  `tolerance`; after `timeout_ms`, stop the run or carry on. */
      type: "wait_color";
      id: string;
      shuffle: boolean;
      x: number;
      y: number;
      /** "#rrggbb" */
      color: string;
      tolerance: number;
      timeout_ms: number;
      on_timeout: "stop" | "continue";
    };

export type StepKind = Step["type"];

export type Trigger = {
  key: KeyRef;
  modifiers: Modifier[];
  mode: TriggerMode;
  swallow: boolean;
};

export type Repeat =
  | { kind: "once" }
  | { kind: "count"; n: number }
  | { kind: "forever" };

export type QueueFrom = "each_press" | "first_press";

/** "App only": the hotkey fires only while the mouse is over this app. */
export type Guard = { process: string; label: string };

/** How strongly random amounts gather around the bell's peak. */
export type Tightness = "loose" | "medium" | "tight";
/** Where in its range the bell peaks. */
export type Peak = "early" | "middle" | "late";
/** Random amounts gather around a peak instead of spreading evenly. */
export type Bell = { tightness: Tightness; peak: Peak };
/** Before pressing, a click waits `ms` longer, `chance_pct` times in a hundred. */
export type Hesitate = { chance_pct: number; ms: Jitter };
/** Glides bend up to `bend_pct` of their length; `overshoot_pct` of them overshoot. */
export type Curve = { bend_pct: number; overshoot_pct: number };
/** A macro's optional touches; null is off. Mirrors model.rs Feel. */
export type Feel = { bell: Bell | null; hesitate: Hesitate | null; curve: Curve | null };

export type Macro = {
  id: string;
  name: string;
  enabled: boolean;
  /** Starred on the macro list. Only affects sorting. */
  favorite: boolean;
  /** Accent name (lib/colors.ts) shown on the macro list, or null. */
  color: string | null;
  /** Imported and not reviewed yet: cannot be switched on or run. */
  review: boolean;
  trigger: Trigger | null;
  repeat: Repeat;
  /** Presses while running are queued instead of ignored. */
  queue: boolean;
  /** Where queued runs start: their own press, or the chain's first press. */
  queue_from: QueueFrom;
  /** When the run ends, move the cursor back to where the macro started. */
  return_to_start: boolean;
  /** End the run after this long (a safety limit), or null for no limit. */
  stop_after_ms: number | null;
  /** Bell-curve randomness, hesitation, curved paths (model.rs Feel). */
  feel: Feel;
  steps: Step[];
  guard: Guard | null;
  created_at: string;
  updated_at: string;
};

export type MacroSummary = {
  id: string;
  name: string;
  enabled: boolean;
  hotkey: string | null;
  step_count: number;
  /** Why the hotkey cannot work as set, or null when it can. */
  conflict: string | null;
  duration_ms: [number, number];
  queue: boolean;
  /** "App only" executable, if set. */
  app: string | null;
  favorite: boolean;
  color: string | null;
  review: boolean;
  /** RFC 3339. */
  created_at: string;
  updated_at: string;
};

export type Settings = {
  panic_key: KeyRef;
  /** Master switch: when false, every hotkey is ignored. */
  enabled: boolean;
  rng_seed: number | null;
  /** Flips `enabled` from anywhere, even from inside a fullscreen game. */
  toggle_hotkey: Hotkey | null;
  /** The first-run welcome has been seen. */
  welcomed: boolean;
  /** Closing the window keeps Pochini in the tray (true) or quits (false);
   *  null asks the first time. */
  close_to_tray: boolean | null;
};

/** How a run ended (app.rs Outcome). */
export type Outcome =
  | { kind: "finished" }
  | { kind: "stopped" }
  | { kind: "cancelled" }
  | { kind: "failed"; message: string; admin: boolean };

export type RunRecord = {
  name: string;
  macro_id: string;
  at_ms: number;
  duration_ms: number;
  outcome: Outcome;
};

export type AppWindow = { process: string; title: string };

/** Why macros.json could not be read at startup (see Store::open_macros). */
export type LoadProblem = {
  reason: string;
  kept_at: string | null;
  /** Loaded from the backup made before the last save. */
  from_backup: boolean;
  /** Nothing could be read; saving is refused until Start fresh. */
  locked: boolean;
};

export type SeenResult =
  | { kind: "panic" }
  | { kind: "toggle" }
  | { kind: "run"; macro_id: string }
  | { kind: "outside_app"; macro_id: string }
  | { kind: "macros_off" }
  | { kind: "wrong_modifiers" };

export type RecentKey = {
  combo: string;
  result: SeenResult;
  via: "hook" | "windows";
  macro_name: string | null;
  app: string | null;
  at_ms: number;
};

export type HookStatus = {
  installed: boolean;
  toggle_registered: boolean;
  toggle_taken: boolean;
  key_events: number;
  reinstalls: number;
};

export type HotkeyDiagnostics = { hook: HookStatus; recent: RecentKey[] };

export type RunStatus = { macro_id: string | null; name: string | null; queued: number };

export type Monitor = {
  device: string;
  rect: [number, number, number, number];
  dpi: number;
  primary: boolean;
};
