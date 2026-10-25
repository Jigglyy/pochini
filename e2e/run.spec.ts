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

const watch = (color: string, timeout_ms: number) =>
  macro("Watch", {
    steps: [{ type: "wait_color", id: "wc", shuffle: false, x: 16, y: 32, color, tolerance: 0, timeout_ms, on_timeout: "stop" }],
  });

// Test mode's fake screen has the color [x, y, 0] at (x, y): (16, 32) is #102000.
test.describe("waiting for a color", () => {
  test.describe("that shows", () => {
    test.use({ seed: { macros: [watch("#102000", 2000)] } });

    test("the run finishes, says so, and lands in the run history", async ({ app: { page } }) => {
      await page.getByRole("button", { name: /^Watch/ }).click();
      await page.getByRole("button", { name: "Test", exact: true }).click();
      await expect(page.getByRole("status").filter({ hasText: "Finished" })).toContainText("Finished Watch (test)", {
        timeout: 8_000,
      });
      await page.getByRole("button", { name: "Settings" }).click();
      const history = page.locator("section").filter({ has: page.getByRole("heading", { name: "Run history" }) });
      await expect(history).toContainText("Watch (test)");
      await expect(history).toContainText("Finished");
    });
  });

  test.describe("that never shows", () => {
    test.use({ seed: { macros: [watch("#ffffff", 300)] } });

    test("the run stops and the pill says why", async ({ app: { page } }) => {
      await page.getByRole("button", { name: "Run" }).click();
      const alert = page.getByRole("alert").filter({ hasText: "stopped" });
      await expect(alert).toContainText("Watch stopped: Waited 300 ms for (16, 32) to turn #ffffff, but it stayed #102000.", {
        timeout: 8_000,
      });
      await alert.getByRole("button", { name: "Dismiss" }).click();
      await expect(alert).toHaveCount(0);
    });

    test("Read color takes the color the point has now", async ({ app: { page } }) => {
      await page.getByRole("button", { name: /^Watch/ }).click();
      await page.locator('[data-step-id="wc"] [role="button"][aria-expanded]').click();
      await expect(page.getByRole("button", { name: "Read color" })).toBeVisible();
      await page.getByRole("button", { name: "Read color" }).click();
      await expect(page.getByRole("textbox", { name: "Color code" })).toHaveValue("#102000");
      await expect(page.locator('[data-step-id="wc"] [role="button"][aria-expanded]')).toContainText(
        "Wait until (16, 32) is #102000",
      );
    });
  });
});
