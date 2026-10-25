//! The binding table the hook callback matches against.
//!
//! Held in an `ArcSwap` so the callback never takes a lock: the UI thread
//! builds a new table and swaps it in, and the callback reads whatever snapshot
//! is current. A callback that blocks on a mutex the UI thread holds is a
//! system-wide input stall.

use crate::model::{Macro, Modifier, TriggerMode};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Binding {
    pub macro_id: String,
    pub vk: u16,
    pub modifiers: Vec<Modifier>,
    pub mode: TriggerMode,
    pub swallow: bool,
    /// "App only": lowercase executable name the mouse must be over.
    pub guard: Option<String>,
}

#[derive(Debug, Default, Clone)]
pub struct BindingTable {
    pub bindings: Vec<Binding>,
    /// Never swallowed. Aborts any running macro.
    pub panic_vk: u16,
    /// Master switch: when false, every binding is inert but the hook stays
    /// installed (so toggling does not churn a system-wide hook).
    pub enabled: bool,
    /// Flips the master switch. Matched even while disabled.
    pub toggle: Option<(u16, Vec<Modifier>)>,
}

/// Why a macro's hotkey cannot work as set.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Clash {
    PanicKey,
    ToggleHotkey,
    /// An earlier macro has the same hotkey, and the first one wins.
    SameAs { macro_id: String },
}

/// What the callback decided.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Match {
    None,
    Panic,
    Toggle,
    Trigger { macro_id: String, swallow: bool, mode: TriggerMode },
    /// An app-only binding exists for this key, but the mouse is elsewhere.
    /// Behaves like `None` (passes through); reported by the hotkey check.
    OutsideApp { macro_id: String },
}

impl BindingTable {
    pub fn build(macros: &[Macro], panic_vk: u16, enabled: bool) -> Self {
        let bindings = macros
            .iter()
            .filter(|m| m.enabled)
            .filter_map(|m| {
                m.trigger.as_ref().map(|t| Binding {
                    macro_id: m.id.clone(),
                    vk: t.key.vk,
                    modifiers: t.modifiers.clone(),
                    mode: t.mode,
                    swallow: t.swallow,
                    guard: m.guard.as_ref().map(|g| g.process.to_lowercase()),
                })
            })
            .collect();
        Self { bindings, panic_vk, enabled, toggle: None }
    }

    pub fn with_toggle(mut self, vk: u16, modifiers: Vec<Modifier>) -> Self {
        self.toggle = Some((vk, modifiers));
        self
    }

    /// Match a key event with no information about where the mouse is, so
    /// app-only bindings never match. Handy in tests.
    pub fn match_key(&self, vk: u16, held: &[Modifier]) -> Match {
        self.match_key_with(vk, held, &mut || None)
    }

    /// Match a key event. `held` is the set of modifiers currently down;
    /// `app_under_cursor` names the executable the mouse is over. It is only
    /// called when an app-only binding is a candidate, because it costs a few
    /// system calls inside the hook callback.
    ///
    /// The panic key is checked first and works even when the master switch is
    /// off, because a runaway macro is exactly when you reach for it.
    pub fn match_key_with(
        &self,
        vk: u16,
        held: &[Modifier],
        app_under_cursor: &mut dyn FnMut() -> Option<String>,
    ) -> Match {
        if vk == self.panic_vk {
            return Match::Panic;
        }
        // Before the enabled check: the toggle is how you turn things back on.
        if let Some((tvk, tmods)) = &self.toggle {
            if *tvk == vk && same_modifiers(tmods, held) {
                return Match::Toggle;
            }
        }
        if !self.enabled {
            return Match::None;
        }
        let trigger = |b: &Binding| Match::Trigger {
            macro_id: b.macro_id.clone(),
            swallow: b.swallow,
            mode: b.mode,
        };
        // An app-only binding beats an unrestricted one on the same key while
        // the mouse is over its app; elsewhere the unrestricted one applies.
        let mut here: Option<Option<String>> = None;
        let mut fallback: Option<&Binding> = None;
        let mut outside: Option<&Binding> = None;
        for b in &self.bindings {
            // Exact modifier match: Ctrl+A must not fire on Ctrl+Shift+A.
            if b.vk != vk || !same_modifiers(&b.modifiers, held) {
                continue;
            }
            match &b.guard {
                None => {
                    if fallback.is_none() {
                        fallback = Some(b);
                    }
                }
                Some(app) => {
                    let here = here.get_or_insert_with(|| app_under_cursor().map(|s| s.to_lowercase()));
                    if here.as_deref() == Some(app.as_str()) {
                        return trigger(b);
                    }
                    if outside.is_none() {
                        outside = Some(b);
                    }
                }
            }
        }
        match (fallback, outside) {
            (Some(b), _) => trigger(b),
            (None, Some(b)) => Match::OutsideApp { macro_id: b.macro_id.clone() },
            (None, None) => Match::None,
        }
    }

    /// Is this key one the user has set up (panic, toggle, or any macro)?
    /// Only these are ever reported by the hotkey check; other keys are not.
    pub fn is_watched(&self, vk: u16) -> bool {
        vk == self.panic_vk
            || self.toggle.as_ref().is_some_and(|(t, _)| *t == vk)
            || self.bindings.iter().any(|b| b.vk == vk)
    }

    /// Would some macro have matched this key if macros were on?
    pub fn binding_exists(&self, vk: u16, held: &[Modifier]) -> bool {
        self.bindings.iter().any(|b| b.vk == vk && same_modifiers(&b.modifiers, held))
    }

    /// Macros whose hotkey cannot work as set, and why: the panic key or the
    /// on/off hotkey (both matched before any macro, so the macro never
    /// fires), or the same hotkey as an earlier macro (the first one wins).
    /// The same key restricted to different apps is not a clash.
    pub fn conflicts(&self) -> Vec<(String, Clash)> {
        self.bindings
            .iter()
            .enumerate()
            .filter_map(|(i, b)| {
                self.clash_with(b.vk, &b.modifiers, b.guard.as_deref(), &self.bindings[..i])
                    .map(|c| (b.macro_id.clone(), c))
            })
            .collect()
    }

    /// Would a hotkey of `vk` + `modifiers` (in `guard`'s app, if any) work,
    /// for the macro `except` (its own binding does not count)? For a warning
    /// while the user records a hotkey.
    pub fn clash_for(&self, vk: u16, modifiers: &[Modifier], guard: Option<&str>, except: &str) -> Option<Clash> {
        let guard = guard.map(str::to_lowercase);
        let others: Vec<Binding> = self.bindings.iter().filter(|b| b.macro_id != except).cloned().collect();
        self.clash_with(vk, modifiers, guard.as_deref(), &others)
    }

    fn clash_with(&self, vk: u16, modifiers: &[Modifier], guard: Option<&str>, others: &[Binding]) -> Option<Clash> {
        // The panic key matches whatever modifiers are held.
        if vk == self.panic_vk {
            return Some(Clash::PanicKey);
        }
        if let Some((tvk, tmods)) = &self.toggle {
            if *tvk == vk && same_modifiers(tmods, modifiers) {
                return Some(Clash::ToggleHotkey);
            }
        }
        others
            .iter()
            .find(|o| o.vk == vk && same_modifiers(&o.modifiers, modifiers) && o.guard.as_deref() == guard)
            .map(|o| Clash::SameAs { macro_id: o.macro_id.clone() })
    }
}

/// Exact set equality, order-insensitive: Ctrl+A must not fire on Ctrl+Shift+A.
fn same_modifiers(want: &[Modifier], held: &[Modifier]) -> bool {
    want.len() == held.len() && want.iter().all(|m| held.contains(m))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{KeyRef, Trigger};

    fn m(id: &str, vk: u16, mods: Vec<Modifier>, swallow: bool) -> Macro {
        let mut mac = Macro::new(id);
        mac.id = id.into();
        mac.trigger = Some(Trigger {
            key: KeyRef { vk, scancode: 0, extended: false, label: String::new() },
            modifiers: mods,
            mode: TriggerMode::Once,
            swallow,
        });
        mac
    }

    #[test]
    fn a_bare_key_matches_only_with_no_modifiers_held() {
        let t = BindingTable::build(&[m("a", 0x20, vec![], false)], 0x1B, true);
        assert!(matches!(t.match_key(0x20, &[]), Match::Trigger { .. }));
        assert_eq!(t.match_key(0x20, &[Modifier::Ctrl]), Match::None);
    }

    #[test]
    fn modifier_matching_is_exact() {
        let t = BindingTable::build(&[m("a", 0x41, vec![Modifier::Ctrl], false)], 0x1B, true);
        assert!(matches!(t.match_key(0x41, &[Modifier::Ctrl]), Match::Trigger { .. }));
        // A superset must not fire it.
        assert_eq!(t.match_key(0x41, &[Modifier::Ctrl, Modifier::Shift]), Match::None);
        assert_eq!(t.match_key(0x41, &[]), Match::None);
    }

    #[test]
    fn modifier_order_does_not_matter() {
        let t = BindingTable::build(
            &[m("a", 0x41, vec![Modifier::Ctrl, Modifier::Shift], false)],
            0x1B,
            true,
        );
        assert!(matches!(
            t.match_key(0x41, &[Modifier::Shift, Modifier::Ctrl]),
            Match::Trigger { .. }
        ));
    }

    #[test]
    fn the_panic_key_wins_over_a_binding_and_ignores_the_master_switch() {
        let t = BindingTable::build(&[m("a", 0x1B, vec![], true)], 0x1B, false);
        assert_eq!(t.match_key(0x1B, &[]), Match::Panic);
    }

    #[test]
    fn disabling_the_master_switch_makes_bindings_inert() {
        let t = BindingTable::build(&[m("a", 0x20, vec![], false)], 0x1B, false);
        assert_eq!(t.match_key(0x20, &[]), Match::None);
    }

    #[test]
    fn a_disabled_macro_is_not_bound() {
        let mut mac = m("a", 0x20, vec![], false);
        mac.enabled = false;
        let t = BindingTable::build(&[mac], 0x1B, true);
        assert_eq!(t.match_key(0x20, &[]), Match::None);
    }

    #[test]
    fn swallow_defaults_off_and_is_reported_on_the_match() {
        let t = BindingTable::build(
            &[m("a", 0x20, vec![], false), m("b", 0x21, vec![], true)],
            0x1B,
            true,
        );
        match t.match_key(0x20, &[]) {
            Match::Trigger { swallow, .. } => assert!(!swallow, "Space must pass through"),
            other => panic!("{other:?}"),
        }
        match t.match_key(0x21, &[]) {
            Match::Trigger { swallow, .. } => assert!(swallow),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn the_toggle_hotkey_works_even_while_everything_is_disabled() {
        let t = BindingTable::build(&[m("a", 0x20, vec![], false)], 0x1B, false)
            .with_toggle(0x7B, vec![Modifier::Ctrl, Modifier::Shift]);
        assert_eq!(t.match_key(0x7B, &[Modifier::Ctrl, Modifier::Shift]), Match::Toggle);
        // and the disabled binding stays inert
        assert_eq!(t.match_key(0x20, &[]), Match::None);
    }

    #[test]
    fn the_toggle_hotkey_needs_its_exact_modifiers() {
        let t = BindingTable::build(&[], 0x1B, true)
            .with_toggle(0x7B, vec![Modifier::Ctrl, Modifier::Shift]);
        assert_eq!(t.match_key(0x7B, &[]), Match::None);
        assert_eq!(t.match_key(0x7B, &[Modifier::Ctrl]), Match::None);
        assert_eq!(t.match_key(0x7B, &[Modifier::Shift, Modifier::Ctrl]), Match::Toggle);
    }

    #[test]
    fn the_toggle_hotkey_beats_a_macro_bound_to_the_same_combo() {
        let t = BindingTable::build(
            &[m("a", 0x7B, vec![Modifier::Ctrl, Modifier::Shift], false)],
            0x1B,
            true,
        )
        .with_toggle(0x7B, vec![Modifier::Ctrl, Modifier::Shift]);
        assert_eq!(t.match_key(0x7B, &[Modifier::Ctrl, Modifier::Shift]), Match::Toggle);
    }

    fn guarded(id: &str, vk: u16, app: &str) -> Macro {
        let mut mac = m(id, vk, vec![], false);
        mac.guard = Some(crate::model::Guard { process: app.into(), label: String::new() });
        mac
    }

    #[test]
    fn an_app_only_binding_fires_only_over_its_app() {
        let t = BindingTable::build(&[guarded("g", 0x20, "game.exe")], 0x1B, true);
        let over = |app: &'static str| move || Some(app.to_string());
        assert!(matches!(
            t.match_key_with(0x20, &[], &mut over("game.exe")),
            Match::Trigger { .. }
        ), "case-insensitive match");
        assert_eq!(
            t.match_key_with(0x20, &[], &mut over("Discord.exe")),
            Match::OutsideApp { macro_id: "g".into() }
        );
        assert_eq!(t.match_key_with(0x20, &[], &mut || None), Match::OutsideApp { macro_id: "g".into() });
    }

    #[test]
    fn an_app_only_binding_beats_an_unrestricted_one_inside_its_app() {
        let t = BindingTable::build(
            &[m("any", 0x20, vec![], false), guarded("game", 0x20, "game.exe")],
            0x1B,
            true,
        );
        let id = |r: Match| match r {
            Match::Trigger { macro_id, .. } => macro_id,
            other => panic!("{other:?}"),
        };
        assert_eq!(id(t.match_key_with(0x20, &[], &mut || Some("game.exe".into()))), "game");
        assert_eq!(id(t.match_key_with(0x20, &[], &mut || Some("Notepad.exe".into()))), "any");
    }

    #[test]
    fn where_the_mouse_is_is_only_asked_when_an_app_only_binding_could_match() {
        let t = BindingTable::build(&[m("a", 0x20, vec![], false), guarded("g", 0x41, "x.exe")], 0x1B, true);
        let mut calls = 0;
        t.match_key_with(0x20, &[], &mut || {
            calls += 1;
            None
        });
        assert_eq!(calls, 0, "no app-only candidate on Space, so no lookup");
        t.match_key_with(0x41, &[], &mut || {
            calls += 1;
            None
        });
        assert_eq!(calls, 1);
    }

    #[test]
    fn only_keys_the_user_set_up_are_watched() {
        let t = BindingTable::build(&[m("a", 0x20, vec![], false)], 0x1B, true)
            .with_toggle(0x7B, vec![Modifier::Ctrl, Modifier::Shift]);
        for vk in [0x20, 0x1B, 0x7B] {
            assert!(t.is_watched(vk), "0x{vk:02X}");
        }
        for vk in [0x41, 0x0D, 0x7A] {
            assert!(!t.is_watched(vk), "0x{vk:02X} must not be watched");
        }
    }

    #[test]
    fn the_same_key_in_different_apps_is_not_a_clash() {
        let t = BindingTable::build(
            &[guarded("a", 0x20, "a.exe"), guarded("b", 0x20, "b.exe"), guarded("c", 0x20, "a.exe")],
            0x1B,
            true,
        );
        assert_eq!(t.conflicts(), vec![("c".to_string(), Clash::SameAs { macro_id: "a".into() })]);
    }

    #[test]
    fn conflicting_bindings_are_reported() {
        let t = BindingTable::build(
            &[
                m("a", 0x20, vec![], false),
                m("b", 0x20, vec![], false),
                m("c", 0x20, vec![Modifier::Ctrl], false),
            ],
            0x1B,
            true,
        );
        assert_eq!(t.conflicts(), vec![("b".to_string(), Clash::SameAs { macro_id: "a".into() })]);
    }

    /// Regression: a macro on the panic key (with any modifiers) or on the
    /// on/off hotkey never fires, because those are matched first, and the
    /// list showed no warning.
    #[test]
    fn the_panic_key_and_the_on_off_hotkey_are_clashes() {
        let t = BindingTable::build(
            &[
                m("esc", 0x1B, vec![], false),
                m("shift-esc", 0x1B, vec![Modifier::Shift], false),
                m("toggle", 0x7B, vec![Modifier::Ctrl, Modifier::Shift], false),
                m("ctrl-f12", 0x7B, vec![Modifier::Ctrl], false),
            ],
            0x1B,
            true,
        )
        .with_toggle(0x7B, vec![Modifier::Shift, Modifier::Ctrl]);
        assert_eq!(
            t.conflicts(),
            vec![
                ("esc".to_string(), Clash::PanicKey),
                ("shift-esc".to_string(), Clash::PanicKey),
                ("toggle".to_string(), Clash::ToggleHotkey),
            ],
            "Ctrl+F12 alone is not the toggle"
        );
    }

    #[test]
    fn clash_for_checks_a_hotkey_being_recorded() {
        let t = BindingTable::build(&[m("a", 0x20, vec![], false)], 0x1B, true);
        assert_eq!(t.clash_for(0x20, &[], None, "b"), Some(Clash::SameAs { macro_id: "a".into() }));
        assert_eq!(t.clash_for(0x20, &[], None, "a"), None, "its own hotkey is no clash");
        assert_eq!(t.clash_for(0x20, &[Modifier::Ctrl], None, "b"), None);
        assert_eq!(t.clash_for(0x20, &[], Some("Game.exe"), "b"), None, "another app's key is fine");
        assert_eq!(t.clash_for(0x1B, &[Modifier::Alt], None, "b"), Some(Clash::PanicKey));
    }
}
