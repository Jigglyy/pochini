import type { Macro, TriggerMode } from "@/types";
import { modLabel } from "./steps";

// One-line summaries of a macro's settings, for the editor's folded
// "Trigger" and "When it runs" sections: what you would see if you opened
// them, in words.

const MODES: Record<TriggerMode, string> = {
  once: "runs once per press",
  hold_repeat: "repeats while held",
  toggle: "press to start and again to stop",
};

export function triggerSummary(m: Pick<Macro, "trigger" | "enabled" | "guard">): string {
  const t = m.trigger;
  if (!t) return "No hotkey";
  const combo = [...t.modifiers.map(modLabel), t.key.label].join("+");
  return [
    `${combo}${m.enabled ? "" : " (off)"}`,
    MODES[t.mode],
    t.swallow && "blocked from other apps",
    m.guard?.process && `only in ${m.guard.process}`,
  ]
    .filter(Boolean)
    .join(", ");
}

export function runSummary(m: Pick<Macro, "repeat" | "queue" | "stop_after_ms" | "return_to_start" | "feel">): string {
  const r = m.repeat;
  return [
    r.kind === "once" ? "Runs once" : r.kind === "count" ? `Runs ${r.n} times` : "Runs until stopped",
    m.queue && "queues presses",
    m.stop_after_ms !== null && `stops after ${Math.max(1, Math.round(m.stop_after_ms / 60_000))} min`,
    m.return_to_start && "moves the mouse back",
    m.feel.bell && "bell-curve randomness",
    m.feel.hesitate && "hesitates",
    m.feel.curve && "curved paths",
  ]
    .filter(Boolean)
    .join(", ");
}
