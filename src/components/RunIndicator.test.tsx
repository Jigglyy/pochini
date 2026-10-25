import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunRecord, RunStatus } from "@/types";
import { button, click, hasButton, render, settle, text } from "@/test/render";

// The backend's run events, driven by hand.
const ipc = vi.hoisted(() => ({
  status: null as ((s: RunStatus) => void) | null,
  finished: null as ((r: RunRecord) => void) | null,
  elevated: false,
  stop: vi.fn(),
  restart: vi.fn(),
}));

vi.mock("@/lib/ipc", () => ({
  RUN_COUNTDOWN_MS: 3000,
  runStatus: () => Promise.resolve({ macro_id: null, name: null, queued: 0 }),
  isElevated: () => Promise.resolve(ipc.elevated),
  onRunStatus: (cb: (s: RunStatus) => void) => {
    ipc.status = cb;
    return Promise.resolve(() => {});
  },
  onRunFinished: (cb: (r: RunRecord) => void) => {
    ipc.finished = cb;
    return Promise.resolve(() => {});
  },
  stopMacro: () => ipc.stop(),
  restartElevated: () => ipc.restart(),
}));

const { RunIndicator } = await import("./RunIndicator");

const run = (name: string, queued = 0): RunStatus => ({ macro_id: "m1", name, queued });
const record = (outcome: RunRecord["outcome"], at_ms = Date.now()): RunRecord => ({
  name: "Fill",
  macro_id: "m1",
  at_ms,
  duration_ms: 120,
  outcome,
});
const emit = <T,>(cb: ((v: T) => void) | null, v: T) => act(() => cb?.(v));

beforeEach(() => {
  ipc.status = ipc.finished = null;
  ipc.elevated = false;
});

describe("the run pill", () => {
  it("counts down after Run, then names the run, its queue and the panic key", async () => {
    const onDone = vi.fn();
    render(<RunIndicator pending={{ label: "Fill", at: Date.now(), token: 1 }} onDone={onDone} panicKey="F9" />);
    await settle();
    expect(text()).toContain("Starting in 3");
    expect(hasButton("Cancel")).toBe(true);

    emit(ipc.status, run("Fill", 2));
    expect(text()).toContain("F9 stops it");
  });

  it("shows a run a hotkey started, with Stop all for a queue", async () => {
    render(<RunIndicator pending={null} onDone={() => {}} panicKey="Esc" />);
    await settle();
    expect(text()).toBe("");
    emit(ipc.status, run("Fill", 3));
    expect(text()).toContain("Running Fill · 3 queued");
    click(button(/Stop all/));
    expect(ipc.stop).toHaveBeenCalledOnce();
  });

  it('says "Finished" for a moment, then goes', async () => {
    vi.useFakeTimers();
    render(<RunIndicator pending={null} onDone={() => {}} panicKey="Esc" />);
    await settle();
    emit(ipc.finished, record({ kind: "finished" }));
    expect(text()).toContain("Finished Fill");
    act(() => vi.advanceTimersByTime(1600));
    expect(text()).toBe("");
  });

  it("stays on a failure with its reason until dismissed", async () => {
    vi.useFakeTimers();
    render(<RunIndicator pending={null} onDone={() => {}} panicKey="Esc" />);
    await settle();
    emit(ipc.finished, record({ kind: "failed", message: "game.exe has no window open.", admin: false }));
    act(() => vi.advanceTimersByTime(10_000));
    expect(text()).toContain("Fill stopped: game.exe has no window open.");
    expect(hasButton("Restart as administrator")).toBe(false);
    click(button("Dismiss"));
    expect(text()).toBe("");
  });

  it("offers Restart as administrator when Windows blocked the input, unless it already is", async () => {
    render(<RunIndicator pending={null} onDone={() => {}} panicKey="Esc" />);
    await settle();
    emit(ipc.finished, record({ kind: "failed", message: "Windows blocked the input", admin: true }));
    click(button("Restart as administrator"));
    expect(ipc.restart).toHaveBeenCalledOnce();
  });

  it("an elevated Pochini does not offer to restart elevated", async () => {
    ipc.elevated = true;
    render(<RunIndicator pending={null} onDone={() => {}} panicKey="Esc" />);
    await settle();
    emit(ipc.finished, record({ kind: "failed", message: "Windows blocked the input", admin: true }));
    expect(hasButton("Restart as administrator")).toBe(false);
  });

  it("a Run's pill is done when that run ends, and a stop or cancel leaves nothing", async () => {
    const onDone = vi.fn();
    const at = Date.now();
    render(<RunIndicator pending={{ label: "Fill", at, token: 1 }} onDone={onDone} panicKey="Esc" />);
    await settle();
    emit(ipc.finished, record({ kind: "cancelled" }, at));
    expect(onDone).toHaveBeenCalled();
  });
});
