//! Pochini - screen-coordinate click macros with global hotkeys.
//!
//! Layering, per docs/01-architecture.md:
//!   model   pure data
//!   storage atomic JSON persistence
//!   input   SendInput + coordinate math   (unsafe lives here)
//!   hotkey  WH_KEYBOARD_LL hook thread    (unsafe lives here)
//!   engine  step execution, timing, cancellation
//!   app     state + the engine worker
//!   commands the Tauri IPC surface

pub mod app;
pub mod commands;
#[cfg(debug_assertions)]
mod e2e;
pub mod engine;
pub mod hotkey;
pub mod input;
pub mod model;
pub mod storage;

use std::sync::{Arc, Mutex};

use app::{AppState, Notify};
use tauri::{Emitter, Manager};

/// Pushes settings changes to the UI, so the master switch moves on screen
/// when the toggle hotkey flips it from inside a game.
struct TauriNotify(tauri::AppHandle);

impl Notify for TauriNotify {
    fn settings_changed(&self, settings: &model::Settings) {
        let _ = self.0.emit("settings-changed", settings);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // RULE 1: before any window exists. Without this, coordinates are silently
    // virtualized on any monitor whose scaling differs from the primary.
    #[cfg(windows)]
    if let Err(e) = input::win::init_dpi_awareness() {
        eprintln!("warning: {e}");
    }

    let (tx, rx) = std::sync::mpsc::channel();

    // The Playwright test mode (debug builds only), see e2e.rs.
    #[cfg(debug_assertions)]
    let e2e = match e2e::from_env() {
        Ok(t) => t,
        Err(e) => {
            eprintln!("error: {e}");
            std::process::exit(2);
        }
    };
    #[cfg(debug_assertions)]
    let testing = e2e.is_some();
    #[cfg(not(debug_assertions))]
    let testing = false;

    let mut builder = tauri::Builder::default();
    if !testing {
        // Must be the first plugin. A second copy of Pochini would install a
        // second keyboard hook and every hotkey would fire twice; instead the
        // second launch just brings the running window to the front.
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }));
    }

    builder
        .setup(move |app| {
            #[cfg(debug_assertions)]
            let test_dir = e2e.as_ref().map(|t| t.data_dir.clone());
            #[cfg(not(debug_assertions))]
            let test_dir: Option<std::path::PathBuf> = None;

            let dir = match test_dir {
                Some(d) => d,
                None => {
                    let dir = app.path().app_config_dir()?;
                    // First start after the rename: bring the user's macros along.
                    if let Some(parent) = dir.parent() {
                        match storage::migrate_legacy_dir(&dir, &parent.join(storage::LEGACY_DIR_NAME)) {
                            Ok(copied) if !copied.is_empty() => {
                                eprintln!("migrated {copied:?} from {}", storage::LEGACY_DIR_NAME)
                            }
                            Ok(_) => {}
                            Err(e) => eprintln!("warning: could not migrate old settings: {e}"),
                        }
                    }
                    dir
                }
            };
            std::fs::create_dir_all(&dir)?;
            let store = storage::Store::new(dir);

            let macros = store.load_macros().unwrap_or_else(|e| {
                eprintln!("could not load macros ({e}); starting with an empty library");
                Default::default()
            });
            let settings = store.load_settings().unwrap_or_default();

            #[cfg(all(windows, debug_assertions))]
            let backend: Arc<dyn input::InputBackend> = if testing {
                Arc::new(input::fake::FakeInput::new())
            } else {
                Arc::new(input::win::WinInput::new())
            };
            #[cfg(all(windows, not(debug_assertions)))]
            let backend: Arc<dyn input::InputBackend> = Arc::new(input::win::WinInput::new());
            #[cfg(not(windows))]
            let backend: Arc<dyn input::InputBackend> =
                unimplemented!("only Windows is implemented; see docs/00-overview.md");

            let state = Arc::new(AppState {
                store,
                macros: Mutex::new(macros),
                settings: Mutex::new(settings),
                input: backend,
                tx: tx.clone(),
                running: Mutex::new(None),
                queue: Mutex::new(std::collections::VecDeque::new()),
                recent_keys: Mutex::new(std::collections::VecDeque::new()),
                notify: Some(Box::new(TauriNotify(app.handle().clone()))),
            });

            app::spawn_worker(state.clone(), rx);

            #[cfg(windows)]
            if !testing {
                match hotkey::HookThread::start(state.binding_table(), tx.clone()) {
                    Ok(h) => {
                        // Kept alive for the process lifetime; dropping it
                        // uninstalls the hook.
                        app.manage(Mutex::new(h));
                    }
                    Err(e) => eprintln!("warning: global hotkeys unavailable: {e}"),
                }
            }

            app.manage(state);

            // The window is built here rather than by Tauri ("create": false in
            // tauri.conf.json) so test mode can move it off-screen and give
            // WebView2 a DevTools port.
            let config = app
                .config()
                .app
                .windows
                .iter()
                .find(|w| w.label == "main")
                .cloned()
                .ok_or("tauri.conf.json has no \"main\" window")?;
            let window = tauri::WebviewWindowBuilder::from_config(app.handle(), &config)?;
            #[cfg(debug_assertions)]
            let window = match &e2e {
                Some(t) => t.window(window),
                None => window,
            };
            window.build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_macros,
            commands::get_macro,
            commands::create_macro,
            commands::save_macro,
            commands::set_macro_enabled,
            commands::set_macro_favorite,
            commands::set_macro_color,
            commands::delete_macro,
            commands::duplicate_macro,
            commands::reorder_macros,
            commands::get_settings,
            commands::save_settings,
            commands::set_enabled,
            commands::app_info,
            commands::list_monitors,
            commands::cursor_pos,
            commands::preview_point,
            commands::key_ref_for_vk,
            commands::run_macro,
            commands::stop_macro,
            commands::run_status,
            commands::list_apps,
            commands::hotkey_diagnostics,
            commands::test_steps,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
