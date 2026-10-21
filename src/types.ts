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
export type Anchor = "fixed" | "activation" | "previous";

export type KeyRef = {
  vk: number;
  scancode: number;
  extended: boolean;
  label: string;
};

export type Hotkey = { key: KeyRef; modifiers: Modifier[] };

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
      move_duration_ms: number;
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
      capture: CaptureMeta | null;
    }
  | {
      type: "scroll";
      id: string;
      shuffle: boolean;
      amount: number;
      axis: ScrollAxis;
      at: [number, number] | null;
    }
  | {
      type: "key";
      id: string;
      shuffle: boolean;
      key: KeyRef;
      action: KeyActionKind;
      modifiers: Modifier[];
      hold_ms: Jitter;
    }
  | { type: "text"; id: string; shuffle: boolean; value: string; per_char_ms: Jitter }
  | { type: "wait"; id: string; shuffle: boolean; ms: Jitter };

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

export type Macro = {
  id: string;
  name: string;
  enabled: boolean;
  /** Starred on the macro list. Only affects sorting. */
  favorite: boolean;
  /** Accent name (lib/colors.ts) shown on the macro list, or null. */
  color: string | null;
  trigger: Trigger | null;
  repeat: Repeat;
  /** Presses while running are queued instead of ignored. */
  queue: boolean;
  /** Where queued runs start: their own press, or the chain's first press. */
  queue_from: QueueFrom;
  /** When the run ends, move the cursor back to where the macro started. */
  return_to_start: boolean;
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
  conflict: boolean;
  duration_ms: [number, number];
  queue: boolean;
  /** "App only" executable, if set. */
  app: string | null;
  favorite: boolean;
  color: string | null;
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
};

export type AppWindow = { process: string; title: string };

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
