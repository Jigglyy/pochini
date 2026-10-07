import type { Jitter, Modifier, Step } from "../types";

export const newId = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

const hold = (): Jitter => ({ base: 25, jitter: 15 });
const settle = (): Jitter => ({ base: 50, jitter: 25 });

/** What the "Add step" buttons create. `click_here` is a click aimed at the
 *  activation point (where the mouse is when the macro starts). */
export type NewStepKind = Step["type"] | "click_here";

export function blankStep(kind: NewStepKind): Step {
  const id = newId();
  switch (kind) {
    case "click":
    case "click_here":
      return {
        type: "click",
        id,
        x: 0,
        y: 0,
        button: "left",
        action: "click",
        anchor: kind === "click_here" ? "activation" : "fixed",
        coord_jitter_px: 0,
        hold_ms: hold(),
        settle_ms: settle(),
        move_duration_ms: 0,
        capture: null,
      };
    case "move":
      return {
        type: "move",
        id,
        x: 0,
        y: 0,
        anchor: "fixed",
        coord_jitter_px: 0,
        move_duration_ms: 0,
        capture: null,
      };
    case "scroll":
      return { type: "scroll", id, amount: -3, axis: "vertical", at: null };
    case "key":
      return {
        type: "key",
        id,
        key: { vk: 0x41, scancode: 0x1e, extended: false, label: "A" },
        action: "press",
        modifiers: [],
        hold_ms: hold(),
      };
    case "text":
      return { type: "text", id, value: "", per_char_ms: { base: 20, jitter: 15 } };
    case "wait":
      return { type: "wait", id, ms: { base: 500, jitter: 0 } };
  }
}

const ms = (j: Jitter) => (j.jitter > 0 ? `${j.base}-${j.base + j.jitter} ms` : `${j.base} ms`);

export const modLabel = (m: Modifier) => m[0].toUpperCase() + m.slice(1);

/** A plain-English one-liner for the collapsed row. Never a field dump. */
export function summarize(s: Step): string {
  switch (s.type) {
    case "click": {
      const verb =
        s.action === "double"
          ? "Double-click"
          : s.action === "down"
            ? "Press and hold"
            : s.action === "up"
              ? "Release"
              : "Click";
      const btn = s.button === "left" ? "" : ` ${s.button}`;
      const where = s.anchor === "activation" ? "where the mouse started" : `at (${s.x}, ${s.y})`;
      const jit = s.coord_jitter_px ? ` ±${s.coord_jitter_px}px` : "";
      return `${verb}${btn} ${where}${jit}`;
    }
    case "move": {
      const where = s.anchor === "activation" ? "where the mouse started" : `(${s.x}, ${s.y})`;
      return `Move to ${where}${s.move_duration_ms ? ` over ${s.move_duration_ms} ms` : ""}`;
    }
    case "scroll":
      return `Scroll ${s.amount > 0 ? "up" : "down"} ${Math.abs(s.amount)}`;
    case "key": {
      const combo = [...s.modifiers.map(modLabel), s.key.label].join("+");
      const verb = s.action === "down" ? "Hold" : s.action === "up" ? "Release" : "Press";
      return `${verb} ${combo}`;
    }
    case "text":
      return s.value ? `Type "${s.value.length > 32 ? s.value.slice(0, 32) + "..." : s.value}"` : "Type text";
    case "wait":
      return `Wait ${ms(s.ms)}`;
  }
}

/** Best/worst-case duration of one step in ms. Mirrors Step::duration_range. */
export function stepRange(s: Step): [number, number] {
  const j = (x: Jitter): [number, number] => [x.base, x.base + x.jitter];
  switch (s.type) {
    case "wait":
      return j(s.ms);
    case "click": {
      const [a, b] = j(s.hold_ms);
      const [sa, sb] = j(s.settle_ms);
      const n = s.action === "double" ? 2 : 1;
      return [a * n + 2 * sa + s.move_duration_ms, b * n + 2 * sb + s.move_duration_ms];
    }
    case "key":
      return j(s.hold_ms);
    case "text": {
      const [a, b] = j(s.per_char_ms);
      const n = [...s.value].length;
      return [a * n, b * n];
    }
    case "move":
      return [s.move_duration_ms, s.move_duration_ms];
    case "scroll":
      return [0, 0];
  }
}

export function fmtRange([lo, hi]: [number, number]): string {
  const f = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${n} ms`);
  return lo === hi ? f(lo) : `${f(lo)} to ${f(hi)}`;
}
