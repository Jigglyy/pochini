//! Test mode for the Playwright suite in `e2e/`, modelled on Kanbini's
//! (each test launches the real app against a throwaway data folder).
//!
//! Debug builds only: a release exe never reads these variables. In test
//! mode Pochini must not touch the person running the tests, so it
//!
//! - keeps macros and settings in `POCHINI_DATA_DIR` (required),
//! - injects into `FakeInput` instead of the real mouse and keyboard,
//! - installs no keyboard hook and registers no toggle hotkey,
//! - skips the single-instance check (a running Pochini stays untouched),
//! - runs headless like Kanbini's tests, as far as you can see: the window
//!   sits far off-screen, never takes focus and stays out of the taskbar
//!   (`POCHINI_E2E_HEADED=1` shows it on screen, for watching a test),
//! - gives WebView2 its own profile and a DevTools port
//!   (`POCHINI_E2E_CDP_PORT`) that Playwright connects to.

use std::path::PathBuf;

pub struct E2e {
    pub data_dir: PathBuf,
    pub cdp_port: u16,
    pub headed: bool,
}

/// `Ok(None)`: a normal run. `Err`: test mode was asked for but is not safe to
/// start, for example without its own data folder.
pub fn from_env() -> Result<Option<E2e>, String> {
    if !cfg!(debug_assertions) || std::env::var_os("POCHINI_E2E").is_none() {
        return Ok(None);
    }
    let data_dir = std::env::var_os("POCHINI_DATA_DIR")
        .map(PathBuf::from)
        .ok_or("POCHINI_E2E needs POCHINI_DATA_DIR, so tests never touch the real macros")?;
    let cdp_port = std::env::var("POCHINI_E2E_CDP_PORT")
        .map_err(|_| "POCHINI_E2E needs POCHINI_E2E_CDP_PORT".to_string())?
        .parse()
        .map_err(|e| format!("POCHINI_E2E_CDP_PORT: {e}"))?;
    let headed = std::env::var("POCHINI_E2E_HEADED").is_ok_and(|v| v == "1");
    Ok(Some(E2e { data_dir, cdp_port, headed }))
}

impl E2e {
    pub fn window<'a, R: tauri::Runtime, M: tauri::Manager<R>>(
        &self,
        b: tauri::WebviewWindowBuilder<'a, R, M>,
    ) -> tauri::WebviewWindowBuilder<'a, R, M> {
        // Setting browser args replaces Tauri's defaults, so they are repeated
        // here. The occlusion and backgrounding switches keep an off-screen
        // window rendering at full speed.
        let args = format!(
            "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,CalculateNativeWinOcclusion \
             --disable-renderer-backgrounding --disable-background-timer-throttling \
             --disable-backgrounding-occluded-windows --remote-debugging-port={}",
            self.cdp_port
        );
        let b = b
            .additional_browser_args(&args)
            .data_directory(self.data_dir.join("webview"));
        if self.headed {
            b
        } else {
            // Not `visible(false)`: a hidden WebView2 draws no frames, and
            // Chromium delivers pointer moves and requestAnimationFrame on
            // frames, so drags and the run countdown would never happen.
            // Off-screen it keeps drawing, and nobody sees it.
            b.position(-20000.0, -20000.0).focused(false).skip_taskbar(true)
        }
    }
}
