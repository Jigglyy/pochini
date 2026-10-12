import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";

// Motion, the Kanbini way: short (200 to 220 ms), one easing curve
// (cubic-bezier(0.22, 1, 0.36, 1), `ease-smooth` in CSS), and nothing at all
// when Windows' "Animation effects" is off (prefers-reduced-motion).

export const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const y = getComputedStyle(p).overflowY;
    if (y === "auto" || y === "scroll") return p;
  }
  return null;
}

/** Scroll just enough that `el` is in view: its bottom (plus `grow`, height it
 *  is about to gain, for something that is opening) comes into view, but its
 *  top never leaves the top; if it is taller than the view, its top is
 *  aligned instead. Something above the view comes down into it. Kanbini's
 *  scrollIntoView "nearest", made aware of an opening animation. */
export function reveal(el: HTMLElement, grow = 0): void {
  const box = scrollParent(el);
  if (!box) return;
  const view = box.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const margin = 16;
  const top = view.top + margin;
  const bottom = view.bottom - margin;
  let delta = 0;
  if (r.top < top) delta = r.top - top;
  else if (r.bottom + grow > bottom) delta = Math.min(r.bottom + grow - bottom, r.top - top);
  if (Math.abs(delta) < 1) return;
  box.scrollBy({ top: delta, behavior: reduced() ? "auto" : "smooth" });
}

/** For a menu's onCloseAutoFocus: give focus back to `ref`'s element without
 *  scrolling to it. Radix's own focus return scrolls the menu's button into
 *  view, which undid the scroll to a row the menu had just added (Duplicate). */
export const refocusWithoutScroll = (ref: RefObject<HTMLElement | null>) => (e: Event) => {
  e.preventDefault();
  ref.current?.focus({ preventScroll: true });
};

/** Smooth reordering for a list (FLIP: measure First, apply the change, Last,
 *  Invert, Play). Items carry `data-flip="<key>"` anywhere inside `ref`. Call
 *  `prepare()` right before a state change that moves items: on the next
 *  render, items that moved glide from where they were, new ones fade in.
 *  The first new item, or the item named by `prepare(key)` (the one being
 *  moved), is scrolled into view, so nothing ends up off-screen.
 *
 *  Not the browser's View Transitions: while one runs, Chromium sends every
 *  click to the page root, so fast repeated clicks (Move down, Move down)
 *  were swallowed. FLIP animates with transforms and never blocks input.
 *  Drag-and-drop drops do not call prepare(): dnd-kit animates those. */
export function useFlip<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const before = useRef<Map<string, DOMRect> | null>(null);
  const focus = useRef<string | undefined>(undefined);

  const prepare = useCallback((key?: string) => {
    const root = ref.current;
    if (!root) return;
    focus.current = key;
    if (reduced()) {
      // No animation, but still keep the moved or new item in view.
      before.current = new Map(
        [...root.querySelectorAll<HTMLElement>("[data-flip]")].map((el) => [el.dataset.flip!, el.getBoundingClientRect()]),
      );
      return;
    }
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
    const items = [...root.querySelectorAll<HTMLElement>("[data-flip]")];
    // Before any transform starts, so it measures where things end up.
    const target =
      items.find((el) => focus.current !== undefined && el.dataset.flip === focus.current) ??
      items.find((el) => !old.has(el.dataset.flip!));
    if (target) reveal(target);
    if (reduced()) return;
    items.forEach((el) => {
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
