import { expect, it } from "vitest";
import type { Macro, Step } from "@/types";
import { macroConcerns, stepConcern } from "./review";
import { blankStep } from "./steps";

const key = (modifiers: ("ctrl" | "alt" | "shift" | "win")[]): Step => ({
  ...(blankStep("key") as Extract<Step, { type: "key" }>),
  modifiers,
});

it("flags steps that type text or press Ctrl, Alt or Win shortcuts", () => {
  expect(stepConcern({ type: "text", id: "t", shuffle: false, value: "rm -rf", per_char_ms: { base: 1, jitter: 0 } })).toMatch(
    /Types into/,
  );
  expect(stepConcern({ type: "text", id: "t", shuffle: false, value: "", per_char_ms: { base: 1, jitter: 0 } })).toBeNull();
  expect(stepConcern(key(["win"]))).toMatch(/shortcut/);
  expect(stepConcern(key(["alt"]))).toMatch(/shortcut/);
  expect(stepConcern(key(["shift"]))).toBeNull();
  expect(stepConcern(blankStep("click"))).toBeNull();
});

it("notes macros that run until stopped, repeat a lot, or hide their key", () => {
  const base = { repeat: { kind: "once" }, trigger: null } as unknown as Macro;
  expect(macroConcerns(base)).toEqual([]);
  expect(macroConcerns({ ...base, repeat: { kind: "forever" } })[0]).toMatch(/until you stop it/);
  expect(macroConcerns({ ...base, repeat: { kind: "count", n: 500 } })[0]).toMatch(/500 times/);
  expect(macroConcerns({ ...base, repeat: { kind: "count", n: 5 } })).toEqual([]);
  const trigger = { key: { vk: 0x20, scancode: 0x39, extended: false, label: "Space" }, modifiers: [], mode: "once", swallow: true };
  expect(macroConcerns({ ...base, trigger } as Macro)[0]).toMatch(/never see its hotkey \(Space\)/);
});
