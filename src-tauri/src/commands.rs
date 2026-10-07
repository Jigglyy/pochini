//! The IPC surface. The only place stringly errors appear: everything below
//! returns typed errors and they are flattened here.

use std::sync::Arc;

use tauri::State;

use crate::app::AppState;
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
    pub conflict: bool,
    pub duration_ms: (u64, u64),
    pub queue: bool,
    /// "App only" executable, if set.
    pub app: Option<String>,
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
    Ok(f.macros
        .iter()
        .map(|m| MacroSummary {
            id: m.id.clone(),
            name: m.name.clone(),
            enabled: m.enabled,
            hotkey: hotkey_label(m),
            step_count: m.steps.len(),
            conflict: conflicts.contains(&m.id),
            duration_ms: m.duration_range(),
            queue: m.queue,
            app: m.guard.as_ref().map(|g| g.process.clone()).filter(|p| !p.is_empty()),
        })
        .collect())
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

#[tauri::command]
pub fn save_macro(state: State<'_, Arc<AppState>>, r#macro: Macro) -> R<()> {
    let mut m = r#macro;
    m.updated_at = now_iso8601();
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
    m.id = ulid::Ulid::new().to_string();
    m.name = format!("{} (copy)", m.name);
    // A duplicate must not inherit the hotkey, or both fire at once.
    m.trigger = None;
    m.created_at = now_iso8601();
    m.updated_at = m.created_at.clone();
    for s in m.steps.iter_mut() {
        reassign_step_id(s);
    }
    state.macros.lock().unwrap().macros.push(m.clone());
    state.persist()?;
    state.refresh_bindings();
    Ok(m)
}

fn reassign_step_id(s: &mut Step) {
    let new = ulid::Ulid::new().to_string();
    match s {
        Step::Click { id, .. }
        | Step::Move { id, .. }
        | Step::Scroll { id, .. }
        | Step::Key { id, .. }
        | Step::Text { id, .. }
        | Step::Wait { id, .. } => *id = new,
    }
}

#[tauri::command]
pub fn reorder_macros(state: State<'_, Arc<AppState>>, ids: Vec<String>) -> R<()> {
    let mut f = state.macros.lock().unwrap();
    f.macros
        .sort_by_key(|m| ids.iter().position(|i| *i == m.id).unwrap_or(usize::MAX));
    drop(f);
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

/// Running applications for the "App only" picker.
#[tauri::command]
pub fn list_apps() -> R<Vec<crate::input::win::AppWindow>> {
    #[cfg(windows)]
    return Ok(crate::input::win::list_apps());
    #[cfg(not(windows))]
    Ok(Vec::new())
}
