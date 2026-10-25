import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  defaultDropAnimationSideEffects,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DropAnimation,
} from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { createSmoothPickup, PICKUP_MS } from "@/lib/pickup";

// The Kanbini drag feel, shared by the step list and the macro list.

/** A press only becomes a drag after 6 px of movement, so the buttons,
 *  switches and click-to-open areas inside a draggable card keep working. */
export function useDragSensors() {
  return useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
}

/** The lifted copy settles into its new slot; the original stays hidden
 *  until it lands, so there is never a double. */
export const DROP_ANIMATION: DropAnimation = {
  duration: 200,
  easing: "cubic-bezier(0.22, 1, 0.36, 1)",
  sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: "0" } } }),
};

/** The listeners that start a drag, spread on a card's drag handle. */
export type DragHandle = ReturnType<typeof useSortable>["listeners"];

/** The lifted copy that follows the pointer, rendered at the top of the page.
 *  Inside the page, a CSS transform on an ancestor (each screen slides in
 *  for 200 ms) makes it the containing block of this fixed-position copy: it
 *  drew and measured one row low, so a drag started as a screen appeared
 *  dropped a slot short. A portal to <body> has no such ancestor.
 *
 *  It also eases into the grip instead of snapping (lib/pickup.ts), and
 *  wears the lift shadow itself, so the shadow travels with the drop. */
export function FloatingOverlay({ children }: { children: ReactNode }) {
  const pickup = useRef(createSmoothPickup()).current;
  const [, tick] = useState(0);
  const lifted = children !== null && children !== undefined && children !== false;
  // A new drag: re-arm the pickup and re-render every frame while it
  // catches up (the modifier only runs on render).
  useEffect(() => {
    if (!lifted) return;
    pickup.reset();
    const until = performance.now() + PICKUP_MS + 50;
    let raf = requestAnimationFrame(function frame() {
      tick((n) => n + 1);
      if (performance.now() < until) raf = requestAnimationFrame(frame);
    });
    return () => cancelAnimationFrame(raf);
  }, [lifted, pickup]);
  return createPortal(
    <DragOverlay dropAnimation={DROP_ANIMATION} modifiers={[pickup.modifier]} className="rounded-lg shadow-xl">
      {children}
    </DragOverlay>,
    document.body,
  );
}

/** One item of a sortable list. Spread `handle` on whatever should start a
 *  drag; `style` makes the item follow the sort and hides it while its
 *  DragOverlay copy is in the air. */
export function useSortableItem(id: string) {
  const s = useSortable({ id });
  return {
    ref: s.setNodeRef,
    handle: s.listeners,
    style: {
      transform: CSS.Translate.toString(s.transform),
      transition: s.transition,
      opacity: s.isDragging ? 0 : undefined,
    },
  };
}
