import type { Step } from "@/types";
import { colorKind, KINDS, type ColorKind } from "./colors";

// Selecting several steps at once in the editor: by hand, by kind ("every
// click"), or a range with Shift. Pure, so the rules are unit-tested; the
// editor holds the Set of selected step ids.

/** The kinds a macro has, in the Add buttons' order, with how many of each. */
export function kindCounts(steps: Step[]): { kind: ColorKind; count: number }[] {
  return KINDS.map((kind) => ({ kind, count: steps.filter((s) => colorKind(s) === kind).length })).filter(
    (k) => k.count > 0,
  );
}

const ofKind = (steps: Step[], kind: ColorKind) => steps.filter((s) => colorKind(s) === kind).map((s) => s.id);

/** All, some or none of a kind is selected. */
export function kindState(steps: Step[], selected: Set<string>, kind: ColorKind): boolean | "some" {
  const mine = ofKind(steps, kind);
  const n = mine.filter((id) => selected.has(id)).length;
  return n === 0 ? false : n === mine.length ? true : "some";
}

/** Select every step of a kind, or, when they all are already, none of them. */
export function toggleKind(steps: Step[], selected: Set<string>, kind: ColorKind): Set<string> {
  const mine = ofKind(steps, kind);
  const next = new Set(selected);
  const all = kindState(steps, selected, kind) === true;
  for (const id of mine) {
    if (all) next.delete(id);
    else next.add(id);
  }
  return next;
}

/** The select-all box. */
export function allState(steps: Step[], selected: Set<string>): boolean | "indeterminate" {
  const n = steps.filter((s) => selected.has(s.id)).length;
  return n === 0 ? false : n === steps.length ? true : "indeterminate";
}

/** Shift+click: every step from `anchor` to `target`, both included, turned
 *  on or off. Without the anchor (deleted since), just the target. */
export function selectRange(steps: Step[], selected: Set<string>, anchor: string, target: string, on: boolean): Set<string> {
  const t = steps.findIndex((s) => s.id === target);
  const found = steps.findIndex((s) => s.id === anchor);
  const a = found < 0 ? t : found;
  const next = new Set(selected);
  for (const s of steps.slice(Math.min(a, t), Math.max(a, t) + 1)) {
    if (on) next.add(s.id);
    else next.delete(s.id);
  }
  return next;
}

/** Forget selected steps that are gone (deleted, undone). The same Set when
 *  nothing changed. */
export function prune(steps: Step[], selected: Set<string>): Set<string> {
  const live = new Set(steps.map((s) => s.id));
  if ([...selected].every((id) => live.has(id))) return selected;
  return new Set([...selected].filter((id) => live.has(id)));
}

/** Copies of the selected steps, in order, right after the last of them. */
export function duplicateSelected(
  steps: Step[],
  selected: Set<string>,
  newId: () => string,
): { steps: Step[]; copies: string[] } {
  const picked = steps.filter((s) => selected.has(s.id));
  const copies = picked.map((s) => ({ ...s, id: newId() }) as Step);
  const last = steps.reduce((at, s, i) => (selected.has(s.id) ? i : at), -1);
  if (last < 0) return { steps, copies: [] };
  return { steps: [...steps.slice(0, last + 1), ...copies, ...steps.slice(last + 1)], copies: copies.map((s) => s.id) };
}

export const removeSelected = (steps: Step[], selected: Set<string>) => steps.filter((s) => !selected.has(s.id));
