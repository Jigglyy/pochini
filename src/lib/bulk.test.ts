import { describe, expect, it } from "vitest";
import type { Step } from "@/types";
import { blankStep } from "./steps";
import { modifierState, setJitterPart, setModifier, shared, shiftFixed, typesOf, update } from "./bulk";

type Click = Extract<Step, { type: "click" }>;
const click = (id: string, patch: Partial<Click> = {}): Click => ({ ...(blankStep("click") as Click), id, ...patch });
const wait = (id: string, base: number, jitter = 0): Step => ({ ...blankStep("wait"), id, ms: { base, jitter } }) as Step;

describe("typesOf", () => {
  it("lists the step types in a selection, in order, with counts", () => {
    expect(typesOf([wait("w", 1), click("a"), click("b")])).toEqual([
      { type: "click", count: 2 },
      { type: "wait", count: 1 },
    ]);
  });
});

describe("shared", () => {
  it("is the value every step has", () => {
    expect(shared([click("a", { coord_jitter_px: 3 }), click("b", { coord_jitter_px: 3 })], (s) => (s as Click).coord_jitter_px)).toBe(3);
  });

  it("is undefined when they differ, or there are none", () => {
    expect(shared([click("a", { coord_jitter_px: 3 }), click("b")], (s) => (s as Click).coord_jitter_px)).toBeUndefined();
    expect(shared([], () => 1)).toBeUndefined();
  });

  it("compares objects by value", () => {
    expect(shared([wait("a", 100, 20), wait("b", 100, 20)], (s) => (s.type === "wait" ? s.ms : null))).toEqual({
      base: 100,
      jitter: 20,
    });
  });
});

describe("update", () => {
  it("changes only the selected steps of that type", () => {
    const steps = [click("a"), click("b"), wait("w", 5)];
    const out = update(steps, new Set(["a", "w"]), "click", (s) => ({ ...s, coord_jitter_px: 4 }));
    expect(out.map((s) => (s.type === "click" ? s.coord_jitter_px : null))).toEqual([4, 0, null]);
    expect(out[2]).toBe(steps[2]);
  });
});

describe("setJitterPart", () => {
  it("sets the base everywhere and keeps each random extra", () => {
    expect(setJitterPart({ base: 100, jitter: 30 }, "base", 250)).toEqual({ base: 250, jitter: 30 });
  });

  it("sets the random extra everywhere and keeps each base", () => {
    expect(setJitterPart({ base: 100, jitter: 0 }, "jitter", 50)).toEqual({ base: 100, jitter: 50 });
  });

  it("never goes below zero", () => {
    expect(setJitterPart({ base: 100, jitter: 0 }, "base", -5)).toEqual({ base: 0, jitter: 0 });
  });
});

describe("modifiers", () => {
  const steps = [click("a", { modifiers: ["shift"] }), click("b", { modifiers: ["shift", "ctrl"] }), click("c")];

  it("says whether all, some or none of the clicks hold a key", () => {
    expect(modifierState(steps.slice(0, 2), "shift")).toBe(true);
    expect(modifierState(steps, "shift")).toBe("some");
    expect(modifierState(steps, "alt")).toBe(false);
  });

  it("adds or removes a key without doubling it", () => {
    expect(setModifier(["shift"], "shift", true)).toEqual(["shift"]);
    expect(setModifier([], "ctrl", true)).toEqual(["ctrl"]);
    expect(setModifier(["shift", "ctrl"], "shift", false)).toEqual(["ctrl"]);
  });
});

describe("shiftFixed", () => {
  it("moves fixed points by the offset and forgets where they were picked", () => {
    const capture = { monitor: "M", monitor_rect: [0, 0, 10, 10] as [number, number, number, number], dpi: 96 };
    const color: Step = { ...blankStep("wait_color"), id: "wc", x: 5, y: 5 } as Step;
    const out = shiftFixed([click("a", { x: 100, y: 200, capture }), color], new Set(["a", "wc"]), 10, -20);
    expect(out[0]).toMatchObject({ x: 110, y: 180, capture: null });
    expect(out[1]).toMatchObject({ x: 15, y: -15 });
  });

  it("leaves offset steps alone: they follow the mouse, the window or the step before", () => {
    const rel = click("r", { anchor: "previous", dx: 5, dy: 5 });
    const [out] = shiftFixed([rel], new Set(["r"]), 10, 10);
    expect(out).toBe(rel);
  });

  it("leaves unselected steps alone", () => {
    const a = click("a", { x: 1, y: 1 });
    expect(shiftFixed([a], new Set(), 10, 10)[0]).toBe(a);
  });
});
