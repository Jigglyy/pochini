import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./_launch";
import { clickAt, macro, wait } from "./data";

// Whatever opens or appears below the fold is scrolled into view: expanding a
// step, adding one, moving one past the edge, a new macro at the end of a long
// list, and confirmations while scrolled down.

/** True when `el` sits entirely inside the visible part of <main>. */
const fullyVisible = (el: Locator) =>
  el.evaluate((node) => {
    const main = document.querySelector("main")!.getBoundingClientRect();
    const r = node.getBoundingClientRect();
    return r.top >= main.top - 1 && r.bottom <= main.bottom + 1;
  });

const longMacro = macro("Long", {
  steps: Array.from({ length: 14 }, (_, i) => ({ ...wait(100 + i), id: `s${i}` })),
});
const step = (page: Page, id: string) => page.locator(`[data-step-id="${id}"]`);
const header = (page: Page, id: string) => step(page, id).locator('[role="button"][aria-expanded]');
const toBottomEdge = (el: Locator) => el.evaluate((n) => n.scrollIntoView({ block: "end" }));

test.describe("the step editor", () => {
  test.use({ seed: { macros: [longMacro] } });

  test("expanding a step at the bottom brings all of it into view", async ({ app: { page } }) => {
    await page.getByRole("button", { name: /^Long/ }).click();
    await toBottomEdge(header(page, "s13"));
    await header(page, "s13").click();
    await expect.poll(() => fullyVisible(step(page, "s13"))).toBe(true);
  });

  test("a step added at the bottom opens fully in view", async ({ app: { page } }) => {
    await page.getByRole("button", { name: /^Long/ }).click();
    await toBottomEdge(header(page, "s5"));
    await page.getByRole("button", { name: "Wait", exact: true }).click();
    const added = page.locator("[data-step-id]").last();
    await expect(added.locator('[role="button"][aria-expanded="true"]')).toBeVisible();
    await expect.poll(() => fullyVisible(added)).toBe(true);
  });

  test("moving a step past the edge keeps it in view", async ({ app: { page } }) => {
    await page.getByRole("button", { name: /^Long/ }).click();
    await toBottomEdge(header(page, "s6"));
    await step(page, "s6").getByRole("button", { name: "Move down", exact: true }).click();
    await step(page, "s6").getByRole("button", { name: "Move down", exact: true }).click();
    await expect.poll(() => fullyVisible(step(page, "s6"))).toBe(true);
  });
});

// A macro of click steps, whose bodies are tall (~470 px),
// taller than the room left under the last step. Wait steps open small enough
// to fit that room, which is why the first version of this test passed while
// the real app still left the step half off-screen.
const tallSteps = macro("Three clicks", {
  steps: [
    { ...clickAt(1623, 592), id: "c1", anchor: "activation" as const },
    { ...clickAt(1127, 830), id: "c2" },
    { ...clickAt(1504, 938), id: "c3" },
  ],
});

for (const size of [
  { width: 1000, height: 720 },
  { width: 1600, height: 1000 },
]) {
  test.describe(`click steps at ${size.width}x${size.height}`, () => {
    test.use({ seed: { macros: [tallSteps] } });

    test("expanding the last click step shows all of it", async ({ app: { page } }) => {
      await page.setViewportSize(size);
      await page.getByRole("button", { name: /^Three clicks/ }).click();
      await toBottomEdge(header(page, "c3"));
      await header(page, "c3").click();
      await expect(step(page, "c3").getByRole("spinbutton", { name: "X", exact: true })).toBeVisible();
      await expect.poll(() => fullyVisible(step(page, "c3")), { timeout: 3000 }).toBe(true);
    });

    // The race that slipped through: on a busy machine the opening began
    // before React had drawn the box, so nothing followed it. Opening it
    // several times gives a race more chances to show.
    test("opening the last click step again and again always shows all of it", async ({ app: { page } }) => {
      await page.setViewportSize(size);
      await page.getByRole("button", { name: /^Three clicks/ }).click();
      for (let i = 0; i < 4; i++) {
        await toBottomEdge(header(page, "c3"));
        await header(page, "c3").click(); // open
        await expect.poll(() => fullyVisible(step(page, "c3")), { timeout: 3000 }).toBe(true);
        await header(page, "c3").click(); // close
        await expect(step(page, "c3").getByRole("spinbutton")).toHaveCount(0);
      }
    });

    test("expanding the first click step at the bottom shows all of it", async ({ app: { page } }) => {
      await page.setViewportSize(size);
      await page.getByRole("button", { name: /^Three clicks/ }).click();
      await toBottomEdge(header(page, "c1"));
      await header(page, "c1").click();
      await expect.poll(() => fullyVisible(step(page, "c1")), { timeout: 3000 }).toBe(true);
    });
  });
}

test.describe("the screen moves with the opening", () => {
  test.use({ seed: { macros: [tallSteps] } });

  test("scrolling happens during the animation, not after it", async ({ app: { page } }) => {
    await page.getByRole("button", { name: /^Three clicks/ }).click();
    await toBottomEdge(header(page, "c3"));
    const samples = await header(page, "c3").evaluate(async (h) => {
      const main = document.querySelector("main")!;
      const start = main.scrollTop;
      const t0 = performance.now();
      const out: { t: number; dy: number }[] = [];
      (h as HTMLElement).click();
      await new Promise<void>((done) => {
        const tick = () => {
          out.push({ t: performance.now() - t0, dy: main.scrollTop - start });
          if (performance.now() - t0 < 450) requestAnimationFrame(tick);
          else done();
        };
        requestAnimationFrame(tick);
      });
      return out;
    });
    const mid = samples.filter((s) => s.t > 60 && s.t < 180);
    const last = samples[samples.length - 1];
    expect(last.dy).toBeGreaterThan(200); // it scrolled to the step's bottom
    expect(mid.some((s) => s.dy > 20 && s.dy < last.dy)).toBe(true); // and went along with it
  });
});

test.describe("options under a switch", () => {
  test.use({ seed: { macros: [tallSteps] } });

  test("turning on App only near the bottom shows the picker", async ({ app: { page } }) => {
    await page.setViewportSize({ width: 1000, height: 460 });
    await page.getByRole("button", { name: /^Three clicks/ }).click();
    const row = page.getByRole("switch", { name: /^App only/ });
    await row.evaluate((n) => n.scrollIntoView({ block: "end" }));
    await row.click();
    const picker = page.getByRole("button", { name: "Refresh" });
    await expect(picker).toBeVisible();
    await expect.poll(() => fullyVisible(picker), { timeout: 3000 }).toBe(true);
  });
});

test.describe("the macro list", () => {
  test.use({
    seed: {
      macros: Array.from({ length: 16 }, (_, i) => macro(`Macro ${i + 1}`, { id: `m${i + 1}` })),
      dialog: "out.pochini.json",
    },
  });

  test("a duplicate added at the end of a long list is scrolled into view", async ({ app: { page } }) => {
    await page.getByRole("button", { name: "More actions for Macro 1", exact: true }).click();
    await page.getByRole("menuitem", { name: "Duplicate" }).click();
    const copy = page.locator("li[data-macro-id]").filter({ hasText: "Macro 1 (copy)" });
    await expect(copy).toBeVisible();
    await expect.poll(() => fullyVisible(copy)).toBe(true);
  });

  test("a confirmation shows even while scrolled down", async ({ app: { page } }) => {
    const last = page.locator('li[data-macro-id="m16"]');
    await last.evaluate((n) => n.scrollIntoView({ block: "end" }));
    await page.getByRole("button", { name: "More actions for Macro 16", exact: true }).click();
    await page.getByRole("menuitem", { name: "Export..." }).click();
    const note = page.getByRole("status").filter({ hasText: "Exported" });
    await expect(note).toBeVisible();
    await expect.poll(() => fullyVisible(note)).toBe(true);
  });
});
