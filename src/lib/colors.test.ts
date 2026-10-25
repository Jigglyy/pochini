import { describe, expect, it } from "vitest";
import type { Step } from "@/types";
import { asColor, colorKind, outlineStyle, tone } from "./colors";
import { blankStep } from "./steps";

describe("tone", () => {
  it("mixes surfaces toward the card token so they read in both themes", () => {
    const t = tone("teal");
    expect(t?.bar).toBe("oklch(0.68 0.10 195)");
    expect(t?.chip).toBe("color-mix(in oklab, oklch(0.68 0.10 195) 24%, var(--card))");
    expect(t?.wash).toContain("var(--card)");
    expect(t?.icon).toContain("var(--foreground)");
  });

  it("is nothing for no color", () => {
    expect(tone("none")).toBeNull();
  });
});

describe("outlineStyle", () => {
  it("sets the four border-color longhands, never the shorthand", () => {
    // React warns, and mis-renders, when border-color and border-left-color mix.
    const s = outlineStyle(tone("red"));
    expect(Object.keys(s).sort()).toEqual(["borderBottomColor", "borderLeftColor", "borderRightColor", "borderTopColor"]);
    expect(new Set(Object.values(s)).size).toBe(1);
  });

  it("can color only the left edge, and nothing without a color", () => {
    const s = outlineStyle(tone("red"), false);
    expect(s.borderLeftColor).toBe(tone("red")?.bar);
    expect(s.borderTopColor).toBeUndefined();
    expect(outlineStyle(null)).toEqual({});
  });
});

it("asColor accepts only palette names", () => {
  expect(asColor("cyan")).toBe("cyan");
  expect(asColor("url(javascript:1)")).toBe("none");
  expect(asColor(null)).toBe("none");
});

it("a click aimed relative to the mouse counts as Click at mouse", () => {
  const c = blankStep("click") as Extract<Step, { type: "click" }>;
  expect(colorKind(c)).toBe("click");
  expect(colorKind({ ...c, anchor: "previous" })).toBe("click_here");
  expect(colorKind(blankStep("wait"))).toBe("wait");
});
