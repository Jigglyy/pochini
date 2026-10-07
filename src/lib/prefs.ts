// Renderer-only preferences live in localStorage as one JSON blob (the
// Kanbini pattern). index.html reads the same key before first paint so the
// window never flashes the wrong theme.

import type { SortMode } from "./order";

export type ThemePref = "system" | "light" | "dark";

export type UiPrefs = { theme?: ThemePref; macroSort?: SortMode };

const KEY = "pochini.settings";

export function readPrefs(): UiPrefs {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") as UiPrefs;
  } catch {
    return {};
  }
}

export function writePrefs(patch: Partial<UiPrefs>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readPrefs(), ...patch }));
  } catch {
    /* private mode / storage blocked: the choice just won't persist */
  }
}
