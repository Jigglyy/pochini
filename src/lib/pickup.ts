// The smooth pickup, from Kanbini (lib/drag-polish.ts). A drag only starts
// after 6 px of movement, so by then the pointer has travelled: without
// this, the lifted copy appears at the source plus that distance and snaps
// to the cursor (worse the faster you grab). Instead it eases from the
// source up to the cursor over PICKUP_MS, then tracks it 1:1.

export const PICKUP_MS = 180;

/** Ease-out cubic: leaves the source quickly, settles into the grip. */
export const pickupEase = (t: number) => 1 - (1 - Math.min(Math.max(t, 0), 1)) ** 3;

type Transform = { x: number; y: number; scaleX: number; scaleY: number };

/** A DragOverlay modifier that scales the live transform by the catch-up
 *  progress, and `reset` to re-arm it for the next drag. Always along the
 *  current drag direction, so it never pulls the copy backwards. The host
 *  must re-render during the catch-up (FloatingOverlay ticks a frame loop).
 *  A {0, 0} first frame does not start the clock. */
export function createSmoothPickup(ms = PICKUP_MS, now: () => number = () => performance.now()) {
  let start: number | null = null;
  return {
    modifier: ({ transform }: { transform: Transform }): Transform => {
      if (start === null) {
        if (transform.x === 0 && transform.y === 0) return transform;
        start = now();
      }
      const p = ms <= 0 ? 1 : pickupEase((now() - start) / ms);
      return { ...transform, x: transform.x * p, y: transform.y * p };
    },
    reset: () => {
      start = null;
    },
  };
}
