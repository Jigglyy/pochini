import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { dragOnto, expect, test } from "./_launch";
import { clickAt, macro, wait } from "./data";

// Working with many steps: the three layouts, ticking steps and changing
// them together, inserting in the middle, and folding the sections above.

const step = (page: Page, id: string) => page.locator(`[data-step-id="${id}"]`);
const header = (page: Page, id: string) => step(page, id).locator("[data-step-header]");
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

const seed = {
  macros: [
    macro("Long", {
      steps: [
        { ...clickAt(10, 10), id: "c1" },
        { ...wait(100), id: "w1" },
        { ...clickAt(20, 20), id: "c2" },
        { ...wait(200), id: "w2" },
        { ...clickAt(30, 30), id: "c3", anchor: "previous" as const, dx: 5 },
      ],
    }),
  ],
};

test.describe("layouts", () => {
  test.use({ seed });

  test("compact and split lay the same steps out; the choice is remembered", async ({ app: { page } }) => {
    await page.getByRole("button", { name: /^Long/ }).click();
    await expect(page.locator('[data-step-view="cards"]')).toBeVisible();

    await page.getByRole("button", { name: "Compact list" }).click();
    await expect(page.locator('[data-step-view="compact"]')).toBeVisible();
    await header(page, "w1").click();
    await expect(step(page, "w1").getByRole("spinbutton", { name: "Wait", exact: true })).toBeVisible();

    // Split: the open step is the one shown beside the list.
    await page.getByRole("button", { name: "Side by side" }).click();
    const detail = page.getByTestId("step-detail");
    await expect(detail).toContainText("Step 2 of 5");
    await header(page, "c2").click();
    await expect(detail).toContainText("Step 3 of 5");
    await detail.getByRole("spinbutton", { name: "X", exact: true }).fill("25");
    await expect(header(page, "c2")).toContainText("Click at (25, 20)");

    // The arrow keys walk the list, showing each step.
    await header(page, "c2").focus();
    await page.keyboard.press("ArrowDown");
    await expect(detail).toContainText("Step 4 of 5");

    await page.reload();
    await page.getByRole("button", { name: /^Long/ }).click();
    await expect(page.locator('[data-step-view="split"]')).toBeVisible();
  });

  test("squares show the steps as tiles with the settings beside", async ({ app: { page } }) => {
    await page.getByRole("button", { name: /^Long/ }).click();
    await page.getByRole("button", { name: "Squares" }).click();
    const grid = page.locator('[data-step-view="squares"]');
    await expect(grid).toBeVisible();
    await expect(grid.locator("[data-step-header]")).toHaveCount(5);
    await expect(header(page, "c2")).toContainText("20, 20");
    await expect(header(page, "c2")).toContainText("Click at (20, 20)");

    const detail = page.getByTestId("step-detail");
    await header(page, "c2").click();
    await expect(detail).toContainText("Step 3 of 5");
    await detail.getByRole("spinbutton", { name: "X", exact: true }).fill("25");
    await expect(header(page, "c2")).toContainText("25, 20");

    // The arrow keys walk the grid, showing each step.
    await header(page, "c2").focus();
    await page.keyboard.press("ArrowRight");
    await expect(detail).toContainText("Step 4 of 5");
    await page.keyboard.press("ArrowLeft");
    await expect(detail).toContainText("Step 3 of 5");

    await page.reload();
    await page.getByRole("button", { name: /^Long/ }).click();
    await expect(page.locator('[data-step-view="squares"]')).toBeVisible();
  });

  test("squares reorder by dragging", async ({ app: { page, dataDir } }) => {
    await page.getByRole("button", { name: /^Long/ }).click();
    await page.getByRole("button", { name: "Squares" }).click();
    await dragOnto(page, header(page, "c3"), header(page, "c1"));
    await expect.poll(async () => (await stepOrder(page))[0]).toBe("c3");
    await save(page);
    expect((await savedSteps(dataDir)).map((s) => s.id)).toEqual(["c3", "c1", "w1", "c2", "w2"]);
  });

  test("Close every step folds all the open ones", async ({ app: { page } }) => {
    await page.getByRole("button", { name: /^Long/ }).click();
    await header(page, "c1").click();
    await header(page, "w1").click();
    await expect(page.locator('[data-step-header][aria-expanded="true"]')).toHaveCount(2);
    await page.getByRole("button", { name: "Close every step" }).click();
    await expect(page.locator('[data-step-header][aria-expanded="true"]')).toHaveCount(0);
  });
});

test.describe("squares", () => {
  test.use({
    seed: {
      macros: [
        macro("Grid", {
          steps: Array.from({ length: 12 }, (_, i) =>
            i % 2 ? { ...wait(100 + i), id: `s${i + 1}` } : { ...clickAt(10 * i, 20), id: `s${i + 1}` },
          ),
        }),
      ],
    },
  });

  const open = async (page: Page) => {
    await page.getByRole("button", { name: /^Grid/ }).click();
    await page.getByRole("button", { name: "Squares" }).click();
    await expect(page.locator('[data-step-view="squares"]')).toBeVisible();
    // The squares glide from the list into the grid; a click mid-glide can
    // land on the square next to it.
    await page.waitForFunction(() => [...document.querySelectorAll("[data-flip]")].every((el) => el.getAnimations().length === 0));
  };
  const tiles = (page: Page) => page.locator('[data-step-view="squares"] [data-step-header]');

  test("up and down move a row of the grid", async ({ app: { page } }) => {
    await open(page);
    const cols = await page
      .locator('[data-step-view="squares"]')
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").filter(Boolean).length);
    expect(cols).toBeGreaterThan(1);
    expect(cols).toBeLessThan(12);
    const detail = page.getByTestId("step-detail");
    await tiles(page).nth(0).focus();
    await expect(detail).toContainText("Step 1 of 12");
    await page.keyboard.press("ArrowDown");
    await expect(detail).toContainText(`Step ${cols + 1} of 12`);
    await page.keyboard.press("ArrowUp");
    await expect(detail).toContainText("Step 1 of 12");
  });

  test("Ctrl+click starts choosing, and the panel changes the chosen ones together", async ({ app: { page } }) => {
    await open(page);
    await header(page, "s2").click({ modifiers: ["Control"] });
    const bar = page.getByRole("toolbar", { name: "Selected steps" });
    await expect(bar).toContainText("1 of 12 selected");
    await header(page, "s4").click();
    await expect(bar).toContainText("2 of 12 selected");
    await expect(step(page, "s4")).toHaveAttribute("data-selected", "true");
    const detail = page.getByTestId("step-detail");
    await detail.getByRole("spinbutton", { name: "Wait", exact: true }).fill("150");
    await expect(header(page, "s2")).toContainText("150 ms");
    await expect(header(page, "s4")).toContainText("150 ms");
    await expect(header(page, "s6")).toContainText("105 ms");
  });

  test("a square's right-click menu duplicates, and Delete removes the focused one", async ({ app: { page } }) => {
    await open(page);
    await header(page, "s1").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Duplicate" }).click();
    await expect(tiles(page)).toHaveCount(13);
    await header(page, "s3").focus();
    await page.keyboard.press("Delete");
    await expect(tiles(page)).toHaveCount(12);
    await expect(step(page, "s3")).toHaveCount(0);
    await page.getByRole("button", { name: "Undo", exact: true }).first().click();
    await expect(step(page, "s3")).toHaveCount(1);
  });

  // Regression: choosing a step with fewer settings shrank the page under the
  // pointer, between the press and the release: the squares jumped and a
  // Ctrl+click or Shift+click landed nowhere.
  for (const layout of ["Squares", "Side by side"]) {
    test(`in ${layout}, choosing a step with fewer settings does not move the steps`, async ({ app: { page } }) => {
      await page.getByRole("button", { name: /^Grid/ }).click();
      await page.getByRole("button", { name: layout }).click();
      await page.waitForFunction(() => [...document.querySelectorAll("[data-flip]")].every((el) => el.getAnimations().length === 0));
      const detail = page.getByTestId("step-detail");
      // A click step's settings are the tallest; then scroll to the bottom.
      await expect(detail).toContainText("Step 1 of 12");
      await page.locator("main").evaluate((m) => m.scrollTo(0, m.scrollHeight));
      // So the click itself needs no scroll.
      await header(page, "s2").scrollIntoViewIfNeeded();
      const before = await header(page, "s12").boundingBox();
      await header(page, "s2").click();
      await expect(detail).toContainText("Step 2 of 12");
      const after = await header(page, "s12").boundingBox();
      expect(Math.abs(after!.y - before!.y)).toBeLessThan(1);
    });
  }

  test("a step added under the grid is shown beside it", async ({ app: { page } }) => {
    await open(page);
    await page.getByRole("group", { name: "Add a step" }).getByRole("button", { name: "Wait", exact: true }).click();
    await expect(tiles(page)).toHaveCount(13);
    await expect(page.getByTestId("step-detail")).toContainText("Step 13 of 13");
  });
});

test.describe("changing many steps at once", () => {
  test.use({ seed });

  test("select every click, leave one out, and give the rest jitter", async ({ app: { page, dataDir } }) => {
    await page.getByRole("button", { name: /^Long/ }).click();
    await page.getByRole("button", { name: "Select", exact: true }).click();
    const bar = page.getByRole("toolbar", { name: "Selected steps" });
    await expect(bar).toContainText("0 of 5 selected");

    await bar.getByRole("button", { name: "Select by kind" }).click();
    await page.getByRole("menuitemcheckbox", { name: /^Click/ }).first().click();
    await page.keyboard.press("Escape");
    await expect(bar).toContainText("2 of 5 selected");

    // Untick c2, tick the "click at mouse" c3 by hand.
    await header(page, "c2").click();
    await header(page, "c3").click();
    await expect(bar).toContainText("2 of 5 selected");
    await expect(step(page, "c1")).toHaveAttribute("data-selected", "true");
    await expect(step(page, "c2")).not.toHaveAttribute("data-selected", "true");

    await bar.getByRole("button", { name: "Edit 2 steps" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("spinbutton", { name: "Jitter" })).toHaveValue("0");
    await dialog.getByRole("spinbutton", { name: "Jitter" }).fill("4");
    await dialog.getByRole("spinbutton", { name: "Settle random extra" }).fill("30");
    await dialog.getByRole("button", { name: "Done" }).click();

    await bar.getByRole("button", { name: "Done" }).click();
    await expect(bar).toHaveCount(0);
    await save(page);
    const steps = await savedSteps(dataDir);
    expect(steps.map((s) => [s.id, s.coord_jitter_px ?? null])).toEqual([
      ["c1", 4],
      ["w1", null],
      ["c2", 0],
      ["w2", null],
      ["c3", 4],
    ]);
    // The base settle stays each step's own; only the randomness was added.
    expect(steps[0].settle_ms).toEqual({ base: 50, jitter: 30 });
    expect(steps[2].settle_ms).toEqual({ base: 50, jitter: 0 });
  });

  test("Shift+click ticks a range, and Delete removes it with Undo", async ({ app: { page } }) => {
    await page.getByRole("button", { name: /^Long/ }).click();
    await header(page, "w1").click({ modifiers: ["Control"] }); // starts choosing, with w1
    await header(page, "w2").click({ modifiers: ["Shift"] });
    const bar = page.getByRole("toolbar", { name: "Selected steps" });
    await expect(bar).toContainText("3 of 5 selected");

    await page.keyboard.press("Delete");
    await expect.poll(() => stepOrder(page)).toEqual(["c1", "c3"]);
    await expect(page.getByRole("status").filter({ hasText: "Deleted 3 steps." })).toBeVisible();
    await page.getByRole("status").filter({ hasText: "Deleted" }).getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => stepOrder(page)).toEqual(["c1", "w1", "c2", "w2", "c3"]);
    // They come back still ticked.
    await expect(bar).toContainText("3 of 5 selected");
  });

  test("Ctrl+A selects them all; Duplicate puts copies after the last one", async ({ app: { page } }) => {
    await page.getByRole("button", { name: /^Long/ }).click();
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+A");
    const bar = page.getByRole("toolbar", { name: "Selected steps" });
    await expect(bar).toContainText("5 of 5 selected");

    await bar.getByRole("checkbox", { name: "Select every step" }).click();
    await expect(bar).toContainText("0 of 5 selected");
    await header(page, "c1").click();
    await header(page, "w1").click();
    await bar.getByRole("button", { name: "Duplicate" }).click();
    const order = await stepOrder(page);
    expect(order).toHaveLength(7);
    expect(order.slice(0, 2)).toEqual(["c1", "w1"]);
    expect(order.slice(4)).toEqual(["c2", "w2", "c3"]);
    // The copies are now the selection.
    await expect(bar).toContainText("2 of 7 selected");
    await expect(step(page, order[2]!)).toHaveAttribute("data-selected", "true");
  });

  test("in split view the settings panel edits the selection", async ({ app: { page } }) => {
    await page.getByRole("button", { name: /^Long/ }).click();
    await page.getByRole("button", { name: "Side by side" }).click();
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await header(page, "w1").click();
    await header(page, "w2").click();
    const detail = page.getByTestId("step-detail");
    await expect(detail).toContainText("Waits2");
    // 100 and 200 ms: Mixed.
    await expect(detail.getByRole("spinbutton", { name: "Wait", exact: true })).toHaveValue("");
    await detail.getByRole("spinbutton", { name: "Wait", exact: true }).fill("150");
    await expect(header(page, "w1")).toContainText("Wait 150 ms");
    await expect(header(page, "w2")).toContainText("Wait 150 ms");
  });
});

test.describe("inserting and folding", () => {
  test.use({ seed });

  test("Insert below puts the new step right after, opened", async ({ app: { page, dataDir } }) => {
    await page.getByRole("button", { name: /^Long/ }).click();
    await header(page, "w1").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Insert below" }).click();
    await page.getByRole("menuitem", { name: "Key", exact: true }).click();
    const order = await stepOrder(page);
    expect(order).toHaveLength(6);
    expect(order[2]).not.toMatch(/^(c|w)\d$/);
    await expect(step(page, order[2]!).locator("[data-step-header]")).toHaveAttribute("aria-expanded", "true");

    await header(page, "c3").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Move to top" }).click();
    await expect.poll(async () => (await stepOrder(page))[0]).toBe("c3");
    await save(page);
    expect((await savedSteps(dataDir))[3].type).toBe("key");
  });

  test("a folded section shows its summary, and stays folded", async ({ app: { page } }) => {
    await page.getByRole("button", { name: /^Long/ }).click();
    await page.getByRole("button", { name: "When it runs" }).click();
    await expect(page.getByText("Runs once", { exact: true })).toBeVisible();
    await expect(page.getByText("Move mouse back to where it started")).toBeHidden();

    await page.reload();
    await page.getByRole("button", { name: /^Long/ }).click();
    await expect(page.getByRole("button", { name: "When it runs" })).toHaveAttribute("aria-expanded", "false");
    await page.getByRole("button", { name: "When it runs" }).click();
    await expect(page.getByText("Move mouse back to where it started")).toBeVisible();
  });
});
