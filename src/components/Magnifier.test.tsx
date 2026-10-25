import { act } from "react";
import { expect, it, vi } from "vitest";
import { render, settle, text } from "@/test/render";

const ev = vi.hoisted(() => ({ frame: null as ((e: { payload: unknown }) => void) | null }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (_name: string, cb: (e: { payload: unknown }) => void) => {
    ev.frame = cb;
    return Promise.resolve(() => {});
  },
}));

const { Magnifier } = await import("./Magnifier");

it("draws the 11 x 11 pixels around the cursor, with its position and color", async () => {
  const { host } = render(<Magnifier />);
  await settle();
  const px = Array.from({ length: 121 }, (_, i) => (i === 60 ? 0x33aa55 : 0x000000));
  act(() => ev.frame?.({ payload: { x: -1500, y: 240, px } }));
  expect(text()).toContain("-1500, 240");
  expect(text()).toContain("#33aa55");
  const cells = host.querySelectorAll(".grid > div");
  expect(cells).toHaveLength(121);
  expect((cells[60] as HTMLElement).style.background).toBe("rgb(51, 170, 85)");
});

it("waits quietly for the first frame, and ignores a short one", async () => {
  render(<Magnifier />);
  await settle();
  expect(text()).toContain("...");
  act(() => ev.frame?.({ payload: { x: 1, y: 2, px: [1, 2, 3] } }));
  expect(text()).toContain("#000000");
});
