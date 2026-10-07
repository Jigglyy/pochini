// Mirrors src-tauri/src/model.rs. Kept by hand for now; the plan is to
// generate this with ts-rs once the schema settles (docs/01-architecture.md).

export type Jitter = { base: number; jitter: number };

export type MouseButton = "left" | "right" | "middle" | "x1" | "x2";
export type ClickAction = "click" | "double" | "down" | "up";
export type KeyActionKind = "press" | "down" | "up";
export type ScrollAxis = "vertical" | "horizontal";
export type Modifier = "ctrl" | "alt" | "shift" | "win";
export type TriggerMode = "once" | "hold_repeat" | "toggle";

/** Where a click or move aims: its own x/y, or wherever the mouse was when
 *  the macro was activated (x/y ignored). */
export type Anchor = "fixed" | "activation";

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
      x: number;
      y: number;
      button: MouseButton;
      action: ClickAction;
      anchor: Anchor;
      coord_jitter_px: number;
      hold_ms: Jitter;
      settle_ms: Jitter;
      move_duration_ms: number;
      capture: CaptureMeta | null;
    }
  | {
      type: "move";
      id: string;
      x: number;
      y: number;
      anchor: Anchor;
      coord_jitter_px: number;
      move_duration_ms: number;
      capture: CaptureMeta | null;
    }
  | {
      type: "scroll";
      id: string;
      amount: number;
      axis: ScrollAxis;
      at: [number, number] | null;
    }
  | {
      type: "key";
      id: string;
      key: KeyRef;
      action: KeyActionKind;
      modifiers: Modifier[];
      hold_ms: Jitter;
    }
  | { type: "text"; id: string; value: string; per_char_ms: Jitter }
  | { type: "wait"; id: string; ms: Jitter };

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

export type Macro = {
  id: string;
  name: string;
  enabled: boolean;
  trigger: Trigger | null;
  repeat: Repeat;
  steps: Step[];
  guard: null;
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
};

export type Settings = {
  panic_key: KeyRef;
  /** Master switch: when false, every hotkey is ignored. */
  enabled: boolean;
  rng_seed: number | null;
  /** Flips `enabled` from anywhere, even from inside a fullscreen game. */
  toggle_hotkey: Hotkey | null;
};

export type Monitor = {
  device: string;
  rect: [number, number, number, number];
  dpi: number;
  primary: boolean;
};
