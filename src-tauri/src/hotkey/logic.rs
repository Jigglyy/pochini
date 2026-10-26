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

/// What the hook can find out about the moment of a key press. Asked lazily:
/// only when a binding actually needs it.
pub trait KeyContext {
    /// Executable name of the app whose window is under the mouse.
    fn app_under_cursor(&mut self) -> Option<String>;
    /// Where the mouse is.
    fn cursor(&mut self) -> Option<(i32, i32)>;
}

/// A context that knows nothing (tests, and anywhere the cursor is irrelevant).
pub struct NoContext;

impl KeyContext for NoContext {
    fn app_under_cursor(&mut self) -> Option<String> {
        None
    }
    fn cursor(&mut self) -> Option<(i32, i32)> {
        None
    }
}

/// What happened to a press of a key the user has set up. Reported to the
/// Settings "Hotkey check" so a hotkey that "does nothing" can be explained.
/// Only produced for watched keys (panic, toggle, bound macros), never for
/// ordinary typing.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SeenResult {
    Panic,
    Toggle,
    Run { macro_id: String },
    /// App-only macro, mouse over a different app.
    OutsideApp { macro_id: String },
    /// A macro would have run, but the master switch is off.
    MacrosOff,
    /// A watched key, but with modifiers that match nothing.
    WrongModifiers,
}

/// Which mechanism reported the press.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Via {
    /// Our low-level keyboard hook.
    Hook,
    /// A hotkey registered with Windows (RegisterHotKey).
    Windows,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Seen {
    pub vk: u16,
    /// Modifier bits, see `mod_bits`.
    pub mods: u8,
    pub result: SeenResult,
    pub via: Via,
}

/// Ctrl = 1, Alt = 2, Shift = 4, Win = 8. A bitmask keeps the hook callback
/// allocation-free.
pub fn mod_bits(mods: &[Modifier]) -> u8 {
    mods.iter().fold(0, |acc, m| {
        acc | match m {
            Modifier::Ctrl => 1,
            Modifier::Alt => 2,
            Modifier::Shift => 4,
            Modifier::Win => 8,
        }
    })
}

/// The modifiers the user holds: those `down` (the OS key state, by virtual
/// key) reports, minus the ones our own injected input holds (`injected`, in
/// `mod_bits` form; see `input::INJECTED`). The OS cannot tell the two apart.
/// If the user holds the same modifier a step is holding, it is not seen;
/// that is the price, and far rarer than a step holding one. No allocation:
/// it runs inside the hook callback.
pub fn held_modifiers(buf: &mut [Modifier; 4], injected: u8, down: impl Fn(i32) -> bool) -> &[Modifier] {
    let mut n = 0;
    for (vks, m, bit) in [
        (&[0x11][..], Modifier::Ctrl, 1),
        (&[0x12][..], Modifier::Alt, 2),
        (&[0x10][..], Modifier::Shift, 4),
        (&[0x5B, 0x5C][..], Modifier::Win, 8),
    ] {
        if injected & bit == 0 && vks.iter().any(|&vk| down(vk)) {
            buf[n] = m;
            n += 1;
        }
    }
    &buf[..n]
}

/// What the keyboard hook sends when the panic key goes down while record
/// mode or click-to-pick is on: the capture ends, and, as everywhere else,
/// whatever runs stops. (It used to end the capture only, so a run during a
/// recording, a Test or a dry run, could not be stopped with the panic key.)
pub const CAPTURE_PANIC: [TriggerEvent; 2] = [TriggerEvent::CaptureEnd, TriggerEvent::Panic];

/// What click-to-pick does with a mouse button event.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PickClick {
    /// Not ours: pass it on.
    Pass,
    /// The pick: report it, and keep it from the app under the cursor.
    Pick,
    /// The release of the picking click: keep it from the app too.
    Swallow,
    /// A click on Pochini's own window: cancel the pick and let the click
    /// through, so the button it was meant for still works.
    Cancel,
}

pub fn pick_click(left: bool, down: bool, over_own_window: bool) -> PickClick {
    match (left, down, over_own_window) {
        (_, true, true) => PickClick::Cancel,
        (_, false, true) => PickClick::Pass,
        (true, true, false) => PickClick::Pick,
        (true, false, false) => PickClick::Swallow,
        (false, _, false) => PickClick::Pass,
    }
}

/// What the callback should do with the event it just saw.
#[derive(Debug, Default, PartialEq)]
pub struct Outcome {
    pub event: Option<TriggerEvent>,
    /// Return 1 from the hook so the focused app never sees the key.
    pub swallow: bool,
    /// For the hotkey check: what this press of a watched key did.
    pub seen: Option<Seen>,
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
    /// The watched key whose press was last reported, so holding it down
    /// (auto-repeat) is reported once.
    reported: Option<u16>,
}

impl KeyLogic {
    /// `mods` is the modifier state Windows reports right now (the hook reads
    /// it with GetAsyncKeyState). It is deliberately NOT tracked here from the
    /// event stream: a tracker that misses one key-up (released inside an
    /// elevated window, on the secure desktop, or held before the app started)
    /// believes that modifier is down forever, and every hotkey that needs
    /// exact modifiers silently stops matching.
    pub fn on_key(
        &mut self,
        table: &BindingTable,
        vk: u16,
        down: bool,
        mods: &[Modifier],
        ctx: &mut dyn KeyContext,
    ) -> Outcome {
        if modifier_for_vk(vk).is_some() {
            return Outcome::default();
        }

        if !down {
            if self.reported == Some(vk) {
                self.reported = None;
            }
            return self.on_release(table, vk);
        }

        // Report each press of a watched key once (not its auto-repeats).
        let report = table.is_watched(vk) && self.reported != Some(vk);
        if report {
            self.reported = Some(vk);
        }
        let seen = |result: SeenResult| {
            report.then(|| Seen { vk, mods: mod_bits(mods), result, via: Via::Hook })
        };

        match table.match_key_with(vk, mods, &mut || ctx.app_under_cursor()) {
            Match::None => {
                if !report {
                    return Outcome::default();
                }
                let why = if !table.enabled && table.binding_exists(vk, mods) {
                    SeenResult::MacrosOff
                } else {
                    SeenResult::WrongModifiers
                };
                Outcome { seen: seen(why), ..Outcome::default() }
            }
            // Not ours here: passes through untouched.
            Match::OutsideApp { macro_id } => {
                Outcome { seen: seen(SeenResult::OutsideApp { macro_id }), ..Outcome::default() }
            }
            // The panic key is never swallowed: you may be pressing Esc for the
            // app underneath as well.
            Match::Panic => Outcome {
                event: Some(TriggerEvent::Panic),
                swallow: false,
                seen: seen(SeenResult::Panic),
            },
            Match::Toggle => {
                if self.toggle_held {
                    return Outcome::default(); // auto-repeat
                }
                self.toggle_held = true;
                Outcome {
                    event: Some(TriggerEvent::ToggleEnabled),
                    swallow: false,
                    seen: seen(SeenResult::Toggle),
                }
            }
            Match::Trigger { macro_id, swallow, mode } => {
                if self.held.iter().any(|h| h.vk == vk) {
                    // Auto-repeat: keep swallowing if the press was swallowed.
                    return Outcome { event: None, swallow, seen: None };
                }
                self.held.push(HeldTrigger { vk, macro_id: macro_id.clone(), mode, swallowed: swallow });
                Outcome {
                    seen: seen(SeenResult::Run { macro_id: macro_id.clone() }),
                    event: Some(TriggerEvent::Start { macro_id, delay_ms: 0, at: ctx.cursor() }),
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
            seen: None,
        }
    }
}

#[cfg(test)]
mod pick_tests {
    use super::*;

    #[test]
    fn a_left_click_elsewhere_picks_and_is_kept_from_the_app() {
        assert_eq!(pick_click(true, true, false), PickClick::Pick);
        assert_eq!(pick_click(true, false, false), PickClick::Swallow);
        assert_eq!(pick_click(false, true, false), PickClick::Pass, "right clicks are left alone");
    }

    /// Regression: a click on Pochini's own window (say, its Macros button)
    /// was taken as the pick and never reached the button.
    #[test]
    fn a_click_on_pochini_cancels_the_pick_and_goes_through() {
        assert_eq!(pick_click(true, true, true), PickClick::Cancel);
        assert_eq!(pick_click(true, false, true), PickClick::Pass);
        assert_eq!(pick_click(false, true, true), PickClick::Cancel);
    }
}

#[cfg(test)]
mod held_tests {
    use super::*;

    #[test]
    fn the_os_key_state_is_read_per_modifier() {
        let mut buf = [Modifier::Ctrl; 4];
        let held = held_modifiers(&mut buf, 0, |vk| vk == 0x11 || vk == 0x5C);
        assert_eq!(held, [Modifier::Ctrl, Modifier::Win]);
    }

    /// Regression: while a step held Shift (a shift-click), the user's own
    /// hotkey press read as Shift+key and matched nothing.
    #[test]
    fn a_modifier_our_own_input_holds_is_not_the_users() {
        let mut buf = [Modifier::Ctrl; 4];
        let shift_down = |vk| vk == 0x10;
        assert_eq!(held_modifiers(&mut buf, 4, shift_down), []);
        let mut buf = [Modifier::Ctrl; 4];
        let ctrl_and_shift = |vk| vk == 0x10 || vk == 0x11;
        assert_eq!(held_modifiers(&mut buf, 4, ctrl_and_shift), [Modifier::Ctrl]);
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
        Some(TriggerEvent::Start { macro_id: id.into(), delay_ms: 0, at: None })
    }

    #[test]
    fn a_held_key_fires_once_despite_auto_repeat() {
        let t = BindingTable::build(&[mac("a", A, vec![], TriggerMode::Once, false)], ESC, true);
        let mut k = KeyLogic::default();
        assert_eq!(k.on_key(&t, A, true, NONE, &mut NoContext).event, start("a"));
        assert_eq!(k.on_key(&t, A, true, NONE, &mut NoContext).event, None);
        assert_eq!(k.on_key(&t, A, true, NONE, &mut NoContext).event, None);
        k.on_key(&t, A, false, NONE, &mut NoContext);
        assert_eq!(k.on_key(&t, A, true, NONE, &mut NoContext).event, start("a"));
    }

    /// Regression: releasing Ctrl before A left A marked as held, so Ctrl+A
    /// never fired again until restart.
    #[test]
    fn releasing_the_modifier_first_does_not_jam_the_hotkey() {
        let t = BindingTable::build(&[mac("a", A, vec![Modifier::Ctrl], TriggerMode::Once, false)], ESC, true);
        let mut k = KeyLogic::default();
        k.on_key(&t, CTRL, true, NONE, &mut NoContext);
        assert_eq!(k.on_key(&t, A, true, C, &mut NoContext).event, start("a"));
        k.on_key(&t, CTRL, false, C, &mut NoContext); // Ctrl up first
        k.on_key(&t, A, false, NONE, &mut NoContext); // then A, with no modifiers held any more
        k.on_key(&t, CTRL, true, NONE, &mut NoContext);
        assert_eq!(k.on_key(&t, A, true, C, &mut NoContext).event, start("a"), "second press must fire");
    }

    #[test]
    fn hold_repeat_stops_on_release_even_if_the_modifier_went_up_first() {
        let t = BindingTable::build(
            &[mac("h", A, vec![Modifier::Ctrl], TriggerMode::HoldRepeat, false)],
            ESC,
            true,
        );
        let mut k = KeyLogic::default();
        k.on_key(&t, CTRL, true, NONE, &mut NoContext);
        k.on_key(&t, A, true, C, &mut NoContext);
        k.on_key(&t, CTRL, false, C, &mut NoContext);
        assert_eq!(
            k.on_key(&t, A, false, NONE, &mut NoContext).event,
            Some(TriggerEvent::Stop { macro_id: "h".into() })
        );
    }

    #[test]
    fn a_swallowed_press_has_its_release_and_repeats_swallowed() {
        let t = BindingTable::build(&[mac("s", A, vec![], TriggerMode::Once, true)], ESC, true);
        let mut k = KeyLogic::default();
        assert!(k.on_key(&t, A, true, NONE, &mut NoContext).swallow);
        assert!(k.on_key(&t, A, true, NONE, &mut NoContext).swallow, "auto-repeat");
        assert!(k.on_key(&t, A, false, NONE, &mut NoContext).swallow, "release");
    }

    #[test]
    fn a_pass_through_binding_never_swallows() {
        let t = BindingTable::build(&[mac("p", A, vec![], TriggerMode::Once, false)], ESC, true);
        let mut k = KeyLogic::default();
        assert!(!k.on_key(&t, A, true, NONE, &mut NoContext).swallow);
        assert!(!k.on_key(&t, A, false, NONE, &mut NoContext).swallow);
    }

    #[test]
    fn the_toggle_fires_once_per_press_in_either_release_order() {
        let t = BindingTable::build(&[], ESC, true).with_toggle(F12, vec![Modifier::Ctrl, Modifier::Shift]);
        let mut k = KeyLogic::default();
        let toggle = Some(TriggerEvent::ToggleEnabled);

        assert_eq!(k.on_key(&t, F12, true, CS, &mut NoContext).event, toggle);
        assert_eq!(k.on_key(&t, F12, true, CS, &mut NoContext).event, None, "auto-repeat");
        // modifiers released before F12
        k.on_key(&t, CTRL, false, CS, &mut NoContext);
        k.on_key(&t, SHIFT, false, &[Modifier::Shift], &mut NoContext);
        k.on_key(&t, F12, false, NONE, &mut NoContext);
        assert_eq!(k.on_key(&t, F12, true, CS, &mut NoContext).event, toggle, "second press must toggle again");
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
        k.on_key(&t, 0xA4, true, NONE, &mut NoContext); // Alt down seen; its key-up never arrives
        assert_eq!(k.on_key(&t, F12, true, CS, &mut NoContext).event, Some(TriggerEvent::ToggleEnabled));
    }

    struct Over(Option<&'static str>, (i32, i32));
    impl KeyContext for Over {
        fn app_under_cursor(&mut self) -> Option<String> {
            self.0.map(String::from)
        }
        fn cursor(&mut self) -> Option<(i32, i32)> {
            Some(self.1)
        }
    }

    #[test]
    fn a_trigger_carries_where_the_mouse_was_at_the_press() {
        let t = BindingTable::build(&[mac("a", A, vec![], TriggerMode::Once, false)], ESC, true);
        let mut k = KeyLogic::default();
        assert_eq!(
            k.on_key(&t, A, true, NONE, &mut Over(None, (120, 340))).event,
            Some(TriggerEvent::Start { macro_id: "a".into(), delay_ms: 0, at: Some((120, 340)) })
        );
    }

    /// App only: outside the chosen app the key is simply not ours, so it is
    /// never swallowed, even when the binding blocks keys inside the app.
    #[test]
    fn outside_its_app_an_app_only_hotkey_passes_through_untouched() {
        let mut m = mac("g", A, vec![], TriggerMode::Once, true);
        m.guard = Some(crate::model::Guard { process: "game.exe".into(), label: String::new() });
        let t = BindingTable::build(&[m], ESC, true);
        let mut k = KeyLogic::default();

        let elsewhere = k.on_key(&t, A, true, NONE, &mut Over(Some("Discord.exe"), (0, 0)));
        assert_eq!((elsewhere.event, elsewhere.swallow), (None, false), "no event, not swallowed");
        assert_eq!(elsewhere.seen.map(|s| s.result), Some(SeenResult::OutsideApp { macro_id: "g".into() }));
        assert_eq!(k.on_key(&t, A, false, NONE, &mut Over(Some("Discord.exe"), (0, 0))), Outcome::default());

        let inside = k.on_key(&t, A, true, NONE, &mut Over(Some("game.exe"), (5, 6)));
        assert!(inside.swallow);
        assert!(matches!(inside.event, Some(TriggerEvent::Start { .. })));
    }

    fn seen(o: Outcome) -> Option<SeenResult> {
        o.seen.map(|s| s.result)
    }

    /// The hotkey check: every press of a key the user set up says what it did.
    #[test]
    fn presses_of_watched_keys_explain_what_happened() {
        let t = BindingTable::build(&[mac("a", A, vec![Modifier::Ctrl], TriggerMode::Once, false)], ESC, true)
            .with_toggle(F12, CS.to_vec());
        let mut k = KeyLogic::default();

        assert_eq!(seen(k.on_key(&t, F12, true, CS, &mut NoContext)), Some(SeenResult::Toggle));
        k.on_key(&t, F12, false, NONE, &mut NoContext);
        // F12 without Ctrl+Shift: a watched key, wrong modifiers
        assert_eq!(seen(k.on_key(&t, F12, true, NONE, &mut NoContext)), Some(SeenResult::WrongModifiers));
        k.on_key(&t, F12, false, NONE, &mut NoContext);
        assert_eq!(
            seen(k.on_key(&t, A, true, C, &mut NoContext)),
            Some(SeenResult::Run { macro_id: "a".into() })
        );
    }

    #[test]
    fn a_bound_key_while_macros_are_off_says_so() {
        let t = BindingTable::build(&[mac("a", A, vec![], TriggerMode::Once, false)], ESC, false);
        let mut k = KeyLogic::default();
        let o = k.on_key(&t, A, true, NONE, &mut NoContext);
        assert_eq!(o.event, None);
        assert_eq!(seen(o), Some(SeenResult::MacrosOff));
    }

    /// Rule 11: ordinary typing is never reported.
    #[test]
    fn unwatched_keys_are_never_reported() {
        let t = BindingTable::build(&[mac("a", A, vec![], TriggerMode::Once, false)], ESC, true);
        let mut k = KeyLogic::default();
        for vk in [0x42u16, 0x43, 0x0D, 0x20] {
            assert_eq!(k.on_key(&t, vk, true, NONE, &mut NoContext), Outcome::default());
        }
    }

    #[test]
    fn holding_a_watched_key_reports_it_once() {
        let t = BindingTable::build(&[], ESC, true).with_toggle(F12, CS.to_vec());
        let mut k = KeyLogic::default();
        assert!(k.on_key(&t, F12, true, NONE, &mut NoContext).seen.is_some());
        assert!(k.on_key(&t, F12, true, NONE, &mut NoContext).seen.is_none(), "auto-repeat");
        k.on_key(&t, F12, false, NONE, &mut NoContext);
        assert!(k.on_key(&t, F12, true, NONE, &mut NoContext).seen.is_some(), "next press");
    }

    #[test]
    fn modifier_bits_are_stable() {
        assert_eq!(mod_bits(&[]), 0);
        assert_eq!(mod_bits(CS), 5);
        assert_eq!(mod_bits(&[Modifier::Win, Modifier::Alt]), 10);
    }

    #[test]
    fn panic_fires_on_press_only_and_is_never_swallowed() {
        let t = BindingTable::build(&[], ESC, true);
        let mut k = KeyLogic::default();
        let o = k.on_key(&t, ESC, true, NONE, &mut NoContext);
        assert_eq!(o.event, Some(TriggerEvent::Panic));
        assert!(!o.swallow);
        assert_eq!(o.seen.map(|s| s.result), Some(SeenResult::Panic));
        assert_eq!(k.on_key(&t, ESC, false, NONE, &mut NoContext), Outcome::default());
    }

    #[test]
    fn modifier_keys_alone_never_produce_events() {
        let t = BindingTable::build(&[], ESC, true);
        let mut k = KeyLogic::default();
        for vk in [CTRL, SHIFT, 0xA4, 0x5B] {
            assert_eq!(k.on_key(&t, vk, true, NONE, &mut NoContext), Outcome::default());
            assert_eq!(k.on_key(&t, vk, false, NONE, &mut NoContext), Outcome::default());
        }
    }
}
