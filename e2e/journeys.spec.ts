import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { drag, expect, test } from "./_launch";
import { clickAt, macro, wait } from "./data";

// Flows that cross screens, and edges the screen-by-screen specs leave out.

const row = (page: Page, name: string) => page.locator("li[data-macro-id]").filter({ hasText: name });
const json = async (dataDir: string, file: string) => JSON.parse(await readFile(join(dataDir, file), "utf8"));
/** For polls: null until the file exists and parses. */
const maybeJson = (dataDir: string, file: string) => json(dataDir, file).catch(() => null);

test.describe("an imported macro checked in the editor", () => {
  const shared = { format: "pochini.macros", version: 1, macros: [macro("Shared", { steps: [clickAt(5, 5)] })] };
  test.use({ seed: { files: { "shared.pochini.json": JSON.stringify(shared) }, dialog: "shared.pochini.json" } });

  test("saving it there counts as checked, on screen and on disk", async ({ app: { page, dataDir } }) => {
    await page.getByRole("button", { name: "Import a macro" }).click();
    await row(page, "Shared").getByRole("switch").click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Open in editor" }).click();

    const notice = page.getByText("Imported from a file, so someone else wrote it.");
    await expect(notice).toBeVisible();
    await page.getByRole("textbox", { name: "Macro name" }).fill("Shared, checked");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    // Regression: the notice stayed until the macro was opened again.
    await expect(notice).toHaveCount(0);
    expect((await json(dataDir, "macros.json")).macros[0].review).toBe(false);

    await page.getByRole("button", { name: "Macros", exact: true }).click();
    await expect(row(page, "Shared, checked")).not.toContainText("check it before use");
    await row(page, "Shared, checked").getByRole("switch").click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(row(page, "Shared, checked").getByRole("switch")).toBeChecked();
  });
});

test.describe("backup", () => {
  test.use({
    seed: { macros: [macro("One", { color: "teal" }), macro("Two", { favorite: true })], dialog: "all.pochini.json" },
  });

  test("Export all writes every macro to one file that Import reads", async ({ app: { page, dataDir } }) => {
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Export all macros..." }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved to" })).toContainText("all.pochini.json");
    const file = await json(dataDir, "all.pochini.json");
    expect(file.format).toBe("pochini.macros");
    expect(file.macros.map((m: { name: string }) => m.name)).toEqual(["One", "Two"]);
    expect(file.macros[1].favorite).toBe(false); // the star stays home
  });
});

test.describe("an empty library", () => {
  test("Export all says there is nothing to export", async ({ app: { page } }) => {
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Export all macros..." }).click();
    await expect(page.getByText("There are no macros to export yet.")).toBeVisible();
  });
});

test.describe("a different panic key", () => {
  test.use({ seed: { macros: [macro("Slow", { steps: [wait(1500)] })] } });

  test("is saved, and the run pill names it", async ({ app: { page, dataDir } }) => {
    await page.getByRole("button", { name: "Settings" }).click();
    // The Field row that holds the "Panic stop" label and its key.
    const panic = page.getByRole("button", { name: "About Panic stop" }).locator("xpath=ancestor::div[contains(@class, 'grid-cols')][1]");
    await panic.getByRole("button", { name: "Change" }).click();
    await page.keyboard.press("F9");
    await expect.poll(async () => (await maybeJson(dataDir, "settings.json"))?.panic_key?.label).toBe("F9");

    await page.getByRole("button", { name: "Macros", exact: true }).click();
    await row(page, "Slow").getByRole("button", { name: "Run" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Running" })).toContainText("F9 stops it", { timeout: 6_000 });
  });
});

test.describe("run history", () => {
  test.use({ seed: { macros: [macro("Quick", { steps: [wait(10)] })] } });

  test("Clear empties it", async ({ app: { page } }) => {
    await page.getByRole("button", { name: /^Quick/ }).click();
    await page.getByRole("button", { name: "Test", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Finished" })).toBeVisible({ timeout: 8_000 });
    await page.getByRole("button", { name: "Settings" }).click();
    const history = page.locator("section").filter({ has: page.getByRole("heading", { name: "Run history" }) });
    await expect(history).toContainText("Quick (test)");
    await history.getByRole("button", { name: "Clear" }).click();
    await expect(history).toContainText("No runs yet.");
  });
});

test.describe("the macro list", () => {
  const space = { key: { vk: 0x20, scancode: 0x39, extended: false, label: "Space" }, modifiers: [], mode: "once" as const, swallow: false };
  test.use({
    seed: {
      macros: [
        macro("Alpha", { trigger: space, steps: [clickAt(1, 1), wait(5)] }),
        macro("Bravo"),
        macro("Charlie"),
        macro("Delta"),
        macro("Echo"),
      ],
    },
  });

  test("a duplicate is a copy without the hotkey", async ({ app: { page, dataDir } }) => {
    await page.getByRole("button", { name: "More actions for Alpha" }).click();
    await page.getByRole("menuitem", { name: "Duplicate" }).click();
    await expect(row(page, "Alpha (copy)")).toContainText("No hotkey");
    await expect(row(page, "Alpha (copy)")).toContainText("2 steps");
    const copy = (await json(dataDir, "macros.json")).macros.find((m: { name: string }) => m.name === "Alpha (copy)");
    expect(copy.trigger).toBeNull();
  });

  test("rows cannot be dragged while a search filters them", async ({ app: { page } }) => {
    const grips = page.locator("li[data-macro-id] .lucide-grip-vertical");
    await expect(grips).toHaveCount(5);
    await page.getByRole("searchbox", { name: "Find a macro" }).fill("a");
    await expect(grips).toHaveCount(0);
  });

  test("Ctrl+N makes a macro and opens it", async ({ app: { page } }) => {
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+n");
    await expect(page.getByRole("textbox", { name: "Macro name" })).toHaveValue("New macro");
  });
});

test.describe("the on/off hotkey", () => {
  const toggle = { key: { vk: 0x54, scancode: 0x14, extended: false, label: "T" }, modifiers: ["ctrl", "shift"] };
  test.use({ seed: { macros: [macro("Mine")], files: { "settings.json": JSON.stringify({ welcomed: true, toggle_hotkey: toggle }) } } });

  test("recorded as a macro's hotkey is a clash", async ({ app: { page } }) => {
    await page.getByRole("button", { name: /^Mine/ }).click();
    await page.getByRole("button", { name: "Record" }).first().click();
    await page.keyboard.press("Control+Shift+KeyT");
    await expect(page.getByText("Same as the on/off hotkey, so it never runs")).toBeVisible();
  });
});

test.describe("unsaved changes", () => {
  test.use({ seed: { macros: [macro("Draft", { steps: [{ ...wait(100), id: "s1" }, { ...wait(200), id: "s2" }, { ...wait(300), id: "s3" }] })] } });

  test("Keep editing keeps them", async ({ app: { page } }) => {
    await page.getByRole("button", { name: /^Draft/ }).click();
    await page.getByRole("textbox", { name: "Macro name" }).fill("Draft 2");
    await page.getByRole("button", { name: "Macros", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Keep editing" }).click();
    await expect(page.getByRole("textbox", { name: "Macro name" })).toHaveValue("Draft 2");
  });

  test("a drag can be undone", async ({ app: { page } }) => {
    await page.getByRole("button", { name: /^Draft/ }).click();
    const header = (id: string) => page.locator(`[data-step-id="${id}"] [role="button"][aria-expanded]`);
    const order = () => page.locator("[data-step-id]").evaluateAll((els) => els.map((e) => e.getAttribute("data-step-id")));
    await drag(page, header("s3"), header("s1"), -10);
    await expect.poll(order).toEqual(["s3", "s1", "s2"]);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(order).toEqual(["s1", "s2", "s3"]);
  });
});

test.describe("waiting for a color that never shows, set to carry on", () => {
  test.use({
    seed: {
      macros: [
        macro("Patient", {
          steps: [{ type: "wait_color", id: "wc", shuffle: false, x: 1, y: 1, color: "#ffffff", tolerance: 0, timeout_ms: 200, on_timeout: "continue" }],
        }),
      ],
    },
  });

  test("finishes normally", async ({ app: { page } }) => {
    await page.getByRole("button", { name: /^Patient/ }).click();
    await page.getByRole("button", { name: "Test", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Finished" })).toContainText("Finished Patient (test)", {
      timeout: 8_000,
    });
  });
});
