import {
  defaultDropAnimationSideEffects,
  PointerSensor,
  useSensor,
  useSensors,
  type DropAnimation,
} from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

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
