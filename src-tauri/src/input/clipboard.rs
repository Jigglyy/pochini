//! Plain text on the Windows clipboard, for copying a macro as text (to paste
//! into a chat) and pasting one back. Text only: no images, no formats.

use std::time::Duration;

use windows::Win32::Foundation::{GlobalFree, HANDLE, HGLOBAL};
use windows::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard, SetClipboardData,
};
use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE};
use windows::Win32::System::Ole::CF_UNICODETEXT;

/// Text longer than this (in UTF-16 units) is cut off when read: a shared
/// macro is a few kilobytes, and import refuses anything near this anyway.
const MAX_READ: usize = 4 * 1024 * 1024;

/// The clipboard, opened; closed again when dropped, however we return.
struct Opened;

impl Opened {
    fn new() -> Result<Self, String> {
        // Another app may hold it for a moment (clipboard managers do).
        for _ in 0..10 {
            // SAFETY: no owner window is needed for reading or for a plain
            // EmptyClipboard + SetClipboardData; Drop closes it again.
            if unsafe { OpenClipboard(None) }.is_ok() {
                return Ok(Opened);
            }
            std::thread::sleep(Duration::from_millis(15));
        }
        Err("Another app is using the clipboard. Try again in a moment.".into())
    }
}

impl Drop for Opened {
    fn drop(&mut self) {
        // SAFETY: we opened the clipboard in `new`, on this thread.
        unsafe {
            let _ = CloseClipboard();
        }
    }
}

pub fn write_text(text: &str) -> Result<(), String> {
    let wide: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
    let _open = Opened::new()?;
    // SAFETY: the clipboard is open on this thread. The memory is allocated
    // movable as SetClipboardData requires, filled while locked, and either
    // handed to the system (which then owns it) or freed if that fails.
    unsafe {
        EmptyClipboard().map_err(|e| format!("Could not clear the clipboard: {e}"))?;
        let mem = GlobalAlloc(GMEM_MOVEABLE, wide.len() * 2).map_err(|e| format!("Out of memory: {e}"))?;
        let dst = GlobalLock(mem) as *mut u16;
        if dst.is_null() {
            let _ = GlobalFree(mem);
            return Err("Could not write to the clipboard.".into());
        }
        std::ptr::copy_nonoverlapping(wide.as_ptr(), dst, wide.len());
        let _ = GlobalUnlock(mem);
        if SetClipboardData(u32::from(CF_UNICODETEXT.0), HANDLE(mem.0)).is_err() {
            let _ = GlobalFree(mem);
            return Err("Could not write to the clipboard.".into());
        }
    }
    Ok(())
}

/// The clipboard's text, or `None` if it holds no text.
pub fn read_text() -> Result<Option<String>, String> {
    let _open = Opened::new()?;
    // SAFETY: the clipboard is open on this thread; the handle it returns
    // belongs to the system and is only read while locked, never past the
    // size of its allocation.
    unsafe {
        if IsClipboardFormatAvailable(u32::from(CF_UNICODETEXT.0)).is_err() {
            return Ok(None);
        }
        let Ok(h) = GetClipboardData(u32::from(CF_UNICODETEXT.0)) else {
            return Ok(None);
        };
        let mem = HGLOBAL(h.0);
        let src = GlobalLock(mem) as *const u16;
        if src.is_null() {
            return Ok(None);
        }
        let units = (GlobalSize(mem) / 2).min(MAX_READ);
        let len = (0..units).take_while(|&i| *src.add(i) != 0).count();
        let text = String::from_utf16_lossy(std::slice::from_raw_parts(src, len));
        let _ = GlobalUnlock(mem);
        Ok(Some(text))
    }
}
