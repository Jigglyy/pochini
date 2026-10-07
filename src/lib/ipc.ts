import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AppWindow,
  HotkeyDiagnostics,
  KeyRef,
  Macro,
  MacroSummary,
  Monitor,
  RunStatus,
  Settings,
  Step,
} from "../types";

/** The Run / Test countdown: time to switch to the target and place the mouse.
 *  It runs in the backend, so it keeps time even while this window is hidden. */
export const RUN_COUNTDOWN_MS = 3000;

export const listMacros = () => invoke<MacroSummary[]>("list_macros");
export const getMacro = (id: string) => invoke<Macro>("get_macro", { id });
export const createMacro = (name: string) => invoke<Macro>("create_macro", { name });
export const saveMacro = (m: Macro) => invoke<void>("save_macro", { macro: m });
export const setMacroEnabled = (id: string, enabled: boolean) =>
  invoke<void>("set_macro_enabled", { id, enabled });
export const setMacroFavorite = (id: string, favorite: boolean) =>
  invoke<void>("set_macro_favorite", { id, favorite });
/** `null` clears it. */
export const setMacroColor = (id: string, color: string | null) =>
  invoke<void>("set_macro_color", { id, color });
export const deleteMacro = (id: string) => invoke<void>("delete_macro", { id });
export const duplicateMacro = (id: string) => invoke<Macro>("duplicate_macro", { id });
/** `ids`: the new order of all macros, or of one group of them (see `MacroFile::reorder`). */
export const reorderMacros = (ids: string[]) => invoke<void>("reorder_macros", { ids });

export const getSettings = () => invoke<Settings>("get_settings");
export const saveSettings = (settings: Settings) => invoke<void>("save_settings", { settings });
export const setEnabled = (enabled: boolean) => invoke<void>("set_enabled", { enabled });

/** Fires when settings change behind the UI's back, e.g. the toggle hotkey
 *  flipped the master switch from inside a game. */
export const onSettingsChanged = (cb: (s: Settings) => void): Promise<UnlistenFn> =>
  listen<Settings>("settings-changed", (e) => cb(e.payload));

export type AppInfo = { version: string; data_dir: string };
export const appInfo = () => invoke<AppInfo>("app_info");

export const listMonitors = () => invoke<Monitor[]>("list_monitors");
export const cursorPos = () => invoke<[number, number]>("cursor_pos");
export const previewPoint = (x: number, y: number) => invoke<void>("preview_point", { x, y });
export const keyRefForVk = (vk: number) => invoke<KeyRef>("key_ref_for_vk", { vk });

export const runMacro = (id: string, delayMs = RUN_COUNTDOWN_MS) =>
  invoke<void>("run_macro", { id, delayMs });
export const testSteps = (steps: Step[], delayMs = RUN_COUNTDOWN_MS) =>
  invoke<void>("test_steps", { steps, delayMs });
export const stopMacro = () => invoke<void>("stop_macro");
export const runStatus = () => invoke<RunStatus>("run_status");
export const listApps = () => invoke<AppWindow[]>("list_apps");
export const hotkeyDiagnostics = () => invoke<HotkeyDiagnostics>("hotkey_diagnostics");
