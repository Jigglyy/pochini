import { act } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import type { Hotkey } from "@/types";
import { button, click, render, settle, text } from "@/test/render";

const ipc = vi.hoisted(() => ({
  paused: [] as boolean[],
  clash: null as string | null,
}));

vi.mock("@/lib/ipc", () => ({
  keyRefForVk: (vk: number) =>
    Promise.resolve({ vk, scancode: vk === 27 ? 1 : 57, extended: false, label: vk === 27 ? "Esc" : vk === 32 ? "Space" : "K" }),
  setRecording: (on: boolean) => {
    ipc.paused.push(on);
    return Promise.resolve();
  },
  hotkeyClash: () => Promise.resolve(ipc.clash),
}));

const { KeyCapture } = await import("./KeyCapture");

const press = async (key: string, keyCode: number, mods: KeyboardEventInit = {}) => {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, keyCode, bubbles: true, ...mods }));
  });
  await settle();
};

beforeEach(() => {
  ipc.paused = [];
  ipc.clash = null;
});

it("hotkeys stand aside while it records, and come back after", async () => {
  const onChange = vi.fn();
  render(<KeyCapture value={null} onChange={onChange} />);
  click(button(/Record/));
  await settle();
  expect(ipc.paused).toEqual([true]);
  await press("k", 75, { ctrlKey: true });
  expect(onChange).toHaveBeenCalledWith({ key: expect.objectContaining({ vk: 75 }), modifiers: ["ctrl"] });
  expect(ipc.paused).toEqual([true, false]);
});

it("records Escape like any other key (a Key step can press it)", async () => {
  const onChange = vi.fn();
  render(<KeyCapture value={null} onChange={onChange} />);
  click(button(/Record/));
  await press("Escape", 27);
  expect(onChange).toHaveBeenCalledWith({ key: expect.objectContaining({ label: "Esc" }), modifiers: [] });
});

it("waits past a lone modifier for the real key, and Cancel records nothing", async () => {
  const onChange = vi.fn();
  render(<KeyCapture value={null} onChange={onChange} />);
  click(button(/Record/));
  await press("Shift", 16, { shiftKey: true });
  expect(onChange).not.toHaveBeenCalled();
  click(button(/Cancel/));
  await settle();
  expect(onChange).not.toHaveBeenCalled();
  expect(ipc.paused).toEqual([true, false]);
});

it("says when a macro's hotkey clashes", async () => {
  ipc.clash = 'Same hotkey as "First", which runs instead';
  const space: Hotkey = { key: { vk: 32, scancode: 57, extended: false, label: "Space" }, modifiers: [] };
  render(<KeyCapture value={space} onChange={() => {}} clashFor={{ macroId: "b", guard: null }} />);
  await settle();
  expect(text()).toContain('Same hotkey as "First", which runs instead');
});

it("never asks about clashes for keys that are not a macro's hotkey", async () => {
  ipc.clash = "should not show";
  const space: Hotkey = { key: { vk: 32, scancode: 57, extended: false, label: "Space" }, modifiers: [] };
  render(<KeyCapture value={space} onChange={() => {}} />);
  await settle();
  expect(text()).not.toContain("should not show");
});
