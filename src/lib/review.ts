import type { Macro, Step } from "../types";

// What an imported macro does that deserves a second look before it runs on
// this machine. A shared macro is a little program: it can type into
// whatever has focus and press shortcuts that open things. See share.rs.

/** Why one step deserves a look, or null. */
export function stepConcern(s: Step): string | null {
  if (s.type === "text" && s.value) return "Types into whatever has focus";
  if (s.type === "key" && s.modifiers.some((m) => m === "win" || m === "alt" || m === "ctrl")) {
    return "A shortcut: it can open, close or change things";
  }
  return null;
}

/** Things about the whole macro worth knowing before turning it on. */
export function macroConcerns(m: Macro): string[] {
  const out: string[] = [];
  if (m.repeat.kind === "forever") out.push("It repeats until you stop it with the panic key.");
  if (m.repeat.kind === "count" && m.repeat.n > 100) out.push(`It repeats ${m.repeat.n} times.`);
  if (m.trigger?.swallow) out.push(`While it is on, other apps never see its hotkey (${m.trigger.key.label}).`);
  return out;
}
