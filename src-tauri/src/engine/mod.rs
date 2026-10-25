//! Macro execution.
//!
//! No `unsafe` here - everything goes through [`InputBackend`], which is what
//! lets the tests at the bottom of this file assert on real behaviour without
//! touching the user's cursor.

pub mod timer;

use std::sync::Arc;

use rand::rngs::StdRng;
use rand::seq::SliceRandom;
use rand::{Rng, SeedableRng};

use crate::input::coords::jitter_point;
use crate::input::{InputBackend, InputError};
use crate::model::{
    parse_hex, to_hex, Anchor, ClickAction, Jitter, KeyAction, KeyRef, Macro, Modifier, MouseButton, Repeat, Step,
    TimeoutAction,
};

pub use timer::CancelToken;

#[derive(Debug, thiserror::Error)]
pub enum EngineError {
    #[error(transparent)]
    Input(#[from] InputError),
    #[error("cancelled")]
    Cancelled,
    /// A bug in Pochini stopped the run (a panic, caught).
    #[error("the macro stopped on an internal error")]
    Internal,
    /// A "wait for a color" step timed out and was set to stop the run.
    #[error("Waited {ms} ms for ({x}, {y}) to turn {want}, but it stayed {saw}.")]
    ColorTimeout { x: i32, y: i32, want: String, saw: String, ms: u64 },
    /// A step aims inside the app's window, and there is none.
    #[error("{0}")]
    NoWindow(String),
    /// "Stop after" ran out during a wait. Never leaves the engine: `run_at`
    /// turns it into a normal end.
    #[error("time up")]
    TimeUp,
}

/// A dry run pauses this long on each point it shows.
pub const DRY_PAUSE_MS: u64 = 600;

/// How often a "wait for a color" step looks at the screen.
pub const COLOR_POLL_MS: u64 = 25;

/// Every channel within `tolerance`.
pub fn color_matches(got: [u8; 3], want: [u8; 3], tolerance: u8) -> bool {
    got.iter().zip(want).all(|(g, w)| g.abs_diff(w) <= tolerance)
}

pub type Result<T> = std::result::Result<T, EngineError>;

/// The shortest a repeated pass may take.
pub const MIN_PASS_MS: u64 = 1;

/// Tracks what we have pressed and not yet released, so that aborting a macro
/// mid-run cannot leave Shift stuck down across the whole OS. This is the worst
/// bug this app could ship, so it is a type rather than a convention.
#[derive(Default)]
struct HeldState {
    buttons: Vec<MouseButton>,
    keys: Vec<(u16, bool)>,
    modifiers: Vec<Modifier>,
}

impl HeldState {
    fn button(&mut self, b: MouseButton, down: bool) {
        if down {
            if !self.buttons.contains(&b) {
                self.buttons.push(b);
            }
        } else {
            self.buttons.retain(|x| *x != b);
        }
    }

    fn key(&mut self, scan: u16, extended: bool, down: bool) {
        if down {
            if !self.keys.iter().any(|(s, _)| *s == scan) {
                self.keys.push((scan, extended));
            }
        } else {
            self.keys.retain(|(s, _)| *s != scan);
        }
    }

    fn has_key(&self, scan: u16) -> bool {
        self.keys.iter().any(|(s, _)| *s == scan)
    }

    fn modifier(&mut self, m: Modifier, down: bool) {
        if down {
            if !self.modifiers.contains(&m) {
                self.modifiers.push(m);
            }
        } else {
            self.modifiers.retain(|x| *x != m);
        }
    }

    fn is_empty(&self) -> bool {
        self.buttons.is_empty() && self.keys.is_empty() && self.modifiers.is_empty()
    }
}

pub struct Engine {
    /// A dry run: the mouse visits every click and move point, pausing on
    /// each, and nothing is clicked, pressed or typed.
    pub dry: bool,
    /// Told the index of each step as it starts (the editor highlights it).
    pub on_step: Option<Box<dyn Fn(usize) + Send>>,
    /// The macro's "App only" app, for points inside its window.
    window_app: Option<String>,
    /// When "stop after" runs out: waits end there instead of running on.
    deadline: Option<std::time::Instant>,
    input: Arc<dyn InputBackend>,
    rng: StdRng,
    /// Cursor position when the current run started. See `Anchor::Activation`.
    activation: (i32, i32),
    /// Where the last click or move step aimed, before jitter. See
    /// `Anchor::Previous`.
    previous: (i32, i32),
}

impl Engine {
    pub fn new(input: Arc<dyn InputBackend>, seed: Option<u64>) -> Self {
        Self {
            dry: false,
            on_step: None,
            window_app: None,
            deadline: None,
            input,
            rng: match seed {
                Some(s) => StdRng::seed_from_u64(s),
                None => StdRng::from_entropy(),
            },
            activation: (0, 0),
            previous: (0, 0),
        }
    }

    fn sample(&mut self, j: Jitter) -> u64 {
        if j.jitter == 0 {
            j.base as u64
        } else {
            j.base as u64 + self.rng.gen_range(0..=j.jitter as u64)
        }
    }

    /// Run the whole macro, honouring `repeat`. Always leaves the keyboard and
    /// mouse in the state it found them, whether it finishes or aborts.
    pub fn run(&mut self, m: &Macro, cancel: &CancelToken) -> Result<()> {
        self.run_at(m, cancel, None)
    }

    /// Run with a known activation point: where the mouse was when the hotkey
    /// was pressed. A queued run starts later, after earlier runs have moved
    /// the cursor, so the point has to travel with the press rather than be
    /// read at start. `None` reads the cursor now (the Run countdown ending).
    pub fn run_at(&mut self, m: &Macro, cancel: &CancelToken, activation: Option<(i32, i32)>) -> Result<()> {
        // Captured once, before any step moves the cursor.
        self.activation = match activation {
            Some(p) => p,
            None => self.input.cursor_pos().unwrap_or((0, 0)),
        };
        self.previous = self.activation;
        self.window_app = m.guard.as_ref().map(|g| g.process.clone()).filter(|p| !p.is_empty());
        let mut held = HeldState::default();
        // A bug in a step must not leave a key held down across the whole OS:
        // catch the panic, run the release pass, report it as an error.
        self.deadline = m
            .stop_after_ms
            .map(|ms| std::time::Instant::now() + std::time::Duration::from_millis(ms));
        let result = match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| self.run_inner(m, cancel, &mut held)))
            .unwrap_or(Err(EngineError::Internal))
        {
            // "Stop after" ended it in the middle of a wait: a normal end.
            Err(EngineError::TimeUp) => Ok(()),
            r => r,
        };
        // The release pass runs on success, on error and on cancellation.
        // It comes before the return move, or a held button would drag.
        self.release_all(&mut held);

        // "Move mouse back to starting position": on a normal finish or a
        // hotkey stop, never after a hard cancel ("stop moving my mouse") or
        // an input error.
        let ended_normally = match &result {
            Ok(()) => true,
            Err(EngineError::Cancelled) => cancel.is_soft_stop(),
            Err(
                EngineError::Input(_)
                | EngineError::Internal
                | EngineError::ColorTimeout { .. }
                | EngineError::NoWindow(_)
                | EngineError::TimeUp,
            ) => false,
        };
        if m.return_to_start && ended_normally {
            let (x, y) = self.activation;
            let _ = self.input.move_to(x, y);
        }
        result
    }

    fn run_inner(&mut self, m: &Macro, cancel: &CancelToken, held: &mut HeldState) -> Result<()> {
        let passes: Option<u32> = match m.repeat {
            _ if self.dry => Some(1),
            Repeat::Once => Some(1),
            Repeat::Count { n } => Some(n),
            Repeat::Forever => None,
        };

        // Nothing to do, however many times: "until stopped" would spin.
        if m.steps.is_empty() {
            return Ok(());
        }
        let run_started = std::time::Instant::now();
        let time_up = || m.stop_after_ms.is_some_and(|ms| run_started.elapsed().as_millis() >= u128::from(ms));
        let mut pass = 0u32;
        loop {
            if let Some(limit) = passes {
                if pass >= limit {
                    return Ok(());
                }
            }
            let started = std::time::Instant::now();
            for i in self.pass_order(&m.steps) {
                if cancel.is_cancelled() {
                    return Err(EngineError::Cancelled);
                }
                // "Stop after": a normal end, between steps.
                if time_up() {
                    return Ok(());
                }
                if let Some(f) = &self.on_step {
                    f(i);
                }
                if self.dry {
                    self.dry_step(&m.steps[i], cancel)?;
                } else {
                    self.run_step(&m.steps[i], cancel, held)?;
                }
            }
            pass = pass.saturating_add(1);
            if passes.is_none() && cancel.is_cancelled() {
                return Err(EngineError::Cancelled);
            }
            // A pass of instant steps (scrolls, instant moves) must not repeat
            // as fast as the CPU allows and flood SendInput.
            let more = passes.is_none_or(|limit| pass < limit);
            if more && started.elapsed() < std::time::Duration::from_millis(MIN_PASS_MS) {
                self.wait(MIN_PASS_MS, cancel)?;
            }
        }
    }

    /// The step indices of one pass: steps marked `shuffle` trade places at
    /// random among the slots they hold, every other step keeps its own.
    fn pass_order(&mut self, steps: &[Step]) -> Vec<usize> {
        let mut order: Vec<usize> = (0..steps.len()).collect();
        let slots: Vec<usize> = order.iter().copied().filter(|&i| steps[i].is_shuffled()).collect();
        let mut drawn = slots.clone();
        drawn.shuffle(&mut self.rng);
        for (slot, from) in slots.into_iter().zip(drawn) {
            order[slot] = from;
        }
        order
    }

    fn wait(&self, ms: u64, cancel: &CancelToken) -> Result<()> {
        // A wait never runs past "stop after".
        let left = self.deadline.map(|d| d.saturating_duration_since(std::time::Instant::now()).as_millis() as u64);
        let (ms, time_up) = match left {
            Some(left) if left <= ms => (left, true),
            _ => (ms, false),
        };
        if !timer::wait(ms, cancel) {
            return Err(EngineError::Cancelled);
        }
        if time_up {
            return Err(EngineError::TimeUp);
        }
        Ok(())
    }

    /// A dry run's step: show where a click or move lands, do nothing else.
    fn dry_step(&mut self, step: &Step, cancel: &CancelToken) -> Result<()> {
        if let Step::Click { x, y, anchor, dx, dy, .. } | Step::Move { x, y, anchor, dx, dy, .. } = step {
            let p = self.resolve_point(*anchor, (*x, *y), (*dx, *dy), 0)?;
            self.input.move_to(p.0, p.1)?;
            self.wait(DRY_PAUSE_MS, cancel)?;
        }
        Ok(())
    }

    fn resolve_point(&mut self, anchor: Anchor, (x, y): (i32, i32), (dx, dy): (i32, i32), jitter_px: u32) -> Result<(i32, i32)> {
        let shift = |(px, py): (i32, i32)| (px.saturating_add(dx), py.saturating_add(dy));
        let (x, y) = match anchor {
            Anchor::Fixed => (x, y),
            Anchor::Activation => shift(self.activation),
            Anchor::Previous => shift(self.previous),
            Anchor::Window => {
                let Some(app) = self.window_app.clone() else {
                    return Err(EngineError::NoWindow(
                        "A step aims inside the app's window, but the macro has no App only app.".into(),
                    ));
                };
                match self.input.window_origin(&app) {
                    Some(origin) => shift(origin),
                    None => return Err(EngineError::NoWindow(format!("{app} has no window open."))),
                }
            }
        };
        // The aimed point, not the jittered or clamped one: a chain of
        // "previous + offset" steps must not drift by its own randomness.
        self.previous = (x, y);
        let (jx, jy) = if jitter_px == 0 {
            (x, y)
        } else {
            jitter_point(x, y, jitter_px, self.rng.gen(), self.rng.gen())
        };
        Ok(self.input.virtual_rect().clamp(jx, jy))
    }

    /// Interpolated cursor travel. Some targets only register hover on real
    /// movement, and some reject a click that lands in the same frame the
    /// cursor appeared.
    fn glide(&mut self, to: (i32, i32), duration_ms: u32, cancel: &CancelToken) -> Result<()> {
        if duration_ms == 0 {
            self.input.move_to(to.0, to.1)?;
            return Ok(());
        }
        let from = self.input.cursor_pos().unwrap_or(to);
        // ~120 Hz, but never more steps than milliseconds.
        let steps = ((duration_ms / 8).max(1)).min(duration_ms.max(1)) as i32;
        for i in 1..=steps {
            if cancel.is_cancelled() {
                return Err(EngineError::Cancelled);
            }
            let t = i as f64 / steps as f64;
            // ease-in-out
            let e = if t < 0.5 {
                2.0 * t * t
            } else {
                1.0 - (-2.0 * t + 2.0).powi(2) / 2.0
            };
            let x = from.0 as f64 + (to.0 - from.0) as f64 * e;
            let y = from.1 as f64 + (to.1 - from.1) as f64 * e;
            self.input.move_to(x.round() as i32, y.round() as i32)?;
            self.wait((duration_ms as u64 / steps as u64).max(1), cancel)?;
        }
        // Land exactly on target regardless of rounding along the way.
        self.input.move_to(to.0, to.1)?;
        Ok(())
    }

    fn run_step(&mut self, step: &Step, cancel: &CancelToken, held: &mut HeldState) -> Result<()> {
        match step {
            Step::Wait { ms, .. } => {
                let d = self.sample(*ms);
                self.wait(d, cancel)?;
            }

            Step::Move { x, y, anchor, dx, dy, coord_jitter_px, move_duration_ms, .. } => {
                let p = self.resolve_point(*anchor, (*x, *y), (*dx, *dy), *coord_jitter_px)?;
                self.glide(p, *move_duration_ms, cancel)?;
            }

            Step::Click {
                x,
                y,
                button,
                action,
                anchor,
                dx,
                dy,
                coord_jitter_px,
                hold_ms,
                settle_ms,
                move_duration_ms,
                modifiers,
                held_key,
                ..
            } => {
                let p = self.resolve_point(*anchor, (*x, *y), (*dx, *dy), *coord_jitter_px)?;
                self.glide(p, *move_duration_ms, cancel)?;
                // Windows would drop the click without a word (UIPI): say so.
                if self.input.blocked(Some(p)) {
                    return Err(InputError::AccessDenied.into());
                }
                // Held keys go down after the travel, so nothing reacts to
                // Shift+move, and stay down through both settles.
                let pressed = self.hold_keys(modifiers, held_key.as_ref(), held)?;
                // Let the target see the cursor at rest before the press...
                let s = self.sample(*settle_ms);
                self.wait(s, cancel)?;
                match action {
                    ClickAction::Down => {
                        self.input.button(*button, true)?;
                        held.button(*button, true);
                    }
                    ClickAction::Up => {
                        self.input.button(*button, false)?;
                        held.button(*button, false);
                    }
                    ClickAction::Click => self.press_button(*button, *hold_ms, cancel, held)?,
                    ClickAction::Double => {
                        self.press_button(*button, *hold_ms, cancel, held)?;
                        let gap = self.sample(*hold_ms);
                        self.wait(gap, cancel)?;
                        self.press_button(*button, *hold_ms, cancel, held)?;
                    }
                }
                // ...and see the release while the cursor is still on it. Without
                // this the next step moves the cursor away ~0.05 ms after the
                // button comes up, and a target that samples once per frame
                // registers the release somewhere else.
                let s = self.sample(*settle_ms);
                self.wait(s, cancel)?;
                if let Some((scan, extended)) = pressed {
                    self.input.key(scan, extended, false)?;
                    held.key(scan, extended, false);
                }
                self.release_modifiers(modifiers, held)?;
            }

            Step::Scroll { amount, axis, at, .. } => {
                let target = at.or_else(|| self.input.cursor_pos().ok());
                if target.is_some_and(|p| self.input.blocked(Some(p))) {
                    return Err(InputError::AccessDenied.into());
                }
                self.input.scroll(*axis, *amount, *at)?;
            }

            Step::WaitColor { x, y, color, tolerance, timeout_ms, on_timeout, .. } => {
                let want = parse_hex(color).unwrap_or([0, 0, 0]);
                let started = std::time::Instant::now();
                loop {
                    let got = self.input.pixel(*x, *y)?;
                    if color_matches(got, want, *tolerance) {
                        break;
                    }
                    if started.elapsed().as_millis() >= u128::from(*timeout_ms) {
                        if *on_timeout == TimeoutAction::Continue {
                            break;
                        }
                        return Err(EngineError::ColorTimeout {
                            x: *x,
                            y: *y,
                            want: to_hex(want),
                            saw: to_hex(got),
                            ms: *timeout_ms,
                        });
                    }
                    self.wait(COLOR_POLL_MS, cancel)?;
                }
            }

            Step::Key { key, action, modifiers, hold_ms, .. } => {
                if self.input.blocked(None) {
                    return Err(InputError::AccessDenied.into());
                }
                for m in modifiers {
                    self.input.modifier(*m, true)?;
                    held.modifier(*m, true);
                }
                match action {
                    KeyAction::Down => {
                        self.input.key(key.scancode, key.extended, true)?;
                        held.key(key.scancode, key.extended, true);
                    }
                    KeyAction::Up => {
                        self.input.key(key.scancode, key.extended, false)?;
                        held.key(key.scancode, key.extended, false);
                    }
                    KeyAction::Press => {
                        self.input.key(key.scancode, key.extended, true)?;
                        held.key(key.scancode, key.extended, true);
                        let d = self.sample(*hold_ms);
                        // Release before propagating a cancellation, so an abort
                        // during the hold does not strand the key.
                        let cancelled = !timer::wait(d, cancel);
                        self.input.key(key.scancode, key.extended, false)?;
                        held.key(key.scancode, key.extended, false);
                        if cancelled {
                            self.release_modifiers(modifiers, held)?;
                            return Err(EngineError::Cancelled);
                        }
                    }
                }
                // Reverse order, matching how a human releases a chord.
                self.release_modifiers(modifiers, held)?;
            }

            Step::Text { value, per_char_ms, .. } => {
                if self.input.blocked(None) {
                    return Err(InputError::AccessDenied.into());
                }
                for unit in value.encode_utf16() {
                    if cancel.is_cancelled() {
                        return Err(EngineError::Cancelled);
                    }
                    self.input.unicode(unit, true)?;
                    self.input.unicode(unit, false)?;
                    let d = self.sample(*per_char_ms);
                    self.wait(d, cancel)?;
                }
            }
        }
        Ok(())
    }

    fn press_button(
        &mut self,
        b: MouseButton,
        hold: Jitter,
        cancel: &CancelToken,
        held: &mut HeldState,
    ) -> Result<()> {
        self.input.button(b, true)?;
        held.button(b, true);
        let d = self.sample(hold);
        let cancelled = !timer::wait(d, cancel);
        self.input.button(b, false)?;
        held.button(b, false);
        if cancelled {
            return Err(EngineError::Cancelled);
        }
        Ok(())
    }

    /// Presses a click's "while holding" keys. Returns the extra key only if
    /// this step pressed it: a key an earlier step holds down is left to that
    /// step, so the click cannot release it early.
    fn hold_keys(&self, modifiers: &[Modifier], key: Option<&KeyRef>, held: &mut HeldState) -> Result<Option<(u16, bool)>> {
        for m in modifiers {
            self.input.modifier(*m, true)?;
            held.modifier(*m, true);
        }
        match key {
            Some(k) if !held.has_key(k.scancode) => {
                self.input.key(k.scancode, k.extended, true)?;
                held.key(k.scancode, k.extended, true);
                Ok(Some((k.scancode, k.extended)))
            }
            _ => Ok(None),
        }
    }

    fn release_modifiers(&self, modifiers: &[Modifier], held: &mut HeldState) -> Result<()> {
        for m in modifiers.iter().rev() {
            self.input.modifier(*m, false)?;
            held.modifier(*m, false);
        }
        Ok(())
    }

    /// Force-release anything still down. Best effort: a failure here must not
    /// stop us trying the rest, or one stuck key becomes several.
    fn release_all(&self, held: &mut HeldState) {
        for b in std::mem::take(&mut held.buttons) {
            let _ = self.input.button(b, false);
        }
        for (scan, extended) in std::mem::take(&mut held.keys) {
            let _ = self.input.key(scan, extended, false);
        }
        for m in std::mem::take(&mut held.modifiers).into_iter().rev() {
            let _ = self.input.modifier(m, false);
        }
        debug_assert!(held.is_empty());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::input::fake::{Event, FakeInput};
    use crate::model::{KeyRef, ScrollAxis};

    fn key(scan: u16) -> KeyRef {
        KeyRef { vk: 0x41, scancode: scan, extended: false, label: "A".into() }
    }

    fn mac(steps: Vec<Step>) -> Macro {
        let mut m = Macro::new("t");
        m.steps = steps;
        m
    }

    fn engine() -> (Arc<FakeInput>, Engine) {
        let f = Arc::new(FakeInput::new());
        let e = Engine::new(f.clone(), Some(42));
        (f, e)
    }

    /// Passes everything to a FakeInput, but panics on a mouse button press:
    /// a stand-in for a bug somewhere in a step.
    struct PanicsOnClick(Arc<FakeInput>);

    impl InputBackend for PanicsOnClick {
        fn virtual_rect(&self) -> crate::input::VirtualRect {
            self.0.virtual_rect()
        }
        fn monitors(&self) -> crate::input::Result<Vec<crate::input::Monitor>> {
            self.0.monitors()
        }
        fn cursor_pos(&self) -> crate::input::Result<(i32, i32)> {
            self.0.cursor_pos()
        }
        fn move_to(&self, x: i32, y: i32) -> crate::input::Result<()> {
            self.0.move_to(x, y)
        }
        fn button(&self, button: MouseButton, down: bool) -> crate::input::Result<()> {
            assert!(!down, "a bug in a step");
            self.0.button(button, down)
        }
        fn scroll(&self, axis: ScrollAxis, notches: i32, at: Option<(i32, i32)>) -> crate::input::Result<()> {
            self.0.scroll(axis, notches, at)
        }
        fn key(&self, scan: u16, extended: bool, down: bool) -> crate::input::Result<()> {
            self.0.key(scan, extended, down)
        }
        fn modifier(&self, m: Modifier, down: bool) -> crate::input::Result<()> {
            self.0.modifier(m, down)
        }
        fn unicode(&self, unit: u16, down: bool) -> crate::input::Result<()> {
            self.0.unicode(unit, down)
        }
        fn pixel(&self, x: i32, y: i32) -> crate::input::Result<[u8; 3]> {
            self.0.pixel(x, y)
        }
    }

    /// Regression guard: with `panic = "abort"`, a panic mid-run ended the
    /// process with Shift still held down by Windows; now the release build
    /// unwinds and the release pass runs.
    #[test]
    fn a_panic_in_a_step_still_releases_every_held_key() {
        let f = Arc::new(FakeInput::new());
        let mut e = Engine::new(Arc::new(PanicsOnClick(f.clone())), Some(1));
        let m = mac(vec![click_holding(0, vec![Modifier::Shift], Some(key(0x10)))]);
        assert!(matches!(e.run(&m, &CancelToken::new()), Err(EngineError::Internal)));
        assert!(f.still_held().is_empty(), "{:?}", f.still_held());
    }

    #[test]
    fn a_click_moves_first_then_presses_and_releases() {
        let (f, mut e) = engine();
        let m = mac(vec![Step::Click {
            id: "1".into(),
            shuffle: false,
            x: 100,
            y: 200,
            button: MouseButton::Left,
            action: ClickAction::Click,
            anchor: Anchor::Fixed,
            dx: 0,
            dy: 0,
            coord_jitter_px: 0,
            hold_ms: Jitter::exact(1),
            settle_ms: Jitter::exact(0),
            move_duration_ms: 0,
            modifiers: vec![],
            held_key: None,
            capture: None,
        }]);
        e.run(&m, &CancelToken::new()).unwrap();
        assert_eq!(
            f.events(),
            vec![
                Event::Move(100, 200),
                Event::Button(MouseButton::Left, true),
                Event::Button(MouseButton::Left, false),
            ]
        );
    }

    fn click_holding(settle: u32, modifiers: Vec<Modifier>, held_key: Option<KeyRef>) -> Step {
        Step::Click {
            id: "held".into(),
            shuffle: false,
            x: 100,
            y: 200,
            button: MouseButton::Left,
            action: ClickAction::Click,
            anchor: Anchor::Fixed,
            dx: 0,
            dy: 0,
            coord_jitter_px: 0,
            hold_ms: Jitter::exact(1),
            settle_ms: Jitter::exact(settle),
            move_duration_ms: 0,
            modifiers,
            held_key,
            capture: None,
        }
    }

    #[test]
    fn a_click_holds_its_keys_around_the_press_and_lets_go_in_reverse() {
        let (f, mut e) = engine();
        let m = mac(vec![click_holding(0, vec![Modifier::Ctrl, Modifier::Shift], Some(key(0x10)))]);
        e.run(&m, &CancelToken::new()).unwrap();
        assert_eq!(
            f.events(),
            vec![
                Event::Move(100, 200),
                Event::Modifier(Modifier::Ctrl, true),
                Event::Modifier(Modifier::Shift, true),
                Event::Key { scan: 0x10, extended: false, down: true },
                Event::Button(MouseButton::Left, true),
                Event::Button(MouseButton::Left, false),
                Event::Key { scan: 0x10, extended: false, down: false },
                Event::Modifier(Modifier::Shift, false),
                Event::Modifier(Modifier::Ctrl, false),
            ]
        );
    }

    /// A target that polls once per frame must see Shift down before the
    /// press and still down at the release, so the settle sits inside the hold.
    #[test]
    fn held_keys_span_the_settle_on_both_sides_of_the_click() {
        let (f, mut e) = engine();
        e.run(&mac(vec![click_holding(40, vec![Modifier::Shift], None)]), &CancelToken::new()).unwrap();
        let tl = f.timeline();
        let at = |ev: Event| tl.iter().position(|(_, x)| *x == ev).unwrap();
        let gap = |a: usize, b: usize| tl[b].0.duration_since(tl[a].0).as_secs_f64() * 1000.0;
        let shift_down = at(Event::Modifier(Modifier::Shift, true));
        let press = at(Event::Button(MouseButton::Left, true));
        let release = at(Event::Button(MouseButton::Left, false));
        let shift_up = at(Event::Modifier(Modifier::Shift, false));
        assert!(gap(shift_down, press) >= 38.0, "Shift only {:.2} ms before the press", gap(shift_down, press));
        assert!(gap(release, shift_up) >= 38.0, "Shift let go {:.2} ms after the release", gap(release, shift_up));
    }

    #[test]
    fn cancelling_during_a_held_click_releases_its_keys() {
        let (f, mut e) = engine();
        let m = mac(vec![click_holding(30_000, vec![Modifier::Shift], Some(key(0x10)))]);
        let cancel = CancelToken::new();
        let c2 = cancel.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(40));
            c2.cancel();
        });
        assert!(matches!(e.run(&m, &cancel), Err(EngineError::Cancelled)));
        assert!(f.still_held().is_empty(), "{:?}", f.still_held());
    }

    /// "Hold down Q", then a click holding Q: the click must not let go of
    /// the Q the earlier step is holding.
    #[test]
    fn a_click_leaves_a_key_an_earlier_step_holds_down_alone() {
        let (f, mut e) = engine();
        let m = mac(vec![
            Step::Key {
                id: "q".into(),
                shuffle: false,
                key: key(0x10),
                action: KeyAction::Down,
                modifiers: vec![],
                hold_ms: Jitter::exact(0),
            },
            click_holding(0, vec![], Some(key(0x10))),
        ]);
        e.run(&m, &CancelToken::new()).unwrap();
        let q = |down| Event::Key { scan: 0x10, extended: false, down };
        assert_eq!(
            f.events(),
            vec![
                q(true),
                Event::Move(100, 200),
                Event::Button(MouseButton::Left, true),
                Event::Button(MouseButton::Left, false),
                q(false), // the release pass at the end of the run
            ]
        );
    }

    fn marked(x: i32, shuffle: bool) -> Step {
        let mut s = to(x, 0);
        if let Step::Move { shuffle: on, .. } = &mut s {
            *on = shuffle;
        }
        s
    }

    #[test]
    fn marked_steps_trade_places_each_pass_and_unmarked_ones_stay_put() {
        let (f, mut e) = engine();
        let mut m = mac(vec![marked(1, true), marked(500, false), marked(2, true), marked(3, true)]);
        m.repeat = Repeat::Count { n: 40 };
        e.run(&m, &CancelToken::new()).unwrap();
        let xs: Vec<i32> = f
            .events()
            .into_iter()
            .map(|ev| match ev {
                Event::Move(x, _) => x,
                other => panic!("expected a move, got {other:?}"),
            })
            .collect();
        let mut orders = std::collections::HashSet::new();
        for pass in xs.chunks(4) {
            assert_eq!(pass[1], 500, "an unmarked step moved: {pass:?}");
            let mut shuffled = [pass[0], pass[2], pass[3]];
            orders.insert(shuffled);
            shuffled.sort();
            assert_eq!(shuffled, [1, 2, 3], "a marked step was lost or repeated: {pass:?}");
        }
        assert_eq!(orders.len(), 6, "40 passes should hit every order of 3: {orders:?}");
    }

    #[test]
    fn one_marked_step_has_nothing_to_trade_with() {
        let (f, mut e) = engine();
        let m = mac(vec![marked(1, false), marked(2, true), marked(3, false)]);
        e.run(&m, &CancelToken::new()).unwrap();
        assert_eq!(f.events(), vec![Event::Move(1, 0), Event::Move(2, 0), Event::Move(3, 0)]);
    }

    /// Regression for a real report: a click held, then the macro moved on and
    /// the target never registered the click. Traced with
    /// `cargo run --example trace_macro`: the cursor left the target 0.05 ms
    /// after the button came up, and the press landed 0.2 ms after the cursor
    /// arrived. Anything that samples input once per frame (~16 ms) sees the
    /// release happen somewhere else.
    #[test]
    fn a_click_settles_before_pressing_and_dwells_after_releasing() {
        let (f, mut e) = engine();
        let click = |id: &str, x: i32| Step::Click {
            id: id.into(),
            shuffle: false,
            x,
            y: 100,
            button: MouseButton::Left,
            action: ClickAction::Click,
            anchor: Anchor::Fixed,
            dx: 0,
            dy: 0,
            coord_jitter_px: 0,
            hold_ms: Jitter::exact(1),
            settle_ms: Jitter::exact(40),
            move_duration_ms: 0,
            modifiers: vec![],
            held_key: None,
            capture: None,
        };
        let m = mac(vec![click("a", 100), click("b", 500)]);
        e.run(&m, &CancelToken::new()).unwrap();

        let tl = f.timeline();
        let at = |pred: &dyn Fn(&Event) -> bool, from: usize| {
            tl.iter().enumerate().skip(from).find(|(_, (_, ev))| pred(ev)).map(|(i, _)| i).unwrap()
        };
        let gap = |a: usize, b: usize| tl[b].0.duration_since(tl[a].0).as_secs_f64() * 1000.0;

        let arrive = at(&|ev| *ev == Event::Move(100, 100), 0);
        let down = at(&|ev| matches!(ev, Event::Button(_, true)), arrive);
        let up = at(&|ev| matches!(ev, Event::Button(_, false)), down);
        let leave = at(&|ev| *ev == Event::Move(500, 100), up);

        let settle = gap(arrive, down);
        let dwell = gap(up, leave);
        assert!(settle >= 38.0, "pressed only {settle:.2} ms after arriving");
        assert!(dwell >= 38.0, "left the target only {dwell:.2} ms after releasing");
    }

    #[test]
    fn an_activation_click_lands_where_the_mouse_was_when_the_run_started() {
        let f = Arc::new(FakeInput::with_cursor(777, 333));
        let mut e = Engine::new(f.clone(), Some(1));
        let m = mac(vec![
            // a fixed click first, so the cursor is somewhere else by step 2
            Step::Click {
                id: "fixed".into(),
                shuffle: false,
                x: 100,
                y: 100,
                button: MouseButton::Left,
                action: ClickAction::Click,
                anchor: Anchor::Fixed,
                dx: 0,
                dy: 0,
                coord_jitter_px: 0,
                hold_ms: Jitter::exact(0),
                settle_ms: Jitter::exact(0),
                move_duration_ms: 0,
                modifiers: vec![],
                held_key: None,
                capture: None,
            },
            Step::Click {
                id: "here".into(),
                shuffle: false,
                x: 0,
                y: 0, // ignored for an activation anchor
                button: MouseButton::Left,
                action: ClickAction::Click,
                anchor: Anchor::Activation,
                dx: 0,
                dy: 0,
                coord_jitter_px: 0,
                hold_ms: Jitter::exact(0),
                settle_ms: Jitter::exact(0),
                move_duration_ms: 0,
                modifiers: vec![],
                held_key: None,
                capture: None,
            },
        ]);
        e.run(&m, &CancelToken::new()).unwrap();
        let moves: Vec<_> = f
            .events()
            .into_iter()
            .filter(|ev| matches!(ev, Event::Move(..)))
            .collect();
        assert_eq!(moves, vec![Event::Move(100, 100), Event::Move(777, 333)]);
    }

    #[test]
    fn a_given_activation_point_wins_over_the_current_cursor() {
        let f = Arc::new(FakeInput::with_cursor(10, 10));
        let mut e = Engine::new(f.clone(), Some(1));
        let m = mac(vec![Step::Move {
            id: "m".into(),
            shuffle: false,
            x: 0,
            y: 0,
            anchor: Anchor::Activation,
            dx: 0,
            dy: 0,
            coord_jitter_px: 0,
            move_duration_ms: 0,
            capture: None,
        }]);
        e.run_at(&m, &CancelToken::new(), Some((640, 480))).unwrap();
        assert_eq!(f.events(), vec![Event::Move(640, 480)]);
    }

    fn to(x: i32, y: i32) -> Step {
        Step::Move {
            id: "to".into(),
            shuffle: false,
            x,
            y,
            anchor: Anchor::Fixed,
            dx: 0,
            dy: 0,
            coord_jitter_px: 0,
            move_duration_ms: 0,
            capture: None,
        }
    }

    #[test]
    fn return_to_start_moves_the_cursor_back_after_the_run() {
        let f = Arc::new(FakeInput::with_cursor(300, 400));
        let mut e = Engine::new(f.clone(), Some(1));
        let mut m = mac(vec![to(10, 10)]);
        m.return_to_start = true;
        e.run(&m, &CancelToken::new()).unwrap();
        assert_eq!(f.events(), vec![Event::Move(10, 10), Event::Move(300, 400)]);
    }

    #[test]
    fn without_return_to_start_the_cursor_stays_put() {
        let f = Arc::new(FakeInput::with_cursor(300, 400));
        let mut e = Engine::new(f.clone(), Some(1));
        e.run(&mac(vec![to(10, 10)]), &CancelToken::new()).unwrap();
        assert_eq!(f.events(), vec![Event::Move(10, 10)]);
    }

    #[test]
    fn return_to_start_happens_once_after_all_repeats_and_uses_the_press_point() {
        let f = Arc::new(FakeInput::with_cursor(1, 1));
        let mut e = Engine::new(f.clone(), Some(1));
        let mut m = mac(vec![to(10, 10)]);
        m.repeat = Repeat::Count { n: 3 };
        m.return_to_start = true;
        e.run_at(&m, &CancelToken::new(), Some((640, 480))).unwrap();
        assert_eq!(
            f.events(),
            vec![Event::Move(10, 10), Event::Move(10, 10), Event::Move(10, 10), Event::Move(640, 480)]
        );
    }

    #[test]
    fn a_held_button_is_released_before_the_cursor_returns() {
        let f = Arc::new(FakeInput::with_cursor(5, 5));
        let mut e = Engine::new(f.clone(), Some(1));
        let mut m = mac(vec![Step::Click {
            id: "hold".into(),
            shuffle: false,
            x: 50,
            y: 50,
            button: MouseButton::Left,
            action: ClickAction::Down,
            anchor: Anchor::Fixed,
            dx: 0,
            dy: 0,
            coord_jitter_px: 0,
            hold_ms: Jitter::exact(0),
            settle_ms: Jitter::exact(0),
            move_duration_ms: 0,
            modifiers: vec![],
            held_key: None,
            capture: None,
        }]);
        m.return_to_start = true;
        e.run(&m, &CancelToken::new()).unwrap();
        let ev = f.events();
        assert_eq!(&ev[ev.len() - 2..], &[Event::Button(MouseButton::Left, false), Event::Move(5, 5)]);
    }

    fn stopped_after_40ms(soft: bool) -> Vec<Event> {
        let f = Arc::new(FakeInput::with_cursor(7, 8));
        let mut e = Engine::new(f.clone(), Some(1));
        let mut m = mac(vec![Step::Wait { id: "w".into(), shuffle: false, ms: Jitter::exact(30_000) }]);
        m.return_to_start = true;
        let cancel = CancelToken::new();
        let c2 = cancel.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(40));
            if soft {
                c2.stop()
            } else {
                c2.cancel()
            }
        });
        assert!(matches!(e.run(&m, &cancel), Err(EngineError::Cancelled)));
        f.events()
    }

    #[test]
    fn a_hotkey_stop_still_returns_to_start() {
        assert_eq!(stopped_after_40ms(true), vec![Event::Move(7, 8)]);
    }

    #[test]
    fn a_panic_or_stop_button_does_not_move_the_mouse_back() {
        assert!(stopped_after_40ms(false).is_empty());
    }

    fn aim(anchor: Anchor, x: i32, y: i32, dx: i32, dy: i32) -> Step {
        Step::Move {
            id: "aim".into(),
            shuffle: false,
            x,
            y,
            anchor,
            dx,
            dy,
            coord_jitter_px: 0,
            move_duration_ms: 0,
            capture: None,
        }
    }

    fn landed(m: &Macro, start: (i32, i32)) -> Vec<Event> {
        let f = Arc::new(FakeInput::new());
        let mut e = Engine::new(f.clone(), Some(3));
        e.run_at(m, &CancelToken::new(), Some(start)).unwrap();
        f.events()
    }

    #[test]
    fn an_activation_offset_aims_beside_the_start_point() {
        let m = mac(vec![aim(Anchor::Activation, 0, 0, 20, -5)]);
        assert_eq!(landed(&m, (500, 300)), vec![Event::Move(520, 295)]);
    }

    #[test]
    fn previous_chains_each_step_from_the_one_before() {
        let m = mac(vec![
            aim(Anchor::Activation, 0, 0, 20, 0),
            aim(Anchor::Previous, 0, 0, 20, 0),
            aim(Anchor::Previous, 0, 0, 0, 15),
        ]);
        assert_eq!(
            landed(&m, (100, 100)),
            vec![Event::Move(120, 100), Event::Move(140, 100), Event::Move(140, 115)]
        );
    }

    #[test]
    fn previous_without_an_earlier_point_counts_from_the_start() {
        let m = mac(vec![aim(Anchor::Previous, 0, 0, 7, 8)]);
        assert_eq!(landed(&m, (10, 10)), vec![Event::Move(17, 18)]);
    }

    #[test]
    fn previous_follows_a_fixed_step_and_ignores_steps_without_a_point() {
        let m = mac(vec![
            aim(Anchor::Fixed, 1000, 400, 99, 99), // offsets ignored when fixed
            Step::Wait { id: "w".into(), shuffle: false, ms: Jitter::exact(0) },
            aim(Anchor::Previous, 0, 0, -10, 0),
        ]);
        assert_eq!(landed(&m, (0, 0)), vec![Event::Move(1000, 400), Event::Move(990, 400)]);
    }

    #[test]
    fn a_previous_chain_carries_over_between_repeats() {
        let mut m = mac(vec![aim(Anchor::Previous, 0, 0, 50, 0)]);
        m.repeat = Repeat::Count { n: 3 };
        assert_eq!(
            landed(&m, (0, 0)),
            vec![Event::Move(50, 0), Event::Move(100, 0), Event::Move(150, 0)]
        );
    }

    #[test]
    fn a_chain_that_starts_from_the_activation_point_starts_over_each_repeat() {
        let mut m = mac(vec![aim(Anchor::Activation, 0, 0, 10, 0), aim(Anchor::Previous, 0, 0, 10, 0)]);
        m.repeat = Repeat::Count { n: 2 };
        assert_eq!(
            landed(&m, (0, 0)),
            vec![Event::Move(10, 0), Event::Move(20, 0), Event::Move(10, 0), Event::Move(20, 0)]
        );
    }

    #[test]
    fn jitter_never_accumulates_along_a_chain() {
        // The first step jitters by up to 30 px; the second has none, so it
        // must land exactly 100 px right of where the first one AIMED.
        for seed in 0..50 {
            let f = Arc::new(FakeInput::new());
            let mut e = Engine::new(f.clone(), Some(seed));
            let mut first = aim(Anchor::Activation, 0, 0, 0, 0);
            if let Step::Move { coord_jitter_px, .. } = &mut first {
                *coord_jitter_px = 30;
            }
            let m = mac(vec![first, aim(Anchor::Previous, 0, 0, 100, 0)]);
            e.run_at(&m, &CancelToken::new(), Some((500, 500))).unwrap();
            assert_eq!(f.events()[1], Event::Move(600, 500), "seed {seed}");
        }
    }

    #[test]
    fn each_run_starts_its_chain_from_its_own_activation_point() {
        let f = Arc::new(FakeInput::new());
        let mut e = Engine::new(f.clone(), Some(1));
        let m = mac(vec![aim(Anchor::Previous, 0, 0, 5, 0)]);
        e.run_at(&m, &CancelToken::new(), Some((100, 0))).unwrap();
        e.run_at(&m, &CancelToken::new(), Some((300, 0))).unwrap();
        assert_eq!(f.events(), vec![Event::Move(105, 0), Event::Move(305, 0)]);
    }

    #[test]
    fn an_offset_off_the_desktop_is_clamped_like_any_other_point() {
        let f = Arc::new(FakeInput::new());
        let rect = f.virtual_rect();
        let mut e = Engine::new(f.clone(), Some(1));
        let m = mac(vec![aim(Anchor::Activation, 0, 0, i32::MAX, i32::MAX)]);
        e.run_at(&m, &CancelToken::new(), Some((10, 10))).unwrap();
        assert_eq!(f.events(), vec![Event::Move(rect.clamp(i32::MAX, i32::MAX).0, rect.clamp(i32::MAX, i32::MAX).1)]);
    }

    #[test]
    fn activation_jitter_is_centred_on_the_activation_point() {
        for seed in 0..32u64 {
            let f = Arc::new(FakeInput::with_cursor(1200, 600));
            let mut e = Engine::new(f.clone(), Some(seed));
            let m = mac(vec![Step::Move {
                id: "m".into(),
                shuffle: false,
                x: 0,
                y: 0,
                anchor: Anchor::Activation,
                dx: 0,
                dy: 0,
                coord_jitter_px: 8,
                move_duration_ms: 0,
                capture: None,
            }]);
            e.run(&m, &CancelToken::new()).unwrap();
            match f.events()[0] {
                Event::Move(x, y) => {
                    let d = ((((x - 1200).pow(2) + (y - 600).pow(2)) as f64).sqrt()).round();
                    assert!(d <= 9.0, "seed {seed}: {d}px from the activation point");
                }
                ref other => panic!("expected a move, got {other:?}"),
            }
        }
    }

    #[test]
    fn the_activation_point_is_captured_once_per_run_not_per_pass() {
        let f = Arc::new(FakeInput::with_cursor(50, 60));
        let mut e = Engine::new(f.clone(), Some(1));
        let mut m = mac(vec![
            Step::Move {
                id: "away".into(),
                shuffle: false,
                x: 900,
                y: 900,
                anchor: Anchor::Fixed,
                dx: 0,
                dy: 0,
                coord_jitter_px: 0,
                move_duration_ms: 0,
                capture: None,
            },
            Step::Move {
                id: "back".into(),
                shuffle: false,
                x: 0,
                y: 0,
                anchor: Anchor::Activation,
                dx: 0,
                dy: 0,
                coord_jitter_px: 0,
                move_duration_ms: 0,
                capture: None,
            },
        ]);
        m.repeat = Repeat::Count { n: 2 };
        e.run(&m, &CancelToken::new()).unwrap();
        assert_eq!(
            f.events(),
            vec![
                Event::Move(900, 900),
                Event::Move(50, 60),
                Event::Move(900, 900),
                Event::Move(50, 60),
            ]
        );
    }

    #[test]
    fn double_click_produces_two_full_presses() {
        let (f, mut e) = engine();
        let m = mac(vec![Step::Click {
            id: "1".into(),
            shuffle: false,
            x: 0,
            y: 0,
            button: MouseButton::Left,
            action: ClickAction::Double,
            anchor: Anchor::Fixed,
            dx: 0,
            dy: 0,
            coord_jitter_px: 0,
            hold_ms: Jitter::exact(1),
            settle_ms: Jitter::exact(0),
            move_duration_ms: 0,
            modifiers: vec![],
            held_key: None,
            capture: None,
        }]);
        e.run(&m, &CancelToken::new()).unwrap();
        let downs = f.events().iter().filter(|e| matches!(e, Event::Button(_, true))).count();
        let ups = f.events().iter().filter(|e| matches!(e, Event::Button(_, false))).count();
        assert_eq!((downs, ups), (2, 2));
    }

    #[test]
    fn modifiers_wrap_the_key_and_release_in_reverse() {
        let (f, mut e) = engine();
        let m = mac(vec![Step::Key {
            id: "1".into(),
            shuffle: false,
            key: key(0x1E),
            action: KeyAction::Press,
            modifiers: vec![Modifier::Ctrl, Modifier::Shift],
            hold_ms: Jitter::exact(1),
        }]);
        e.run(&m, &CancelToken::new()).unwrap();
        assert_eq!(
            f.events(),
            vec![
                Event::Modifier(Modifier::Ctrl, true),
                Event::Modifier(Modifier::Shift, true),
                Event::Key { scan: 0x1E, extended: false, down: true },
                Event::Key { scan: 0x1E, extended: false, down: false },
                Event::Modifier(Modifier::Shift, false),
                Event::Modifier(Modifier::Ctrl, false),
            ]
        );
    }

    /// The bug that matters most: an abort must never strand a modifier.
    #[test]
    fn cancelling_mid_run_releases_everything_still_held() {
        let (f, mut e) = engine();
        let m = mac(vec![
            Step::Key {
                id: "down".into(),
                shuffle: false,
                key: key(0x2A),
                action: KeyAction::Down,
                modifiers: vec![],
                hold_ms: Jitter::exact(0),
            },
            Step::Click {
                id: "hold".into(),
                shuffle: false,
                x: 10,
                y: 10,
                button: MouseButton::Left,
                action: ClickAction::Down,
                anchor: Anchor::Fixed,
                dx: 0,
                dy: 0,
                coord_jitter_px: 0,
                hold_ms: Jitter::exact(0),
                settle_ms: Jitter::exact(0),
                move_duration_ms: 0,
                modifiers: vec![],
                held_key: None,
                capture: None,
            },
            Step::Wait { id: "w".into(), shuffle: false, ms: Jitter::exact(30_000) },
        ]);

        let cancel = CancelToken::new();
        let c2 = cancel.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(40));
            c2.cancel();
        });

        let t = std::time::Instant::now();
        let r = e.run(&m, &cancel);
        assert!(matches!(r, Err(EngineError::Cancelled)));
        assert!(t.elapsed() < std::time::Duration::from_millis(600), "abort was slow");
        assert!(
            f.still_held().is_empty(),
            "left held after abort: {:?}",
            f.still_held()
        );
    }

    #[test]
    fn cancelling_during_a_key_hold_still_releases_that_key() {
        let (f, mut e) = engine();
        let m = mac(vec![Step::Key {
            id: "1".into(),
            shuffle: false,
            key: key(0x1E),
            action: KeyAction::Press,
            modifiers: vec![Modifier::Shift],
            hold_ms: Jitter::exact(30_000),
        }]);
        let cancel = CancelToken::new();
        let c2 = cancel.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(40));
            c2.cancel();
        });
        assert!(matches!(e.run(&m, &cancel), Err(EngineError::Cancelled)));
        assert!(f.still_held().is_empty(), "{:?}", f.still_held());
    }

    #[test]
    fn repeat_count_runs_the_list_that_many_times() {
        let (f, mut e) = engine();
        let mut m = mac(vec![Step::Scroll {
            id: "s".into(),
            shuffle: false,
            amount: -1,
            axis: ScrollAxis::Vertical,
            at: None,
        }]);
        m.repeat = Repeat::Count { n: 4 };
        e.run(&m, &CancelToken::new()).unwrap();
        assert_eq!(f.events().len(), 4);
    }

    #[test]
    fn repeat_forever_stops_only_on_cancel() {
        let (f, mut e) = engine();
        let mut m = mac(vec![Step::Wait { id: "w".into(), shuffle: false, ms: Jitter::exact(5) }]);
        m.repeat = Repeat::Forever;
        let cancel = CancelToken::new();
        let c2 = cancel.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(80));
            c2.cancel();
        });
        assert!(matches!(e.run(&m, &cancel), Err(EngineError::Cancelled)));
        assert!(f.still_held().is_empty());
    }

    /// Regression: the limit was only checked between steps, so a long wait
    /// (or a color that never came) ran on past it.
    #[test]
    fn stop_after_cuts_a_long_wait_short() {
        let (f, mut e) = engine();
        let mut m = mac(vec![
            Step::Wait { id: "w".into(), shuffle: false, ms: Jitter::exact(30_000) },
            Step::Scroll { id: "s".into(), shuffle: false, amount: 1, axis: ScrollAxis::Vertical, at: None },
        ]);
        m.stop_after_ms = Some(80);
        let t = std::time::Instant::now();
        e.run(&m, &CancelToken::new()).unwrap();
        assert!(t.elapsed() < std::time::Duration::from_millis(1_000), "{:?}", t.elapsed());
        assert!(f.events().is_empty(), "the step after the wait never ran");

        let mut m = mac(vec![wait_color(3, 4, "#ffffff", 30_000, TimeoutAction::Stop)]);
        m.stop_after_ms = Some(80);
        let t = std::time::Instant::now();
        assert!(e.run(&m, &CancelToken::new()).is_ok(), "time up is a normal end, not a color timeout");
        assert!(t.elapsed() < std::time::Duration::from_millis(1_000), "{:?}", t.elapsed());
    }

    #[test]
    fn stop_after_ends_an_endless_run_normally_and_lets_go_of_everything() {
        let (f, mut e) = engine();
        let mut m = mac(vec![
            Step::Key {
                id: "k".into(),
                shuffle: false,
                key: key(0x2A),
                action: KeyAction::Down,
                modifiers: vec![],
                hold_ms: Jitter::exact(0),
            },
            Step::Wait { id: "w".into(), shuffle: false, ms: Jitter::exact(5) },
        ]);
        m.repeat = Repeat::Forever;
        m.stop_after_ms = Some(60);
        m.return_to_start = true;
        let t = std::time::Instant::now();
        e.run_at(&m, &CancelToken::new(), Some((7, 8))).unwrap();
        let took = t.elapsed();
        assert!(took >= std::time::Duration::from_millis(55) && took < std::time::Duration::from_millis(400), "{took:?}");
        assert!(f.still_held().is_empty(), "{:?}", f.still_held());
        assert_eq!(f.events().last(), Some(&Event::Move(7, 8)), "a normal end moves the mouse back");
    }

    fn wait_color(x: i32, y: i32, color: &str, timeout_ms: u64, on_timeout: TimeoutAction) -> Step {
        Step::WaitColor { id: "wc".into(), shuffle: false, x, y, color: color.into(), tolerance: 8, timeout_ms, on_timeout }
    }

    #[test]
    fn wait_color_carries_on_once_the_pixel_turns() {
        let (f, mut e) = engine();
        f.set_pixel(10, 10, [0, 0, 0]);
        let f2 = f.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(60));
            f2.set_pixel(10, 10, [250, 4, 4]); // within the tolerance of #ff0000
        });
        let t = std::time::Instant::now();
        let m = mac(vec![wait_color(10, 10, "#ff0000", 2_000, TimeoutAction::Stop), Step::Scroll {
            id: "s".into(),
            shuffle: false,
            amount: 1,
            axis: ScrollAxis::Vertical,
            at: None,
        }]);
        e.run(&m, &CancelToken::new()).unwrap();
        assert!(t.elapsed() >= std::time::Duration::from_millis(55), "{:?}", t.elapsed());
        assert_eq!(f.events().len(), 1, "the step after it ran");
    }

    #[test]
    fn wait_color_stops_the_run_or_carries_on_when_it_never_shows() {
        let (f, mut e) = engine();
        f.set_pixel(3, 4, [1, 2, 3]);
        let stop = mac(vec![wait_color(3, 4, "#ffffff", 50, TimeoutAction::Stop)]);
        match e.run(&stop, &CancelToken::new()) {
            Err(EngineError::ColorTimeout { want, saw, .. }) => assert_eq!((want.as_str(), saw.as_str()), ("#ffffff", "#010203")),
            other => panic!("{other:?}"),
        }
        let go_on = mac(vec![wait_color(3, 4, "#ffffff", 50, TimeoutAction::Continue)]);
        assert!(e.run(&go_on, &CancelToken::new()).is_ok());
    }

    #[test]
    fn wait_color_is_cancellable() {
        let (_, mut e) = engine();
        let m = mac(vec![wait_color(3, 4, "#ffffff", 60_000, TimeoutAction::Stop)]);
        let cancel = CancelToken::new();
        let c2 = cancel.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(40));
            c2.cancel();
        });
        let t = std::time::Instant::now();
        assert!(matches!(e.run(&m, &cancel), Err(EngineError::Cancelled)));
        assert!(t.elapsed() < std::time::Duration::from_millis(500));
    }

    #[test]
    fn input_to_an_app_running_as_administrator_stops_the_run_with_the_reason() {
        let (f, mut e) = engine();
        f.blocked.store(true, std::sync::atomic::Ordering::SeqCst);
        let m = mac(vec![click_holding(0, vec![Modifier::Shift], None)]);
        assert!(matches!(e.run(&m, &CancelToken::new()), Err(EngineError::Input(InputError::AccessDenied))));
        assert!(f.still_held().is_empty());
        assert!(!f.events().iter().any(|ev| matches!(ev, Event::Button(..))), "no click was sent into the void");
    }

    #[test]
    fn colors_match_within_the_tolerance_on_every_channel() {
        assert!(color_matches([100, 100, 100], [110, 90, 100], 10));
        assert!(!color_matches([100, 100, 100], [111, 100, 100], 10));
        assert!(color_matches([0, 0, 0], [0, 0, 0], 0));
    }

    fn move_to_window(dx: i32, dy: i32) -> Step {
        Step::Move {
            id: "mw".into(),
            shuffle: false,
            x: 0,
            y: 0,
            anchor: Anchor::Window,
            dx,
            dy,
            coord_jitter_px: 0,
            move_duration_ms: 0,
            capture: None,
        }
    }

    #[test]
    fn a_point_in_the_apps_window_follows_the_window() {
        let (f, mut e) = engine();
        let mut m = mac(vec![move_to_window(10, 5)]);
        m.guard = Some(crate::model::Guard { process: "game.exe".into(), label: String::new() });
        e.run(&m, &CancelToken::new()).unwrap();
        *f.window.lock().unwrap() = Some((400, 300)); // the window moved
        e.run(&m, &CancelToken::new()).unwrap();
        assert_eq!(f.events(), vec![Event::Move(110, 55), Event::Move(410, 305)]);
    }

    #[test]
    fn a_point_in_the_apps_window_needs_the_app_and_its_window() {
        let (f, mut e) = engine();
        let m = mac(vec![move_to_window(1, 1)]);
        match e.run(&m, &CancelToken::new()) {
            Err(EngineError::NoWindow(why)) => assert!(why.contains("no App only app"), "{why}"),
            other => panic!("{other:?}"),
        }
        let mut m = m;
        m.guard = Some(crate::model::Guard { process: "game.exe".into(), label: String::new() });
        *f.window.lock().unwrap() = None;
        match e.run(&m, &CancelToken::new()) {
            Err(EngineError::NoWindow(why)) => assert_eq!(why, "game.exe has no window open."),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn a_dry_run_visits_each_point_once_and_presses_nothing() {
        let (f, mut e) = engine();
        e.dry = true;
        let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
        let s2 = seen.clone();
        e.on_step = Some(Box::new(move |i| s2.lock().unwrap().push(i)));
        let mut m = mac(vec![
            click_holding(0, vec![Modifier::Shift], Some(key(0x10))),
            Step::Text { id: "t".into(), shuffle: false, value: "nope".into(), per_char_ms: Jitter::exact(0) },
            Step::Wait { id: "w".into(), shuffle: false, ms: Jitter::exact(5_000) },
        ]);
        m.repeat = Repeat::Forever;
        let t = std::time::Instant::now();
        e.run(&m, &CancelToken::new()).unwrap();
        assert!(t.elapsed() < std::time::Duration::from_millis(2_000), "waits are skipped, one pass only");
        assert_eq!(f.events(), vec![Event::Move(100, 200)]);
        assert_eq!(*seen.lock().unwrap(), vec![0, 1, 2], "every step is announced");
    }

    /// Regression: "Until stopped" with no steps looped with nothing to wait
    /// on, spinning a CPU core until the panic key.
    #[test]
    fn an_empty_macro_set_to_repeat_forever_ends_at_once() {
        let (_, mut e) = engine();
        let mut m = mac(vec![]);
        m.repeat = Repeat::Forever;
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let _ = tx.send(e.run(&m, &CancelToken::new()).is_ok());
        });
        assert_eq!(rx.recv_timeout(std::time::Duration::from_millis(500)), Ok(true));
    }

    /// Regression: a pass of instant steps (scrolls, instant moves) repeated
    /// as fast as the CPU allowed, flooding SendInput. Each pass now takes at
    /// least `MIN_PASS_MS`.
    #[test]
    fn a_pass_of_instant_steps_still_takes_at_least_a_millisecond() {
        let (f, mut e) = engine();
        let mut m = mac(vec![Step::Scroll {
            id: "s".into(),
            shuffle: false,
            amount: -1,
            axis: ScrollAxis::Vertical,
            at: None,
        }]);
        m.repeat = Repeat::Forever;
        let cancel = CancelToken::new();
        let c2 = cancel.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(50));
            c2.cancel();
        });
        assert!(matches!(e.run(&m, &cancel), Err(EngineError::Cancelled)));
        let n = f.events().len();
        assert!((1..=60).contains(&n), "{n} scrolls in 50 ms");
    }

    #[test]
    fn text_is_sent_as_utf16_code_units_including_surrogate_pairs() {
        let (f, mut e) = engine();
        let m = mac(vec![Step::Text {
            id: "t".into(),
            shuffle: false,
            value: "hi\u{1F600}".into(), // 2 BMP chars + 1 surrogate pair
            per_char_ms: Jitter::exact(0),
        }]);
        e.run(&m, &CancelToken::new()).unwrap();
        let units: Vec<u16> = f
            .events()
            .iter()
            .filter_map(|e| match e {
                Event::Unicode(u, true) => Some(*u),
                _ => None,
            })
            .collect();
        assert_eq!(units, "hi\u{1F600}".encode_utf16().collect::<Vec<_>>());
        assert_eq!(units.len(), 4, "the emoji must be two code units");
        assert!(f.still_held().is_empty());
    }

    #[test]
    fn coordinate_jitter_stays_within_its_radius_over_many_seeds() {
        for seed in 0..64u64 {
            let f = Arc::new(FakeInput::new());
            let mut e = Engine::new(f.clone(), Some(seed));
            let m = mac(vec![Step::Move {
                id: "m".into(),
                shuffle: false,
                x: 1000,
                y: 700,
                anchor: Anchor::Fixed,
                dx: 0,
                dy: 0,
                coord_jitter_px: 12,
                move_duration_ms: 0,
                capture: None,
            }]);
            e.run(&m, &CancelToken::new()).unwrap();
            match f.events()[0] {
                Event::Move(x, y) => {
                    let d = ((((x - 1000).pow(2) + (y - 700).pow(2)) as f64).sqrt()).round();
                    assert!(d <= 13.0, "seed {seed}: moved {d}px from target");
                }
                ref other => panic!("expected a move, got {other:?}"),
            }
        }
    }

    #[test]
    fn wait_jitter_samples_stay_in_the_declared_range() {
        let f = Arc::new(FakeInput::new());
        let mut e = Engine::new(f, Some(7));
        let j = Jitter { base: 100, jitter: 50 };
        for _ in 0..1000 {
            let s = e.sample(j);
            assert!((100..=150).contains(&s), "sampled {s} outside 100..=150");
        }
        // And an exact jitter is genuinely exact.
        for _ in 0..100 {
            assert_eq!(e.sample(Jitter::exact(33)), 33);
        }
    }

    #[test]
    fn a_seeded_run_is_reproducible() {
        let build = || {
            let f = Arc::new(FakeInput::new());
            let mut e = Engine::new(f.clone(), Some(99));
            let m = mac(vec![Step::Move {
                id: "m".into(),
                shuffle: false,
                x: 500,
                y: 500,
                anchor: Anchor::Fixed,
                dx: 0,
                dy: 0,
                coord_jitter_px: 20,
                move_duration_ms: 0,
                capture: None,
            }]);
            e.run(&m, &CancelToken::new()).unwrap();
            f.events()
        };
        assert_eq!(build(), build());
    }

    #[test]
    fn coordinates_are_clamped_into_the_virtual_desktop() {
        let (f, mut e) = engine();
        let m = mac(vec![Step::Move {
            id: "m".into(),
            shuffle: false,
            x: 999_999,
            y: -999_999,
            anchor: Anchor::Fixed,
            dx: 0,
            dy: 0,
            coord_jitter_px: 0,
            move_duration_ms: 0,
            capture: None,
        }]);
        e.run(&m, &CancelToken::new()).unwrap();
        // FakeInput's rect is the dev machine's: origin (-1920,0), 6400x1440.
        assert_eq!(f.events(), vec![Event::Move(4479, 0)]);
    }

    #[test]
    fn a_glide_ends_exactly_on_target() {
        let (f, mut e) = engine();
        let m = mac(vec![Step::Move {
            id: "m".into(),
            shuffle: false,
            x: 300,
            y: 400,
            anchor: Anchor::Fixed,
            dx: 0,
            dy: 0,
            coord_jitter_px: 0,
            move_duration_ms: 40,
            capture: None,
        }]);
        e.run(&m, &CancelToken::new()).unwrap();
        let evs = f.events();
        assert!(evs.len() > 2, "expected interpolation, got {evs:?}");
        assert_eq!(evs.last(), Some(&Event::Move(300, 400)));
    }

    #[test]
    fn a_backend_failure_still_runs_the_release_pass() {
        let f = Arc::new(FakeInput::new());
        let mut e = Engine::new(f.clone(), Some(1));
        let m = mac(vec![Step::Key {
            id: "1".into(),
            shuffle: false,
            key: key(0x1E),
            action: KeyAction::Down,
            modifiers: vec![],
            hold_ms: Jitter::exact(0),
        }]);
        *f.fail_with.lock().unwrap() = Some("uipi");
        let r = e.run(&m, &CancelToken::new());
        assert!(matches!(r, Err(EngineError::Input(InputError::AccessDenied))));
        // Nothing was recorded because every call failed, but the important part
        // is that run() returned the error rather than panicking or hanging.
        assert!(f.events().is_empty());
    }
}
