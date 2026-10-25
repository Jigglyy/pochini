import { describe, expect, it } from "vitest";
import { isTypingTarget, matches, SHORTCUTS } from "./shortcuts";

const key = (k: string, mods: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean } = {}) => ({
  key: k,
  ctrlKey: !!mods.ctrl,
  altKey: !!mods.alt,
  shiftKey: !!mods.shift,
  metaKey: !!mods.meta,
});

describe("matches", () => {
  it("needs exactly the combo's modifiers", () => {
    expect(matches(key("z", { ctrl: true }), "Ctrl+Z")).toBe(true);
    expect(matches(key("Z", { ctrl: true, shift: true }), "Ctrl+Z")).toBe(false);
    expect(matches(key("z"), "Ctrl+Z")).toBe(false);
    expect(matches(key("z", { ctrl: true, meta: true }), "Ctrl+Z")).toBe(false);
  });

  it("knows named keys", () => {
    expect(matches(key("ArrowLeft", { alt: true }), "Alt+Left")).toBe(true);
    expect(matches(key("Delete"), "Delete")).toBe(true);
    expect(matches(key("Enter", { ctrl: true }), "Ctrl+Enter")).toBe(true);
  });
});

it("leaves typing in fields alone, but not switches and buttons", () => {
  const input = document.createElement("input");
  const box = document.createElement("input");
  box.type = "checkbox";
  const spin = document.createElement("div");
  spin.setAttribute("role", "spinbutton");
  expect(isTypingTarget(input)).toBe(true);
  expect(isTypingTarget(document.createElement("textarea"))).toBe(true);
  expect(isTypingTarget(spin)).toBe(true);
  expect(isTypingTarget(box)).toBe(false);
  expect(isTypingTarget(document.createElement("button"))).toBe(false);
  expect(isTypingTarget(null)).toBe(false);
});

it("no shortcut is a bare letter or Escape", () => {
  // Macros bind bare letters, and Escape is the default panic key.
  for (const s of SHORTCUTS) {
    expect(s.keys).not.toMatch(/^[A-Z0-9]$/);
    expect(s.keys).not.toMatch(/Esc/);
  }
});
