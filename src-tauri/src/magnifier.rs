//! The magnifier that follows the cursor during click-to-pick: a small,
//! click-through, always-on-top window showing the pixels around the cursor,
//! zoomed, with the coordinates and the color under it. It only exists while
//! a pick waits for its click.

use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};

use crate::app::AppState;

const LABEL: &str = "magnifier";
/// Pixels on each side of the center: an 11 x 11 grid.
pub const RADIUS: i32 = 5;
/// How far from the cursor the window sits, in physical pixels.
const OFFSET: i32 = 24;
const FRAME_MS: u64 = 33;

/// What the magnifier page draws, once per frame.
#[derive(Clone, serde::Serialize)]
struct Frame {
    x: i32,
    y: i32,
    /// (2 * RADIUS + 1)^2 colors, row by row, as 0xRRGGBB.
    px: Vec<u32>,
}

pub fn open(app: &AppHandle, state: Arc<AppState>) {
    let window = match app.get_webview_window(LABEL) {
        Some(w) => w,
        None => match WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html?view=magnifier".into()))
            .title("Pochini magnifier")
            .inner_size(168.0, 204.0)
            .decorations(false)
            .resizable(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .focused(false)
            .visible(false)
            .build()
        {
            Ok(w) => w,
            Err(_) => return, // picking works without it
        },
    };
    let _ = window.set_ignore_cursor_events(true);
    let app = app.clone();
    let _ = std::thread::Builder::new().name("magnifier".into()).spawn(move || {
        let mut shown = false;
        while state.picking.load(Ordering::SeqCst) {
            if let Ok((x, y)) = state.input.cursor_pos() {
                let px = grab(x, y);
                let _ = app.emit_to(LABEL, "magnify", Frame { x, y, px });
                if let Ok(size) = window.outer_size() {
                    let rect = state.input.virtual_rect();
                    let (w, h) = (size.width as i32, size.height as i32);
                    // Beside the cursor, flipped to the other side at the
                    // desktop's right and bottom edges.
                    let wx = if x + OFFSET + w > rect.x + rect.w { x - OFFSET - w } else { x + OFFSET };
                    let wy = if y + OFFSET + h > rect.y + rect.h { y - OFFSET - h } else { y + OFFSET };
                    let _ = window.set_position(PhysicalPosition::new(wx, wy));
                }
                if !shown {
                    let _ = window.show();
                    shown = true;
                }
            }
            std::thread::sleep(Duration::from_millis(FRAME_MS));
        }
        close(&app);
    });
}

pub fn close(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.close();
    }
}

fn grab(x: i32, y: i32) -> Vec<u32> {
    #[cfg(windows)]
    {
        let side = 2 * RADIUS + 1;
        crate::input::win::capture(x - RADIUS, y - RADIUS, side, side)
            .map(|px| px.into_iter().map(|[r, g, b]| (u32::from(r) << 16) | (u32::from(g) << 8) | u32::from(b)).collect())
            .unwrap_or_default()
    }
    #[cfg(not(windows))]
    {
        let _ = (x, y);
        Vec::new()
    }
}
