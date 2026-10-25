import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AppWindow,
  HotkeyDiagnostics,
  KeyRef,
  LoadProblem,
  Macro,
  MacroSummary,
  Modifier,
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
/** An imported macro's review is done: it may be switched on and run. */
export const markReviewed = (id: string) => invoke<void>("mark_reviewed", { id });
/** `null` clears it. */
export const setMacroColor = (id: string, color: string | null) =>
  invoke<void>("set_macro_color", { id, color });
export const deleteMacro = (id: string) => invoke<void>("delete_macro", { id });
/** Undo of a delete: back at `index`, with its own id. */
export const restoreMacro = (m: Macro, index: number) => invoke<void>("restore_macro", { macro: m, index });
/** Every macro in one .pochini.json file the user picks; where it went, or null. */
export const exportAll = () => invoke<string | null>("export_all");
/** The macro as one line of text on the clipboard, to paste into a chat. */
export const copyMacroText = (id: string) => invoke<void>("copy_macro_text", { id });
/** Import macros from text on the clipboard; their names. */
export const pasteMacros = () => invoke<string[]>("paste_macros");
export const duplicateMacro = (id: string) => invoke<Macro>("duplicate_macro", { id });
/** Save one macro to a .pochini.json file the user picks; where it went, or
 *  null if they cancelled. */
export const exportMacro = (id: string) => invoke<string | null>("export_macro", { id });
/** Add the macros from a file the user picks (hotkeys off); their names, or
 *  [] if they cancelled. */
export const importMacros = () => invoke<string[]>("import_macros");
/** `ids`: the new order of all macros, or of one group of them (see `MacroFile::reorder`). */
export const reorderMacros = (ids: string[]) => invoke<void>("reorder_macros", { ids });

export const getSettings = () => invoke<Settings>("get_settings");
export const saveSettings = (settings: Settings) => invoke<void>("save_settings", { settings });
export const setEnabled = (enabled: boolean) => invoke<void>("set_enabled", { enabled });
/** The first-run welcome was closed. */
export const setWelcomed = () => invoke<void>("set_welcomed");
/** A key is being recorded in the window: hotkeys stand aside meanwhile. */
export const setRecording = (on: boolean) => invoke<void>("set_recording", { on });
/** Would this hotkey work for the macro? Why not, in words, or null. */
export const hotkeyClash = (vk: number, modifiers: Modifier[], guard: string | null, macroId: string) =>
  invoke<string | null>("hotkey_clash", { vk, modifiers, guard, macroId });

/** Fires when settings change behind the UI's back, e.g. the toggle hotkey
 *  flipped the master switch from inside a game. */
export const onSettingsChanged = (cb: (s: Settings) => void): Promise<UnlistenFn> =>
  listen<Settings>("settings-changed", (e) => cb(e.payload));

export type AppInfo = { version: string; data_dir: string };
export const appInfo = () => invoke<AppInfo>("app_info");

export const storageProblem = () => invoke<LoadProblem | null>("storage_problem");
/** Dismiss the notice; for a locked library, "Start fresh". */
export const clearStorageProblem = () => invoke<void>("clear_storage_problem");
export const openDataDir = () => invoke<void>("open_data_dir");
/** THIRD_PARTY_NOTICES.md, built into the exe. */
export const thirdPartyNotices = () => invoke<string>("third_party_notices");

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
