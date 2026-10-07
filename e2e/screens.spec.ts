import type { Page } from "@playwright/test";
import { expect, test } from "./_launch";
import { clickAt, macro, typeText, wait } from "./data";
import type { Step } from "../src/types";

// Not a test: screenshots of every screen for design review. Skipped unless
// POCHINI_SCREENS names an output folder:
//   POCHINI_SCREENS=shots npx playwright test screens

const out = process.env.POCHINI_SCREENS;
test.skip(!out, "set POCHINI_SCREENS to an output folder");

const space = { vk: 0x20, scancode: 0x39, extended: false, label: "Space" };
const rel = (anchor: "activation" | "previous", dx: number, dy: number): Step => ({
  ...clickAt(0, 0),
  anchor,
  dx,
  dy,
});

test.use({
  seed: {
    macros: [
      macro("Fill form", {
        favorite: true,
        trigger: { key: space, modifiers: [], mode: "once", swallow: false },
        guard: { process: "game.exe", label: "Game" },
        queue: true,
        return_to_start: true,
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
        trigger: { key: { vk: 0x52, scancode: 0x13, extended: false, label: "R" }, modifiers: ["ctrl"], mode: "toggle", swallow: true },
        repeat: { kind: "forever" },
        steps: [clickAt(840, 412), wait(1200), clickAt(1320, 700), wait(600)],
      }),
      macro("Inventory sweep with a rather long name that keeps going", {
        favorite: true,
        repeat: { kind: "count", n: 12 },
        steps: [rel("previous", 64, 0), wait(90)],
      }),
      macro("Chat greeting", {
        enabled: false,
        trigger: { key: { vk: 0x71, scancode: 0x3c, extended: false, label: "F2" }, modifiers: [], mode: "once", swallow: false },
        steps: [typeText("gg wp"), wait(50)],
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
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByText(theme === "light" ? "Light" : "Dark", { exact: true }).click();
    await page.getByRole("button", { name: "Macros" }).click();
    await expect(page.getByText("Fill form")).toBeVisible();
    await shot(page, `${theme}-1-home`);

    await page.getByRole("button", { name: /^Fill form/ }).click();
    await shot(page, `${theme}-2-editor`);

    await page.locator("[data-step-id]").nth(3).locator('[role="button"][aria-expanded]').click();
    await shot(page, `${theme}-3-editor-step-open`);

    await page.locator("[data-step-id]").nth(2).locator('[role="button"][aria-expanded]').click({ button: "right" });
    await shot(page, `${theme}-4-context-menu`);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Settings" }).click();
    await shot(page, `${theme}-5-settings`);
  });
}
