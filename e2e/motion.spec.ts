import type { Page } from "@playwright/test";
import { expect, test } from "./_launch";
import { macro, wait } from "./data";

// Motion: animated, never in the way, and off when Windows says so.

test.use({
  seed: {
    macros: [
      macro("Steps", {
        steps: [
          { ...wait(100), id: "s1" },
          { ...wait(200), id: "s2" },
          { ...wait(300), id: "s3" },
        ],
      }),
    ],
  },
});

const step = (page: Page, id: string) => page.locator(`[data-step-id="${id}"]`);
const order = (page: Page) =>
  page.locator("[data-step-id]").evaluateAll((els) => els.map((e) => e.getAttribute("data-step-id")));
/** Count the animations started on a step from now on. Counting starts
 *  rather than looking for one still running keeps a slow machine (a CI
 *  runner) from finishing the 220 ms glide before the test looks. */
async function countAnimations(page: Page, id: string) {
  await page.evaluate((id) => {
    const w = window as unknown as { __started: number };
    w.__started = 0;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (this: Element, ...args: Parameters<Element["animate"]>) {
      if (this.getAttribute("data-step-id") === id) w.__started++;
      return animate.apply(this, args);
    };
  }, id);
  return () => page.evaluate(() => (window as unknown as { __started: number }).__started);
}

test("expanding a step animates its height", async ({ app: { page } }) => {
  await page.getByRole("button", { name: /^Steps/ }).click();
  await step(page, "s1").locator('[role="button"][aria-expanded]').click();
  const body = step(page, "s1").locator(".grid").first();
  await expect(body).toHaveCSS("transition-property", /grid-template-rows/);
  await expect(body).toHaveCSS("grid-template-rows", /px/); // open: a real height
  await expect(step(page, "s1").getByRole("spinbutton").first()).toBeVisible();
});

test("moving a step glides it, and quick repeated clicks all count", async ({ app: { page } }) => {
  // Whatever this machine's "Animation effects" setting is (CI runners turn it off).
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.getByRole("button", { name: /^Steps/ }).click();
  const started = await countAnimations(page, "s1");
  const down = step(page, "s1").getByRole("button", { name: "Move down", exact: true });
  await down.click();
  await expect.poll(started).toBeGreaterThan(0);
  await step(page, "s1").getByRole("button", { name: "Move down", exact: true }).click();
  await expect.poll(() => order(page)).toEqual(["s2", "s3", "s1"]);
});

test.describe("with Windows animations off", () => {
  test("nothing animates", async ({ app: { page } }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("button", { name: /^Steps/ }).click();
    const started = await countAnimations(page, "s1");
    await step(page, "s1").getByRole("button", { name: "Move down", exact: true }).click();
    await expect.poll(() => order(page)).toEqual(["s2", "s1", "s3"]);
    expect(await started()).toBe(0);
    await step(page, "s2").locator('[role="button"][aria-expanded]').click();
    await expect(step(page, "s2").locator(".grid").first()).toHaveCSS("transition-duration", /^0\.00001s|^1e-05s|^0s/);
  });
});
