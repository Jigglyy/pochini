import { useCallback, useLayoutEffect, useRef } from "react";

// Motion, the Kanbini way: short (200 to 220 ms), one easing curve
// (cubic-bezier(0.22, 1, 0.36, 1), `ease-smooth` in CSS), and nothing at all
// when Windows' "Animation effects" is off (prefers-reduced-motion).

export const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Smooth reordering for a list (FLIP: measure First, apply the change, Last,
 *  Invert, Play). Items carry `data-flip="<key>"` anywhere inside `ref`. Call
 *  `prepare()` right before a state change that moves items: on the next
 *  render, items that moved glide from where they were, new ones fade in.
 *
 *  Not the browser's View Transitions: while one runs, Chromium sends every
 *  click to the page root, so fast repeated clicks (Move down, Move down)
 *  were swallowed. FLIP animates with transforms and never blocks input.
 *  Drag-and-drop drops do not call prepare(): dnd-kit animates those. */
export function useFlip<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const before = useRef<Map<string, DOMRect> | null>(null);

  const prepare = useCallback(() => {
    const root = ref.current;
    if (!root || reduced()) return;
    const rects = new Map<string, DOMRect>();
    root.querySelectorAll<HTMLElement>("[data-flip]").forEach((el) => {
      rects.set(el.dataset.flip!, el.getBoundingClientRect());
    });
    before.current = rects;
  }, []);

  // After every render; only acts when prepare() ran before it.
  useLayoutEffect(() => {
    const old = before.current;
    const root = ref.current;
    if (!old || !root) return;
    before.current = null;
    root.querySelectorAll<HTMLElement>("[data-flip]").forEach((el) => {
      const was = old.get(el.dataset.flip!);
      if (!was) {
        el.animate([{ opacity: 0, transform: "scale(0.98)" }, { opacity: 1, transform: "none" }], {
          duration: 200,
          easing: EASE,
        });
        return;
      }
      const now = el.getBoundingClientRect();
      const dx = was.left - now.left;
      const dy = was.top - now.top;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], {
          duration: 220,
          easing: EASE,
        });
      }
    });
  });

  return { ref, prepare };
}
