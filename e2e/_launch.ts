import { chromium, test as base, type Browser, type Locator, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Macro } from "../src/types";

// Launches one Pochini per test, like Kanbini's tests/_launch.ts: a fresh data
// folder (optionally seeded with macros), the app in test mode (see
// src-tauri/src/e2e.rs), and Playwright attached to its WebView2 through the
// DevTools port. Cleanup kills the app and deletes the folder.

const here = dirname(fileURLToPath(import.meta.url));
const EXE = resolve(here, "../src-tauri/target/debug/pochini.exe");

export type Seed = {
  macros?: Macro[];
  /** Extra files written into the data folder before launch (name -> text). */
  files?: Record<string, string>;
  /** A file in the data folder that every save / open dialog "returns". */
  dialog?: string;
  /** Show the first-run welcome (every other test starts past it). */
  welcome?: boolean;
};

export type App = {
  page: Page;
  /** The throwaway data folder (macros.json, settings.json). */
  dataDir: string;
};

// Apps still running when a worker exits (a test timed out mid-launch, say)
// are killed rather than left behind.
const live = new Set<ChildProcess>();
process.on("exit", () => live.forEach((c) => c.kill()));

function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.on("error", fail);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as AddressInfo;
      s.close(() => ok(port));
    });
  });
}

async function launch(seed: Seed): Promise<{ app: App; close: () => Promise<void> }> {
  if (!existsSync(EXE)) {
    throw new Error(`${EXE} is missing. Run the suite with "npm run e2e", which builds it first.`);
  }
  const dataDir = await mkdtemp(join(tmpdir(), "pochini-e2e-"));
  if (seed.macros) {
    await writeFile(join(dataDir, "macros.json"), JSON.stringify({ schema_version: 1, macros: seed.macros }));
  }
  if (!seed.welcome && !seed.files?.["settings.json"]) {
    await writeFile(join(dataDir, "settings.json"), JSON.stringify({ welcomed: true }));
  }
  for (const [name, text] of Object.entries(seed.files ?? {})) {
    await writeFile(join(dataDir, name), text);
  }
  const port = await freePort();
  const child = spawn(EXE, [], {
    env: {
      ...process.env,
      POCHINI_E2E: "1",
      POCHINI_DATA_DIR: dataDir,
      POCHINI_E2E_CDP_PORT: String(port),
      ...(seed.dialog ? { POCHINI_E2E_DIALOG_FILE: join(dataDir, seed.dialog) } : {}),
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  live.add(child);
  let stderr = "";
  child.stderr?.on("data", (d) => (stderr += String(d)));
  let exited: number | null = null;
  child.on("exit", (code) => {
    exited = code ?? -1;
    live.delete(child);
  });

  let browser: Browser | undefined;
  const close = async () => {
    await browser?.close().catch(() => {});
    if (exited === null) {
      const gone = new Promise((r) => child.once("exit", r));
      child.kill();
      await gone;
    }
    // WebView2 lets go of its profile a moment after the app exits.
    await rm(dataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }).catch(() => {});
  };

  try {
    const page = await attach();
    return { app: { page, dataDir }, close };
  } catch (e) {
    await close();
    throw e;
  }

  async function attach(): Promise<Page> {
    // WebView2 opens the DevTools port once the window exists.
    const deadline = Date.now() + 45_000;
    for (;;) {
      if (exited !== null) throw new Error(`Pochini exited (${exited}) before its window opened:\n${stderr}`);
      try {
        const r = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (r.ok) break;
      } catch {
        /* not listening yet */
      }
      if (Date.now() > deadline) throw new Error(`No DevTools port after 45 s:\n${stderr}`);
      await new Promise((r) => setTimeout(r, 200));
    }

    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    // The page can attach just after the connection, so poll rather than
    // wait for a "page" event that may already have fired.
    let page: Page | undefined;
    while (!page) {
      page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes("tauri"));
      if (Date.now() > deadline) throw new Error("Connected, but Pochini's page never appeared");
      if (!page) await new Promise((r) => setTimeout(r, 100));
    }
    await page.getByRole("heading", { name: "Pochini" }).waitFor();
    return page;
  }
}

export const test = base.extend<{ seed: Seed; app: App }>({
  seed: [{}, { option: true }],
  app: async ({ seed }, use) => {
    const { app, close } = await launch(seed);
    try {
      await use(app);
    } finally {
      await close();
    }
  },
});

export { expect } from "@playwright/test";

/** A real pointer drag that dnd-kit accepts: press, nudge past its 6 px
 *  activation distance, then glide in small steps (same as Kanbini's
 *  dragBetween). Grabs `from` a third of the way across, which on a macro
 *  row or step header is the name, clear of the star and the buttons (those
 *  never start a drag). Drops on the centre of `to`, offset by `dy`. */
export async function drag(page: Page, from: Locator, to: Locator, dy = 0): Promise<void> {
  // Raw mouse moves do not scroll, so bring the pair into the window first.
  // Centred, so neither end of the drag sits at an edge of the view, where
  // dnd-kit would start auto-scrolling under the pointer.
  await from.evaluate((el) => el.scrollIntoView({ block: "center" }));
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  if (!a || !b) throw new Error("drag source or target has no box");
  const start = { x: a.x + a.width / 3, y: a.y + a.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 8, start.y + 8, { steps: 4 });
  await page.mouse.move(start.x, b.y + b.height / 2 + dy, { steps: 20 });
  // Hold still for two frames before letting go, as a person does. Releasing
  // in the same frame as the last move dropped on a busy machine before
  // dnd-kit had registered it, one slot short of the target.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.mouse.up();
  // dnd-kit swallows clicks for 50 ms after a drop, so the release that ends
  // a drag cannot also press a button. Let that pass before the next click.
  await page.waitForTimeout(100);
}
