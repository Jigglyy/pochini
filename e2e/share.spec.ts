import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./_launch";
import { clickAt, macro, wait } from "./data";

// Sharing macros: Export writes a .pochini.json file, Import reads one.
// Test mode answers the file dialogs with the seed's `dialog` file.

const row = (page: Page, name: string) => page.locator("li[data-macro-id]").filter({ hasText: name });

async function library(dataDir: string) {
  return JSON.parse(await readFile(join(dataDir, "macros.json"), "utf8")).macros as {
    id: string;
    name: string;
    enabled: boolean;
    steps: unknown[];
  }[];
}

test.describe("export", () => {
  test.use({
    seed: {
      macros: [macro("Fill form", { id: "s", color: "cyan", favorite: true, steps: [clickAt(10, 10), wait(50)] })],
      dialog: "out.pochini.json",
    },
  });

  test("Export writes the macro to a file", async ({ app: { page, dataDir } }) => {
    await page.getByRole("button", { name: "More actions for Fill form" }).click();
    await page.getByRole("menuitem", { name: "Export..." }).click();
    await expect(page.getByRole("status").filter({ hasText: "Exported" })).toContainText('Exported "Fill form" to');

    const file = JSON.parse(await readFile(join(dataDir, "out.pochini.json"), "utf8"));
    expect(file.format).toBe("pochini.macros");
    expect(file.version).toBe(1);
    expect(file.macros).toHaveLength(1);
    expect(file.macros[0]).toMatchObject({ name: "Fill form", color: "cyan", favorite: false });
    expect(file.macros[0].steps).toHaveLength(2);
  });

  test("the right-click menu exports too", async ({ app: { page, dataDir } }) => {
    await row(page, "Fill form").click({ button: "right" });
    await page.getByRole("menu").getByRole("menuitem", { name: "Export..." }).click();
    await expect.poll(async () => JSON.parse(await readFile(join(dataDir, "out.pochini.json"), "utf8")).macros[0].name).toBe("Fill form");
  });
});

const shared = {
  format: "pochini.macros",
  version: 1,
  macros: [macro("Fill form", { id: "theirs", enabled: true, steps: [clickAt(5, 5)] }), macro("Buy", { id: "b2" })],
};

test.describe("import", () => {
  test.use({
    seed: {
      macros: [macro("Fill form", { id: "mine" })],
      files: { "shared.pochini.json": JSON.stringify(shared) },
      dialog: "shared.pochini.json",
    },
  });

  test("Import adds the macros as new ones, hotkeys off", async ({ app: { page, dataDir } }) => {
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Imported" })).toContainText(
      "Imported 2 macros. Their hotkeys are off until you turn them on.",
    );
    await expect(row(page, "Fill form (imported)")).toBeVisible();
    await expect(row(page, "Buy")).toBeVisible();
    await expect(row(page, "Buy").getByRole("switch")).not.toBeChecked();

    const lib = await library(dataDir);
    expect(lib.map((m) => m.name)).toEqual(["Fill form", "Fill form (imported)", "Buy"]);
    expect(lib.every((m, i) => i === 0 || !m.enabled)).toBe(true);
    expect(new Set(lib.map((m) => m.id)).size).toBe(3);
    expect(lib.map((m) => m.id)).not.toContain("theirs");
  });
});

test.describe("importing something else", () => {
  test.use({
    seed: { macros: [macro("Keep")], files: { "notes.json": '{"hello": "world"}' }, dialog: "notes.json" },
  });

  test("a file that is not an export is refused with a reason", async ({ app: { page, dataDir } }) => {
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await expect(page.getByText("That file is not a Pochini macro export.")).toBeVisible();
    expect((await library(dataDir)).map((m) => m.name)).toEqual(["Keep"]);
  });
});
