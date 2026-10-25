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
    /// or the end of the Run countdown), plus the step's `dx`/`dy`. Captured
    /// once per run, so a later step can still return to it after earlier
    /// steps moved the cursor. `x`/`y` are ignored.
    Activation,
    /// The point the previous click or move step aimed at, plus `dx`/`dy`.
    /// "Aimed at" is before jitter, so random offsets never pile up along a
    /// chain. Before any click or move in the run, that is the activation
    /// point. It carries over between repeats: a chain whose first step is
    /// `Previous` keeps going on the next pass, one that starts from
    /// `Activation` starts over. `x`/`y` are ignored.
    Previous,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Step {
    Click {
        id: String,
        /// Every step has this. Marked steps trade places at random among the
        /// slots they hold, a new order each pass; unmarked steps never move.
        #[serde(default)]
        shuffle: bool,
        x: i32,
        y: i32,
        button: MouseButton,
        action: ClickAction,
        #[serde(default)]
        anchor: Anchor,
        /// Offset in pixels for an `Activation` or `Previous` anchor: right
        /// and down are positive. Ignored for `Fixed`.
        #[serde(default)]
        dx: i32,
        #[serde(default)]
        dy: i32,
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
        /// Held from when the cursor arrives until the release has settled
        /// (Shift for a shift-click), so a frame-polling target sees them on
        /// both sides of the click. This step only, like `Step::Key::modifiers`.
        #[serde(default)]
        modifiers: Vec<Modifier>,
        /// Any other key held the same way, pressed after the modifiers.
        #[serde(default)]
        held_key: Option<KeyRef>,
        #[serde(default)]
        capture: Option<CaptureMeta>,
    },
    Move {
        id: String,
        #[serde(default)]
        shuffle: bool,
        x: i32,
        y: i32,
        #[serde(default)]
        anchor: Anchor,
        /// See `Step::Click::dx`.
        #[serde(default)]
        dx: i32,
        #[serde(default)]
        dy: i32,
        #[serde(default)]
        coord_jitter_px: u32,
        #[serde(default)]
        move_duration_ms: u32,
        #[serde(default)]
        capture: Option<CaptureMeta>,
    },
    Scroll {
        id: String,
        #[serde(default)]
        shuffle: bool,
        /// Notches; multiplied by WHEEL_DELTA (120) on the way out.
        amount: i32,
        #[serde(default = "default_axis")]
        axis: ScrollAxis,
        #[serde(default)]
        at: Option<(i32, i32)>,
    },
    Key {
        id: String,
        #[serde(default)]
        shuffle: bool,
        key: KeyRef,
        action: KeyAction,
        #[serde(default)]
        modifiers: Vec<Modifier>,
        #[serde(default = "default_hold")]
        hold_ms: Jitter,
    },
    Text {
        id: String,
        #[serde(default)]
        shuffle: bool,
        value: String,
        #[serde(default = "default_per_char")]
        per_char_ms: Jitter,
    },
    Wait {
        id: String,
        #[serde(default)]
        shuffle: bool,
        ms: Jitter,
    },
}

impl Step {
    /// See `Step::Click::shuffle`.
    pub fn is_shuffled(&self) -> bool {
        match self {
            Step::Click { shuffle, .. }
            | Step::Move { shuffle, .. }
            | Step::Scroll { shuffle, .. }
            | Step::Key { shuffle, .. }
            | Step::Text { shuffle, .. }
            | Step::Wait { shuffle, .. } => *shuffle,
        }
    }

    /// Forget where the step's point was picked (monitor name and layout):
    /// the sender's desktop is nobody else's business.
    pub fn clear_capture(&mut self) {
        if let Step::Click { capture, .. } | Step::Move { capture, .. } = self {
            *capture = None;
        }
    }

    pub fn set_id(&mut self, new: String) {
        match self {
            Step::Click { id, .. }
            | Step::Move { id, .. }
            | Step::Scroll { id, .. }
            | Step::Key { id, .. }
            | Step::Text { id, .. }
            | Step::Wait { id, .. } => *id = new,
        }
    }
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
                // A double click holds, waits a hold's length, and holds
                // again; a lone press or release does not hold at all.
                let n = match action {
                    ClickAction::Double => 3,
                    ClickAction::Click => 1,
                    ClickAction::Down | ClickAction::Up => 0,
                };
                let travel = *move_duration_ms as u64;
                (a * n + 2 * sa + travel, b * n + 2 * sb + travel)
            }
            Step::Key { hold_ms, .. } => of(hold_ms),
            Step::Text {
                value, per_char_ms, ..
            } => {
                let (a, b) = of(per_char_ms);
                // One wait per UTF-16 unit, as the engine types them.
                let n = value.encode_utf16().count() as u64;
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

/// "App only": the macro's hotkey fires only while the mouse is over a window
/// that belongs to this process. Anywhere else the key behaves as if unbound
/// (it passes through, even if the trigger would normally block it).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Guard {
    /// Executable file name, e.g. "notepad.exe". Compared ignoring case.
    pub process: String,
    /// What the user picked it from (a window title), for display only.
    #[serde(default)]
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Macro {
    pub id: String,
    pub name: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Starred on the macro list. Purely for sorting; never affects a run.
    #[serde(default)]
    pub favorite: bool,
    /// The macro's color on the macro list: an accent name from the UI's
    /// palette (src/lib/colors.ts), or none. Display only.
    #[serde(default)]
    pub color: Option<String>,
    /// Imported from someone else's file and not looked at yet. A shared
    /// macro is a program that types and clicks, so it cannot be switched on
    /// or run until its new owner has seen its steps (see share.rs).
    #[serde(default)]
    pub review: bool,
    pub trigger: Option<Trigger>,
    #[serde(default)]
    pub repeat: Repeat,
    /// Pressing the hotkey while this macro is already running queues another
    /// run instead of ignoring the press. Only meaningful for `TriggerMode::Once`.
    #[serde(default)]
    pub queue: bool,
    /// Where queued runs start (only with `queue`).
    #[serde(default)]
    pub queue_from: QueueFrom,
    /// When the run ends, move the cursor back to where the macro started
    /// (the activation point). Not after Panic / Stop / switching off.
    #[serde(default)]
    pub return_to_start: bool,
    /// End the run after this long, however it repeats: a safety limit for
    /// "until stopped" and repeat-while-held. A normal end, so "move mouse
    /// back" still happens. `None`: no limit.
    #[serde(default)]
    pub stop_after_ms: Option<u64>,
    #[serde(default)]
    pub steps: Vec<Step>,
    #[serde(default)]
    pub guard: Option<Guard>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

/// The activation point a queued run uses: where the first press of the
/// chain was (the default), or where the mouse was at its own press. A press
/// made while the macro runs catches the cursor wherever the macro has moved
/// it, so with "each press" a queued "click where the mouse started" aims at
/// the macro's own last click, and "move mouse back" keeps returning there.
/// The user hit exactly that, so the first press is the default.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QueueFrom {
    /// Every queued run starts from the activation point of the run that
    /// started the chain (the first press, or where the Run countdown ended).
    #[default]
    FirstPress,
    EachPress,
}

fn default_true() -> bool {
    true
}

/// A color as the UI sends it: trimmed, empty or "none" means no color, and
/// anything unreasonably long is refused rather than stored.
pub fn normalize_color(color: Option<String>) -> Option<String> {
    let c = color?.trim().to_ascii_lowercase();
    (!c.is_empty() && c != "none" && c.len() <= 32 && c.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '-'))
        .then_some(c)
}

impl Macro {
    pub fn new(name: impl Into<String>) -> Self {
        let now = crate::storage::now_iso8601();
        Self {
            id: ulid::Ulid::new().to_string(),
            name: name.into(),
            enabled: true,
            favorite: false,
            color: None,
            review: false,
            trigger: None,
            repeat: Repeat::Once,
            queue: false,
            queue_from: QueueFrom::FirstPress,
            return_to_start: false,
            stop_after_ms: None,
            steps: Vec::new(),
            guard: None,
            created_at: now.clone(),
            updated_at: now,
        }
    }

    /// Give this macro and every step new ids: a copy or an import is a new
    /// macro, and step ids key the editor's list.
    pub fn fresh_ids(&mut self) {
        self.id = ulid::Ulid::new().to_string();
        for s in self.steps.iter_mut() {
            s.set_id(ulid::Ulid::new().to_string());
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

impl MacroFile {
    /// Apply a drag on the macro list. The order of `macros` is the user's
    /// custom order.
    ///
    /// `ids` is the new order of some of the macros: all of them for a drag in
    /// the custom view, or only one group (the favorites, or the rest) for a
    /// drag in the favorites-first view. The listed macros swap among the
    /// places they already hold and every other macro stays exactly where it
    /// was, so reordering the favorites never shuffles the rest. Unknown and
    /// repeated ids are ignored.
    /// Put back a macro that was deleted (Undo), at `index` or the end, with
    /// its own id. Refused (false) if a macro with that id exists.
    pub fn insert_at(&mut self, m: Macro, index: usize) -> bool {
        if self.macros.iter().any(|x| x.id == m.id) {
            return false;
        }
        let i = index.min(self.macros.len());
        self.macros.insert(i, m);
        true
    }

    pub fn reorder(&mut self, ids: &[String]) {
        let mut wanted: Vec<&String> = Vec::new();
        for id in ids {
            if !wanted.contains(&id) && self.macros.iter().any(|m| m.id == *id) {
                wanted.push(id);
            }
        }
        let slots: Vec<usize> = self
            .macros
            .iter()
            .enumerate()
            .filter(|(_, m)| wanted.contains(&&m.id))
            .map(|(i, _)| i)
            .collect();
        let moved: Vec<Macro> = wanted
            .iter()
            .filter_map(|id| self.macros.iter().find(|m| m.id == **id).cloned())
            .collect();
        for (slot, m) in slots.into_iter().zip(moved) {
            self.macros[slot] = m;
        }
    }
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
    #[serde(default = "default_panic_key")]
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
    /// The first-run welcome has been seen.
    #[serde(default)]
    pub welcomed: bool,
}

/// Esc: the instinctive "stop" key (docs/06-open-questions.md #3).
fn default_panic_key() -> KeyRef {
    KeyRef {
        vk: 0x1B,
        scancode: 0x01,
        extended: false,
        label: "Esc".into(),
    }
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
            panic_key: default_panic_key(),
            enabled: true,
            rng_seed: None,
            toggle_hotkey: default_toggle_hotkey(),
            welcomed: false,
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
            shuffle: false,
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
    fn steps_saved_before_hold_keys_and_shuffle_get_neither() {
        let c: Step = serde_json::from_str(
            r#"{"type":"click","id":"a","x":1,"y":2,"button":"left","action":"click"}"#,
        )
        .unwrap();
        assert!(matches!(&c, Step::Click { modifiers, held_key: None, shuffle: false, .. } if modifiers.is_empty()));
        let w: Step = serde_json::from_str(r#"{"type":"wait","id":"w","ms":{"base":5}}"#).unwrap();
        assert!(!w.is_shuffled());
    }

    #[test]
    fn hold_keys_and_shuffle_roundtrip() {
        let s: Step = serde_json::from_str(
            r#"{"type":"click","id":"a","x":1,"y":2,"button":"left","action":"click","shuffle":true,
                "modifiers":["shift"],"held_key":{"vk":81,"scancode":16,"label":"Q"}}"#,
        )
        .unwrap();
        assert!(s.is_shuffled());
        let back: Step = serde_json::from_str(&serde_json::to_string(&s).unwrap()).unwrap();
        match back {
            Step::Click { modifiers, held_key: Some(k), .. } => {
                assert_eq!(modifiers, vec![Modifier::Shift]);
                assert_eq!(k.scancode, 16);
            }
            other => panic!("wrong shape: {other:?}"),
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
        assert!(matches!(s, Step::Click { anchor: Anchor::Activation, dx: 0, dy: 0, .. }));
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
    fn offset_anchors_roundtrip_and_offsets_default_to_zero() {
        let s: Step = serde_json::from_str(
            r#"{"type":"move","id":"m","x":5,"y":6,"anchor":"previous","dx":20,"dy":-4}"#,
        )
        .unwrap();
        assert!(matches!(s, Step::Move { anchor: Anchor::Previous, dx: 20, dy: -4, .. }));
        let back = serde_json::to_string(&s).unwrap();
        assert!(back.contains(r#""anchor":"previous""#) && back.contains(r#""dx":20"#), "{back}");

        // A file from before offsets existed: an activation click stays exactly
        // on the activation point.
        let old: Step = serde_json::from_str(
            r#"{"type":"click","id":"c","x":900,"y":900,"button":"left","action":"click","anchor":"activation"}"#,
        )
        .unwrap();
        assert!(matches!(old, Step::Click { anchor: Anchor::Activation, dx: 0, dy: 0, .. }));
    }

    #[test]
    fn queue_from_roundtrips_as_snake_case() {
        let mut m = Macro::new("q");
        m.queue_from = QueueFrom::FirstPress;
        let json = serde_json::to_string(&m).unwrap();
        assert!(json.contains(r#""queue_from":"first_press""#), "{json}");
        let back: Macro = serde_json::from_str(&json).unwrap();
        assert_eq!(back.queue_from, QueueFrom::FirstPress);
    }

    #[test]
    fn colors_are_normalized_before_they_are_stored() {
        assert_eq!(normalize_color(Some("Red".into())), Some("red".into()));
        assert_eq!(normalize_color(Some("  sky ".into())), Some("sky".into()));
        assert_eq!(normalize_color(Some("none".into())), None);
        assert_eq!(normalize_color(Some("".into())), None);
        assert_eq!(normalize_color(None), None);
        assert_eq!(normalize_color(Some("x".repeat(33))), None);
        assert_eq!(normalize_color(Some("red; drop".into())), None);
    }

    #[test]
    fn a_macro_color_roundtrips() {
        let mut m = Macro::new("c");
        m.color = Some("teal".into());
        let back: Macro = serde_json::from_str(&serde_json::to_string(&m).unwrap()).unwrap();
        assert_eq!(back.color.as_deref(), Some("teal"));
    }

    fn file_of(ids: &[&str]) -> MacroFile {
        let mut f = MacroFile::default();
        for id in ids {
            let mut m = Macro::new(*id);
            m.id = (*id).into();
            f.macros.push(m);
        }
        f
    }

    fn order(f: &MacroFile) -> Vec<&str> {
        f.macros.iter().map(|m| m.id.as_str()).collect()
    }

    fn ids(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn a_full_reorder_sets_the_custom_order() {
        let mut f = file_of(&["a", "b", "c", "d"]);
        f.reorder(&ids(&["d", "a", "c", "b"]));
        assert_eq!(order(&f), ["d", "a", "c", "b"]);
    }

    #[test]
    fn reordering_one_group_leaves_the_others_in_place() {
        // Favorites b and d sit at positions 1 and 3 of the custom order.
        let mut f = file_of(&["a", "b", "c", "d", "e"]);
        f.reorder(&ids(&["d", "b"]));
        assert_eq!(order(&f), ["a", "d", "c", "b", "e"]);
    }

    #[test]
    fn reorder_ignores_unknown_and_repeated_ids_and_keeps_every_macro() {
        let mut f = file_of(&["a", "b", "c"]);
        f.reorder(&ids(&["zzz", "c", "c", "a"]));
        assert_eq!(order(&f), ["c", "b", "a"]);
        f.reorder(&[]);
        assert_eq!(order(&f), ["c", "b", "a"]);
    }

    #[test]
    fn reorder_keeps_each_macros_data() {
        let mut f = file_of(&["a", "b"]);
        f.macros[0].favorite = true;
        f.macros[0].name = "first".into();
        f.reorder(&ids(&["b", "a"]));
        assert_eq!(f.macros[1].name, "first");
        assert!(f.macros[1].favorite && !f.macros[0].favorite);
    }

    #[test]
    fn queue_defaults_off_and_guard_roundtrips() {
        let m: Macro = serde_json::from_str(r#"{"id":"a","name":"n","trigger":null}"#).unwrap();
        assert!(!m.queue);
        assert!(!m.return_to_start);
        assert!(!m.favorite);
        assert!(m.color.is_none());
        assert_eq!(m.queue_from, QueueFrom::FirstPress);
        assert!(m.guard.is_none());

        let mut m = Macro::new("x");
        m.queue = true;
        m.guard = Some(Guard { process: "game.exe".into(), label: "Game".into() });
        let back: Macro = serde_json::from_str(&serde_json::to_string(&m).unwrap()).unwrap();
        assert!(back.queue);
        assert_eq!(back.guard, m.guard);
    }

    #[test]
    fn duration_range_accounts_for_double_click_and_text_length() {
        let double = Step::Click {
            id: "a".into(),
            shuffle: false,
            x: 0,
            y: 0,
            button: MouseButton::Left,
            action: ClickAction::Double,
            anchor: Anchor::Fixed,
            dx: 0,
            dy: 0,
            coord_jitter_px: 0,
            hold_ms: Jitter { base: 10, jitter: 5 },
            settle_ms: Jitter { base: 3, jitter: 1 },
            move_duration_ms: 0,
            modifiers: vec![],
            held_key: None,
            capture: None,
        };
        // 2 presses of 10-15 with a hold-long gap between them (the engine
        // waits three holds), plus settle before and after of 3-4 each.
        // Regression: the estimate counted two holds.
        assert_eq!(double.duration_range(), (36, 53));
        let mut press_only = double.clone();
        if let Step::Click { action, .. } = &mut press_only {
            *action = ClickAction::Down;
        }
        assert_eq!(press_only.duration_range(), (6, 8), "a lone press does not hold");

        let text = Step::Text {
            id: "b".into(),
            shuffle: false,
            value: "a\u{1F600}".into(),
            per_char_ms: Jitter { base: 10, jitter: 2 },
        };
        // The emoji is two UTF-16 units, typed (and waited for) one by one.
        assert_eq!(text.duration_range(), (30, 36));
    }

    #[test]
    fn a_settings_file_with_only_some_fields_keeps_the_defaults_for_the_rest() {
        let s: Settings = serde_json::from_str(r#"{"welcomed": true}"#).unwrap();
        assert!(s.welcomed);
        assert_eq!(s.panic_key.label, "Esc");
        assert_eq!(s, Settings { welcomed: true, ..Settings::default() });
        let old: Settings = serde_json::from_str(r#"{"panic_key":{"vk":19,"scancode":69,"extended":false,"label":"Pause"}}"#).unwrap();
        assert!(!old.welcomed, "a file from before the welcome has not seen it");
    }

    #[test]
    fn a_deleted_macro_goes_back_in_its_place_with_its_id() {
        let mut f = MacroFile::default();
        let (a, b, c) = (Macro::new("a"), Macro::new("b"), Macro::new("c"));
        f.macros = vec![a.clone(), c.clone()];
        assert!(f.insert_at(b.clone(), 1));
        assert_eq!(f.macros.iter().map(|m| m.name.as_str()).collect::<Vec<_>>(), ["a", "b", "c"]);
        assert!(!f.insert_at(b, 0), "never twice");
        assert!(f.insert_at(Macro::new("d"), 99), "past the end means at the end");
        assert_eq!(f.macros[3].name, "d");
        let _ = (a, c);
    }

    #[test]
    fn stop_after_defaults_to_no_limit() {
        let m: Macro = serde_json::from_str(r#"{"id":"x","name":"n","trigger":null}"#).unwrap();
        assert_eq!(m.stop_after_ms, None);
    }

    #[test]
    fn macro_file_roundtrips() {
        let mut f = MacroFile::default();
        let mut m = Macro::new("Harvest loop");
        m.steps.push(Step::Wait {
            id: "w".into(),
            shuffle: false,
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
