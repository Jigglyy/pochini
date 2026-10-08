import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "./_launch";
import { macro } from "./data";

// Queue presses: where queued runs start. The worker's behaviour is covered
// by the Rust tests in app.rs; this checks the choice and that it saves.

test.use({ seed: { macros: [macro("Queued", { queue: false })] } });

test("choose where queued runs start; it only shows with Queue on", async ({ app: { page, dataDir } }) => {
  await page.getByRole("button", { name: /^Queued/ }).click();
  const choice = page.getByRole("group", { name: "Queued runs start from" });
  await expect(choice).toHaveCount(0);

  await page.getByRole("switch", { name: /^Queue presses/ }).click();
  await expect(choice.getByRole("button", { name: "Each press" })).toHaveAttribute("aria-pressed", "true");
  await choice.getByRole("button", { name: "The first press" }).click();
  await expect(choice.getByRole("button", { name: "The first press" })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible();
  const saved = JSON.parse(await readFile(join(dataDir, "macros.json"), "utf8")).macros[0];
  expect([saved.queue, saved.queue_from]).toEqual([true, "first_press"]);
});
