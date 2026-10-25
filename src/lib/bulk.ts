import type { Jitter, Modifier, Step } from "@/types";

// Editing many steps at once (the editor's "Edit selected steps"). A field
// shows the value its steps share, or "Mixed"; a change sets that one field
// on every selected step of the type and leaves the rest of each step as it
// was. Pure, so the rules are unit-tested.

export type StepType = Step["type"];
export type StepOf<T extends StepType> = Extract<Step, { type: T }>;

/** Step types in the order the editor lists them. */
export const TYPE_ORDER: readonly StepType[] = ["click", "move", "key", "text", "wait", "wait_color", "scroll"];

/** The types in a selection, in order, with how many of each. */
export function typesOf(steps: Step[]): { type: StepType; count: number }[] {
  return TYPE_ORDER.map((type) => ({ type, count: steps.filter((s) => s.type === type).length })).filter(
    (t) => t.count > 0,
  );
}

/** The value every item (step) has, compared by value; undefined when they
 *  differ (shown as "Mixed") or there are none. */
export function shared<T, V>(items: T[], get: (x: T) => V): V | undefined {
  if (items.length === 0) return undefined;
  const first = get(items[0]);
  const key = JSON.stringify(first);
  return items.every((x) => JSON.stringify(get(x)) === key) ? first : undefined;
}

/** `f` applied to every selected step of type `type`; other steps are kept
 *  as they are (the same objects). */
export function update<T extends StepType>(
  steps: Step[],
  selected: Set<string>,
  type: T,
  f: (s: StepOf<T>) => StepOf<T>,
): Step[] {
  return steps.map((s) => (s.type === type && selected.has(s.id) ? f(s as StepOf<T>) : s));
}

/** One half of a duration with randomness: the base, or the random extra. */
export function setJitterPart(j: Jitter, part: keyof Jitter, value: number): Jitter {
  return { ...j, [part]: Math.max(0, Math.round(value)) };
}

/** Whether all, some or none of these clicks hold a modifier. */
export function modifierState(steps: Step[], m: Modifier): boolean | "some" {
  const clicks = steps.filter((s): s is StepOf<"click"> => s.type === "click");
  const n = clicks.filter((s) => s.modifiers.includes(m)).length;
  return n === 0 ? false : n === clicks.length ? true : "some";
}

export function setModifier(mods: Modifier[], m: Modifier, on: boolean): Modifier[] {
  const rest = mods.filter((x) => x !== m);
  return on ? [...rest, m] : rest;
}

/** Can this step's point be shifted? Fixed screen points only: offsets
 *  follow the mouse start, the window or the step before, which move on
 *  their own. */
export const hasFixedPoint = (s: Step) =>
  ((s.type === "click" || s.type === "move") && s.anchor === "fixed") || s.type === "wait_color";

/** Move the fixed points of the selected steps by (dx, dy), for when the
 *  target window moved. Their pick record goes, as when a number is typed. */
export function shiftFixed(steps: Step[], selected: Set<string>, dx: number, dy: number): Step[] {
  return steps.map((s) => {
    if (!selected.has(s.id)) return s;
    if (s.type === "wait_color") return { ...s, x: s.x + dx, y: s.y + dy };
    if ((s.type === "click" || s.type === "move") && s.anchor === "fixed") {
      return { ...s, x: s.x + dx, y: s.y + dy, capture: null };
    }
    return s;
  });
}
