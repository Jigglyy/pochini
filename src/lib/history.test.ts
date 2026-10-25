import { expect, it } from "vitest";
import { COALESCE_MS, LIMIT, record, redo, start, undo } from "./history";

it("undoes and redoes edits in order", () => {
  let h = start("a");
  h = record(h, "b", 1000);
  h = record(h, "c", 5000);
  h = undo(h);
  expect(h.present).toBe("b");
  h = undo(h);
  expect(h.present).toBe("a");
  expect(undo(h)).toBe(h); // nothing further back
  h = redo(redo(h));
  expect(h.present).toBe("c");
  expect(redo(h)).toBe(h);
});

it("a new edit after undo drops the redo branch", () => {
  let h = record(record(start(1), 2, 0), 3, 5000);
  h = record(undo(h), 9, 9000);
  expect(h.future).toEqual([]);
  expect(undo(h).present).toBe(2);
});

it("quick edits to the same thing are one undo step; other edits are not", () => {
  let h = start("");
  for (const [i, v] of ["F", "Fi", "Fil", "Fill"].entries()) h = record(h, v, 1000 + i * 100, "name");
  expect(undo(h).present).toBe("");
  // Same key, but a pause in between: two steps.
  h = record(record(start(""), "a", 0, "name"), "ab", COALESCE_MS + 1, "name");
  expect(undo(h).present).toBe("a");
  // No key (adding a step, say): never merged.
  const n = record(record(start(0), 1, 0), 2, 10);
  expect(undo(n).present).toBe(1);
});

it("keeps at most LIMIT steps", () => {
  let h = start(0);
  for (let i = 1; i <= LIMIT + 20; i++) h = record(h, i, i * 10_000);
  expect(h.past).toHaveLength(LIMIT);
  expect(h.past[0]).toBe(20);
});
