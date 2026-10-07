import { expect, test } from "./_launch";

// The basics, and that test mode really is isolated.

test("starts empty, in its own data folder", async ({ app: { page, dataDir } }) => {
  await expect(page.getByText("No macros yet")).toBeVisible();

  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByText(dataDir, { exact: true })).toBeVisible();
});

test("create, name and save a macro", async ({ app: { page } }) => {
  await page.getByRole("button", { name: "Create your first macro" }).click();

  const name = page.getByRole("textbox", { name: "Macro name" });
  await name.fill("Sell loop");
  await page.getByRole("button", { name: "Click at mouse" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeDisabled();

  await page.getByRole("button", { name: "Macros", exact: true }).click();
  const row = page.getByRole("listitem").filter({ hasText: "Sell loop" });
  await expect(row).toContainText("1 step");
});

test("leaving with unsaved changes asks first", async ({ app: { page } }) => {
  await page.getByRole("button", { name: "Create your first macro" }).click();
  await page.getByRole("textbox", { name: "Macro name" }).fill("Draft");
  await page.getByRole("button", { name: "Macros", exact: true }).click();

  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Discard unsaved changes?");
  await dialog.getByRole("button", { name: "Keep editing" }).click();
  await expect(page.getByRole("textbox", { name: "Macro name" })).toHaveValue("Draft");
});

test("theme switches to light and back", async ({ app: { page } }) => {
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByText("Light", { exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByText("Dark", { exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
