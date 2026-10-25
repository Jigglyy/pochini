import { expect, it } from "vitest";
import { createSmoothPickup, pickupEase } from "./pickup";

const t = (x: number, y: number) => ({ x, y, scaleX: 1, scaleY: 1 });

it("eases from the source to the cursor, then tracks it", () => {
  let clock = 1000;
  const p = createSmoothPickup(180, () => clock);
  expect(p.modifier({ transform: t(0, 0) })).toEqual(t(0, 0)); // clock not started
  expect(p.modifier({ transform: t(40, 0) })).toEqual(t(0, 0)); // starts at the source
  clock += 90;
  const mid = p.modifier({ transform: t(40, 20) });
  expect(mid.x).toBeCloseTo(40 * pickupEase(0.5));
  expect(mid.y).toBeCloseTo(20 * pickupEase(0.5));
  clock += 200;
  expect(p.modifier({ transform: t(50, -5) })).toEqual(t(50, -5));
});

it("reset re-arms it for the next drag", () => {
  let clock = 0;
  const p = createSmoothPickup(100, () => clock);
  p.modifier({ transform: t(10, 0) });
  clock = 500;
  expect(p.modifier({ transform: t(10, 0) }).x).toBe(10);
  p.reset();
  expect(p.modifier({ transform: t(10, 0) }).x).toBe(0);
});

it("never overshoots", () => {
  for (const x of [-1, 0, 0.3, 0.99, 1, 2]) expect(pickupEase(x)).toBeLessThanOrEqual(1);
  expect(pickupEase(0)).toBe(0);
});
