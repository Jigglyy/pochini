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

/// What the callback decided.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Match {
    None,
    Panic,
    Toggle,
    Trigger { macro_id: String, swallow: bool, mode: TriggerMode },
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
                })
            })
            .collect();
        Self { bindings, panic_vk, enabled, toggle: None }
    }

    pub fn with_toggle(mut self, vk: u16, modifiers: Vec<Modifier>) -> Self {
        self.toggle = Some((vk, modifiers));
        self
    }

    /// Match a key event. `held` is the set of modifiers currently down.
    ///
    /// The panic key is checked first and works even when the master switch is
    /// off, because a runaway macro is exactly when you reach for it.
    pub fn match_key(&self, vk: u16, held: &[Modifier]) -> Match {
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
        for b in &self.bindings {
            if b.vk != vk {
                continue;
            }
            // Exact modifier match: Ctrl+A must not fire on Ctrl+Shift+A.
            if same_modifiers(&b.modifiers, held) {
                return Match::Trigger {
                    macro_id: b.macro_id.clone(),
                    swallow: b.swallow,
                    mode: b.mode,
                };
            }
        }
        Match::None
    }

    /// Macro ids whose hotkey collides with an earlier one. Surfaced as a
    /// warning badge in the list; the first binding wins at runtime.
    pub fn conflicts(&self) -> Vec<String> {
        let mut seen: Vec<(u16, Vec<Modifier>)> = Vec::new();
        let mut out = Vec::new();
        for b in &self.bindings {
            let key = (b.vk, {
                let mut m = b.modifiers.clone();
                m.sort_by_key(|x| format!("{x:?}"));
                m
            });
            if seen.contains(&key) {
                out.push(b.macro_id.clone());
            } else {
                seen.push(key);
            }
        }
        out
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
        assert_eq!(t.conflicts(), vec!["b".to_string()]);
    }
}
