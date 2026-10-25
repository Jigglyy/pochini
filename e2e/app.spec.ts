import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
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

// A page that can drive SendInput must not run script it did not ship.
test("runs under a content security policy, and the app breaks none of it", async ({ app: { page } }) => {
  const violations: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy/i.test(m.text())) violations.push(m.text());
  });

  const injected = await page.evaluate(() => {
    const s = document.createElement("script");
    s.textContent = "window.__injected = true";
    document.head.appendChild(s);
    return (window as unknown as { __injected?: boolean }).__injected === true;
  });
  expect(injected, "an inline script ran").toBe(false);
  violations.length = 0; // that refusal is the one we provoked

  // The app's own styling (inline style props) and screens still work.
  await page.getByRole("button", { name: "Create your first macro" }).click();
  await page.getByRole("button", { name: "Click", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByText("Panic stop", { exact: true })).toBeVisible();
  expect(violations).toEqual([]);
});

test("Settings > About shows the third-party licenses built into the app", async ({ app: { page } }) => {
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Third-party licenses" }).click();
  const dialog = page.getByRole("dialog", { name: "Third-party licenses" });
  await expect(dialog).toContainText("# Third-party notices");
  await expect(dialog).toContainText("Microsoft WebView2 SDK");
  await expect(dialog).toContainText("tauri ");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test.describe("first run", () => {
  test.use({ seed: { welcome: true } });

  test("welcomes once, with the panic key and the privacy promise", async ({ app: { page, dataDir } }) => {
    const dialog = page.getByRole("dialog", { name: "Welcome to Pochini" });
    await expect(dialog).toContainText("stops a running macro at once");
    await expect(dialog).toContainText("The keyboard hook keeps nothing");
    await dialog.getByRole("button", { name: "Got it" }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(async () => JSON.parse(await readFile(join(dataDir, "settings.json"), "utf8")).welcomed).toBe(true);
    await page.reload();
    await expect(page.getByText("No macros yet")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});

test("Settings lists the app shortcuts", async ({ app: { page } }) => {
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByText("Paste a copied macro")).toBeVisible();
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(page.getByText("No macros yet")).toBeVisible();
});

// What only a release build can get wrong (the manifest, the embedded page,
// storage), checked the way scripts/release.mjs checks each new exe.
test("--smoke starts, checks itself and exits cleanly", async () => {
  const exe = join(import.meta.dirname, "../src-tauri/target/debug/pochini.exe");
  const code = await new Promise<number | null>((done) => {
    const child = spawn(exe, ["--smoke"], { stdio: "ignore" });
    const timer = setTimeout(() => child.kill(), 30_000);
    child.on("exit", (c) => {
      clearTimeout(timer);
      done(c);
    });
  });
  expect(code).toBe(0);
});
