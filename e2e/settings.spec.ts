import { expect, openSettings, test } from "./_launch";
import { clickAt, macro } from "./data";

// Settings, Kanbini style: a sidebar of sections, one shown at a time, and
// the last one remembered. And the page uses the width of a big window.

test("the sidebar shows one section at a time and remembers the last", async ({ app: { page } }) => {
  await openSettings(page);
  const nav = page.getByRole("navigation", { name: "Settings sections" });
  // The first time: Hotkeys.
  await expect(nav.getByRole("button", { name: "Hotkeys", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("Panic stop", { exact: true })).toBeVisible();

  await nav.getByRole("button", { name: "Window and startup", exact: true }).click();
  await expect(page.getByRole("switch", { name: /^Start with Windows/ })).toBeVisible();
  await expect(page.getByText("Panic stop", { exact: true })).toHaveCount(0);

  await page.reload();
  await openSettings(page);
  await expect(nav.getByRole("button", { name: "Window and startup", exact: true })).toHaveAttribute("aria-current", "page");
});

test.describe("with a macro", () => {
  test.use({ seed: { macros: [macro("Wide", { steps: [{ ...clickAt(1, 1), id: "c1" }] })] } });

  test("Appearance sets how the editor lays out steps", async ({ app: { page } }) => {
    await openSettings(page, "Appearance");
    await page.getByText("Compact list", { exact: true }).click();
    await page.getByRole("button", { name: "Macros", exact: true }).click();
    await page.getByRole("button", { name: /^Wide/ }).click();
    await expect(page.locator('[data-step-view="compact"]')).toBeVisible();
  });

  test("a big window gets a wider page, with the two option sections side by side", async ({ app: { page } }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.getByRole("button", { name: /^Wide/ }).click();
    const trigger = page.getByRole("button", { name: "Trigger" });
    const runs = page.getByRole("button", { name: "When it runs" });
    const [a, b] = [await trigger.boundingBox(), await runs.boundingBox()];
    expect(Math.abs(a!.y - b!.y)).toBeLessThan(2);
    expect(b!.x).toBeGreaterThan(a!.x + 400);
    // Wider than the 56rem column of a normal window.
    const column = await page.getByRole("textbox", { name: "Macro name" }).evaluate((el) => el.closest(".page-column")!.getBoundingClientRect().width);
    expect(column).toBeGreaterThan(1000);
  });

  test("the Add buttons sit under the steps, not over them", async ({ app: { page } }) => {
    await page.getByRole("button", { name: /^Wide/ }).click();
    await expect(page.getByRole("group", { name: "Add a step" })).toHaveCSS("position", "static");
  });
});
