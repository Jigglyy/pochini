import { describe, expect, it } from "vitest";
import type { Step } from "@/types";
import { blankStep } from "./steps";
import {
  allState,
  duplicateSelected,
  kindCounts,
  kindState,
  prune,
  removeSelected,
  selectRange,
  toggleKind,
} from "./selection";

const make = (kind: Parameters<typeof blankStep>[0], id: string): Step => ({ ...blankStep(kind), id });

// click, wait, click at mouse, wait, key
const steps = [make("click", "a"), make("wait", "b"), make("click_here", "c"), make("wait", "d"), make("key", "e")];
const ids = (s: Set<string>) => [...s].sort();

describe("kindCounts", () => {
  it("lists the kinds a macro has, in the Add buttons' order, with counts", () => {
    expect(kindCounts(steps)).toEqual([
      { kind: "click", count: 1 },
      { kind: "click_here", count: 1 },
      { kind: "key", count: 1 },
      { kind: "wait", count: 2 },
    ]);
  });
});

describe("toggleKind", () => {
  it("adds every step of a kind to the selection", () => {
    expect(ids(toggleKind(steps, new Set(["a"]), "wait"))).toEqual(["a", "b", "d"]);
  });

  it("takes them out again when they are all selected already", () => {
    expect(ids(toggleKind(steps, new Set(["a", "b", "d"]), "wait"))).toEqual(["a"]);
  });

  it("selects the rest of a kind that is only partly selected", () => {
    expect(ids(toggleKind(steps, new Set(["b"]), "wait"))).toEqual(["b", "d"]);
  });
});

describe("kindState", () => {
  it("says whether all, some or none of a kind is selected", () => {
    expect(kindState(steps, new Set(["b", "d"]), "wait")).toBe(true);
    expect(kindState(steps, new Set(["b"]), "wait")).toBe("some");
    expect(kindState(steps, new Set(["a"]), "wait")).toBe(false);
  });
});

describe("allState", () => {
  it("is the select-all box: off, on, or in between", () => {
    expect(allState(steps, new Set())).toBe(false);
    expect(allState(steps, new Set(["a", "b", "c", "d", "e"]))).toBe(true);
    expect(allState(steps, new Set(["a"]))).toBe("indeterminate");
    expect(allState([], new Set())).toBe(false);
  });
});

describe("selectRange", () => {
  it("selects every step between two, both included, in either direction", () => {
    expect(ids(selectRange(steps, new Set(), "b", "d", true))).toEqual(["b", "c", "d"]);
    expect(ids(selectRange(steps, new Set(), "d", "b", true))).toEqual(["b", "c", "d"]);
  });

  it("can clear a range too, leaving the rest", () => {
    expect(ids(selectRange(steps, new Set(["a", "b", "c", "d"]), "b", "c", false))).toEqual(["a", "d"]);
  });

  it("falls back to the one step when the anchor is gone", () => {
    expect(ids(selectRange(steps, new Set(), "zz", "c", true))).toEqual(["c"]);
  });
});

describe("prune", () => {
  it("forgets steps that no longer exist", () => {
    expect(ids(prune(steps.slice(0, 2), new Set(["a", "c"])))).toEqual(["a"]);
  });

  it("returns the same set when nothing changed, so React can skip a render", () => {
    const s = new Set(["a"]);
    expect(prune(steps, s)).toBe(s);
  });
});

describe("duplicateSelected", () => {
  it("puts copies after the last selected step, in order, with new ids", () => {
    let n = 0;
    const { steps: out, copies } = duplicateSelected(steps, new Set(["a", "c"]), () => `n${++n}`);
    expect(out.map((s) => s.id)).toEqual(["a", "b", "c", "n1", "n2", "d", "e"]);
    expect(copies).toEqual(["n1", "n2"]);
    expect(out[3].type).toBe("click");
    expect(out[4]).toMatchObject({ type: "click", anchor: "activation" });
  });
});

describe("removeSelected", () => {
  it("keeps only the steps that are not selected", () => {
    expect(removeSelected(steps, new Set(["b", "e"])).map((s) => s.id)).toEqual(["a", "c", "d"]);
  });
});
