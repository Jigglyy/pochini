//! The IPC surface. The only place stringly errors appear: everything below
//! returns typed errors and they are flattened here.

use std::sync::Arc;

use tauri::State;

use crate::app::AppState;
use crate::hotkey::bindings::Clash;
use crate::hotkey::TriggerEvent;
use crate::input::{keys, Monitor};
use crate::model::{KeyRef, Macro, Settings, Step};
use crate::storage::now_iso8601;

type R<T> = Result<T, String>;

#[derive(serde::Serialize)]
pub struct MacroSummary {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub hotkey: Option<String>,
    pub step_count: usize,
    /// Why the hotkey cannot work as set, in words; `None` when it can.
    pub conflict: Option<String>,
    pub duration_ms: (u64, u64),
    pub queue: bool,
    /// "App only" executable, if set.
    pub app: Option<String>,
    pub favorite: bool,
    pub color: Option<String>,
    /// Imported and not reviewed yet (see share.rs).
    pub review: bool,
    pub created_at: String,
    pub updated_at: String,
}

fn hotkey_label(m: &Macro) -> Option<String> {
    m.trigger.as_ref().map(|t| {
        let mut parts: Vec<String> = t
            .modifiers
            .iter()
            .map(|x| format!("{x:?}"))
            .collect();
        parts.push(if t.key.label.is_empty() {
            keys::label_for_vk(t.key.vk)
        } else {
            t.key.label.clone()
        });
        parts.join("+")
    })
}

#[tauri::command]
pub fn list_macros(state: State<'_, Arc<AppState>>) -> R<Vec<MacroSummary>> {
    let conflicts = state.binding_table().conflicts();
    let f = state.macros.lock().unwrap();
    let name_of = |id: &str| f.macros.iter().find(|m| m.id == id).map(|m| m.name.clone()).unwrap_or_default();
    Ok(f.macros
        .iter()
        .map(|m| MacroSummary {
            id: m.id.clone(),
            name: m.name.clone(),
            enabled: m.enabled,
            hotkey: hotkey_label(m),
            step_count: m.steps.len(),
            conflict: conflicts.iter().find(|(id, _)| *id == m.id).map(|(_, c)| clash_text(c, &name_of)),
            duration_ms: m.duration_range(),
            queue: m.queue,
            app: m.guard.as_ref().map(|g| g.process.clone()).filter(|p| !p.is_empty()),
            favorite: m.favorite,
            color: m.color.clone(),
            review: m.review,
            created_at: m.created_at.clone(),
            updated_at: m.updated_at.clone(),
        })
        .collect())
}

fn clash_text(c: &Clash, name_of: &dyn Fn(&str) -> String) -> String {
    match c {
        Clash::PanicKey => "Same key as the panic stop, so it never runs".into(),
        Clash::ToggleHotkey => "Same as the on/off hotkey, so it never runs".into(),
        Clash::SameAs { macro_id } => format!("Same hotkey as \"{}\", which runs instead", name_of(macro_id)),
    }
}

#[tauri::command]
pub fn get_macro(state: State<'_, Arc<AppState>>, id: String) -> R<Macro> {
    state.find(&id).ok_or_else(|| format!("no macro with id {id}"))
}

#[tauri::command]
pub fn create_macro(state: State<'_, Arc<AppState>>, name: String) -> R<Macro> {
    let m = Macro::new(if name.trim().is_empty() {
        "New macro".to_string()
    } else {
        name
    });
    state.macros.lock().unwrap().macros.push(m.clone());
    state.persist()?;
    state.refresh_bindings();
    Ok(m)
}

/// Refused for an imported macro nobody has reviewed yet (see share.rs).
const NEEDS_REVIEW: &str = "Review this imported macro before you turn it on or run it.";

#[tauri::command]
pub fn save_macro(state: State<'_, Arc<AppState>>, r#macro: Macro) -> R<()> {
    let mut m = r#macro;
    m.updated_at = now_iso8601();
    // Saved from the editor, which shows every step: that is a review.
    m.review = false;
    let id = m.id.clone();
    let disabled = !m.enabled;
    {
        let mut f = state.macros.lock().unwrap();
        match f.macros.iter_mut().find(|x| x.id == m.id) {
            Some(slot) => *slot = m,
            None => f.macros.push(m),
        }
    }
    state.persist()?;
    state.refresh_bindings();
    if disabled {
        state.abort_if(&id);
    }
    Ok(())
}

/// The switch on each macro row. Disabling a macro that is mid-run stops it.
#[tauri::command]
pub fn set_macro_enabled(state: State<'_, Arc<AppState>>, id: String, enabled: bool) -> R<()> {
    {
        let mut f = state.macros.lock().unwrap();
        let m = f
            .macros
            .iter_mut()
            .find(|m| m.id == id)
            .ok_or_else(|| format!("no macro with id {id}"))?;
        if enabled && m.review {
            return Err(NEEDS_REVIEW.into());
        }
        m.enabled = enabled;
        m.updated_at = now_iso8601();
    }
    state.persist()?;
    state.refresh_bindings();
    if !enabled {
        state.abort_if(&id);
    }
    Ok(())
}

/// The import review dialog's "Looks good": the user has seen the steps.
#[tauri::command]
pub fn mark_reviewed(state: State<'_, Arc<AppState>>, id: String) -> R<()> {
    {
        let mut f = state.macros.lock().unwrap();
        let m = f
            .macros
            .iter_mut()
            .find(|m| m.id == id)
            .ok_or_else(|| format!("no macro with id {id}"))?;
        m.review = false;
    }
    state.persist()
}

/// The star on each macro row. Not an edit: `updated_at` stays, so starring
/// does not move a macro in the "Recently edited" sort.
#[tauri::command]
pub fn set_macro_favorite(state: State<'_, Arc<AppState>>, id: String, favorite: bool) -> R<()> {
    {
        let mut f = state.macros.lock().unwrap();
        let m = f
            .macros
            .iter_mut()
            .find(|m| m.id == id)
            .ok_or_else(|| format!("no macro with id {id}"))?;
        m.favorite = favorite;
    }
    state.persist()
}

/// The color on a macro row (right-click, or the row menu). Like the star,
/// not an edit: `updated_at` stays.
#[tauri::command]
pub fn set_macro_color(state: State<'_, Arc<AppState>>, id: String, color: Option<String>) -> R<()> {
    {
        let mut f = state.macros.lock().unwrap();
        let m = f
            .macros
            .iter_mut()
            .find(|m| m.id == id)
            .ok_or_else(|| format!("no macro with id {id}"))?;
        m.color = crate::model::normalize_color(color);
    }
    state.persist()
}

#[tauri::command]
pub fn delete_macro(state: State<'_, Arc<AppState>>, id: String) -> R<()> {
    state.abort_if(&id);
    state.macros.lock().unwrap().macros.retain(|m| m.id != id);
    state.persist()?;
    state.refresh_bindings();
    Ok(())
}

#[tauri::command]
pub fn duplicate_macro(state: State<'_, Arc<AppState>>, id: String) -> R<Macro> {
    let mut m = state.find(&id).ok_or_else(|| format!("no macro with id {id}"))?;
    m.fresh_ids();
    m.name = format!("{} (copy)", m.name);
    // A duplicate must not inherit the hotkey, or both fire at once.
    m.trigger = None;
    m.favorite = false;
    m.created_at = now_iso8601();
    m.updated_at = m.created_at.clone();
    state.macros.lock().unwrap().macros.push(m.clone());
    state.persist()?;
    state.refresh_bindings();
    Ok(m)
}

/// Where to save or read a shared macro file: the system dialog, or in the
/// e2e test mode the file the test named (Playwright cannot drive native
/// dialogs). `None` when the user cancels.
fn pick_file(app: &tauri::AppHandle, save_as: Option<&str>) -> Option<std::path::PathBuf> {
    #[cfg(debug_assertions)]
    if let Some(p) = crate::e2e::dialog_file() {
        return Some(p);
    }
    use tauri_plugin_dialog::DialogExt;
    let dialog = app.dialog().file().add_filter("Pochini macros", &["json"]);
    let picked = match save_as {
        Some(name) => dialog.set_file_name(name).blocking_save_file(),
        None => dialog.blocking_pick_file(),
    };
    picked.and_then(|p| p.into_path().ok())
}

/// "Export...": write one macro to a .pochini.json file of the user's choice.
/// Returns where it went, or `None` if the dialog was cancelled. Async so the
/// blocking dialog never runs on the main thread.
#[tauri::command]
pub async fn export_macro(app: tauri::AppHandle, state: State<'_, Arc<AppState>>, id: String) -> R<Option<String>> {
    let m = state.find(&id).ok_or_else(|| format!("no macro with id {id}"))?;
    let Some(path) = pick_file(&app, Some(&crate::share::file_name(&m.name))) else {
        return Ok(None);
    };
    std::fs::write(&path, crate::share::export(&[m])).map_err(|e| format!("Could not write {}: {e}", path.display()))?;
    Ok(Some(path.display().to_string()))
}

/// "Import...": read a shared macro file and add its macros, hotkeys off.
/// Returns the names added (empty if the dialog was cancelled).
#[tauri::command]
pub async fn import_macros(app: tauri::AppHandle, state: State<'_, Arc<AppState>>) -> R<Vec<String>> {
    let Some(path) = pick_file(&app, None) else {
        return Ok(Vec::new());
    };
    // Read at most one byte past the limit, however big the file claims to
    // be (or grows while being read); share::import refuses anything over.
    let mut text = String::new();
    let file = std::fs::File::open(&path).map_err(|e| format!("Could not open {}: {e}", path.display()))?;
    std::io::Read::read_to_string(&mut std::io::Read::take(file, crate::share::MAX_BYTES as u64 + 1), &mut text)
        .map_err(|e| format!("Could not read {}: {e}", path.display()))?;
    let added = {
        let mut f = state.macros.lock().unwrap();
        let names: Vec<String> = f.macros.iter().map(|m| m.name.clone()).collect();
        let added = crate::share::import(&text, &names, &now_iso8601()).map_err(|e| e.to_string())?;
        f.macros.extend(added.iter().cloned());
        added
    };
    state.persist()?;
    state.refresh_bindings();
    Ok(added.into_iter().map(|m| m.name).collect())
}

/// A drag on the macro list: `ids` is the new order of all macros, or of one
/// group of them (see `MacroFile::reorder`).
#[tauri::command]
pub fn reorder_macros(state: State<'_, Arc<AppState>>, ids: Vec<String>) -> R<()> {
    state.macros.lock().unwrap().reorder(&ids);
    state.persist()
}

#[tauri::command]
pub fn get_settings(state: State<'_, Arc<AppState>>) -> R<Settings> {
    Ok(state.settings.lock().unwrap().clone())
}

#[tauri::command]
pub fn save_settings(state: State<'_, Arc<AppState>>, settings: Settings) -> R<()> {
    state.apply_settings(settings)
}

/// The master switch. Turning it off also stops whatever is running.
#[tauri::command]
pub fn set_enabled(state: State<'_, Arc<AppState>>, enabled: bool) -> R<()> {
    state.set_enabled(enabled)
}

#[derive(serde::Serialize)]
pub struct AppInfo {
    pub version: String,
    pub data_dir: String,
}

/// For Settings > About.
#[tauri::command]
pub fn app_info(app: tauri::AppHandle, state: State<'_, Arc<AppState>>) -> R<AppInfo> {
    Ok(AppInfo {
        version: app.package_info().version.to_string(),
        data_dir: state.store.dir().display().to_string(),
    })
}

/// Why the macro library could not be read at startup, if it could not.
#[tauri::command]
pub fn storage_problem(state: State<'_, Arc<AppState>>) -> R<Option<crate::storage::LoadProblem>> {
    Ok(state.storage_problem.lock().unwrap().clone())
}

/// Dismiss the storage notice. For a locked library this is "Start fresh":
/// saving works again, and the unreadable file stays where it was kept.
#[tauri::command]
pub fn clear_storage_problem(state: State<'_, Arc<AppState>>) -> R<()> {
    *state.storage_problem.lock().unwrap() = None;
    Ok(())
}

/// Show the data folder in Explorer.
#[tauri::command]
pub fn open_data_dir(state: State<'_, Arc<AppState>>) -> R<()> {
    #[cfg(debug_assertions)]
    if crate::e2e::active() {
        return Ok(());
    }
    std::process::Command::new("explorer.exe")
        .arg(state.store.dir())
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Could not open the folder: {e}"))
}

/// The licenses of the open source software inside the exe, for Settings >
/// About. Built in, because the exe is shipped on its own.
#[tauri::command]
pub fn third_party_notices() -> R<&'static str> {
    Ok(include_str!("../../THIRD_PARTY_NOTICES.md"))
}

#[tauri::command]
pub fn list_monitors(state: State<'_, Arc<AppState>>) -> R<Vec<Monitor>> {
    state.input.monitors().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cursor_pos(state: State<'_, Arc<AppState>>) -> R<(i32, i32)> {
    state.input.cursor_pos().map_err(|e| e.to_string())
}

/// Move the real cursor to a stored coordinate so the user can confirm it still
/// points where they think. The "Show me" button in the editor.
#[tauri::command]
pub fn preview_point(state: State<'_, Arc<AppState>>, x: i32, y: i32) -> R<()> {
    state.input.move_to(x, y).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn key_ref_for_vk(vk: u16) -> R<KeyRef> {
    Ok(keys::key_ref(vk, keys::label_for_vk(vk)))
}

/// Run a saved macro from the UI. `delay_ms` is the countdown that gives the
/// user time to switch to the target and place the mouse; the activation point
/// is wherever the mouse is when it ends.
#[tauri::command]
pub fn run_macro(state: State<'_, Arc<AppState>>, id: String, delay_ms: u64) -> R<()> {
    if state.find(&id).is_some_and(|m| m.review) {
        return Err(NEEDS_REVIEW.into());
    }
    state
        .tx
        .send(TriggerEvent::Start { macro_id: id, delay_ms, at: None })
        .map_err(|e| e.to_string())
}

/// Run an unsaved step list (the editor's Test button), with the same
/// countdown and the same one-at-a-time rule as everything else.
#[tauri::command]
pub fn test_steps(state: State<'_, Arc<AppState>>, steps: Vec<Step>, delay_ms: u64) -> R<()> {
    let mut m = Macro::new("Test run");
    m.steps = steps;
    state
        .tx
        .send(TriggerEvent::RunAdhoc { mac: Box::new(m), delay_ms })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn stop_macro(state: State<'_, Arc<AppState>>) -> R<()> {
    state.abort();
    Ok(())
}

/// What is running and how many presses are queued behind it, for the pill.
#[tauri::command]
pub fn run_status(state: State<'_, Arc<AppState>>) -> R<crate::app::RunStatus> {
    Ok(state.run_status())
}

#[derive(serde::Serialize)]
pub struct HotkeyDiagnostics {
    pub hook: crate::hotkey::HookStatus,
    pub recent: Vec<crate::app::RecentKey>,
}

/// For the Settings "Hotkey check": is the hook alive, does Windows own the
/// toggle, and what happened on the last presses of the user's hotkeys.
#[tauri::command]
pub fn hotkey_diagnostics(state: State<'_, Arc<AppState>>) -> R<HotkeyDiagnostics> {
    Ok(HotkeyDiagnostics { hook: crate::hotkey::hook_status(), recent: state.recent_keys() })
}

/// Running applications for the "App only" picker.
#[tauri::command]
pub fn list_apps() -> R<Vec<crate::input::win::AppWindow>> {
    #[cfg(windows)]
    return Ok(crate::input::win::list_apps());
    #[cfg(not(windows))]
    Ok(Vec::new())
}
