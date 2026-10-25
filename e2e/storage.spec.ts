import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "./_launch";
import { macro } from "./data";

// A macros file the app cannot read must never turn into an empty list that
// the next save writes over (Store::open_macros).

const newer = JSON.stringify({ schema_version: 99, macros: [] });

test.describe("a library from a newer Pochini", () => {
  test.use({ seed: { files: { "macros.json": newer } } });

  test("is kept, nothing is saved over it, and Start fresh unlocks", async ({ app: { page, dataDir } }) => {
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("Your macros could not be loaded");
    await expect(alert).toContainText("saved by a newer Pochini");
    expect((await readdir(dataDir)).some((f) => f.startsWith("macros.json.unreadable-"))).toBe(true);

    // Creating a macro is refused rather than written over the file.
    await page.getByRole("button", { name: "New macro" }).click();
    await expect(page.getByText("Not saved: your macros file could not be read")).toBeVisible();
    expect(await readFile(join(dataDir, "macros.json"), "utf8")).toBe(newer);

    await alert.getByRole("button", { name: "Start fresh..." }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Start fresh" }).click();
    await expect(alert).toHaveCount(0);
    await page.getByRole("button", { name: "New macro" }).click();
    await expect(page.getByRole("textbox", { name: "Macro name" })).toBeVisible();
    expect(JSON.parse(await readFile(join(dataDir, "macros.json"), "utf8")).schema_version).toBe(1);
  });
});

test.describe("a damaged library with a good backup", () => {
  test.use({
    seed: {
      files: {
        "macros.json": "{ not json",
        "macros.bak": JSON.stringify({ schema_version: 1, macros: [macro("Rescued")] }),
      },
    },
  });

  test("loads the backup and says so", async ({ app: { page } }) => {
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("restored from the backup");
    await expect(page.locator("li[data-macro-id]").filter({ hasText: "Rescued" })).toBeVisible();
    await alert.getByRole("button", { name: "Got it" }).click();
    await expect(alert).toHaveCount(0);
  });
});
