import { describe, expect, it } from "vitest";
import { decodePath } from "./path";

describe("decodePath", () => {
  it("reads the packed form the backend saves", () => {
    // The same string the Rust codec is tested to produce (model.rs).
    expect(decodePath("1:PDIAZB6QA1AokAM")).toEqual([
      { x: 30, y: 25, t: 0 },
      { x: 80, y: 40, t: 200 },
      { x: 120, y: 60, t: 400 },
    ]);
  });

  it("is empty for nothing, and for a form it does not know", () => {
    expect(decodePath(undefined)).toEqual([]);
    expect(decodePath("")).toEqual([]);
    expect(decodePath("2:abc")).toEqual([]);
  });

  it("still reads a plain list of points", () => {
    expect(decodePath([{ x: 1, y: 2, t: 3 }])).toEqual([{ x: 1, y: 2, t: 3 }]);
  });
});
