import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "./_launch";
import { macro } from "./data";

// Queue presses: where queued runs start. The worker's behaviour is covered
// by the Rust tests in app.rs; this checks the choice and that it saves.

test.use({ seed: { macros: [macro("Queued", { queue: false })] } });

const saved = async (dataDir: string) => {
  const m = JSON.parse(await readFile(join(dataDir, "macros.json"), "utf8")).macros[0];
  return [m.queue, m.queue_from];
};

test.describe("an old macro saved with Each press and the queue off", () => {
  test.use({ seed: { macros: [macro("Queued", { queue: false, queue_from: "each_press" })] } });

  test("turning the queue on starts from the first press", async ({ app: { page, dataDir } }) => {
    await page.getByRole("button", { name: /^Queued/ }).click();
    const choice = page.getByRole("group", { name: "Queued runs start from" });
    await expect(choice).toHaveCount(0); // only shown with Queue on

    await page.getByRole("switch", { name: /^Queue presses/ }).click();
    await expect(choice.getByRole("button", { name: "The first press" })).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible();
    await expect.poll(() => saved(dataDir)).toEqual([true, "first_press"]);
  });
});

test("Each press can still be chosen", async ({ app: { page, dataDir } }) => {
  await page.getByRole("button", { name: /^Queued/ }).click();
  await page.getByRole("switch", { name: /^Queue presses/ }).click();
  await page.getByRole("group", { name: "Queued runs start from" }).getByRole("button", { name: "Each press" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => saved(dataDir)).toEqual([true, "each_press"]);
});

test("unsaved changes say the hotkey still runs the saved version", async ({ app: { page } }) => {
  await page.getByRole("button", { name: /^Queued/ }).click();
  const note = page.getByText("Not saved yet. Your hotkey still runs the saved version.");
  await expect(note).toHaveCount(0);
  await page.getByRole("switch", { name: /^Queue presses/ }).click();
  await expect(note).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(note).toHaveCount(0);
});
