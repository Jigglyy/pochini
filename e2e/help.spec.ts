import { expect, test } from "./_launch";
import { macro } from "./data";

// The "?" after a label: explanations live there instead of on screen.
// Hover only: it shows while the pointer is on it, and clicking does nothing.
// Radix closes a tooltip on the pointer move after it leaves, so tests move
// away in steps, as a real mouse does.

test.use({ seed: { macros: [macro("Helpful")] } });

test("hover shows the explanation, leaving hides it", async ({ app: { page } }) => {
  await page.getByRole("button", { name: /^Helpful/ }).click();
  const text = page.getByText("Panic stop clears the queue.");

  await page.getByRole("button", { name: "About Queue presses" }).hover();
  await expect(text).toBeVisible();
  await page.mouse.move(0, 0, { steps: 5 });
  await expect(text).toBeHidden();
});

test("clicking the ? does nothing: no pinning, no switch flip", async ({ app: { page } }) => {
  await page.getByRole("button", { name: /^Helpful/ }).click();
  const queue = page.getByRole("switch", { name: /^Queue presses/ });
  const text = page.getByText("Panic stop clears the queue.");
  await expect(queue).not.toBeChecked();

  await page.getByRole("button", { name: "About Queue presses" }).click();
  await expect(text).toBeVisible(); // still showing while hovered
  await expect(queue).not.toBeChecked();

  await page.mouse.move(0, 0, { steps: 5 });
  await expect(text).toBeHidden(); // not pinned by the click
});
