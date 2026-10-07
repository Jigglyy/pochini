//! Macro data model. Mirrors docs/03-macro-format.md, which is the spec.
//!
//! Everything here is pure data: no Win32, no I/O, no timing. That keeps the
//! schema testable and keeps `storage` and the UI honest about what they share.

use serde::{Deserialize, Serialize};

pub const SCHEMA_VERSION: u32 = 1;

/// A duration with optional uniform jitter: `base + uniform(0, jitter)`.
///
/// This is the user-facing "wait a bit, with a tick for randomness and how much
/// time the randomness adds".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Jitter {
    pub base: u32,
    #[serde(default)]
    pub jitter: u32,
}

impl Jitter {
    pub const fn exact(base: u32) -> Self {
        Self { base, jitter: 0 }
    }

    /// Inclusive range this can sample to. Used by the UI to show "500-700 ms"
    /// and by tests to assert sampling stays in bounds.
    pub fn range(&self) -> (u32, u32) {
        (self.base, self.base.saturating_add(self.jitter))
    }
}

impl Default for Jitter {
    fn default() -> Self {
        Self::exact(0)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MouseButton {
    Left,
    Right,
    Middle,
    X1,
    X2,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ClickAction {
    Click,
    Double,
    Down,
    Up,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KeyAction {
    Press,
    Down,
    Up,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScrollAxis {
    Vertical,
    Horizontal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Modifier {
    Ctrl,
    Alt,
    Shift,
    Win,
}

/// A key identified by scan code, which is what actually gets injected.
///
/// `vk` and `label` exist so the UI has something readable; they are never the
/// source of truth, because a scan code survives a keyboard-layout change and a
/// virtual key code does not. See docs/02-windows-input-research.md.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KeyRef {
    pub vk: u16,
    pub scancode: u16,
    #[serde(default)]
    pub extended: bool,
    #[serde(default)]
    pub label: String,
}

/// Where a coordinate came from. Unused in v1; recorded so that a later
/// "your display layout changed, remap?" feature is possible rather than
/// impossible.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CaptureMeta {
    pub monitor: String,
    /// left, top, right, bottom in virtual-desktop pixels.
    pub monitor_rect: [i32; 4],
    pub dpi: u32,
}

/// Where a click or move step aims.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Anchor {
    /// The step's own `x`/`y`.
    #[default]
    Fixed,
    /// Wherever the mouse was when the macro was activated (hotkey pressed,
    /// or the end of the Run countdown). Captured once per run, so a later
    /// step can still return to it after earlier steps moved the cursor.
    /// `x`/`y` are ignored.
    Activation,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Step {
    Click {
        id: String,
        x: i32,
        y: i32,
        button: MouseButton,
        action: ClickAction,
        #[serde(default)]
        anchor: Anchor,
        #[serde(default)]
        coord_jitter_px: u32,
        #[serde(default = "default_hold")]
        hold_ms: Jitter,
        /// Paused after the cursor arrives (before pressing) and again after
        /// releasing (before moving on). Apps that sample input once per frame
        /// need the cursor to sit still on the target across a frame boundary on
        /// both sides of the click, or the release registers somewhere else.
        #[serde(default = "default_settle")]
        settle_ms: Jitter,
        #[serde(default)]
        move_duration_ms: u32,
        #[serde(default)]
        capture: Option<CaptureMeta>,
    },
    Move {
        id: String,
        x: i32,
        y: i32,
        #[serde(default)]
        anchor: Anchor,
        #[serde(default)]
        coord_jitter_px: u32,
        #[serde(default)]
        move_duration_ms: u32,
        #[serde(default)]
        capture: Option<CaptureMeta>,
    },
    Scroll {
        id: String,
        /// Notches; multiplied by WHEEL_DELTA (120) on the way out.
        amount: i32,
        #[serde(default = "default_axis")]
        axis: ScrollAxis,
        #[serde(default)]
        at: Option<(i32, i32)>,
    },
    Key {
        id: String,
        key: KeyRef,
        action: KeyAction,
        #[serde(default)]
        modifiers: Vec<Modifier>,
        #[serde(default = "default_hold")]
        hold_ms: Jitter,
    },
    Text {
        id: String,
        value: String,
        #[serde(default = "default_per_char")]
        per_char_ms: Jitter,
    },
    Wait {
        id: String,
        ms: Jitter,
    },
}

fn default_hold() -> Jitter {
    Jitter {
        base: 25,
        jitter: 15,
    }
}

/// 50-75 ms: at least two frames at 60 fps and one and a half at 30 fps.
fn default_settle() -> Jitter {
    Jitter {
        base: 50,
        jitter: 25,
    }
}

fn default_per_char() -> Jitter {
    Jitter {
        base: 20,
        jitter: 15,
    }
}

fn default_axis() -> ScrollAxis {
    ScrollAxis::Vertical
}

impl Step {
    pub fn id(&self) -> &str {
        match self {
            Step::Click { id, .. }
            | Step::Move { id, .. }
            | Step::Scroll { id, .. }
            | Step::Key { id, .. }
            | Step::Text { id, .. }
            | Step::Wait { id, .. } => id,
        }
    }

    /// Best-case and worst-case duration in ms, ignoring the cost of SendInput
    /// itself. Drives the "estimated run time" line in the editor.
    pub fn duration_range(&self) -> (u64, u64) {
        let of = |j: &Jitter| {
            let (a, b) = j.range();
            (a as u64, b as u64)
        };
        match self {
            Step::Wait { ms, .. } => of(ms),
            Step::Click {
                action,
                hold_ms,
                settle_ms,
                move_duration_ms,
                ..
            } => {
                let (a, b) = of(hold_ms);
                let (sa, sb) = of(settle_ms);
                let n = if matches!(action, ClickAction::Double) {
                    2
                } else {
                    1
                };
                let travel = *move_duration_ms as u64;
                (a * n + 2 * sa + travel, b * n + 2 * sb + travel)
            }
            Step::Key { hold_ms, .. } => of(hold_ms),
            Step::Text {
                value, per_char_ms, ..
            } => {
                let (a, b) = of(per_char_ms);
                let n = value.chars().count() as u64;
                (a * n, b * n)
            }
            Step::Move {
                move_duration_ms, ..
            } => (*move_duration_ms as u64, *move_duration_ms as u64),
            Step::Scroll { .. } => (0, 0),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TriggerMode {
    Once,
    HoldRepeat,
    Toggle,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Trigger {
    pub key: KeyRef,
    #[serde(default)]
    pub modifiers: Vec<Modifier>,
    pub mode: TriggerMode,
    /// When true the target app never sees the key. Defaults to false, because
    /// binding a bare key like Space with swallow on makes the keyboard feel
    /// broken everywhere else.
    #[serde(default)]
    pub swallow: bool,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Repeat {
    #[default]
    Once,
    Count { n: u32 },
    Forever,
}

/// Reserved in the schema now so adding it later is not a migration.
/// See docs/03-macro-format.md.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Guard {
    pub foreground_process: String,
    pub on_mismatch: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Macro {
    pub id: String,
    pub name: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    pub trigger: Option<Trigger>,
    #[serde(default)]
    pub repeat: Repeat,
    #[serde(default)]
    pub steps: Vec<Step>,
    #[serde(default)]
    pub guard: Option<Guard>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

fn default_true() -> bool {
    true
}

impl Macro {
    pub fn new(name: impl Into<String>) -> Self {
        let now = crate::storage::now_iso8601();
        Self {
            id: ulid::Ulid::new().to_string(),
            name: name.into(),
            enabled: true,
            trigger: None,
            repeat: Repeat::Once,
            steps: Vec::new(),
            guard: None,
            created_at: now.clone(),
            updated_at: now,
        }
    }

    /// Total estimated duration of one pass, in ms.
    pub fn duration_range(&self) -> (u64, u64) {
        self.steps
            .iter()
            .fold((0, 0), |(lo, hi), s| {
                let (a, b) = s.duration_range();
                (lo + a, hi + b)
            })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MacroFile {
    pub schema_version: u32,
    #[serde(default)]
    pub macros: Vec<Macro>,
}

impl Default for MacroFile {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            macros: Vec::new(),
        }
    }
}

/// A key plus the modifiers that must be held with it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Hotkey {
    pub key: KeyRef,
    #[serde(default)]
    pub modifiers: Vec<Modifier>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Settings {
    /// Never swallowed; aborts any running macro. See docs/06-open-questions.md.
    pub panic_key: KeyRef,
    /// Master switch. When false the hook stays installed but every binding is inert.
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Seeding the RNG makes a run reproducible while debugging.
    #[serde(default)]
    pub rng_seed: Option<u64>,
    /// Flips `enabled` from anywhere, so macros can be paused without leaving
    /// a fullscreen game. Works while disabled (that is the point). A file
    /// written before this existed gets the default; an explicit `null`
    /// means the user cleared it.
    #[serde(default = "default_toggle_hotkey")]
    pub toggle_hotkey: Option<Hotkey>,
}

/// Ctrl+Shift+F12: unlikely to collide with a game binding.
fn default_toggle_hotkey() -> Option<Hotkey> {
    Some(Hotkey {
        key: KeyRef {
            vk: 0x7B,
            scancode: 0x58,
            extended: false,
            label: "F12".into(),
        },
        modifiers: vec![Modifier::Ctrl, Modifier::Shift],
    })
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            // VK_ESCAPE
            panic_key: KeyRef {
                vk: 0x1B,
                scancode: 0x01,
                extended: false,
                label: "Esc".into(),
            },
            enabled: true,
            rng_seed: None,
            toggle_hotkey: default_toggle_hotkey(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jitter_range_is_inclusive_and_saturating() {
        assert_eq!(Jitter { base: 500, jitter: 200 }.range(), (500, 700));
        assert_eq!(Jitter::exact(50).range(), (50, 50));
        assert_eq!(
            Jitter { base: u32::MAX, jitter: 10 }.range(),
            (u32::MAX, u32::MAX)
        );
    }

    #[test]
    fn step_roundtrips_through_json_by_tag() {
        let s = Step::Wait {
            id: "a".into(),
            ms: Jitter { base: 500, jitter: 200 },
        };
        let j = serde_json::to_string(&s).unwrap();
        assert!(j.contains(r#""type":"wait""#), "{j}");
        assert_eq!(serde_json::from_str::<Step>(&j).unwrap(), s);
    }

    #[test]
    fn click_step_defaults_fill_in_from_a_minimal_object() {
        // A hand-written macro file should not need every field.
        let s: Step = serde_json::from_str(
            r#"{"type":"click","id":"x","x":10,"y":20,"button":"left","action":"click"}"#,
        )
        .unwrap();
        match s {
            Step::Click {
                hold_ms,
                coord_jitter_px,
                move_duration_ms,
                capture,
                ..
            } => {
                assert_eq!(hold_ms, default_hold());
                assert_eq!(coord_jitter_px, 0);
                assert_eq!(move_duration_ms, 0);
                assert!(capture.is_none());
            }
            other => panic!("wrong variant: {other:?}"),
        }
    }

    #[test]
    fn a_click_saved_before_settle_existed_gets_a_nonzero_default() {
        // Exactly the shape of a step in a macros.json written by the first build.
        let s: Step = serde_json::from_str(
            r#"{"type":"click","id":"x","x":1623,"y":592,"button":"left","action":"click",
                "coord_jitter_px":3,"hold_ms":{"base":150,"jitter":25},
                "move_duration_ms":10,"capture":null}"#,
        )
        .unwrap();
        match s {
            Step::Click { settle_ms, .. } => {
                assert!(settle_ms.base >= 33, "default settle must cover two 60 fps frames");
                assert_eq!(settle_ms, default_settle());
            }
            other => panic!("wrong variant: {other:?}"),
        }
    }

    #[test]
    fn click_and_move_default_to_a_fixed_anchor() {
        let c: Step = serde_json::from_str(
            r#"{"type":"click","id":"a","x":1,"y":2,"button":"left","action":"click"}"#,
        )
        .unwrap();
        let m: Step = serde_json::from_str(r#"{"type":"move","id":"b","x":1,"y":2}"#).unwrap();
        assert!(matches!(c, Step::Click { anchor: Anchor::Fixed, .. }));
        assert!(matches!(m, Step::Move { anchor: Anchor::Fixed, .. }));
    }

    #[test]
    fn activation_anchor_roundtrips() {
        let s: Step = serde_json::from_str(
            r#"{"type":"click","id":"a","x":0,"y":0,"button":"left","action":"click","anchor":"activation"}"#,
        )
        .unwrap();
        assert!(matches!(s, Step::Click { anchor: Anchor::Activation, .. }));
        assert!(serde_json::to_string(&s).unwrap().contains(r#""anchor":"activation""#));
    }

    #[test]
    fn settings_default_toggle_hotkey_is_ctrl_shift_f12() {
        let t = Settings::default().toggle_hotkey.expect("a default toggle hotkey");
        assert_eq!(t.key.vk, 0x7B);
        assert_eq!(t.modifiers, vec![Modifier::Ctrl, Modifier::Shift]);
    }

    #[test]
    fn settings_saved_before_the_toggle_hotkey_existed_get_the_default() {
        let s: Settings = serde_json::from_str(
            r#"{"panic_key":{"vk":27,"scancode":1,"extended":false,"label":"Esc"},"enabled":true}"#,
        )
        .unwrap();
        assert_eq!(s.toggle_hotkey, Settings::default().toggle_hotkey);
        // An explicit null means the user cleared it, and must stay cleared.
        let cleared: Settings = serde_json::from_str(
            r#"{"panic_key":{"vk":27,"scancode":1},"enabled":true,"toggle_hotkey":null}"#,
        )
        .unwrap();
        assert_eq!(cleared.toggle_hotkey, None);
    }

    #[test]
    fn duration_range_accounts_for_double_click_and_text_length() {
        let double = Step::Click {
            id: "a".into(),
            x: 0,
            y: 0,
            button: MouseButton::Left,
            action: ClickAction::Double,
            anchor: Anchor::Fixed,
            coord_jitter_px: 0,
            hold_ms: Jitter { base: 10, jitter: 5 },
            settle_ms: Jitter { base: 3, jitter: 1 },
            move_duration_ms: 0,
            capture: None,
        };
        // 2 presses of 10-15 plus settle before and after of 3-4 each
        assert_eq!(double.duration_range(), (26, 38));

        let text = Step::Text {
            id: "b".into(),
            value: "abc".into(),
            per_char_ms: Jitter { base: 10, jitter: 2 },
        };
        assert_eq!(text.duration_range(), (30, 36));
    }

    #[test]
    fn macro_file_roundtrips() {
        let mut f = MacroFile::default();
        let mut m = Macro::new("Harvest loop");
        m.steps.push(Step::Wait {
            id: "w".into(),
            ms: Jitter { base: 100, jitter: 50 },
        });
        f.macros.push(m);
        let j = serde_json::to_string_pretty(&f).unwrap();
        let back: MacroFile = serde_json::from_str(&j).unwrap();
        assert_eq!(back.schema_version, SCHEMA_VERSION);
        assert_eq!(back.macros.len(), 1);
        assert_eq!(back.macros[0].duration_range(), (100, 150));
    }
}
