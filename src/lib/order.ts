import type { MacroSummary } from "@/types";
import { readPrefs, writePrefs } from "./prefs";

// How the macro list is ordered. The backend keeps the macros in the user's
// custom order; every other mode is a view over it.

export type SortMode = "custom" | "favorites" | "name" | "created" | "updated";

export const SORT_LABELS: Record<SortMode, string> = {
  custom: "Custom order",
  favorites: "Favorites first",
  name: "Name (A to Z)",
  created: "Newest first",
  updated: "Recently edited",
};

/** Modes where rows can be dragged. In "favorites" a drag stays inside its
 *  group (favorites, or the rest). */
export const DRAGGABLE: ReadonlySet<SortMode> = new Set<SortMode>(["custom", "favorites"]);

export function loadSortMode(): SortMode {
  const v = readPrefs().macroSort;
  return v && v in SORT_LABELS ? v : "custom";
}

export const saveSortMode = (macroSort: SortMode) => writePrefs({ macroSort });

const time = (iso: string) => Date.parse(iso) || 0;

export type Group = { key: string; title?: string; rows: MacroSummary[] };

/** `rows` arrive in custom order. Sorts are stable, so ties keep it. */
export function groupMacros(rows: MacroSummary[], mode: SortMode): Group[] {
  switch (mode) {
    case "custom":
      return [{ key: "all", rows }];
    case "favorites": {
      const fav = rows.filter((r) => r.favorite);
      const rest = rows.filter((r) => !r.favorite);
      if (fav.length === 0 || rest.length === 0) return [{ key: "all", rows }];
      return [
        { key: "fav", title: "Favorites", rows: fav },
        { key: "rest", title: "Other macros", rows: rest },
      ];
    }
    case "name":
      return [
        {
          key: "all",
          rows: [...rows].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })),
        },
      ];
    case "created":
      return [{ key: "all", rows: [...rows].sort((a, b) => time(b.created_at) - time(a.created_at)) }];
    case "updated":
      return [{ key: "all", rows: [...rows].sort((a, b) => time(b.updated_at) - time(a.updated_at)) }];
  }
}

/** The custom order after one group was reordered: the group's macros swap
 *  among the places they already hold, everything else stays put. Mirrors
 *  `MacroFile::reorder` in the backend so the list does not jump on save. */
export function applyGroupOrder(all: MacroSummary[], group: MacroSummary[]): MacroSummary[] {
  const ids = new Set(group.map((r) => r.id));
  let next = 0;
  return all.map((r) => (ids.has(r.id) ? group[next++] : r));
}
