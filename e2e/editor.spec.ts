import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { drag, expect, test } from "./_launch";
import { decodePath } from "../src/lib/path";
import { clickAt, macro, wait } from "./data";

// The step editor: dragging steps, the arrow buttons, and offset targets.

const step = (page: Page, id: string) => page.locator(`[data-step-id="${id}"]`);
const header = (page: Page, id: string) => step(page, id).locator('[role="button"][aria-expanded]');

const stepOrder = (page: Page) =>
  page.locator("[data-step-id]").evaluateAll((els) => els.map((e) => e.getAttribute("data-step-id")));

async function savedSteps(dataDir: string) {
  const f = JSON.parse(await readFile(join(dataDir, "macros.json"), "utf8"));
  return f.macros[0].steps as Record<string, unknown>[];
}

const save = async (page: Page) => {
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible();
};

test.describe("reordering steps", () => {
  test.use({
    seed: {
      macros: [
        macro("Steps", {
          steps: [
            { ...wait(100), id: "s1" },
            { ...wait(200), id: "s2" },
            { ...wait(300), id: "s3" },
          ],
        }),
      ],
    },
  });

  test("drag a step by its header, then save", async ({ app: { page, dataDir } }) => {
    await page.getByRole("button", { name: /^Steps/ }).click();
    await drag(page, header(page, "s3"), header(page, "s1"), -10);
    await expect.poll(() => stepOrder(page)).toEqual(["s3", "s1", "s2"]);

    await save(page);
    expect((await savedSteps(dataDir)).map((s) => s.id)).toEqual(["s3", "s1", "s2"]);
  });

  test("the arrow buttons still work", async ({ app: { page } }) => {
    await page.getByRole("button", { name: /^Steps/ }).click();
    await step(page, "s1").getByRole("button", { name: "Move down", exact: true }).click();
    await expect.poll(() => stepOrder(page)).toEqual(["s2", "s1", "s3"]);
  });

  test("a drag that starts on an open step's inputs does not move it", async ({ app: { page } }) => {
    await page.getByRole("button", { name: /^Steps/ }).click();
    await header(page, "s1").click(); // open it
    const input = step(page, "s1").getByRole("spinbutton").first();
    await drag(page, input, header(page, "s3"), 10);
    await expect.poll(() => stepOrder(page)).toEqual(["s1", "s2", "s3"]);
  });
});

test.describe("offset targets", () => {
  test.use({ seed: { macros: [macro("Offsets")] } });

  test("mouse start + offset, then previous point + offset", async ({ app: { page, dataDir } }) => {
    await page.getByRole("button", { name: /^Offsets/ }).click();

    // A new "Click at mouse" step opens expanded.
    await page.getByRole("button", { name: "Click at mouse" }).click();
    const first = page.locator("[data-step-id]").nth(0);
    await first.getByRole("spinbutton", { name: "Offset X" }).fill("20");
    await expect(first.locator('[role="button"][aria-expanded]')).toContainText("Click 20 px right of where the mouse started");
    await expect(first.getByTestId("lands-at")).toContainText("Lands at mouse start + (20, 0)");

    await page.getByRole("button", { name: "Click at mouse" }).click();
    const second = page.locator("[data-step-id]").nth(1);
    await second.getByRole("button", { name: "Previous point + offset" }).click();
    await second.getByRole("spinbutton", { name: "Offset X" }).fill("20");
    await second.getByRole("spinbutton", { name: "Offset Y" }).fill("-5");
    await expect(second.locator('[role="button"][aria-expanded]')).toContainText(
      "Click 20 px right and 5 px up from the previous point",
    );
    await expect(second.getByTestId("lands-at")).toContainText("Lands at mouse start + (40, -5)");

    await save(page);
    const steps = await savedSteps(dataDir);
    expect(steps.map((s) => [s.anchor, s.dx, s.dy])).toEqual([
      ["activation", 20, 0],
      ["previous", 20, -5],
    ]);

    // Back from the backend after a reload: the shape survived the round trip.
    await page.reload();
    await page.getByRole("button", { name: /^Offsets/ }).click();
    await expect(page.locator("[data-step-id]").nth(1).locator('[role="button"][aria-expanded]')).toContainText(
      "Click 20 px right and 5 px up from the previous point",
    );
  });

  test("a first step aimed at the previous point counts from the start", async ({ app: { page } }) => {
    await page.getByRole("button", { name: /^Offsets/ }).click();
    await page.getByRole("button", { name: "Click at mouse" }).click();
    const only = page.locator("[data-step-id]").nth(0);
    await only.getByRole("button", { name: "Previous point + offset" }).click();
    await expect(only.getByTestId("lands-at")).toContainText("nothing before it, so from the mouse start");
  });

  test("a fixed step anchors the chain to the screen", async ({ app: { page } }) => {
    await page.getByRole("button", { name: /^Offsets/ }).click();
    await page.getByRole("button", { name: "Click", exact: true }).click();
    const fixed = page.locator("[data-step-id]").nth(0);
    await fixed.getByRole("spinbutton", { name: "X", exact: true }).fill("1000");
    await fixed.getByRole("spinbutton", { name: "Y", exact: true }).fill("400");

    await page.getByRole("button", { name: "Move", exact: true }).click();
    const move = page.locator("[data-step-id]").nth(1);
    await move.getByRole("button", { name: "Previous point + offset" }).click();
    await move.getByRole("spinbutton", { name: "Offset X" }).fill("-10");
    await expect(move.getByTestId("lands-at")).toContainText("Lands at (990, 400)");
  });
});

test.describe("recording keys", () => {
  test.use({ seed: { macros: [macro("Keys")] } });

  test("Escape can be recorded like any other key", async ({ app: { page, dataDir } }) => {
    await page.getByRole("button", { name: /^Keys/ }).click();
    await page.getByRole("button", { name: "Key", exact: true }).click();
    const key = page.locator("[data-step-id]").nth(0);
    await key.getByRole("button", { name: "Change" }).click();
    await page.keyboard.press("Escape");
    await expect(key.locator('[role="button"][aria-expanded]')).toContainText("Press Esc");
    await save(page);
    expect(((await savedSteps(dataDir))[0].key as { vk: number }).vk).toBe(0x1b);
  });
});

test.describe("held keys and shuffle", () => {
  test.use({
    seed: {
      macros: [
        macro("Mixed", {
          steps: [{ ...clickAt(10, 20), id: "c1" }, { ...wait(100), id: "w1" }, { ...clickAt(30, 40), id: "c2" }],
        }),
      ],
    },
  });

  test("a click holds Shift and a recorded key, and two steps shuffle", async ({ app: { page, dataDir } }) => {
    await page.getByRole("button", { name: /^Mixed/ }).click();
    await header(page, "c1").click();
    const c1 = step(page, "c1");
    await c1.getByRole("switch", { name: /^shift$/i }).click();
    await c1.getByRole("button", { name: "Record" }).click();
    await page.keyboard.press("KeyQ");
    await expect(header(page, "c1")).toContainText("Click at (10, 20) holding Shift+Q");

    // One shuffled step has nothing to trade with, and says so.
    await c1.getByRole("switch", { name: "Shuffle" }).click();
    await expect(c1.getByText("nothing to trade places with")).toBeVisible();
    await expect(header(page, "c1").getByRole("img", { name: "Shuffled" })).toBeVisible();

    // The second one from the right-click menu.
    await header(page, "c2").click({ button: "right" });
    await page.getByRole("menuitemcheckbox", { name: "Shuffle" }).click();
    await expect(header(page, "c2").getByRole("img", { name: "Shuffled" })).toBeVisible();
    await expect(c1.getByText("nothing to trade places with")).toHaveCount(0);
    await expect(page.getByText("2 steps shuffled")).toBeVisible();

    await save(page);
    const steps = await savedSteps(dataDir);
    expect(steps.map((s) => [s.id, s.shuffle])).toEqual([
      ["c1", true],
      ["w1", false],
      ["c2", true],
    ]);
    expect(steps[0].modifiers).toEqual(["shift"]);
    expect((steps[0].held_key as { label: string }).label).toBe("Q");
    expect([steps[2].modifiers, steps[2].held_key]).toEqual([[], null]);
  });
});

test.describe("undo and redo", () => {
  test.use({ seed: { macros: [macro("Undoable", { steps: [{ ...wait(100), id: "w1" }, { ...wait(200), id: "w2" }] })] } });

  test("a deleted step comes back, and Ctrl+Z / Ctrl+Y walk the history", async ({ app: { page } }) => {
    await page.getByRole("button", { name: /^Undoable/ }).click();
    await step(page, "w1").getByRole("button", { name: "Delete", exact: true }).click();
    await expect(step(page, "w1")).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: "Deleted" })).toContainText('Deleted "Wait 100 ms".');
    await page.getByRole("status").getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => stepOrder(page)).toEqual(["w1", "w2"]);
    // Back where it was saved: nothing to save.
    await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Wait", exact: true }).click();
    await expect(page.locator("[data-step-id]")).toHaveCount(3);
    await page.locator("body").click({ position: { x: 5, y: 5 } }); // out of any field
    await page.keyboard.press("Control+z");
    await expect(page.locator("[data-step-id]")).toHaveCount(2);
    await page.keyboard.press("Control+y");
    await expect(page.locator("[data-step-id]")).toHaveCount(3);
  });

  test("typing a name undoes in one step", async ({ app: { page } }) => {
    await page.getByRole("button", { name: /^Undoable/ }).click();
    const name = page.getByRole("textbox", { name: "Macro name" });
    await name.press("End");
    await name.pressSequentially(" again", { delay: 20 });
    await expect(name).toHaveValue("Undoable again");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(name).toHaveValue("Undoable");
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(name).toHaveValue("Undoable again");
  });

  test("Delete and Ctrl+D act on the focused step", async ({ app: { page } }) => {
    await page.getByRole("button", { name: /^Undoable/ }).click();
    await header(page, "w2").focus();
    await page.keyboard.press("Control+d");
    await expect(page.locator("[data-step-id]")).toHaveCount(3);
    await header(page, "w1").focus();
    await page.keyboard.press("Delete");
    await expect(step(page, "w1")).toHaveCount(0);
  });
});

test.describe("hotkey clashes while recording", () => {
  const space = { key: { vk: 0x20, scancode: 0x39, extended: false, label: "Space" }, modifiers: [], mode: "once" as const, swallow: false };
  test.use({ seed: { macros: [macro("First", { id: "a", trigger: space }), macro("Second", { id: "b" })] } });

  test("say so while recording a hotkey another macro has", async ({ app: { page } }) => {
    await page.getByRole("button", { name: /^Second/ }).click();
    await page.getByRole("button", { name: "Record" }).first().click();
    await page.keyboard.press("Space");
    await expect(page.getByText('Same hotkey as "First", which runs instead')).toBeVisible();
    await page.getByRole("button", { name: "Change" }).first().click();
    await page.keyboard.press("Shift+Space");
    await expect(page.getByText("Same hotkey as")).toHaveCount(0);
  });
});

test.describe("stop after", () => {
  test.use({ seed: { macros: [macro("Endless", { repeat: { kind: "forever" }, steps: [wait(50)] })] } });

  test("a run that repeats until stopped can end on its own", async ({ app: { page, dataDir } }) => {
    await page.getByRole("button", { name: /^Endless/ }).click();
    await expect(page.getByText("Useful here: this macro can run until stopped.")).toBeVisible();
    await page.getByRole("switch", { name: /^Stop after a while/ }).click();
    const minutes = page.getByRole("spinbutton", { name: "Minutes" });
    // It opens under the switch; typing before it has opened goes nowhere.
    await expect(minutes).toHaveValue("10");
    await expect(minutes.locator("xpath=ancestor::*[@inert]")).toHaveCount(0);
    await minutes.fill("3");
    await expect(minutes).toHaveValue("3");
    await save(page);
    const f = JSON.parse(await readFile(join(dataDir, "macros.json"), "utf8"));
    expect(f.macros[0].stop_after_ms).toBe(180_000);
  });
});

test.describe("picking a point", () => {
  test.use({ seed: { macros: [macro("Pick one", { steps: [{ ...clickAt(5, 5), id: "c1" }] })] } });

  test("records the monitor it was picked on; typing a number forgets it", async ({ app: { page, dataDir } }) => {
    await page.getByRole("button", { name: /^Pick one/ }).click();
    await header(page, "c1").click();
    await step(page, "c1").getByRole("button", { name: "Pick" }).click();
    await expect(step(page, "c1").getByRole("button", { name: "Pick" })).toBeVisible({ timeout: 6_000 });
    await save(page);
    // The fake mouse sits at (0, 0), on its 2560x1440 primary monitor.
    expect((await savedSteps(dataDir))[0].capture).toEqual({ monitor: "\\\\.\\DISPLAY2", monitor_rect: [0, 0, 2560, 1440], dpi: 120 });

    await step(page, "c1").getByRole("spinbutton", { name: "X", exact: true }).fill("12");
    await save(page);
    expect((await savedSteps(dataDir))[0].capture).toBeNull();
  });
});

test.describe("record mode", () => {
  // Test mode installs no hooks: Record "records" the events in record.json.
  const events = [
    { kind: "button", button: "left", down: true, x: 10, y: 20, t: 1000 },
    { kind: "button", button: "left", down: false, x: 10, y: 20, t: 1060 },
    { kind: "key", vk: 0x11, scan: 0x1d, extended: false, down: true, t: 1800 },
    { kind: "key", vk: 0x43, scan: 0x2e, extended: false, down: true, t: 1820 },
    { kind: "key", vk: 0x43, scan: 0x2e, extended: false, down: false, t: 1870 },
    { kind: "key", vk: 0x11, scan: 0x1d, extended: false, down: false, t: 1890 },
  ];
  test.use({ seed: { macros: [macro("Recorded")], files: { "record.json": JSON.stringify(events) } } });

  test("Record, then Stop, adds the clicks, keys and pauses as steps; Undo takes them back", async ({ app: { page } }) => {
    await page.getByRole("button", { name: /^Recorded/ }).click();
    await page.getByRole("button", { name: "Record steps" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Recording." })).toContainText("Press Esc or Stop recording");
    await page.getByRole("button", { name: "Stop recording" }).click();

    // Ctrl is held around C, each at the moment it went down and came up.
    await expect(page.getByText("Recorded 7 steps.")).toBeVisible();
    const headers = page.locator('[data-step-id] [role="button"][aria-expanded]');
    await expect(headers).toHaveCount(7);
    await expect(headers.nth(0)).toContainText("Click at (10, 20)");
    await expect(headers.nth(1)).toContainText("Wait 740 ms"); // from the release to Ctrl going down
    await expect(headers.nth(2)).toContainText("Hold Ctrl");
    await expect(headers.nth(3)).toContainText("Wait 20 ms");
    await expect(headers.nth(4)).toContainText("Press C");
    await expect(headers.nth(5)).toContainText("Wait 20 ms");
    await expect(headers.nth(6)).toContainText("Release Ctrl");

    await page.getByRole("status").filter({ hasText: "Recorded 7 steps." }).getByRole("button", { name: "Undo" }).click();
    await expect(headers).toHaveCount(0);
  });
});

test.describe("recording the way the mouse went", () => {
  // A click; then the mouse travels (300 to 700 ms after it) and Shift goes
  // down (left Shift, as the hook reports it) for a shift-click there.
  const events = [
    { kind: "button", button: "left", down: true, x: 10, y: 20, t: 1000 },
    { kind: "button", button: "left", down: false, x: 10, y: 20, t: 1060 },
    { kind: "move", x: 30, y: 25, t: 1300 },
    { kind: "move", x: 80, y: 40, t: 1500 },
    { kind: "move", x: 120, y: 60, t: 1700 },
    { kind: "key", vk: 0xa0, scan: 0x2a, extended: false, down: true, t: 1720 },
    { kind: "button", button: "left", down: true, x: 120, y: 60, t: 1760 },
    { kind: "button", button: "left", down: false, x: 120, y: 60, t: 1800 },
    { kind: "key", vk: 0xa0, scan: 0x2a, extended: false, down: false, t: 1850 },
  ];
  test.use({ seed: { macros: [macro("Traced")], files: { "record.json": JSON.stringify(events) } } });

  test("the movement keeps its path and travel time, and Shift is held when it was", async ({ app: { page, dataDir } }) => {
    await page.getByRole("button", { name: /^Traced/ }).click();
    await page.getByRole("button", { name: "Record steps" }).click();
    await page.getByRole("button", { name: "Stop recording" }).click();

    const headers = page.locator("[data-step-id] [data-step-header]");
    await expect(headers).toHaveCount(9);
    await expect(headers.nth(0)).toContainText("Click at (10, 20)");
    // The mouse set off 240 ms after the click ended and took 400 ms.
    await expect(headers.nth(1)).toContainText("Wait 240 ms");
    await expect(headers.nth(2)).toContainText("Move to (120, 60) over 400 ms (recorded path)");
    // Shift went down 20 ms after it arrived, the click 40 ms after that,
    // and Shift came up 50 ms after the click.
    await expect(headers.nth(3)).toContainText("Wait 20 ms");
    await expect(headers.nth(4)).toContainText("Hold LShift");
    await expect(headers.nth(5)).toContainText("Wait 40 ms");
    await expect(headers.nth(6)).toContainText("Click at (120, 60)");
    await expect(headers.nth(7)).toContainText("Wait 50 ms");
    await expect(headers.nth(8)).toContainText("Release LShift");

    await headers.nth(2).click();
    const move = page.locator("[data-step-id]").nth(2);
    await expect(move.getByRole("spinbutton", { name: "Travel" })).toHaveValue("400");
    await expect(move.getByText("Follows the recorded path (3 points).", { exact: false })).toBeVisible();

    await save(page);
    const saved = await savedSteps(dataDir);
    expect(saved[2]).toMatchObject({ type: "move", move_duration_ms: 400 });
    // Saved packed (lib/path.ts reads it).
    expect(decodePath(saved[2].path as string)).toEqual([
      { x: 30, y: 25, t: 0 },
      { x: 80, y: 40, t: 200 },
      { x: 120, y: 60, t: 400 },
    ]);
    expect([saved[4].action, saved[8].action]).toEqual(["down", "up"]);

    // Straight line instead drops the path, and the travel stays.
    await move.getByRole("button", { name: "Straight line instead" }).click();
    await expect(headers.nth(2)).not.toContainText("recorded path");
    await save(page);
    expect((await savedSteps(dataDir))[2].path).toBeUndefined();
  });
});

test.describe("recording a smooth wheel", () => {
  // Turns of less than a notch (a free-spinning wheel or a touchpad).
  const events = [
    { kind: "wheel", axis: "vertical", delta: -30, x: 40, y: 50, t: 1000 },
    { kind: "wheel", axis: "vertical", delta: -30, x: 40, y: 50, t: 1020 },
    { kind: "wheel", axis: "vertical", delta: -120, x: 40, y: 50, t: 1045 },
  ];
  test.use({ seed: { macros: [macro("Wheel")], files: { "record.json": JSON.stringify(events) } } });

  test("keeps every turn, fractions of a notch included, with its timing", async ({ app: { page, dataDir } }) => {
    await page.getByRole("button", { name: /^Wheel/ }).click();
    await page.getByRole("button", { name: "Record steps" }).click();
    await page.getByRole("button", { name: "Stop recording" }).click();

    const headers = page.locator("[data-step-id] [data-step-header]");
    await expect(headers).toHaveCount(1);
    await expect(headers.nth(0)).toContainText("Scroll down 1.5 (recorded)");

    await save(page);
    expect((await savedSteps(dataDir))[0].ticks).toEqual([
      { t: 0, delta: -30 },
      { t: 20, delta: -30 },
      { t: 45, delta: -120 },
    ]);
  });
});

test.describe("recording a key held through other actions", () => {
  // W goes down, a click happens half a second later, W comes up a second in
  // (Windows repeats the held key meanwhile).
  const events = [
    { kind: "key", vk: 0x57, scan: 0x11, extended: false, down: true, t: 1000 },
    { kind: "key", vk: 0x57, scan: 0x11, extended: false, down: true, t: 1500 },
    { kind: "button", button: "left", down: true, x: 40, y: 50, t: 1500 },
    { kind: "button", button: "left", down: false, x: 40, y: 50, t: 1550 },
    { kind: "key", vk: 0x57, scan: 0x11, extended: false, down: false, t: 2000 },
  ];
  test.use({ seed: { macros: [macro("Held")], files: { "record.json": JSON.stringify(events) } } });

  test("it is held down and released around the click, each at its moment", async ({ app: { page, dataDir } }) => {
    await page.getByRole("button", { name: /^Held/ }).click();
    await page.getByRole("button", { name: "Record steps" }).click();
    await page.getByRole("button", { name: "Stop recording" }).click();

    const headers = page.locator("[data-step-id] [data-step-header]");
    await expect(headers).toHaveCount(5);
    await expect(headers.nth(0)).toContainText("Hold W");
    await expect(headers.nth(1)).toContainText("Wait 500 ms");
    await expect(headers.nth(2)).toContainText("Click at (40, 50)");
    await expect(headers.nth(3)).toContainText("Wait 450 ms");
    await expect(headers.nth(4)).toContainText("Release W");

    await save(page);
    const saved = await savedSteps(dataDir);
    expect(saved.map((s) => [s.type, s.action])).toEqual([
      ["key", "down"],
      ["wait", undefined],
      ["click", "click"],
      ["wait", undefined],
      ["key", "up"],
    ]);
    // The click holds for as long as it was held, with no pause added.
    expect(saved[2]).toMatchObject({ hold_ms: { base: 50, jitter: 0 }, settle_ms: { base: 0, jitter: 0 } });
    // W repeated half a second in, as Windows repeats a held key: the replay
    // repeats it the same way (at Windows' usual pace after the first).
    expect(saved[0].repeat).toEqual({ delay_ms: 500, every_ms: 33 });
  });
});

test.describe("recording a click you rested on", () => {
  // The mouse arrives, rests 30 ms, clicks, and sets off again 2 ms after
  // the release.
  const events = [
    { kind: "move", x: 60, y: 50, t: 1000 },
    { kind: "move", x: 80, y: 50, t: 1020 },
    { kind: "move", x: 100, y: 50, t: 1040 },
    { kind: "button", button: "left", down: true, x: 100, y: 50, t: 1070 },
    { kind: "button", button: "left", down: false, x: 100, y: 50, t: 1120 },
    { kind: "move", x: 105, y: 50, t: 1122 },
    { kind: "move", x: 140, y: 50, t: 1150 },
    { kind: "button", button: "left", down: true, x: 140, y: 50, t: 1180 },
    { kind: "button", button: "left", down: false, x: 140, y: 50, t: 1230 },
  ];
  test.use({ seed: { macros: [macro("Rested")], files: { "record.json": JSON.stringify(events) } } });

  test("keeps the rest before the press and after the release apart", async ({ app: { page, dataDir } }) => {
    await page.getByRole("button", { name: /^Rested/ }).click();
    await page.getByRole("button", { name: "Record steps" }).click();
    await page.getByRole("button", { name: "Stop recording" }).click();

    const headers = page.locator("[data-step-id] [data-step-header]");
    await expect(headers).toHaveCount(3);
    await headers.nth(1).click();
    const first = page.locator("[data-step-id]").nth(1);
    await expect(first.getByRole("spinbutton", { name: "Rest before", exact: true })).toHaveValue("30");
    await expect(first.getByRole("spinbutton", { name: "Rest after", exact: true })).toHaveValue("2");

    await save(page);
    const saved = await savedSteps(dataDir);
    expect(saved[1]).toMatchObject({ settle_ms: { base: 30, jitter: 0 }, dwell_ms: { base: 2, jitter: 0 } });
  });
});

test.describe("points in the app's window", () => {
  const inWindow = { ...clickAt(0, 0), id: "cw", anchor: "window" as const, dx: 10, dy: 5 };
  test.describe("with App only set", () => {
    test.use({ seed: { macros: [macro("Windowed", { guard: { process: "game.exe", label: "" }, steps: [inWindow] })] } });

    test("say where they land, and a dry run shows them without clicking", async ({ app: { page } }) => {
      await page.getByRole("button", { name: /^Windowed/ }).click();
      await header(page, "cw").click();
      await expect(step(page, "cw").getByTestId("lands-at")).toContainText("Lands at app window + (10, 5)");
      await expect(header(page, "cw")).toContainText("Click at (10, 5) in the app's window");
      await expect(step(page, "cw").getByRole("button", { name: "Pick in the window" })).toBeVisible();

      await page.getByRole("button", { name: "Dry run" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Finished" })).toContainText("Finished Windowed (dry run)", {
        timeout: 8_000,
      });
    });
  });

  test.describe("without App only", () => {
    test.use({ seed: { macros: [macro("No app", { steps: [inWindow] })] } });

    test("say what is missing", async ({ app: { page } }) => {
      await page.getByRole("button", { name: /^No app/ }).click();
      await header(page, "cw").click();
      await expect(step(page, "cw").getByText("Turn on App only above and choose the app")).toBeVisible();
      await page.getByRole("button", { name: "Test", exact: true }).click();
      await expect(page.getByRole("alert").filter({ hasText: "stopped" })).toContainText(
        "A step aims inside the app's window, but the macro has no App only app.",
        { timeout: 8_000 },
      );
    });
  });
});

test.describe("while a run is on a step", () => {
  test.use({ seed: { macros: [macro("Lit", { steps: [{ ...wait(1500), id: "w1" }, { ...wait(10), id: "w2" }] })] } });

  test("that step lights up", async ({ app: { page } }) => {
    await page.getByRole("button", { name: /^Lit/ }).click();
    await page.getByRole("button", { name: "Test", exact: true }).click();
    await expect(step(page, "w1")).toHaveAttribute("data-running", "true", { timeout: 6_000 });
    await expect(page.locator("[data-running]")).toHaveCount(0, { timeout: 6_000 });
  });
});

// Regression: Pick made the magnifier window inside a synchronous command,
// which deadlocks the app's main thread on Windows: the pick never arrived,
// the tray menu went dead, and the macro list never loaded again.
test.describe("after a pick", () => {
  test.use({ seed: { macros: [macro("Keep me"), macro("Pick here", { steps: [{ ...clickAt(5, 5), id: "c1" }] })] } });

  test("the app still answers: the point arrives and the list loads", async ({ app: { page } }) => {
    await page.getByRole("button", { name: /^Pick here/ }).click();
    await header(page, "c1").click();
    await step(page, "c1").getByRole("button", { name: "Pick" }).click();
    await expect(step(page, "c1").getByRole("spinbutton", { name: "X", exact: true })).toHaveValue("0");
    await page.getByRole("button", { name: "Macros", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Discard" }).click();
    await expect(page.locator("li[data-macro-id]").filter({ hasText: "Keep me" })).toBeVisible();
  });
});
