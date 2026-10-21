import type { Macro, Step } from "../src/types";

// Seed data for e2e tests, shaped like macros.json (see src/types.ts).

let n = 0;
const id = (prefix: string) => `${prefix}-${++n}`;

export function macro(name: string, o: Partial<Macro> = {}): Macro {
  return {
    id: id("m"),
    name,
    enabled: true,
    favorite: false,
    color: null,
    trigger: null,
    repeat: { kind: "once" },
    queue: false,
    queue_from: "first_press",
    return_to_start: false,
    steps: [],
    guard: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...o,
  };
}

export const wait = (ms: number): Step => ({ type: "wait", id: id("w"), shuffle: false, ms: { base: ms, jitter: 0 } });

export type ClickStep = Extract<Step, { type: "click" }>;

export const clickAt = (x: number, y: number): ClickStep => ({
  type: "click",
  id: id("c"),
  shuffle: false,
  x,
  y,
  button: "left",
  action: "click",
  anchor: "fixed",
  dx: 0,
  dy: 0,
  coord_jitter_px: 0,
  hold_ms: { base: 25, jitter: 0 },
  settle_ms: { base: 50, jitter: 0 },
  move_duration_ms: 0,
  modifiers: [],
  held_key: null,
  capture: null,
});

export const typeText = (value: string): Step => ({
  type: "text",
  id: id("t"),
  shuffle: false,
  value,
  per_char_ms: { base: 20, jitter: 0 },
});
