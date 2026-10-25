import { useSyncExternalStore, type CSSProperties } from "react";
import type { Step } from "@/types";
import { readPrefs, writePrefs } from "./prefs";
import type { NewStepKind } from "./steps";

// Step colour coding. Each kind of step has a colour; the user can change it
// (right-click a step, or Settings > Step colors) and reset it to the
// default. Renderer-only, stored in localStorage "pochini.settings" as the
// kinds that differ from the default, so a re-tuned default still reaches
// everyone who never changed that kind.

/** Kanbini's accent palette (packages/shared/src/palette.ts): a categorical
 *  rainbow tuned to read on the dark surface. Stored by name, so re-tuning a
 *  value never needs a migration. */
export const ACCENTS = [
  { name: "red", value: "oklch(0.63 0.19 25)" },
  { name: "orange", value: "oklch(0.72 0.19 48)" },
  { name: "amber", value: "oklch(0.76 0.14 85)" },
  { name: "yellow", value: "oklch(0.84 0.15 105)" },
  { name: "lime", value: "oklch(0.74 0.17 140)" },
  { name: "green", value: "oklch(0.64 0.15 160)" },
  { name: "teal", value: "oklch(0.68 0.10 195)" },
  { name: "cyan", value: "oklch(0.74 0.12 210)" },
  { name: "sky", value: "oklch(0.69 0.13 230)" },
  { name: "blue", value: "oklch(0.60 0.16 262)" },
  { name: "indigo", value: "oklch(0.56 0.17 292)" },
  { name: "purple", value: "oklch(0.62 0.18 322)" },
  { name: "pink", value: "oklch(0.67 0.20 352)" },
  { name: "rose", value: "oklch(0.66 0.19 8)" },
] as const;

export type AccentName = (typeof ACCENTS)[number]["name"];
/** An accent, or "none" for the plain uncoloured look. */
export type StepColor = AccentName | "none";

export const COLOR_CHOICES: readonly StepColor[] = [...ACCENTS.map((a) => a.name), "none"];

/** The colour categories: one per step type, with "Click at mouse" apart
 *  from a fixed-position Click, matching the editor's Add buttons. */
export type ColorKind = NewStepKind;

export const KINDS: readonly ColorKind[] = ["click", "click_here", "move", "key", "text", "wait", "wait_color", "scroll"];

export const KIND_LABELS: Record<ColorKind, string> = {
  click: "Click",
  click_here: "Click at mouse",
  move: "Move",
  key: "Key",
  text: "Type text",
  wait: "Wait",
  wait_color: "Wait for color",
  scroll: "Scroll",
};

export const DEFAULT_COLORS: Record<ColorKind, StepColor> = {
  click: "blue",
  click_here: "purple",
  move: "teal",
  key: "orange",
  text: "amber",
  wait: "green",
  wait_color: "lime",
  scroll: "pink",
};

/** A click aimed relative to the mouse (start or previous point) counts as
 *  "Click at mouse". */
export function colorKind(s: Step): ColorKind {
  return s.type === "click" && (s.anchor === "activation" || s.anchor === "previous") ? "click_here" : s.type;
}

/** A stored color (a macro's, say), as one of ours: unknown or missing is "none". */
export const asColor = (c: string | null | undefined): StepColor =>
  c && COLOR_CHOICES.includes(c as StepColor) ? (c as StepColor) : "none";

export function accentValue(c: StepColor): string | null {
  return ACCENTS.find((a) => a.name === c)?.value ?? null;
}

export type Tone = {
  /** The accent itself: the card's left edge, the swatch. */
  bar: string;
  /** Icon chip background, tinted toward the card so it reads in both themes. */
  chip: string;
  /** Icon colour, pulled toward the foreground (lighter in dark, darker in light). */
  icon: string;
  /** A faint wash of the accent over a card (a colored macro row). */
  wash: string;
};

export function tone(c: StepColor): Tone | null {
  const v = accentValue(c);
  if (!v) return null;
  return {
    bar: v,
    chip: `color-mix(in oklab, ${v} 24%, var(--card))`,
    icon: `color-mix(in oklab, ${v} 80%, var(--foreground))`,
    wash: `color-mix(in oklab, ${v} 9%, var(--card))`,
  };
}

/** Border colours for a coloured card, Kanbini style: the whole outline in
 *  the accent (with the card's thicker left edge), not just the edge. With
 *  `outline` false only the left edge is coloured. Longhands only, so React
 *  never mixes border-color with border-left-color. */
export function outlineStyle(t: Tone | null, outline = true): CSSProperties {
  if (!t) return {};
  const side = outline ? t.bar : undefined;
  return { borderTopColor: side, borderRightColor: side, borderBottomColor: side, borderLeftColor: t.bar };
}

export type StepColors = Record<ColorKind, StepColor>;

const isColor = (v: unknown): v is StepColor => typeof v === "string" && COLOR_CHOICES.includes(v as StepColor);

function load(): StepColors {
  const saved = readPrefs().stepColors ?? {};
  const out = { ...DEFAULT_COLORS };
  for (const k of KINDS) {
    const v = saved[k];
    if (isColor(v)) out[k] = v;
  }
  return out;
}

let current: StepColors = load();
const listeners = new Set<() => void>();

function commit(next: StepColors): void {
  current = next;
  const changed: Record<string, string> = {};
  for (const k of KINDS) if (next[k] !== DEFAULT_COLORS[k]) changed[k] = next[k];
  writePrefs({ stepColors: changed });
  listeners.forEach((l) => l());
}

export const setStepColor = (k: ColorKind, c: StepColor) => commit({ ...current, [k]: c });
export const resetStepColor = (k: ColorKind) => commit({ ...current, [k]: DEFAULT_COLORS[k] });
export const resetStepColors = () => commit({ ...DEFAULT_COLORS });

/** The current colours; every user re-renders when one changes. */
export function useStepColors(): StepColors {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
