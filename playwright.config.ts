import { defineConfig } from "@playwright/test";

// End-to-end tests, the Kanbini way: every test launches the real Pochini
// (a debug build, `npm run e2e` builds it first) against a throwaway data
// folder and drives its WebView2 over the DevTools protocol. Test mode
// (src-tauri/src/e2e.rs) swaps in a fake mouse and keyboard, installs no
// keyboard hook, and runs headless (the window is never shown), so a run
// never clicks on the desktop, reacts to your typing, or touches a Pochini
// you have open.
//
// `npm run e2e:headed` shows the windows, one test at a time, for watching.

const headed = process.argv.includes("--headed");
const ci = !!process.env.CI;
// Workers inherit this, and pass it on to the app they launch.
if (headed) process.env.POCHINI_E2E_HEADED = "1";

export default defineConfig({
  testDir: "./e2e",
  // Seeds every WebView2 profile so none signs in to the Windows account, and
  // stops the run if one does (it locked the account once: e2e/_webview.ts).
  globalSetup: "./e2e/global-setup.ts",
  // Each test owns its app, data folder and WebView2 profile, so tests are
  // independent. WebView2 is heavy; 3 at a time is plenty.
  workers: headed ? 1 : ci ? 2 : 3,
  fullyParallel: true,
  // Starting the app counts toward each test's time, and a slow CI runner can
  // take over a minute to start WebView2 (the launcher allows 90 s there).
  timeout: ci ? 120_000 : 60_000,
  expect: { timeout: 10_000 },
  // No retries: a flaky test gets fixed, not re-run until it passes.
  retries: 0,
  reporter: ci ? [["github"], ["list"]] : "list",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
