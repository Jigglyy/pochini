import { expect, test } from "./_launch";
import { macro, wait } from "./data";

// Running a macro. Test mode runs it against the fake mouse and keyboard, so
// this exercises the real countdown, worker and run pill without touching
// the desktop.

test.use({ seed: { macros: [macro("Slow one", { steps: [wait(1500)] })] } });

test("Run counts down and can be cancelled", async ({ app: { page } }) => {
  await page.getByRole("button", { name: "Run" }).click();
  await expect(page.getByText(/Starting in \d/)).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText(/Starting in \d/)).toHaveCount(0);
});

test("after the countdown the run shows, then finishes", async ({ app: { page } }) => {
  await page.getByRole("button", { name: "Run" }).click();
  const pill = page.getByRole("status").filter({ hasText: /Starting in|Running/ });
  await expect(pill).toContainText("Running Slow one", { timeout: 6_000 });
  await expect(pill).toContainText("Esc stops it");
  await expect(pill.getByRole("button", { name: "Stop" })).toBeVisible();
  await expect(pill).toHaveCount(0, { timeout: 6_000 });
});

test("the master switch turns every hotkey off", async ({ app: { page } }) => {
  await page.getByRole("switch", { name: "Macros on or off" }).click();
  await expect(page.getByText("Macros are off.")).toBeVisible();
  await page.getByRole("switch", { name: "Macros on or off" }).click();
  await expect(page.getByText("Macros are off.")).toHaveCount(0);
});
