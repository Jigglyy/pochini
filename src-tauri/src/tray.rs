//! The tray icon: Pochini keeps running there with the window closed, so its
//! hotkeys keep working. Left click opens the window; the menu toggles every
//! hotkey, stops the running macro, or quits. Never in test or smoke mode.

use std::sync::Arc;

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

use crate::app::AppState;

const ID: &str = "main";

/// The menu's "Macros on" item, kept so the master switch can tick it.
struct Toggle(CheckMenuItem<Wry>);

fn tooltip(enabled: bool) -> &'static str {
    if enabled {
        "Pochini: macros on"
    } else {
        "Pochini: macros off"
    }
}

pub fn create(app: &tauri::App, enabled: bool) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Pochini", true, None::<&str>)?;
    let toggle = CheckMenuItem::with_id(app, "toggle", "Macros on", true, enabled, None::<&str>)?;
    let stop = MenuItem::with_id(app, "stop", "Stop the running macro", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Pochini", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &toggle, &stop, &PredefinedMenuItem::separator(app)?, &quit])?;

    let mut tray = TrayIconBuilder::with_id(ID)
        .tooltip(tooltip(enabled))
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let state = app.state::<Arc<AppState>>();
            match event.id.as_ref() {
                "open" => show(app),
                "toggle" => {
                    let now = !state.settings.lock().unwrap().enabled;
                    let _ = state.set_enabled(now);
                }
                "stop" => state.abort(),
                "quit" => app.exit(0),
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    app.manage(Toggle(toggle));
    Ok(())
}

/// Bring the window back, from the tray or a second launch.
pub fn show(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Keep the tray in step with the master switch.
pub fn show_state(app: &AppHandle, enabled: bool) {
    if let Some(t) = app.try_state::<Toggle>() {
        let _ = t.0.set_checked(enabled);
    }
    if let Some(tray) = app.tray_by_id(ID) {
        let _ = tray.set_tooltip(Some(tooltip(enabled)));
    }
}
