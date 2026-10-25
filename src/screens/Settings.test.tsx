import { expect, it, vi } from "vitest";
import type { Settings as SettingsT } from "@/types";
import { button, click, render, settle, text } from "@/test/render";

vi.mock("@/lib/ipc", () => ({
  appInfo: () => Promise.resolve({ version: "9.9.9", data_dir: "C:\\data" }),
  autostartEnabled: () => Promise.resolve(false),
  isElevated: () => Promise.resolve(false),
  runHistory: () => Promise.resolve([]),
  onRunFinished: () => Promise.resolve(() => {}),
  hotkeyDiagnostics: () => new Promise(() => {}),
  clearRunHistory: () => Promise.resolve(),
  exportAll: () => Promise.resolve(null),
  openDataDir: () => Promise.resolve(),
  restartElevated: () => Promise.resolve(),
  saveSettings: () => Promise.resolve(),
  setAutostart: () => Promise.resolve(),
  thirdPartyNotices: () => Promise.resolve(""),
}));

const { Settings, loadSection } = await import("./Settings");

const settings = {
  panic_key: { vk: 0x1b, scancode: 1, extended: false, label: "Esc" },
  enabled: true,
  rng_seed: null,
  toggle_hotkey: null,
  welcomed: true,
  close_to_tray: null,
} as SettingsT;

const show = () => render(<Settings settings={settings} onSettings={() => {}} theme="dark" onTheme={() => {}} />);

it("opens on Hotkeys the first time, and on the last section after that", async () => {
  expect(loadSection()).toBe("hotkeys");
  const view = show();
  expect(text()).toContain("Panic stop");
  click(button("About"));
  await settle();
  expect(text()).toContain("Version 9.9.9");
  expect(text()).not.toContain("Panic stop");
  expect(button("About").getAttribute("aria-current")).toBe("page");

  view.unmount();
  expect(loadSection()).toBe("about");
  show();
  await settle();
  expect(text()).toContain("Third-party licenses");
});

it("forgets a section that no longer exists", () => {
  localStorage.setItem("pochini.lastSettingsSection", "obsidian");
  expect(loadSection()).toBe("hotkeys");
});
