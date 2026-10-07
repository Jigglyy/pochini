import { expect, test } from "./_launch";
import { macro } from "./data";

// The "?" after a label: explanations live there instead of on screen.

test.use({ seed: { macros: [macro("Helpful")] } });

test("hover shows the explanation, click pins it, Escape closes it", async ({ app: { page } }) => {
  await page.getByRole("button", { name: /^Helpful/ }).click();
  const tip = page.getByRole("button", { name: "About Queue presses" });
  const text = page.getByText("Panic stop clears the queue.");

  await tip.hover();
  await expect(text).toBeVisible();
  await page.mouse.move(0, 0);
  await expect(text).toBeHidden();

  await tip.click();
  await page.mouse.move(0, 0);
  await expect(text).toBeVisible(); // pinned: stays after the pointer leaves
  await page.keyboard.press("Escape");
  await expect(text).toBeHidden();
});

test("clicking the ? never flips the switch beside it", async ({ app: { page } }) => {
  await page.getByRole("button", { name: /^Helpful/ }).click();
  const queue = page.getByRole("switch", { name: /^Queue presses/ });
  await expect(queue).not.toBeChecked();
  await page.getByRole("button", { name: "About Queue presses" }).click();
  await expect(queue).not.toBeChecked();
});
