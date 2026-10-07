//! What the keyboard hook decides for each key event, as a pure state
//! machine so it can be tested without installing a system-wide hook.
//!
//! The hook callback (hotkey/hook.rs) does nothing but feed events in here
//! and act on the result, which keeps it inside its `LowLevelHooksTimeout`
//! budget and keeps every decision covered by the tests below.

use super::bindings::{BindingTable, Match};
use super::TriggerEvent;
use crate::input::keys::modifier_for_vk;
use crate::model::{Modifier, TriggerMode};

/// What the callback should do with the event it just saw.
#[derive(Debug, Default, PartialEq)]
pub struct Outcome {
    pub event: Option<TriggerEvent>,
    /// Return 1 from the hook so the focused app never sees the key.
    pub swallow: bool,
}

#[derive(Debug)]
struct HeldTrigger {
    vk: u16,
    macro_id: String,
    mode: TriggerMode,
    swallowed: bool,
}

#[derive(Debug, Default)]
pub struct KeyLogic {
    /// Bound keys currently held. Used to debounce OS auto-repeat (repeated
    /// key-downs with no key-up between them) and to pair each release with
    /// its press.
    held: Vec<HeldTrigger>,
    toggle_held: bool,
}

impl KeyLogic {
    /// `mods` is the modifier state Windows reports right now (the hook reads
    /// it with GetAsyncKeyState). It is deliberately NOT tracked here from the
    /// event stream: a tracker that misses one key-up (released inside an
    /// elevated window, on the secure desktop, or held before the app started)
    /// believes that modifier is down forever, and every hotkey that needs
    /// exact modifiers silently stops matching.
    pub fn on_key(&mut self, table: &BindingTable, vk: u16, down: bool, mods: &[Modifier]) -> Outcome {
        if modifier_for_vk(vk).is_some() {
            return Outcome::default();
        }

        if !down {
            return self.on_release(table, vk);
        }

        match table.match_key(vk, mods) {
            Match::None => Outcome::default(),
            // The panic key is never swallowed: you may be pressing Esc for the
            // app underneath as well.
            Match::Panic => Outcome { event: Some(TriggerEvent::Panic), swallow: false },
            Match::Toggle => {
                if self.toggle_held {
                    return Outcome::default(); // auto-repeat
                }
                self.toggle_held = true;
                Outcome { event: Some(TriggerEvent::ToggleEnabled), swallow: false }
            }
            Match::Trigger { macro_id, swallow, mode } => {
                if self.held.iter().any(|h| h.vk == vk) {
                    // Auto-repeat: keep swallowing if the press was swallowed.
                    return Outcome { event: None, swallow };
                }
                self.held.push(HeldTrigger { vk, macro_id: macro_id.clone(), mode, swallowed: swallow });
                Outcome {
                    event: Some(TriggerEvent::Start { macro_id, delay_ms: 0 }),
                    swallow,
                }
            }
        }
    }

    /// Releases are matched by key alone. Modifiers may already be up (letting
    /// go of Ctrl before A is normal), and requiring them here left the key
    /// marked as held forever, so the hotkey never fired again.
    fn on_release(&mut self, table: &BindingTable, vk: u16) -> Outcome {
        if table.toggle.as_ref().is_some_and(|(tvk, _)| *tvk == vk) {
            self.toggle_held = false;
        }
        let Some(i) = self.held.iter().position(|h| h.vk == vk) else {
            return Outcome::default();
        };
        let h = self.held.remove(i);
        Outcome {
            event: matches!(h.mode, TriggerMode::HoldRepeat)
                .then_some(TriggerEvent::Stop { macro_id: h.macro_id }),
            // A swallowed press must have its release swallowed too, or the
            // app sees an orphan key-up.
            swallow: h.swallowed,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{KeyRef, Macro, Trigger};

    const CTRL: u16 = 0xA2;
    const SHIFT: u16 = 0xA0;
    const A: u16 = 0x41;
    const NONE: &[Modifier] = &[];
    const C: &[Modifier] = &[Modifier::Ctrl];
    const CS: &[Modifier] = &[Modifier::Ctrl, Modifier::Shift];
    const F12: u16 = 0x7B;
    const ESC: u16 = 0x1B;

    fn mac(id: &str, vk: u16, mods: Vec<Modifier>, mode: TriggerMode, swallow: bool) -> Macro {
        let mut m = Macro::new(id);
        m.id = id.into();
        m.trigger = Some(Trigger {
            key: KeyRef { vk, scancode: 0, extended: false, label: String::new() },
            modifiers: mods,
            mode,
            swallow,
        });
        m
    }

    fn start(id: &str) -> Option<TriggerEvent> {
        Some(TriggerEvent::Start { macro_id: id.into(), delay_ms: 0 })
    }

    #[test]
    fn a_held_key_fires_once_despite_auto_repeat() {
        let t = BindingTable::build(&[mac("a", A, vec![], TriggerMode::Once, false)], ESC, true);
        let mut k = KeyLogic::default();
        assert_eq!(k.on_key(&t, A, true, NONE).event, start("a"));
        assert_eq!(k.on_key(&t, A, true, NONE).event, None);
        assert_eq!(k.on_key(&t, A, true, NONE).event, None);
        k.on_key(&t, A, false, NONE);
        assert_eq!(k.on_key(&t, A, true, NONE).event, start("a"));
    }

    /// Regression: releasing Ctrl before A left A marked as held, so Ctrl+A
    /// never fired again until restart.
    #[test]
    fn releasing_the_modifier_first_does_not_jam_the_hotkey() {
        let t = BindingTable::build(&[mac("a", A, vec![Modifier::Ctrl], TriggerMode::Once, false)], ESC, true);
        let mut k = KeyLogic::default();
        k.on_key(&t, CTRL, true, NONE);
        assert_eq!(k.on_key(&t, A, true, C).event, start("a"));
        k.on_key(&t, CTRL, false, C); // Ctrl up first
        k.on_key(&t, A, false, NONE); // then A, with no modifiers held any more
        k.on_key(&t, CTRL, true, NONE);
        assert_eq!(k.on_key(&t, A, true, C).event, start("a"), "second press must fire");
    }

    #[test]
    fn hold_repeat_stops_on_release_even_if_the_modifier_went_up_first() {
        let t = BindingTable::build(
            &[mac("h", A, vec![Modifier::Ctrl], TriggerMode::HoldRepeat, false)],
            ESC,
            true,
        );
        let mut k = KeyLogic::default();
        k.on_key(&t, CTRL, true, NONE);
        k.on_key(&t, A, true, C);
        k.on_key(&t, CTRL, false, C);
        assert_eq!(
            k.on_key(&t, A, false, NONE).event,
            Some(TriggerEvent::Stop { macro_id: "h".into() })
        );
    }

    #[test]
    fn a_swallowed_press_has_its_release_and_repeats_swallowed() {
        let t = BindingTable::build(&[mac("s", A, vec![], TriggerMode::Once, true)], ESC, true);
        let mut k = KeyLogic::default();
        assert!(k.on_key(&t, A, true, NONE).swallow);
        assert!(k.on_key(&t, A, true, NONE).swallow, "auto-repeat");
        assert!(k.on_key(&t, A, false, NONE).swallow, "release");
    }

    #[test]
    fn a_pass_through_binding_never_swallows() {
        let t = BindingTable::build(&[mac("p", A, vec![], TriggerMode::Once, false)], ESC, true);
        let mut k = KeyLogic::default();
        assert!(!k.on_key(&t, A, true, NONE).swallow);
        assert!(!k.on_key(&t, A, false, NONE).swallow);
    }

    #[test]
    fn the_toggle_fires_once_per_press_in_either_release_order() {
        let t = BindingTable::build(&[], ESC, true).with_toggle(F12, vec![Modifier::Ctrl, Modifier::Shift]);
        let mut k = KeyLogic::default();
        let toggle = Some(TriggerEvent::ToggleEnabled);

        assert_eq!(k.on_key(&t, F12, true, CS).event, toggle);
        assert_eq!(k.on_key(&t, F12, true, CS).event, None, "auto-repeat");
        // modifiers released before F12
        k.on_key(&t, CTRL, false, CS);
        k.on_key(&t, SHIFT, false, &[Modifier::Shift]);
        k.on_key(&t, F12, false, NONE);
        assert_eq!(k.on_key(&t, F12, true, CS).event, toggle, "second press must toggle again");
    }

    /// Regression, reproduced live: a modifier key-up the hook never saw
    /// (released in an elevated window, or on the secure desktop) used to stay
    /// "held" in the old event-stream tracker, so Ctrl+Shift+F12 arrived as
    /// Alt+Ctrl+Shift+F12 and matched nothing until Alt was pressed again.
    /// The modifier state is now whatever Windows says it is at that moment,
    /// so a lost key-up cannot poison later matches.
    #[test]
    fn a_lost_modifier_release_does_not_poison_later_hotkeys() {
        let t = BindingTable::build(&[], ESC, true).with_toggle(F12, CS.to_vec());
        let mut k = KeyLogic::default();
        k.on_key(&t, 0xA4, true, NONE); // Alt down seen; its key-up never arrives
        assert_eq!(k.on_key(&t, F12, true, CS).event, Some(TriggerEvent::ToggleEnabled));
    }

    #[test]
    fn panic_fires_on_press_only_and_is_never_swallowed() {
        let t = BindingTable::build(&[], ESC, true);
        let mut k = KeyLogic::default();
        let o = k.on_key(&t, ESC, true, NONE);
        assert_eq!(o.event, Some(TriggerEvent::Panic));
        assert!(!o.swallow);
        assert_eq!(k.on_key(&t, ESC, false, NONE), Outcome::default());
    }

    #[test]
    fn modifier_keys_alone_never_produce_events() {
        let t = BindingTable::build(&[], ESC, true);
        let mut k = KeyLogic::default();
        for vk in [CTRL, SHIFT, 0xA4, 0x5B] {
            assert_eq!(k.on_key(&t, vk, true, NONE), Outcome::default());
            assert_eq!(k.on_key(&t, vk, false, NONE), Outcome::default());
        }
    }
}
