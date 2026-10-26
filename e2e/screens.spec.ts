import type { Page } from "@playwright/test";
import { expect, openSettings, test } from "./_launch";
import { clickAt, macro, typeText, wait, type ClickStep } from "./data";

// Not a test: screenshots of every screen for design review. Skipped unless
// POCHINI_SCREENS names an output folder:
//   POCHINI_SCREENS=shots npx playwright test screens

const out = process.env.POCHINI_SCREENS;
test.skip(!out, "set POCHINI_SCREENS to an output folder");

const space = { vk: 0x20, scancode: 0x39, extended: false, label: "Space" };
const rel = (anchor: "activation" | "previous", dx: number, dy: number): ClickStep => ({
  ...clickAt(0, 0),
  anchor,
  dx,
  dy,
});

test.use({
  seed: {
    macros: [
      macro("Fill the order form", {
        favorite: true,
        color: "orange",
        trigger: { key: space, modifiers: [], mode: "once", swallow: false },
        guard: { process: "msedge.exe", label: "" },
        queue: true,
        return_to_start: true,
        feel: {
          bell: { tightness: "medium", peak: "early" },
          hesitate: { chance_pct: 10, ms: { base: 150, jitter: 350 } },
          curve: { bend_pct: 10, overshoot_pct: 0 },
        },
        steps: [
          { ...rel("activation", 0, 0), coord_jitter_px: 3 },
          wait(180),
          { ...clickAt(1623, 592), coord_jitter_px: 2 },
          rel("previous", 0, 46),
          wait(250),
          clickAt(1180, 810),
        ],
      }),
      macro("Refresh and check", {
        color: "sky",
        trigger: { key: { vk: 0x52, scancode: 0x13, extended: false, label: "R" }, modifiers: ["ctrl"], mode: "toggle", swallow: true },
        repeat: { kind: "forever" },
        steps: [clickAt(840, 412), wait(1200), clickAt(1320, 700), wait(600)],
      }),
      macro("Rename every file in the folder, one after another, until the list ends", {
        favorite: true,
        repeat: { kind: "count", n: 12 },
        steps: [rel("previous", 64, 0), wait(90)],
      }),
      macro("Sign-off", {
        enabled: false,
        trigger: { key: { vk: 0x71, scancode: 0x3c, extended: false, label: "F2" }, modifiers: [], mode: "once", swallow: false },
        steps: [typeText("Thanks, talk soon!"), wait(50)],
      }),
    ],
  },
});

async function shot(page: Page, name: string) {
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
}

for (const theme of ["dark", "light"] as const) {
  test(`screens ${theme}`, async ({ app: { page } }) => {
    // Tall enough for whole pages (the app scrolls inside <main>).
    await page.setViewportSize({ width: 1000, height: 1700 });
    await openSettings(page, "Appearance");
    await page.getByText(theme === "light" ? "Light" : "Dark", { exact: true }).click();
    await page.getByRole("button", { name: "Macros", exact: true }).click();
    await expect(page.getByText("Fill the order form")).toBeVisible();
    await shot(page, `${theme}-1-home`);

    await page.locator("li[data-macro-id]").nth(1).click({ button: "right" });
    await expect(page.getByRole("menu")).toBeVisible();
    await shot(page, `${theme}-1b-row-menu`);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: /^Fill the order form/ }).click();
    await shot(page, `${theme}-2-editor`);

    await page.locator("[data-step-id]").nth(3).locator('[role="button"][aria-expanded]').click();
    await shot(page, `${theme}-3-editor-step-open`);

    await page.locator("[data-step-id]").nth(2).locator('[role="button"][aria-expanded]').click({ button: "right" });
    await shot(page, `${theme}-4-context-menu`);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "About Target" }).hover();
    await expect(page.getByRole("tooltip")).toBeVisible();
    await shot(page, `${theme}-4b-help`);
    await page.mouse.move(0, 0, { steps: 5 });

    // The other step layouts, choosing steps, and changing them together.
    await page.getByRole("button", { name: "Compact list" }).click();
    await shot(page, `${theme}-6-compact`);
    await page.getByRole("button", { name: "Side by side" }).click();
    await shot(page, `${theme}-7-split`);
    await page.getByRole("button", { name: "Squares" }).click();
    await page.locator("[data-step-header]").nth(2).click();
    await shot(page, `${theme}-7b-squares`);
    await page.getByRole("button", { name: "Side by side" }).click();
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await page.locator("[data-step-header]").nth(0).click();
    await page.locator("[data-step-header]").nth(2).click();
    await shot(page, `${theme}-8-split-selected`);
    await page.getByRole("button", { name: "Cards" }).click();
    await page.getByRole("button", { name: "Select by kind" }).click();
    await shot(page, `${theme}-9-select-by-kind`);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /^Edit \d steps?$/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await shot(page, `${theme}-10-bulk-edit`);
    await page.getByRole("dialog").getByRole("button", { name: "Done" }).click();
    await page.getByRole("toolbar").getByRole("button", { name: "Done" }).click();
    await page.getByRole("button", { name: "Trigger" }).click();
    await page.getByRole("button", { name: "When it runs" }).click();
    await shot(page, `${theme}-11-folded`);
    await page.getByRole("button", { name: "Trigger" }).click();
    await page.getByRole("button", { name: "When it runs" }).click();

    // A maximized window: the column grows, the option sections pair up.
    await page.setViewportSize({ width: 1536, height: 1100 });
    await shot(page, `${theme}-12-editor-wide`);
    await page.setViewportSize({ width: 1000, height: 1700 });

    await page.getByRole("button", { name: "Settings" }).click();
    await shot(page, `${theme}-5-settings`);
    for (const section of ["Hotkeys", "Shortcuts", "Window and startup", "About"]) {
      await openSettingsSection(page, section);
      await shot(page, `${theme}-5-settings-${section.split(" ")[0].toLowerCase()}`);
    }
  });
}

const openSettingsSection = (page: Page, section: string) =>
  page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: section, exact: true }).click();

// The README pictures (docs/images/): window-sized, not whole pages.
for (const theme of ["dark", "light"] as const) {
  test(`readme ${theme}`, async ({ app: { page } }) => {
    await page.setViewportSize({ width: 1100, height: 700 });
    await openSettings(page, "Appearance");
    await page.getByText(theme === "light" ? "Light" : "Dark", { exact: true }).click();
    await page.getByRole("button", { name: "Macros", exact: true }).click();
    await expect(page.getByText("Fill the order form")).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/readme-list-${theme}.png` });

    await page.setViewportSize({ width: 1100, height: 900 });
    await page.getByRole("button", { name: /^Fill the order form/ }).click();
    await page.locator("[data-step-id]").nth(2).locator('[role="button"][aria-expanded]').click();
    await page.waitForTimeout(400);
    // The step list from its heading down.
    await page.getByRole("heading", { name: "Steps" }).evaluate((h) => h.scrollIntoView({ block: "start" }));
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${out}/readme-editor-${theme}.png` });
  });
}
