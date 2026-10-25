import { describe, expect, it } from "vitest";
import type { MacroSummary } from "@/types";
import { applyGroupOrder, groupMacros, loadSortMode, saveSortMode } from "./order";

const row = (id: string, o: Partial<MacroSummary> = {}): MacroSummary => ({
  id,
  name: id,
  enabled: true,
  hotkey: null,
  step_count: 0,
  conflict: null,
  duration_ms: [0, 0],
  queue: false,
  app: null,
  favorite: false,
  color: null,
  review: false,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...o,
});

const ids = (rows: MacroSummary[]) => rows.map((r) => r.id);

describe("groupMacros", () => {
  const rows = [
    row("b", { name: "Item 10", created_at: "2026-01-03T00:00:00Z" }),
    row("a", { name: "item 9", favorite: true, updated_at: "2026-02-01T00:00:00Z" }),
    row("c", { name: "Alpha", favorite: true }),
  ];

  it("keeps the custom order as one group", () => {
    expect(groupMacros(rows, "custom").map((g) => ids(g.rows))).toEqual([["b", "a", "c"]]);
  });

  it("puts favorites first, in custom order, as two titled groups", () => {
    const g = groupMacros(rows, "favorites");
    expect(g.map((x) => [x.title, ids(x.rows)])).toEqual([
      ["Favorites", ["a", "c"]],
      ["Other macros", ["b"]],
    ]);
    // No point in groups when everything is (or nothing is) a favorite.
    expect(groupMacros([row("x")], "favorites")).toHaveLength(1);
  });

  it("sorts by name naturally, ignoring case", () => {
    expect(ids(groupMacros(rows, "name")[0].rows)).toEqual(["c", "a", "b"]);
  });

  it("sorts newest and recently edited first, ties keeping custom order", () => {
    expect(ids(groupMacros(rows, "created")[0].rows)).toEqual(["b", "a", "c"]);
    expect(ids(groupMacros(rows, "updated")[0].rows)).toEqual(["a", "b", "c"]);
  });
});

it("applyGroupOrder swaps a group among its own places only (MacroFile::reorder)", () => {
  const all = [row("f1", { favorite: true }), row("o1"), row("f2", { favorite: true }), row("o2")];
  const favs = [all[2], all[0]];
  expect(ids(applyGroupOrder(all, favs))).toEqual(["f2", "o1", "f1", "o2"]);
});

it("remembers the sort mode, and ignores a corrupt or unknown one", () => {
  saveSortMode("name");
  expect(loadSortMode()).toBe("name");
  localStorage.setItem("pochini.settings", '{"macroSort":"sideways"}');
  expect(loadSortMode()).toBe("custom");
  localStorage.setItem("pochini.settings", "{not json");
  expect(loadSortMode()).toBe("custom");
});
