import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { drag, expect, test } from "./_launch";
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
