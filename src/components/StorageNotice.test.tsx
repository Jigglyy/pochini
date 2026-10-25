import { expect, it, vi } from "vitest";
import type { LoadProblem } from "@/types";
import { button, click, hasButton, render, settle, text } from "@/test/render";

const ipc = vi.hoisted(() => ({ problem: null as LoadProblem | null, cleared: 0, opened: 0 }));
vi.mock("@/lib/ipc", () => ({
  storageProblem: () => Promise.resolve(ipc.problem),
  clearStorageProblem: () => {
    ipc.cleared++;
    return Promise.resolve();
  },
  openDataDir: () => {
    ipc.opened++;
    return Promise.resolve();
  },
}));

const { StorageNotice } = await import("./StorageNotice");

it("shows nothing when the macros file read fine", async () => {
  ipc.problem = null;
  render(<StorageNotice />);
  await settle();
  expect(text()).toBe("");
});

it("a locked library explains itself and only unlocks after Start fresh is confirmed", async () => {
  ipc.problem = {
    reason: "macros.json is schema version 9, which this build (3) cannot read",
    kept_at: "C:\\data\\macros.json.unreadable-1",
    from_backup: false,
    locked: true,
  };
  ipc.cleared = 0;
  render(<StorageNotice />);
  await settle();
  expect(text()).toContain("Your macros could not be loaded");
  expect(text()).toContain("will not save anything until you choose Start fresh");
  expect(text()).toContain("saved by a newer Pochini");
  expect(text()).toContain("macros.json.unreadable-1");
  expect(hasButton("Got it")).toBe(false);

  click(button("Open data folder"));
  expect(ipc.opened).toBe(1);
  click(button("Start fresh..."));
  await settle();
  expect(ipc.cleared).toBe(0); // only asked so far
  click(button("Start fresh"));
  await settle();
  expect(ipc.cleared).toBe(1);
  expect(text()).not.toContain("could not be loaded");
});

it("a library restored from the backup says so and can be dismissed", async () => {
  ipc.problem = { reason: "malformed json", kept_at: null, from_backup: true, locked: false };
  ipc.cleared = 0;
  render(<StorageNotice />);
  await settle();
  expect(text()).toContain("restored from the backup");
  click(button("Got it"));
  await settle();
  expect(ipc.cleared).toBe(1);
  expect(text()).toBe("");
});
