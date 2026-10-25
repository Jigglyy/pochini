import { beforeEach, expect, it, vi } from "vitest";
import { button, click, render, settle, text } from "@/test/render";

const ipc = vi.hoisted(() => ({
  resolve: null as ((at: [number, number] | null) => void) | null,
  cancelled: 0,
}));

vi.mock("@/lib/pick", () => ({
  pickPoint: () =>
    new Promise<[number, number] | null>((r) => {
      ipc.resolve = r;
    }),
}));
vi.mock("@/lib/ipc", () => ({
  cancelPick: () => {
    ipc.cancelled++;
    return Promise.resolve();
  },
  listMonitors: () =>
    Promise.resolve([
      { device: "\\\\.\\DISPLAY1", rect: [-1920, 0, 0, 1080], dpi: 96, primary: false },
      { device: "\\\\.\\DISPLAY2", rect: [0, 0, 2560, 1440], dpi: 120, primary: true },
    ]),
  previewPoint: () => Promise.resolve(),
}));

const { CoordPicker } = await import("./CoordPicker");

beforeEach(() => {
  ipc.resolve = null;
  ipc.cancelled = 0;
});

it("a pick fills in the point and the monitor it is on", async () => {
  const onChange = vi.fn();
  render(<CoordPicker x={0} y={0} onChange={onChange} />);
  click(button("Pick"));
  expect(text()).toContain("Click the point...");
  ipc.resolve?.([-100, 50]);
  await settle();
  expect(onChange).toHaveBeenCalledWith(-100, 50, { monitor: "\\\\.\\DISPLAY1", monitor_rect: [-1920, 0, 0, 1080], dpi: 96 });
  expect(ipc.cancelled).toBe(0);
});

it("a cancelled pick changes nothing", async () => {
  const onChange = vi.fn();
  render(<CoordPicker x={3} y={4} onChange={onChange} />);
  click(button("Pick"));
  ipc.resolve?.(null);
  await settle();
  expect(onChange).not.toHaveBeenCalled();
  expect(text()).not.toContain("Click the point...");
});

/** Regression: closing the step (or leaving the screen) mid-pick left the
 *  pick armed, so the next click anywhere was taken as the point. */
it("leaving mid-pick cancels it", async () => {
  const { unmount } = render(<CoordPicker x={0} y={0} onChange={() => {}} />);
  click(button("Pick"));
  await settle();
  unmount();
  expect(ipc.cancelled).toBe(1);
});
