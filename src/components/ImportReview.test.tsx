import { expect, it, vi } from "vitest";
import type { Macro } from "@/types";
import { button, click, render, settle, text } from "@/test/render";

const risky = {
  id: "imp",
  name: "Helper",
  enabled: false,
  favorite: false,
  color: null,
  review: true,
  trigger: { key: { vk: 0x20, scancode: 0x39, extended: false, label: "Space" }, modifiers: [], mode: "once", swallow: true },
  repeat: { kind: "forever" },
  queue: false,
  queue_from: "first_press",
  return_to_start: false,
  stop_after_ms: null,
  feel: { bell: null, hesitate: null, curve: null },
  guard: { process: "game.exe", label: "" },
  created_at: "",
  updated_at: "",
  steps: [
    { type: "key", id: "k", shuffle: false, key: { vk: 0x52, scancode: 0x13, extended: false, label: "R" }, action: "press", modifiers: ["win"], hold_ms: { base: 20, jitter: 0 } },
    { type: "text", id: "t", shuffle: false, value: "powershell -c something", per_char_ms: { base: 1, jitter: 0 } },
    { type: "wait", id: "w", shuffle: false, ms: { base: 100, jitter: 0 } },
  ],
} as unknown as Macro;

vi.mock("@/lib/ipc", () => ({ getMacro: () => Promise.resolve(risky) }));

const { ImportReview } = await import("./ImportReview");

it("lists every step in words and flags what deserves a look", async () => {
  render(<ImportReview id="imp" then="enable" onConfirm={() => {}} onEdit={() => {}} onClose={() => {}} />);
  await settle();
  const t = text();
  expect(t).toContain('Check "Helper" first');
  expect(t).toContain("Hotkey Space, runs until stopped, only in game.exe.");
  expect(t).toContain("It repeats until you stop it with the panic key.");
  expect(t).toContain("other apps never see its hotkey (Space)");
  expect(t).toContain("Press Win+R");
  expect(t).toContain('Type "powershell -c something"'); // in full, not shortened
  expect(t).toContain("Types into whatever has focus");
  expect(t).toContain("Wait 100 ms");
});

it("Looks good and Open in editor say which macro", async () => {
  const onConfirm = vi.fn();
  const onEdit = vi.fn();
  render(<ImportReview id="imp" then="run" onConfirm={onConfirm} onEdit={onEdit} onClose={() => {}} />);
  await settle();
  click(button("Open in editor"));
  expect(onEdit).toHaveBeenCalledWith("imp");
  click(button("Looks good, run it"));
  expect(onConfirm).toHaveBeenCalledWith("imp");
});
