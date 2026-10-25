import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { drag, expect, test } from "./_launch";
import { macro } from "./data";

// The macro list: favorites, sorting, dragging rows, deleting.

const row = (page: Page, id: string) => page.locator(`li[data-macro-id="${id}"]`);

/** Row ids top to bottom, as shown. */
const shown = (page: Page) =>
  page.locator("li[data-macro-id]").evaluateAll((els) => els.map((e) => e.getAttribute("data-macro-id")));

/** The custom order as saved in macros.json. */
async function saved(dataDir: string): Promise<string[]> {
  const f = JSON.parse(await readFile(join(dataDir, "macros.json"), "utf8"));
  return f.macros.map((m: { id: string }) => m.id);
}

async function sortBy(page: Page, label: string) {
  await page.getByRole("combobox", { name: "Sort macros" }).click();
  await page.getByRole("option", { name: label }).click();
  // Radix blocks the page (pointer-events: none) while the menu is open and
  // lifts it a moment after it closes.
  await expect(page.locator("body")).not.toHaveCSS("pointer-events", "none");
}

test.describe("favorites and sorting", () => {
  test.use({
    seed: {
      macros: [
        macro("bravo", { id: "b", created_at: "2026-03-01T00:00:00Z", updated_at: "2026-03-05T00:00:00Z" }),
        macro("Alpha", { id: "a", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-06-01T00:00:00Z" }),
        macro("charlie 10", { id: "c10", created_at: "2026-02-01T00:00:00Z", updated_at: "2026-01-02T00:00:00Z" }),
        macro("charlie 9", { id: "c9", created_at: "2026-04-01T00:00:00Z", updated_at: "2026-01-03T00:00:00Z" }),
      ],
    },
  });

  test("star a macro and list favorites first, remembered after a reload", async ({ app: { page } }) => {
    await row(page, "c9").getByRole("button", { name: "Add charlie 9 to favorites" }).click();
    await expect(row(page, "c9").getByRole("button", { name: "Remove charlie 9 from favorites" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await sortBy(page, "Favorites first");
    await expect(page.getByRole("heading", { name: "Favorites" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Other macros" })).toBeVisible();
    expect(await shown(page)).toEqual(["c9", "b", "a", "c10"]);

    await page.reload();
    await expect(page.getByRole("heading", { name: "Favorites" })).toBeVisible();
    expect(await shown(page)).toEqual(["c9", "b", "a", "c10"]);
  });

  test("sort by name, newest and recently edited", async ({ app: { page } }) => {
    await sortBy(page, "Name (A to Z)");
    await expect.poll(() => shown(page)).toEqual(["a", "b", "c9", "c10"]); // numeric-aware
    await sortBy(page, "Newest first");
    await expect.poll(() => shown(page)).toEqual(["c9", "b", "c10", "a"]);
    await sortBy(page, "Recently edited");
    await expect.poll(() => shown(page)).toEqual(["a", "b", "c9", "c10"]);
  });

  test("rows can only be dragged in the drag views", async ({ app: { page } }) => {
    await sortBy(page, "Name (A to Z)");
    await drag(page, row(page, "c10"), row(page, "a"));
    await expect.poll(() => shown(page)).toEqual(["a", "b", "c9", "c10"]);
  });
});

test.describe("dragging", () => {
  test.use({
    seed: {
      macros: [
        macro("Alpha", { id: "a", favorite: true }),
        macro("Bravo", { id: "b" }),
        macro("Charlie", { id: "c", favorite: true }),
        macro("Delta", { id: "d" }),
      ],
    },
  });

  test("drag a row in custom order and it stays there", async ({ app: { page, dataDir } }) => {
    await drag(page, row(page, "d"), row(page, "a"), -10);
    await expect.poll(() => shown(page)).toEqual(["d", "a", "b", "c"]);
    await expect.poll(() => saved(dataDir)).toEqual(["d", "a", "b", "c"]);

    await page.reload();
    await expect.poll(() => shown(page)).toEqual(["d", "a", "b", "c"]);
  });

  test("in favorites first, a drag reorders its group and leaves the rest in place", async ({
    app: { page, dataDir },
  }) => {
    await sortBy(page, "Favorites first");
    expect(await shown(page)).toEqual(["a", "c", "b", "d"]);

    await drag(page, row(page, "c"), row(page, "a"), -10);
    await expect.poll(() => shown(page)).toEqual(["c", "a", "b", "d"]);
    // Favorites held places 0 and 2 of the custom order; they swap there.
    await expect.poll(() => saved(dataDir)).toEqual(["c", "b", "a", "d"]);
  });

  test("Move up and Move down in the row menu", async ({ app: { page } }) => {
    await page.getByRole("button", { name: "More actions for Charlie" }).click();
    await page.getByRole("menuitem", { name: "Move up" }).click();
    await expect.poll(() => shown(page)).toEqual(["a", "c", "b", "d"]);
  });
});

test.describe("deleting", () => {
  test.use({ seed: { macros: [macro("Keep", { id: "k" }), macro("Remove me", { id: "r" })] } });

  test("delete asks first", async ({ app: { page, dataDir } }) => {
    await page.getByRole("button", { name: "More actions for Remove me" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText('Delete "Remove me"?');
    await dialog.getByRole("button", { name: "Delete" }).click();

    await expect(row(page, "r")).toHaveCount(0);
    await expect.poll(() => saved(dataDir)).toEqual(["k"]);
  });
});

const hotkey = (vk: number, label: string, modifiers: ("ctrl" | "alt" | "shift" | "win")[] = []) => ({
  key: { vk, scancode: 0, extended: false, label },
  modifiers,
  mode: "once" as const,
  swallow: false,
});

test.describe("hotkey clashes", () => {
  test.use({
    seed: {
      macros: [
        macro("On the panic key", { id: "p", trigger: hotkey(0x1b, "Esc", ["shift"]) }),
        macro("First Space", { id: "a", trigger: hotkey(0x20, "Space") }),
        macro("Second Space", { id: "b", trigger: hotkey(0x20, "Space") }),
      ],
    },
  });

  test("say why the hotkey cannot work", async ({ app: { page } }) => {
    await expect(row(page, "a")).not.toContainText("Hotkey clash");

    const tip = (text: string) => page.getByRole("tooltip").filter({ hasText: text });
    await row(page, "p").getByText("Hotkey clash").hover();
    await expect(tip("Same key as the panic stop, so it never runs")).toBeVisible();
    // Radix closes a tooltip on the pointer move after it leaves (help.spec.ts).
    await page.mouse.move(0, 0, { steps: 5 });
    await expect(page.getByRole("tooltip")).toHaveCount(0);

    await row(page, "b").getByText("Hotkey clash").hover();
    await expect(tip('Same hotkey as "First Space", which runs instead')).toBeVisible();
  });
});
