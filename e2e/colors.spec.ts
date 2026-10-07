import type { Page } from "@playwright/test";
import { expect, test } from "./_launch";
import { clickAt, macro, wait } from "./data";

// Step colours and the right-click menu on a step.

const BLUE = "oklch(0.6 0.16 262)"; // the Click default
const RED = "oklch(0.63 0.19 25)";

const step = (page: Page, id: string) => page.locator(`[data-step-id="${id}"]`);
const header = (page: Page, id: string) => step(page, id).locator('[role="button"][aria-expanded]');

test.use({
  seed: {
    macros: [
      macro("Colors", {
        steps: [
          { ...clickAt(10, 10), id: "c1" },
          { ...clickAt(20, 20), id: "c2" },
          { ...wait(100), id: "w1" },
        ],
      }),
    ],
  },
});

const open = (page: Page) => page.getByRole("button", { name: /^Colors/ }).click();

test("each kind of step has its own color", async ({ app: { page } }) => {
  await open(page);
  await expect(step(page, "c1")).toHaveCSS("border-left-color", BLUE);
  await expect(step(page, "w1")).not.toHaveCSS("border-left-color", BLUE);
});

test("right-click recolors every step of that kind, and it sticks", async ({ app: { page } }) => {
  await open(page);
  await header(page, "c1").click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu).toContainText("Color for every Click step");
  await menu.getByRole("menuitem", { name: "Red" }).click();

  await expect(step(page, "c1")).toHaveCSS("border-left-color", RED);
  await expect(step(page, "c1")).toHaveCSS("border-bottom-color", RED); // the whole outline
  await expect(step(page, "c2")).toHaveCSS("border-left-color", RED);
  await expect(step(page, "w1")).not.toHaveCSS("border-left-color", RED);

  await page.reload();
  await open(page);
  await expect(step(page, "c2")).toHaveCSS("border-left-color", RED);

  // Settings shows the change and resets it.
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Reset all" }).click();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(step(page, "c1")).toHaveCSS("border-left-color", BLUE);
});

test("the right-click menu also duplicates and deletes", async ({ app: { page } }) => {
  await open(page);
  await header(page, "w1").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Duplicate" }).click();
  await expect(page.locator("[data-step-id]")).toHaveCount(4);

  await header(page, "c1").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(step(page, "c1")).toHaveCount(0);
  await expect(page.locator("[data-step-id]")).toHaveCount(3);
});

test("right-clicking an input keeps the normal menu", async ({ app: { page } }) => {
  await open(page);
  await header(page, "c1").click();
  await step(page, "c1").getByRole("spinbutton", { name: "X", exact: true }).click({ button: "right" });
  await expect(page.getByRole("menu")).toHaveCount(0);
});
