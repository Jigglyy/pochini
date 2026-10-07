import { defineConfig } from "@playwright/test";

// End-to-end tests, the Kanbini way: every test launches the real Pochini
// (a debug build, `npm run e2e` builds it first) against a throwaway data
// folder and drives its WebView2 over the DevTools protocol. Test mode
// (src-tauri/src/e2e.rs) swaps in a fake mouse and keyboard, installs no
// keyboard hook, and runs headless (the window sits off-screen), so a run
// never clicks on the desktop, reacts to your typing, or touches a Pochini
// you have open.
//
// `npm run e2e:headed` shows the windows, one test at a time, for watching.

const headed = process.argv.includes("--headed");
// Workers inherit this, and pass it on to the app they launch.
if (headed) process.env.POCHINI_E2E_HEADED = "1";

export default defineConfig({
  testDir: "./e2e",
  // Each test owns its app, data folder and WebView2 profile, so tests are
  // independent. WebView2 is heavy; 3 at a time is plenty.
  workers: headed ? 1 : 3,
  fullyParallel: true,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // No retries: a flaky test gets fixed, not re-run until it passes.
  retries: 0,
  reporter: "list",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
