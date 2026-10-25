import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./_launch";
import { clickAt, macro, typeText, wait } from "./data";

// Sharing macros: Export writes a .pochini.json file, Import reads one.
// Test mode answers the file dialogs with the seed's `dialog` file.

const row = (page: Page, name: string) => page.locator("li[data-macro-id]").filter({ hasText: name });

async function library(dataDir: string) {
  return JSON.parse(await readFile(join(dataDir, "macros.json"), "utf8")).macros as {
    id: string;
    name: string;
    enabled: boolean;
    review: boolean;
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
    // Waits for the file to appear rather than failing on the first read.
    const exported = () => readFile(join(dataDir, "out.pochini.json"), "utf8").then(JSON.parse).catch(() => null);
    await expect.poll(async () => (await exported())?.macros[0].name).toBe("Fill form");
  });
});

const shared = {
  format: "pochini.macros",
  version: 1,
  macros: [macro("Fill form", { id: "theirs", enabled: true, steps: [clickAt(5, 5)] }), macro("Copy row", { id: "b2" })],
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
      "Imported 2 macros. Their hotkeys are off: you'll see each one's steps before you turn it on or run it.",
    );
    await expect(row(page, "Fill form (imported)")).toBeVisible();
    await expect(row(page, "Copy row")).toBeVisible();
    await expect(row(page, "Copy row").getByRole("switch")).not.toBeChecked();

    const lib = await library(dataDir);
    expect(lib.map((m) => m.name)).toEqual(["Fill form", "Fill form (imported)", "Copy row"]);
    expect(lib.every((m, i) => i === 0 || !m.enabled)).toBe(true);
    expect(lib.map((m) => m.review)).toEqual([false, true, true]);
    await expect(row(page, "Copy row")).toContainText("Imported, check it before use");
    expect(new Set(lib.map((m) => m.id)).size).toBe(3);
    expect(lib.map((m) => m.id)).not.toContain("theirs");
  });
});

const risky = {
  format: "pochini.macros",
  version: 1,
  macros: [
    macro("Helper", {
      repeat: { kind: "forever" },
      steps: [
        {
          type: "key",
          id: "k",
          shuffle: false,
          key: { vk: 0x52, scancode: 0x13, extended: false, label: "R" },
          action: "press",
          modifiers: ["win"],
          hold_ms: { base: 20, jitter: 0 },
        },
        typeText("powershell"),
      ],
    }),
  ],
};

test.describe("reviewing an imported macro", () => {
  test.use({
    seed: { files: { "risky.pochini.json": JSON.stringify(risky) }, dialog: "risky.pochini.json" },
  });

  test("its steps are shown before it can be switched on", async ({ app: { page, dataDir } }) => {
    await page.getByRole("button", { name: "Import a macro" }).click();
    await row(page, "Helper").getByRole("switch").click();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText('Check "Helper" first');
    await expect(dialog).toContainText("It repeats until you stop it");
    const steps = dialog.getByRole("list", { name: "Steps" });
    await expect(steps).toContainText("Press Win+R");
    await expect(steps).toContainText("A shortcut: it can open, close or change things");
    await expect(steps).toContainText('Type "powershell"');
    await expect(steps).toContainText("Types into whatever has focus");

    // Cancel leaves it off and unreviewed.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(row(page, "Helper").getByRole("switch")).not.toBeChecked();

    await row(page, "Helper").getByRole("switch").click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Looks good, turn it on" }).click();
    await expect(row(page, "Helper").getByRole("switch")).toBeChecked();
    await expect(row(page, "Helper")).not.toContainText("check it before use");
    await expect.poll(async () => (await library(dataDir)).map((m) => [m.enabled, m.review])).toEqual([[true, false]]);
  });

  test("Run asks first too", async ({ app: { page } }) => {
    await page.getByRole("button", { name: "Import a macro" }).click();
    await row(page, "Helper").getByRole("button", { name: "Run" }).click();
    await expect(page.getByRole("alertdialog").getByRole("button", { name: "Looks good, run it" })).toBeVisible();
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

test.describe("copy and paste as text", () => {
  test.use({ seed: { macros: [macro("Fill form", { id: "f", steps: [clickAt(1, 2)] })] } });

  test("Copy as text puts one line on the clipboard; Ctrl+V pastes it back as a new macro", async ({ app: { page, dataDir } }) => {
    await page.getByRole("button", { name: "More actions for Fill form" }).click();
    await page.getByRole("menuitem", { name: "Copy as text" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Copied" })).toContainText('Copied "Fill form" as text.');
    // Test mode keeps the "clipboard" in a file, away from yours.
    const text = await readFile(join(dataDir, "clipboard.txt"), "utf8");
    expect(text).not.toContain("\n");
    expect(JSON.parse(text).format).toBe("pochini.macros");

    await page.keyboard.press("Control+v");
    await expect(row(page, "Fill form (imported)")).toContainText("Imported, check it before use");
    expect((await library(dataDir)).map((m) => [m.name, m.review])).toEqual([
      ["Fill form", false],
      ["Fill form (imported)", true],
    ]);
  });

  test("pasting something that is not a macro says so", async ({ app: { page } }) => {
    await page.getByRole("button", { name: "Paste a copied macro" }).click();
    await expect(page.getByText("The clipboard holds no text. Copy a macro first.")).toBeVisible();
  });
});
