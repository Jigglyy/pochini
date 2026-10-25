import { useEffect, useRef } from "react";

// Keyboard shortcuts inside Pochini's window, Kanbini style (lib/shortcuts.ts
// there): one list, exact modifier matching, never while typing in a field.
// These are not the global hotkeys: they only work while the window has
// focus, and a macro hotkey that blocks its key from other apps takes
// precedence. No bare letters, which macros often use, and no Escape for
// "back": Escape is the default panic key.

export type Shortcut = { keys: string; action: string; where: string };

export const SHORTCUTS: readonly Shortcut[] = [
  { keys: "Ctrl+N", action: "New macro", where: "Macro list" },
  { keys: "Ctrl+F", action: "Find a macro", where: "Macro list" },
  { keys: "Ctrl+V", action: "Paste a copied macro", where: "Macro list" },
  { keys: "Ctrl+Z", action: "Undo", where: "Editor, and a deleted macro on the list" },
  { keys: "Ctrl+Y", action: "Redo", where: "Editor" },
  { keys: "Ctrl+S", action: "Save", where: "Editor" },
  { keys: "Ctrl+Enter", action: "Test the steps", where: "Editor" },
  { keys: "Delete", action: "Delete the focused step", where: "Editor" },
  { keys: "Ctrl+D", action: "Duplicate the focused step", where: "Editor" },
  { keys: "Alt+Up", action: "Move the focused step up (Alt+Down: down)", where: "Editor" },
  { keys: "Alt+Left", action: "Back", where: "Editor, Settings" },
];

const KEY_NAMES: Record<string, string> = { Left: "ArrowLeft", Right: "ArrowRight", Up: "ArrowUp", Down: "ArrowDown" };

/** Does `e` press exactly `combo` ("Ctrl+Z", "Alt+Left", "Delete")? Extra
 *  modifiers do not match: Ctrl+Shift+Z is not Ctrl+Z. */
export function matches(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">, combo: string): boolean {
  const parts = combo.split("+");
  const key = parts.pop() ?? "";
  if (e.metaKey) return false;
  if (e.ctrlKey !== parts.includes("Ctrl") || e.altKey !== parts.includes("Alt") || e.shiftKey !== parts.includes("Shift")) {
    return false;
  }
  const pressed = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  return pressed === (KEY_NAMES[key] ?? key);
}

/** Is focus somewhere the user types, where shortcuts must leave keys alone? */
export function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return true;
  if (t instanceof HTMLInputElement) return !["checkbox", "radio", "button", "submit", "reset", "range", "color"].includes(t.type);
  return ["textbox", "spinbutton", "combobox", "searchbox"].includes(t.getAttribute("role") ?? "");
}

const dialogOpen = () => document.querySelector('[role="dialog"], [role="alertdialog"]') !== null;

/** Run `handler` when `combo` is pressed, while mounted and `enabled`. Not
 *  while typing in a field (unless `inFields`) or while a dialog is open. */
export function useShortcut(
  combo: string | string[],
  handler: (e: KeyboardEvent) => void,
  { enabled = true, inFields = false }: { enabled?: boolean; inFields?: boolean } = {},
) {
  const latest = useRef(handler);
  latest.current = handler;
  const combos = Array.isArray(combo) ? combo.join("|") : combo;
  useEffect(() => {
    if (!enabled) return;
    const list = combos.split("|");
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !list.some((c) => matches(e, c))) return;
      if (dialogOpen() || (!inFields && isTypingTarget(e.target))) return;
      e.preventDefault();
      latest.current(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [combos, enabled, inFields]);
}

/** "Save (Ctrl+S)", for tooltips. */
export const withKeys = (label: string, keys: string) => `${label} (${keys})`;
