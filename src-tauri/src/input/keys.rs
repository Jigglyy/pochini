//! Virtual key <-> scan code, and the extended-key bit.
//!
//! `MAPVK_VK_TO_VSC_EX` returns the scan code with a `0xE0` prefix in the high
//! byte for extended keys, so the hardcoded extended-key table the design
//! originally called for turned out to be unnecessary. Verified for Right Ctrl:
//! scan `0x1D` with `KEYEVENTF_EXTENDEDKEY` registers as `VK_RCONTROL`, and the
//! same scan code without it registers as `VK_LCONTROL`.

use crate::model::{KeyRef, Modifier};

pub const VK_LCONTROL: u16 = 0xA2;
pub const VK_RCONTROL: u16 = 0xA3;
pub const VK_LMENU: u16 = 0xA4;
pub const VK_RMENU: u16 = 0xA5;
pub const VK_LSHIFT: u16 = 0xA0;
pub const VK_RSHIFT: u16 = 0xA1;
pub const VK_LWIN: u16 = 0x5B;
pub const VK_ESCAPE: u16 = 0x1B;

/// Keys `MapVirtualKeyW` is documented not to resolve usefully, or that need a
/// fixed answer regardless of layout.
fn special_case(vk: u16) -> Option<(u16, bool)> {
    match vk {
        0x13 => Some((0x45, false)), // VK_PAUSE: scan 0x45, NOT extended
        0x90 => Some((0x45, false)), // VK_NUMLOCK shares 0x45; extended only via E1/E0 games
        _ => None,
    }
}

/// Split a `MAPVK_VK_TO_VSC_EX` result into (scan code, extended).
pub fn split_vsc_ex(vk: u16, raw: u32) -> (u16, bool) {
    if let Some(s) = special_case(vk) {
        return s;
    }
    let extended = ((raw >> 8) & 0xFF) == 0xE0;
    ((raw & 0xFF) as u16, extended)
}

/// Resolve a VK to a scan code under the current keyboard layout.
#[cfg(windows)]
pub fn scan_for_vk(vk: u16) -> (u16, bool) {
    use windows::Win32::UI::Input::KeyboardAndMouse::{MapVirtualKeyW, MAPVK_VK_TO_VSC_EX};
    // SAFETY: MapVirtualKeyW takes and returns plain integers and has no
    // preconditions beyond a valid map type.
    let raw = unsafe { MapVirtualKeyW(vk as u32, MAPVK_VK_TO_VSC_EX) };
    split_vsc_ex(vk, raw)
}

#[cfg(not(windows))]
pub fn scan_for_vk(vk: u16) -> (u16, bool) {
    (vk, false)
}

/// Build a [`KeyRef`] for a virtual key, resolving the scan code now so the
/// stored macro survives a later layout change.
pub fn key_ref(vk: u16, label: impl Into<String>) -> KeyRef {
    let (scancode, extended) = scan_for_vk(vk);
    KeyRef {
        vk,
        scancode,
        extended,
        label: label.into(),
    }
}

pub fn modifier_vk(m: Modifier) -> u16 {
    match m {
        Modifier::Ctrl => VK_LCONTROL,
        Modifier::Alt => VK_LMENU,
        Modifier::Shift => VK_LSHIFT,
        Modifier::Win => VK_LWIN,
    }
}

/// Is this virtual key one of the modifier keys, on either side?
pub fn modifier_for_vk(vk: u16) -> Option<Modifier> {
    match vk {
        0x11 | VK_LCONTROL | VK_RCONTROL => Some(Modifier::Ctrl),
        0x12 | VK_LMENU | VK_RMENU => Some(Modifier::Alt),
        0x10 | VK_LSHIFT | VK_RSHIFT => Some(Modifier::Shift),
        VK_LWIN | 0x5C => Some(Modifier::Win),
        _ => None,
    }
}

/// A readable name for a virtual key, for the UI.
pub fn label_for_vk(vk: u16) -> String {
    match vk {
        0x08 => "Backspace".into(),
        0x09 => "Tab".into(),
        0x0D => "Enter".into(),
        0x13 => "Pause".into(),
        0x14 => "CapsLock".into(),
        VK_ESCAPE => "Esc".into(),
        0x20 => "Space".into(),
        0x21 => "PageUp".into(),
        0x22 => "PageDown".into(),
        0x23 => "End".into(),
        0x24 => "Home".into(),
        0x25 => "Left".into(),
        0x26 => "Up".into(),
        0x27 => "Right".into(),
        0x28 => "Down".into(),
        0x2D => "Insert".into(),
        0x2E => "Delete".into(),
        0x10 => "Shift".into(),
        0x11 => "Ctrl".into(),
        0x12 => "Alt".into(),
        VK_LSHIFT => "LShift".into(),
        VK_RSHIFT => "RShift".into(),
        VK_LCONTROL => "LCtrl".into(),
        VK_RCONTROL => "RCtrl".into(),
        VK_LMENU => "LAlt".into(),
        VK_RMENU => "RAlt".into(),
        VK_LWIN => "Win".into(),
        0x30..=0x39 => char::from(b'0' + (vk - 0x30) as u8).to_string(),
        0x41..=0x5A => char::from(b'A' + (vk - 0x41) as u8).to_string(),
        0x60..=0x69 => format!("Numpad{}", vk - 0x60),
        0x70..=0x87 => format!("F{}", vk - 0x6F),
        other => format!("VK 0x{other:02X}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extended_prefix_is_read_from_the_high_byte() {
        // Right Ctrl: MAPVK_VK_TO_VSC_EX returns 0xE01D.
        assert_eq!(split_vsc_ex(VK_RCONTROL, 0xE01D), (0x1D, true));
        // Left Ctrl: same scan code, no prefix.
        assert_eq!(split_vsc_ex(VK_LCONTROL, 0x001D), (0x1D, false));
        // 'A'
        assert_eq!(split_vsc_ex(0x41, 0x001E), (0x1E, false));
        // Arrows are extended.
        assert_eq!(split_vsc_ex(0x25, 0xE04B), (0x4B, true));
    }

    #[test]
    fn pause_and_numlock_are_special_cased() {
        // Whatever MapVirtualKeyW says, these are pinned.
        assert_eq!(split_vsc_ex(0x13, 0xE11D), (0x45, false));
        assert_eq!(split_vsc_ex(0x90, 0x0045), (0x45, false));
    }

    #[test]
    fn modifier_lookup_covers_both_sides() {
        for vk in [0x11, VK_LCONTROL, VK_RCONTROL] {
            assert_eq!(modifier_for_vk(vk), Some(Modifier::Ctrl));
        }
        for vk in [0x10, VK_LSHIFT, VK_RSHIFT] {
            assert_eq!(modifier_for_vk(vk), Some(Modifier::Shift));
        }
        assert_eq!(modifier_for_vk(0x41), None);
    }

    #[test]
    fn labels_are_readable() {
        assert_eq!(label_for_vk(0x20), "Space");
        assert_eq!(label_for_vk(0x41), "A");
        assert_eq!(label_for_vk(0x30), "0");
        assert_eq!(label_for_vk(0x78), "F9");
        assert_eq!(label_for_vk(0x70), "F1");
        assert_eq!(label_for_vk(VK_RCONTROL), "RCtrl");
    }
}
