import { describe, expect, it } from "vitest";
import type { Step } from "@/types";
import type { Feel, Macro } from "@/types";
import {
  aimPhrase,
  aimPoints,
  blankStep,
  fmtAim,
  fmtRange,
  macroRange,
  shortLabel,
  stepHesitates,
  stepRange,
  summarize,
} from "./steps";

const click = (patch: Partial<Extract<Step, { type: "click" }>> = {}): Step => ({
  ...(blankStep("click") as Extract<Step, { type: "click" }>),
  hold_ms: { base: 10, jitter: 5 },
  settle_ms: { base: 3, jitter: 1 },
  ...patch,
});

describe("summarize", () => {
  it("says where a click lands and what it holds", () => {
    expect(summarize(click({ x: 10, y: 20 }))).toBe("Click at (10, 20)");
    expect(summarize(click({ x: 1, y: 2, button: "right", action: "double", coord_jitter_px: 3 }))).toBe(
      "Double-click right at (1, 2) ±3px",
    );
    const held = click({ modifiers: ["ctrl", "shift"], held_key: { vk: 0x51, scancode: 0x10, extended: false, label: "Q" } });
    expect(summarize(held)).toBe("Click at (0, 0) holding Ctrl+Shift+Q");
  });

  it("phrases offsets from the mouse start and the previous point", () => {
    expect(summarize(click({ anchor: "activation" }))).toBe("Click where the mouse started");
    expect(summarize(click({ anchor: "previous", dx: 20, dy: -5 }))).toBe(
      "Click 20 px right and 5 px up from the previous point",
    );
  });

  it("scrolls up and down, or left and right", () => {
    const scroll = (amount: number, axis: "vertical" | "horizontal"): Step => ({
      type: "scroll",
      id: "s",
      shuffle: false,
      amount,
      axis,
      at: null,
    });
    expect(summarize(scroll(3, "vertical"))).toBe("Scroll up 3");
    expect(summarize(scroll(-2, "vertical"))).toBe("Scroll down 2");
    // Regression: a horizontal scroll read "up" or "down".
    expect(summarize(scroll(4, "horizontal"))).toBe("Scroll right 4");
    expect(summarize(scroll(-1, "horizontal"))).toBe("Scroll left 1");
  });

  it("says when a click or move follows a recorded path", () => {
    // Three points, packed as the backend saves them (lib/path.ts).
    const path = "1:PDIAZB6QA1AokAM";
    expect(summarize(click({ x: 10, y: 20, modifiers: ["shift"], move_duration_ms: 300, path }))).toBe(
      "Click at (10, 20) holding Shift (recorded path)",
    );
    const move: Step = { ...(blankStep("move") as Extract<Step, { type: "move" }>), x: 10, y: 20, move_duration_ms: 300, path };
    expect(summarize(move)).toBe("Move to (10, 20) over 300 ms (recorded path)");
  });

  it("shortens long text and shows wait ranges", () => {
    const text = (value: string): Step => ({ type: "text", id: "t", shuffle: false, value, per_char_ms: { base: 1, jitter: 0 } });
    expect(summarize(text(""))).toBe("Type text");
    expect(summarize(text("a".repeat(40)))).toBe(`Type "${"a".repeat(32)}..."`);
    expect(summarize({ type: "wait", id: "w", shuffle: false, ms: { base: 50, jitter: 25 } })).toBe("Wait 50-75 ms");
  });
});

describe("recorded scrolls", () => {
  const recorded: Step = {
    type: "scroll",
    id: "s",
    shuffle: false,
    amount: -1,
    axis: "vertical",
    at: null,
    ticks: [
      { t: 0, delta: -30 },
      { t: 20, delta: -30 },
      { t: 45, delta: -120 },
    ],
  };

  it("say how far they really turned, fractions of a notch included", () => {
    expect(summarize(recorded)).toBe("Scroll down 1.5 (recorded)");
  });

  it("take as long as their turns did", () => {
    expect(stepRange(recorded)).toEqual([45, 45]);
  });
});

describe("shortLabel", () => {
  const key = (action: "press" | "down" | "up"): Step => ({
    type: "key",
    id: "k",
    shuffle: false,
    key: { vk: 0x41, scancode: 0x1e, extended: false, label: "A" },
    action,
    modifiers: ["ctrl"],
    hold_ms: { base: 25, jitter: 0 },
  });

  it("gives a click or move its point, or what it aims from", () => {
    expect(shortLabel(click({ x: 640, y: 380 }))).toBe("640, 380");
    expect(shortLabel(click({ x: 640, y: 380, action: "double" }))).toBe("2× 640, 380");
    expect(shortLabel(click({ anchor: "activation" }))).toBe("Start");
    expect(shortLabel(click({ anchor: "activation", dx: 20, dy: -5 }))).toBe("Start +20, -5");
    expect(shortLabel(click({ anchor: "previous" }))).toBe("Previous");
    expect(shortLabel(click({ anchor: "window", dx: 20, dy: 30 }))).toBe("Window 20, 30");
    expect(shortLabel({ ...(blankStep("move") as Extract<Step, { type: "move" }>), x: -5, y: 7 })).toBe("-5, 7");
  });

  it("gives a key its combo, held or released", () => {
    expect(shortLabel(key("press"))).toBe("Ctrl+A");
    expect(shortLabel(key("down"))).toBe("Hold Ctrl+A");
    expect(shortLabel(key("up"))).toBe("Release Ctrl+A");
  });

  it("keeps text, waits, scrolls and colors short", () => {
    const text = (value: string): Step => ({ type: "text", id: "t", shuffle: false, value, per_char_ms: { base: 20, jitter: 0 } });
    expect(shortLabel(text("hello world"))).toBe('"hello worl..."');
    expect(shortLabel(text("hi"))).toBe('"hi"');
    expect(shortLabel(text(""))).toBe("Text");
    expect(shortLabel({ type: "wait", id: "w", shuffle: false, ms: { base: 500, jitter: 0 } })).toBe("500 ms");
    expect(shortLabel({ type: "wait", id: "w", shuffle: false, ms: { base: 500, jitter: 200 } })).toBe("500-700 ms");
    expect(shortLabel({ type: "scroll", id: "s", shuffle: false, amount: -3, axis: "vertical", at: null })).toBe("Down 3");
    const ticks = [{ t: 0, delta: -120 }];
    expect(shortLabel({ type: "scroll", id: "s", shuffle: false, amount: -1, axis: "vertical", at: null, ticks })).toBe("Down 1");
    expect(shortLabel({ ...(blankStep("wait_color") as Extract<Step, { type: "wait_color" }>), color: "#FF0000" })).toBe(
      "#FF0000",
    );
  });
});

describe("macroRange", () => {
  it("adds a hesitation's longest pause once per press", () => {
    // Mirrors Macro::duration_range (model.rs), which has the same test.
    const steps: Step[] = [
      click({ action: "click" }),
      click({ action: "down" }),
      click({ action: "up" }),
      click({ action: "click", path: "1:AAAAKKU" }),
    ];
    expect(steps.map(stepHesitates)).toEqual([true, true, false, false]);
    const off: Feel = { bell: null, hesitate: null, curve: null };
    const [lo, hi] = macroRange({ steps, feel: off } satisfies Pick<Macro, "steps" | "feel">);
    const ms = { base: 150, jitter: 350 };
    expect(macroRange({ steps, feel: { ...off, hesitate: { chance_pct: 10, ms } } })).toEqual([lo, hi + 2 * 500]);
    expect(macroRange({ steps, feel: { ...off, hesitate: { chance_pct: 0, ms } } })).toEqual([lo, hi]);
  });
});

describe("stepRange", () => {
  it("counts three holds for a double click and none for a lone press", () => {
    // Mirrors Step::duration_range (model.rs), which has the same test.
    expect(stepRange(click({ action: "double" }))).toEqual([36, 53]);
    expect(stepRange(click({ action: "click" }))).toEqual([16, 23]);
    expect(stepRange(click({ action: "down" }))).toEqual([6, 8]);
    // A recorded click's own rest after the release replaces the second settle.
    expect(stepRange(click({ action: "click", dwell_ms: { base: 0, jitter: 0 } }))).toEqual([13, 19]);
  });

  it("waits once per UTF-16 unit of typed text", () => {
    const t: Step = { type: "text", id: "t", shuffle: false, value: "a\u{1F600}", per_char_ms: { base: 10, jitter: 2 } };
    expect(stepRange(t)).toEqual([30, 36]);
  });
});

describe("aim points", () => {
  it("follows previous-point chains from a fixed point or the mouse start", () => {
    const steps = [
      click({ anchor: "previous", dx: 5 }),
      click({ x: 100, y: 50 }),
      { type: "wait", id: "w", shuffle: false, ms: { base: 1, jitter: 0 } } as Step,
      click({ anchor: "previous", dx: -10, dy: 2 }),
      click({ anchor: "activation", dx: 1, dy: 1 }),
    ];
    expect(aimPoints(steps)).toEqual([
      { from: "start", x: 5, y: 0 },
      { from: "screen", x: 100, y: 50 },
      null,
      { from: "screen", x: 90, y: 52 },
      { from: "start", x: 1, y: 1 },
    ]);
    expect(fmtAim({ from: "screen", x: 90, y: 52 })).toBe("(90, 52)");
    expect(fmtAim({ from: "start", x: 0, y: 0 })).toBe("where the mouse started");
    expect(fmtAim({ from: "start", x: 1, y: -1 })).toBe("mouse start + (1, -1)");
  });

  it("points in the app's window chain from the window", () => {
    const steps = [click({ anchor: "window", dx: 10, dy: 5 }), click({ anchor: "previous", dx: 0, dy: 20 })];
    expect(aimPoints(steps)).toEqual([
      { from: "window", x: 10, y: 5 },
      { from: "window", x: 10, y: 25 },
    ]);
    expect(fmtAim({ from: "window", x: 10, y: 25 })).toBe("app window + (10, 25)");
    expect(summarize(steps[0])).toBe("Click at (10, 5) in the app's window");
  });

  it("phrases every direction", () => {
    expect(aimPhrase("activation", 0, 0)).toBe("where the mouse started");
    expect(aimPhrase("previous", 0, 0)).toBe("at the previous point");
    expect(aimPhrase("activation", -3, 0)).toBe("3 px left of where the mouse started");
    expect(aimPhrase("previous", 0, 4)).toBe("4 px below the previous point");
    expect(aimPhrase("previous", 0, -4)).toBe("4 px above the previous point");
  });
});

it("formats durations", () => {
  expect(fmtRange([500, 500])).toBe("500 ms");
  expect(fmtRange([900, 2500])).toBe("900 ms to 2.50 s");
});
