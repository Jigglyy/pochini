import { describe, expect, it } from "vitest";
import type { Macro } from "@/types";
import { runSummary, triggerSummary } from "./describe";

const base: Macro = {
  id: "m",
  name: "M",
  enabled: true,
  favorite: false,
  color: null,
  review: false,
  trigger: null,
  repeat: { kind: "once" },
  queue: false,
  queue_from: "first_press",
  return_to_start: false,
  stop_after_ms: null,
  steps: [],
  guard: null,
  created_at: "",
  updated_at: "",
};
const space = { vk: 0x20, scancode: 0x39, extended: false, label: "Space" };

describe("triggerSummary", () => {
  it("says there is no hotkey", () => {
    expect(triggerSummary(base)).toBe("No hotkey");
  });

  it("names the hotkey, its mode, and what else is on", () => {
    expect(
      triggerSummary({
        ...base,
        trigger: { key: space, modifiers: ["ctrl"], mode: "toggle", swallow: true },
        guard: { process: "notepad.exe", label: "" },
      }),
    ).toBe("Ctrl+Space, press to start and again to stop, blocked from other apps, only in notepad.exe");
    expect(triggerSummary({ ...base, trigger: { key: space, modifiers: [], mode: "hold_repeat", swallow: false } })).toBe(
      "Space, repeats while held",
    );
  });

  it("says when the hotkey is switched off", () => {
    expect(triggerSummary({ ...base, enabled: false, trigger: { key: space, modifiers: [], mode: "once", swallow: false } })).toBe(
      "Space (off), runs once per press",
    );
  });
});

describe("runSummary", () => {
  it("is just the repeat when nothing else is on", () => {
    expect(runSummary(base)).toBe("Runs once");
    expect(runSummary({ ...base, repeat: { kind: "count", n: 12 } })).toBe("Runs 12 times");
    expect(runSummary({ ...base, repeat: { kind: "forever" } })).toBe("Runs until stopped");
  });

  it("adds the queue, the time limit and the return to start", () => {
    expect(runSummary({ ...base, queue: true, stop_after_ms: 10 * 60_000, return_to_start: true })).toBe(
      "Runs once, queues presses, stops after 10 min, moves the mouse back",
    );
  });
});
