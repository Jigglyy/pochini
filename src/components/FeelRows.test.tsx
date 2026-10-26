import { expect, it, vi } from "vitest";
import type { Feel } from "@/types";
import { click, input, render, text, type } from "@/test/render";
import { FeelRows } from "./FeelRows";

const OFF: Feel = { bell: null, hesitate: null, curve: null };
const ON: Feel = {
  bell: { tightness: "tight", peak: "early" },
  hesitate: { chance_pct: 25, ms: { base: 100, jitter: 0 } },
  curve: { bend_pct: 15, overshoot_pct: 20 },
};

/** The switch a row's title labels. */
function toggle(title: string): HTMLElement {
  const label = [...document.querySelectorAll("label")].find((l) => l.textContent === title);
  const el = label && document.getElementById(label.htmlFor);
  if (!el) throw new Error(`no switch "${title}"`);
  return el;
}

it("each switch turns its option on with its starting settings", () => {
  const onChange = vi.fn();
  render(<FeelRows feel={OFF} onChange={onChange} />);
  click(toggle("Bell-curve randomness"));
  expect(onChange).toHaveBeenLastCalledWith({ ...OFF, bell: { tightness: "medium", peak: "middle" } }, undefined);
  click(toggle("Hesitate now and then"));
  expect(onChange).toHaveBeenLastCalledWith({ ...OFF, hesitate: { chance_pct: 10, ms: { base: 150, jitter: 350 } } }, undefined);
  click(toggle("Curved mouse paths"));
  expect(onChange).toHaveBeenLastCalledWith({ ...OFF, curve: { bend_pct: 10, overshoot_pct: 0 } }, undefined);
});

it("and off again, leaving the others alone", () => {
  const onChange = vi.fn();
  render(<FeelRows feel={ON} onChange={onChange} />);
  click(toggle("Bell-curve randomness"));
  expect(onChange).toHaveBeenLastCalledWith({ ...ON, bell: null }, undefined);
  click(toggle("Hesitate now and then"));
  expect(onChange).toHaveBeenLastCalledWith({ ...ON, hesitate: null }, undefined);
  click(toggle("Curved mouse paths"));
  expect(onChange).toHaveBeenLastCalledWith({ ...ON, curve: null }, undefined);
});

it("keeps every number in its range, each typed as one undo step", () => {
  const onChange = vi.fn();
  render(<FeelRows feel={ON} onChange={onChange} />);
  const last = () => onChange.mock.lastCall as [Feel, string];
  type(input("Hesitation chance"), "0");
  expect(last()).toEqual([{ ...ON, hesitate: { ...ON.hesitate!, chance_pct: 1 } }, "hesitate_chance"]);
  type(input("Hesitation chance"), "500");
  expect(last()[0].hesitate!.chance_pct).toBe(100);
  type(input("Extra wait"), "200");
  expect(last()).toEqual([{ ...ON, hesitate: { ...ON.hesitate!, ms: { base: 200, jitter: 0 } } }, "hesitate_ms"]);
  type(input("Curve bend"), "99");
  expect(last()).toEqual([{ ...ON, curve: { ...ON.curve!, bend_pct: 30 } }, "curve_bend"]);
  type(input("Overshoot chance"), "0");
  expect(last()).toEqual([{ ...ON, curve: { ...ON.curve!, overshoot_pct: 0 } }, "curve_overshoot"]);
  type(input("Overshoot chance"), "150");
  expect(last()[0].curve!.overshoot_pct).toBe(100);
});

it("says how often and how long clicks hesitate", () => {
  const { rerender } = render(<FeelRows feel={ON} onChange={() => {}} />);
  expect(text()).toContain("25% of clicks wait 100 ms longer.");
  rerender(<FeelRows feel={{ ...ON, hesitate: { chance_pct: 5, ms: { base: 100, jitter: 50 } } }} onChange={() => {}} />);
  expect(text()).toContain("5% of clicks wait 100 to 150 ms longer.");
  rerender(<FeelRows feel={OFF} onChange={() => {}} />);
  expect(text()).not.toContain("of clicks wait");
});
