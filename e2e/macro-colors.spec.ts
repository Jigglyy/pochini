import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./_launch";
import { macro } from "./data";

// Coloring macros on the list: right-click a row, or the row's menu.

const RED = "oklch(0.63 0.19 25)";
const TEAL = "oklch(0.68 0.1 195)";

const row = (page: Page, id: string) => page.locator(`li[data-macro-id="${id}"]`);

async function savedColor(dataDir: string, id: string) {
  const f = JSON.parse(await readFile(join(dataDir, "macros.json"), "utf8"));
  return f.macros.find((m: { id: string }) => m.id === id)?.color ?? null;
}

test.use({ seed: { macros: [macro("Alpha", { id: "a" }), macro("Bravo", { id: "b" })] } });

test("right-click a macro to color it; it is saved with the macro", async ({ app: { page, dataDir } }) => {
  await row(page, "a").click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu).toContainText("Color");
  await menu.getByRole("menuitem", { name: "Red" }).click();

  await expect(row(page, "a")).toHaveCSS("border-left-color", RED);
  // The whole outline, not just the edge (Kanbini's colored cards).
  await expect(row(page, "a")).toHaveCSS("border-top-color", RED);
  await expect(row(page, "a")).toHaveCSS("border-right-color", RED);
  await expect(row(page, "b")).not.toHaveCSS("border-left-color", RED);
  await expect.poll(() => savedColor(dataDir, "a")).toBe("red");

  await page.reload();
  await expect(row(page, "a")).toHaveCSS("border-left-color", RED);
});

test("the row menu has the same colors, and No color clears it", async ({ app: { page, dataDir } }) => {
  await page.getByRole("button", { name: "More actions for Bravo" }).click();
  await page.getByRole("menuitem", { name: "Color" }).click();
  await page.getByRole("menuitem", { name: "Teal" }).click();
  await expect(row(page, "b")).toHaveCSS("border-left-color", TEAL);
  await expect.poll(() => savedColor(dataDir, "b")).toBe("teal");

  await row(page, "b").click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "No color" }).click();
  await expect(row(page, "b")).not.toHaveCSS("border-left-color", TEAL);
  await expect.poll(() => savedColor(dataDir, "b")).toBe(null);
});

test("coloring is not an edit: Recently edited order stays", async ({ app: { page, dataDir } }) => {
  const before = JSON.parse(await readFile(join(dataDir, "macros.json"), "utf8")).macros[0].updated_at;
  await row(page, "a").click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Purple" }).click();
  await expect.poll(() => savedColor(dataDir, "a")).toBe("purple");
  const after = JSON.parse(await readFile(join(dataDir, "macros.json"), "utf8")).macros[0].updated_at;
  expect(after).toBe(before);
});

test.describe("a switched-off macro", () => {
  test.use({ seed: { macros: [macro("Off one", { id: "off", enabled: false, color: "red" })] } });

  test("keeps only the colored edge", async ({ app: { page } }) => {
    await expect(row(page, "off")).toHaveCSS("border-left-color", RED);
    await expect(row(page, "off")).not.toHaveCSS("border-top-color", RED);
  });
});
