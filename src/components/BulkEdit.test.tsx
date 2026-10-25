import { expect, it, vi } from "vitest";
import type { Step } from "@/types";
import { blankStep } from "@/lib/steps";
import { input, render, text, type } from "@/test/render";
import { BulkEdit } from "./BulkEdit";

type Click = Extract<Step, { type: "click" }>;
const click = (id: string, coord_jitter_px: number, shuffle = false): Step => ({
  ...(blankStep("click") as Click),
  id,
  coord_jitter_px,
  shuffle,
});
const wait: Step = { type: "wait", id: "w", shuffle: false, ms: { base: 100, jitter: 0 } };

// Two clicks that differ, a wait, and a click that is not selected.
const steps = [click("a", 2, true), click("b", 5), wait, click("off", 9)];
const selected = new Set(["a", "b", "w"]);

it("groups the selected steps by type and says Mixed where they differ", () => {
  render(<BulkEdit steps={steps} selected={selected} onChange={() => {}} />);
  expect(text()).toContain("Clicks2");
  expect(text()).toContain("Waits1");
  expect(input("Jitter").value).toBe("");
  expect(input("Jitter").placeholder).toBe("Mixed");
  // Both clicks keep the default hold, so that one is shared.
  expect(input("Hold").value).toBe("25");
  // Some of the selected steps shuffle.
  expect(document.querySelector('[aria-label="Shuffle"]')?.getAttribute("data-state")).toBe("indeterminate");
});

it("sets one field on every selected step of the type, and nothing else", () => {
  const onChange = vi.fn();
  render(<BulkEdit steps={steps} selected={selected} onChange={onChange} />);
  type(input("Jitter"), "3");
  const [next, key] = onChange.mock.calls[0] as [Step[], string];
  expect(next.map((s) => (s.type === "click" ? s.coord_jitter_px : null))).toEqual([3, 3, null, 9]);
  expect(next[0]).toMatchObject({ shuffle: true, hold_ms: { base: 25, jitter: 15 } });
  expect(key).toBe("bulk:click:jitter");
});

it("adds randomness to every wait without changing their lengths", () => {
  const onChange = vi.fn();
  render(<BulkEdit steps={steps} selected={selected} onChange={onChange} />);
  type(input("Wait random extra"), "50");
  const [next] = onChange.mock.calls[0] as [Step[]];
  expect(next[2]).toMatchObject({ type: "wait", ms: { base: 100, jitter: 50 } });
});

it("changes nothing when a Mixed box is cleared", () => {
  const onChange = vi.fn();
  render(<BulkEdit steps={steps} selected={selected} onChange={onChange} />);
  type(input("Jitter"), "");
  expect(onChange).not.toHaveBeenCalled();
});
