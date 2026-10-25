import { beforeEach, expect, it, vi } from "vitest";

const ipc = vi.hoisted(() => ({
  picked: null as ((at: [number, number] | null) => void) | null,
  start: vi.fn(() => Promise.resolve()),
  unlistened: 0,
}));

vi.mock("./ipc", () => ({
  onPicked: (cb: (at: [number, number] | null) => void) => {
    ipc.picked = cb;
    return Promise.resolve(() => {
      ipc.unlistened++;
    });
  },
  startPick: () => ipc.start(),
}));

const { pickPoint } = await import("./pick");
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  ipc.picked = null;
  ipc.start.mockReset().mockResolvedValue(undefined);
  ipc.unlistened = 0;
});

it("listens before it starts, and resolves with the click", async () => {
  const p = pickPoint();
  await tick();
  expect(ipc.start).toHaveBeenCalledOnce();
  ipc.picked?.([120, -40]);
  await expect(p).resolves.toEqual([120, -40]);
  expect(ipc.unlistened).toBe(1);
});

it("a second Pick while one waits joins it instead of starting another", async () => {
  const a = pickPoint();
  const b = pickPoint();
  expect(b).toBe(a);
  await tick();
  ipc.picked?.(null); // Esc
  await expect(a).resolves.toBeNull();
  expect(ipc.start).toHaveBeenCalledOnce();
});

it("a refused start resolves as cancelled, and the next pick starts afresh", async () => {
  ipc.start.mockRejectedValueOnce(new Error("busy"));
  await expect(pickPoint()).resolves.toBeNull();
  const next = pickPoint();
  await tick();
  ipc.picked?.([1, 2]);
  await expect(next).resolves.toEqual([1, 2]);
});
