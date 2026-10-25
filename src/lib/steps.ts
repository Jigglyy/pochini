import type { Anchor, Jitter, Modifier, Step } from "../types";

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
        shuffle: false,
        x: 0,
        y: 0,
        button: "left",
        action: "click",
        anchor: kind === "click_here" ? "activation" : "fixed",
        dx: 0,
        dy: 0,
        coord_jitter_px: 0,
        hold_ms: hold(),
        settle_ms: settle(),
        move_duration_ms: 0,
        modifiers: [],
        held_key: null,
        capture: null,
      };
    case "move":
      return {
        type: "move",
        id,
        shuffle: false,
        x: 0,
        y: 0,
        anchor: "fixed",
        dx: 0,
        dy: 0,
        coord_jitter_px: 0,
        move_duration_ms: 0,
        capture: null,
      };
    case "scroll":
      return { type: "scroll", id, shuffle: false, amount: -3, axis: "vertical", at: null };
    case "key":
      return {
        type: "key",
        id,
        shuffle: false,
        key: { vk: 0x41, scancode: 0x1e, extended: false, label: "A" },
        action: "press",
        modifiers: [],
        hold_ms: hold(),
      };
    case "text":
      return { type: "text", id, shuffle: false, value: "", per_char_ms: { base: 20, jitter: 15 } };
    case "wait":
      return { type: "wait", id, shuffle: false, ms: { base: 500, jitter: 0 } };
    case "wait_color":
      return {
        type: "wait_color",
        id,
        shuffle: false,
        x: 0,
        y: 0,
        color: "#ffffff",
        tolerance: 16,
        timeout_ms: 5000,
        on_timeout: "stop",
      };
  }
}

const ms = (j: Jitter) => (j.jitter > 0 ? `${j.base}-${j.base + j.jitter} ms` : `${j.base} ms`);

export const modLabel = (m: Modifier) => m[0].toUpperCase() + m.slice(1);

/** "where the mouse started", "20 px right of the previous point",
 *  "20 px right and 5 px up from where the mouse started". */
export function aimPhrase(anchor: Anchor, dx: number, dy: number): string {
  if (anchor === "window") return `at (${dx}, ${dy}) in the app's window`;
  const place = anchor === "previous" ? "the previous point" : "where the mouse started";
  if (dx === 0 && dy === 0) return anchor === "previous" ? `at ${place}` : place;
  if (dy === 0) return dx > 0 ? `${dx} px right of ${place}` : `${-dx} px left of ${place}`;
  if (dx === 0) return dy > 0 ? `${dy} px below ${place}` : `${-dy} px above ${place}`;
  const h = dx > 0 ? `${dx} px right` : `${-dx} px left`;
  const v = dy > 0 ? `${dy} px down` : `${-dy} px up`;
  return `${h} and ${v} from ${place}`;
}

/** Where a click or move step aims on the first pass: a fixed screen point,
 *  or an offset from where the mouse started. Mirrors Engine::resolve_point
 *  (before jitter). */
export type Aim = { from: "screen" | "start" | "window"; x: number; y: number };

/** The aim of every step (null for steps without a point), following
 *  "previous point" chains. Later passes of a repeat can differ: a chain that
 *  begins with "previous" carries on from where the last pass ended. */
export function aimPoints(steps: Step[]): (Aim | null)[] {
  let prev: Aim = { from: "start", x: 0, y: 0 };
  return steps.map((s) => {
    if (s.type !== "click" && s.type !== "move") return null;
    const aim: Aim =
      s.anchor === "fixed"
        ? { from: "screen", x: s.x, y: s.y }
        : s.anchor === "activation"
          ? { from: "start", x: s.dx, y: s.dy }
          : s.anchor === "window"
            ? { from: "window", x: s.dx, y: s.dy }
            : { from: prev.from, x: prev.x + s.dx, y: prev.y + s.dy };
    prev = aim;
    return aim;
  });
}

export function fmtAim(a: Aim): string {
  if (a.from === "screen") return `(${a.x}, ${a.y})`;
  if (a.from === "window") return `app window + (${a.x}, ${a.y})`;
  return a.x === 0 && a.y === 0 ? "where the mouse started" : `mouse start + (${a.x}, ${a.y})`;
}

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
      const where = s.anchor === "fixed" ? `at (${s.x}, ${s.y})` : aimPhrase(s.anchor, s.dx, s.dy);
      const jit = s.coord_jitter_px ? ` ±${s.coord_jitter_px}px` : "";
      const keys = [...s.modifiers.map(modLabel), ...(s.held_key ? [s.held_key.label] : [])];
      return `${verb}${btn} ${where}${jit}${keys.length ? ` holding ${keys.join("+")}` : ""}`;
    }
    case "move": {
      const where =
        s.anchor === "fixed" ? `(${s.x}, ${s.y})` : aimPhrase(s.anchor, s.dx, s.dy).replace(/^at /, "");
      return `Move to ${where}${s.move_duration_ms ? ` over ${s.move_duration_ms} ms` : ""}`;
    }
    case "scroll": {
      const way = s.axis === "horizontal" ? (s.amount > 0 ? "right" : "left") : s.amount > 0 ? "up" : "down";
      return `Scroll ${way} ${Math.abs(s.amount)}`;
    }
    case "key": {
      const combo = [...s.modifiers.map(modLabel), s.key.label].join("+");
      const verb = s.action === "down" ? "Hold" : s.action === "up" ? "Release" : "Press";
      return `${verb} ${combo}`;
    }
    case "text":
      return s.value ? `Type "${s.value.length > 32 ? s.value.slice(0, 32) + "..." : s.value}"` : "Type text";
    case "wait":
      return `Wait ${ms(s.ms)}`;
    case "wait_color":
      return `Wait until (${s.x}, ${s.y}) is ${s.color} (up to ${fmtRange([s.timeout_ms, s.timeout_ms])})`;
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
      // A double click holds, waits a hold's length, and holds again.
      const n = s.action === "double" ? 3 : s.action === "click" ? 1 : 0;
      return [a * n + 2 * sa + s.move_duration_ms, b * n + 2 * sb + s.move_duration_ms];
    }
    case "key":
      return j(s.hold_ms);
    case "text": {
      const [a, b] = j(s.per_char_ms);
      // One wait per UTF-16 unit, as the engine types them.
      const n = s.value.length;
      return [a * n, b * n];
    }
    case "move":
      return [s.move_duration_ms, s.move_duration_ms];
    case "scroll":
      return [0, 0];
    case "wait_color":
      return [0, s.timeout_ms];
  }
}

export function fmtRange([lo, hi]: [number, number]): string {
  const f = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${n} ms`);
  return lo === hi ? f(lo) : `${f(lo)} to ${f(hi)}`;
}
