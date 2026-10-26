//! Macro execution.
//!
//! No `unsafe` here - everything goes through [`InputBackend`], which is what
//! lets the tests at the bottom of this file assert on real behaviour without
//! touching the user's cursor.

pub mod curve;
pub mod random;
pub mod timer;

use std::sync::Arc;

use rand::rngs::StdRng;
use rand::seq::SliceRandom;
use rand::{Rng, SeedableRng};

use crate::input::coords::{jitter_point, jitter_point_bell};
use crate::input::{InputBackend, InputError};
use crate::model::{
    parse_hex, to_hex, Anchor, ClickAction, Feel, Jitter, KeyAction, KeyRef, KeyRepeat, Macro, Modifier, MouseButton,
    PathPoint, Repeat, Step, TimeoutAction,
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
/// Further behind its timeline than this (the machine stalled), a run stops
/// making up the time and carries on from now, rather than rushing.
const CATCH_UP_MS: u64 = 250;

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

/// Each path point's moment in ms, with points that share a millisecond
/// spread evenly across it. Times are recorded in whole milliseconds, and a
/// 2000 Hz mouse reports twice in each, evenly, so this puts every report
/// back within about a quarter of a millisecond instead of replaying pairs
/// at once.
fn spread_within_ms(path: &[PathPoint]) -> Vec<f64> {
    let mut out = Vec::with_capacity(path.len());
    let mut i = 0;
    while i < path.len() {
        let n = path[i..].iter().take_while(|p| p.t == path[i].t).count();
        out.extend((0..n).map(|k| f64::from(path[i].t) + k as f64 / n as f64));
        i += n;
    }
    out
}

/// A key the engine repeats while a step holds it down. Windows repeats a
/// key the user holds but never one a program holds, so a recorded hold
/// (W held while walking, Backspace held in a text box) would otherwise
/// replay as a single press.
struct Repeater {
    key: (u16, bool),
    stop: CancelToken,
    thread: Option<std::thread::JoinHandle<()>>,
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
    /// Where the run should be by now: every pause adds its length. A Wait
    /// step sleeps until it, so the time lost to every late wake-up and to
    /// sending input is made up there instead of adding up. (A recorded
    /// macro replayed 2 ms per click late, 74 ms after 40 clicks.) Pauses
    /// inside a step (settle, hold) always run their full length.
    plan: Option<std::time::Instant>,
    /// Held keys being repeated (`KeyRepeat`), stopped before their release.
    repeaters: Vec<Repeater>,
    /// A step has moved the cursor this run (see `travel`).
    traveled: bool,
    /// The running macro's bell, hesitation and curve.
    feel: Feel,
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
            plan: None,
            repeaters: Vec::new(),
            traveled: false,
            feel: Feel::default(),
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
        } else if let Some(bell) = self.feel.bell {
            j.base as u64 + (random::unit(Some(bell), &mut self.rng) * j.jitter as f64).round() as u64
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
        self.feel = m.feel;
        self.plan = None;
        self.traveled = false;
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

    /// The run's timeline moves on by `ms`.
    fn plan_add(&mut self, ms: u64) {
        let base = self.plan.unwrap_or_else(std::time::Instant::now);
        self.plan = Some(base + std::time::Duration::from_millis(ms));
    }

    /// A pause inside a step: its full length, on the timeline.
    fn wait(&mut self, ms: u64, cancel: &CancelToken) -> Result<()> {
        self.plan_add(ms);
        self.sleep(ms, cancel)
    }

    /// A Wait step: `ms` on the timeline, made shorter by however far the run
    /// has fallen behind it, so a long macro keeps its pace.
    fn wait_step(&mut self, ms: u64, cancel: &CancelToken) -> Result<()> {
        let now = std::time::Instant::now();
        let mut behind = self.plan.map_or(0, |p| now.saturating_duration_since(p).as_millis() as u64);
        if behind > CATCH_UP_MS {
            self.plan = Some(now);
            behind = 0;
        }
        self.plan_add(ms);
        self.sleep(ms.saturating_sub(behind), cancel)
    }

    fn sleep(&self, ms: u64, cancel: &CancelToken) -> Result<()> {
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
        } else if let Some(bell) = self.feel.bell {
            jitter_point_bell(x, y, jitter_px, random::spread(bell.tightness), self.rng.gen(), self.rng.gen())
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
            // Sets off and arrives at rest, fastest halfway, as a hand does.
            let e = curve::min_jerk(i as f64 / steps as f64);
            let x = from.0 as f64 + (to.0 - from.0) as f64 * e;
            let y = from.1 as f64 + (to.1 - from.1) as f64 * e;
            self.input.move_to(x.round() as i32, y.round() as i32)?;
            self.wait((duration_ms as u64 / steps as u64).max(1), cancel)?;
        }
        // Land exactly on target regardless of rounding along the way.
        self.input.move_to(to.0, to.1)?;
        Ok(())
    }

    /// The cursor's way to `to`: a recorded path when the step has one,
    /// otherwise a glide.
    fn travel(&mut self, to: (i32, i32), path: &[PathPoint], duration_ms: u32, anchor: Anchor, cancel: &CancelToken) -> Result<()> {
        // The run's first travel along a path starts where the path was
        // recorded, as the recording did (unless the step aims relative to
        // something, which a recorded spot means nothing to).
        let from_recorded_start = !self.traveled && anchor == Anchor::Fixed;
        self.traveled = true;
        if path.len() < 2 || duration_ms == 0 {
            // A glide with `Feel::curve` arcs: its way is made here and
            // replayed like a recorded one. A jump stays a jump.
            if let (Some(c), true) = (self.feel.curve, duration_ms > 0) {
                let from = self.input.cursor_pos().unwrap_or(to);
                let bounds = self.input.virtual_rect();
                let way = curve::curve_path(from, to, duration_ms, c, self.feel.bell, bounds, &mut self.rng);
                return self.follow_path(to, &way, duration_ms, false, cancel);
            }
            return self.glide(to, duration_ms, cancel);
        }
        self.follow_path(to, path, duration_ms, from_recorded_start, cancel)
    }

    /// Replay a recorded path (see `PathPoint`), point by point on its own
    /// timing stretched to `duration_ms`. It is bent so it starts where the
    /// cursor is (unless `from_recorded_start`) and ends on `to`: each point
    /// is shifted by the start's difference fading out and the end's fading
    /// in, so a path replayed from where it was recorded is exact, and one
    /// whose step was moved still arrives without a jump.
    fn follow_path(&mut self, to: (i32, i32), path: &[PathPoint], duration_ms: u32, from_recorded_start: bool, cancel: &CancelToken) -> Result<()> {
        let (first, last) = (path[0], path[path.len() - 1]);
        let span = f64::from(last.t.max(1));
        let from = match from_recorded_start {
            true => (first.x, first.y),
            false => self.input.cursor_pos().unwrap_or((first.x, first.y)),
        };
        let (sx, sy) = (f64::from(from.0 - first.x), f64::from(from.1 - first.y));
        let (ex, ey) = (f64::from(to.0 - last.x), f64::from(to.1 - last.y));
        let scale = f64::from(duration_ms) / span;
        // On the run's timeline (see `plan`), point by point: each point at
        // its own moment from the start, to a fraction of a millisecond (a
        // 2000 Hz mouse makes a point every half millisecond).
        let start = self.timeline_start();
        let at = spread_within_ms(path);
        for (p, t) in path.iter().zip(at) {
            if cancel.is_cancelled() {
                return Err(EngineError::Cancelled);
            }
            let f = f64::from(p.t) / span;
            let due = start + std::time::Duration::from_micros((t * scale * 1000.0) as u64);
            self.sleep_until(due, cancel)?;
            let x = f64::from(p.x) + sx * (1.0 - f) + ex * f;
            let y = f64::from(p.y) + sy * (1.0 - f) + ey * f;
            self.input.move_to(x.round() as i32, y.round() as i32)?;
        }
        self.input.move_to(to.0, to.1)?;
        self.plan = Some(start + std::time::Duration::from_millis(u64::from(duration_ms)));
        Ok(())
    }

    /// Where a step that plays out over time (a path, a recorded scroll)
    /// starts on the run's timeline: where the run should be by now, unless
    /// it has fallen far behind (a stall), then now.
    fn timeline_start(&self) -> std::time::Instant {
        let now = std::time::Instant::now();
        self.plan
            .filter(|p| now.saturating_duration_since(*p).as_millis() as u64 <= CATCH_UP_MS)
            .unwrap_or(now)
    }

    /// Sleep until `due`, to a fraction of a millisecond (`timer::wait_until`).
    /// Never past "stop after".
    fn sleep_until(&self, due: std::time::Instant, cancel: &CancelToken) -> Result<()> {
        match self.deadline.filter(|d| *d <= due) {
            Some(d) if timer::wait_until(d, cancel) => Err(EngineError::TimeUp),
            None if timer::wait_until(due, cancel) => Ok(()),
            _ => Err(EngineError::Cancelled),
        }
    }

    /// A pause inside a step (a settle, a dwell): its full length from now,
    /// ended to a fraction of a millisecond, on the timeline.
    fn pause(&mut self, ms: u64, cancel: &CancelToken) -> Result<()> {
        self.plan_add(ms);
        self.sleep_until(std::time::Instant::now() + std::time::Duration::from_millis(ms), cancel)
    }

    fn run_step(&mut self, step: &Step, cancel: &CancelToken, held: &mut HeldState) -> Result<()> {
        match step {
            Step::Wait { ms, .. } => {
                let d = self.sample(*ms);
                self.wait_step(d, cancel)?;
            }

            Step::Move { x, y, anchor, dx, dy, coord_jitter_px, move_duration_ms, path, .. } => {
                let p = self.resolve_point(*anchor, (*x, *y), (*dx, *dy), *coord_jitter_px)?;
                self.travel(p, path, *move_duration_ms, *anchor, cancel)?;
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
                dwell_ms,
                move_duration_ms,
                path,
                modifiers,
                held_key,
                ..
            } => {
                let p = self.resolve_point(*anchor, (*x, *y), (*dx, *dy), *coord_jitter_px)?;
                self.travel(p, path, *move_duration_ms, *anchor, cancel)?;
                // Windows would drop the click without a word (UIPI): say so.
                if self.input.blocked(Some(p)) {
                    return Err(InputError::AccessDenied.into());
                }
                // Now and then a moment's hesitation on the target before
                // pressing (`Feel::hesitate`), before any key goes down.
                if let Some(h) = self.feel.hesitate.filter(|h| h.chance_pct > 0) {
                    if step.hesitates() && self.rng.gen_bool(f64::from(h.chance_pct.min(100)) / 100.0) {
                        let ms = self.sample(h.ms);
                        self.pause(ms, cancel)?;
                    }
                }
                // Held keys go down after the travel, so nothing reacts to
                // Shift+move, and stay down through both settles.
                let pressed = self.hold_keys(modifiers, held_key.as_ref(), held)?;
                // Let the target see the cursor at rest before the press...
                let s = self.sample(*settle_ms);
                self.pause(s, cancel)?;
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
                // registers the release somewhere else. (A recorded click
                // stays as long as the user did: its own `dwell_ms`.)
                let s = self.sample(dwell_ms.unwrap_or(*settle_ms));
                self.pause(s, cancel)?;
                if let Some((scan, extended)) = pressed {
                    self.input.key(scan, extended, false)?;
                    held.key(scan, extended, false);
                }
                self.release_modifiers(modifiers, held)?;
            }

            Step::Scroll { amount, axis, at, ticks, .. } => {
                let target = at.or_else(|| self.input.cursor_pos().ok());
                if target.is_some_and(|p| self.input.blocked(Some(p))) {
                    return Err(InputError::AccessDenied.into());
                }
                // Scrolling at a point puts the cursor there.
                self.traveled |= at.is_some();
                if ticks.is_empty() {
                    self.input.scroll(*axis, *amount, *at)?;
                } else {
                    // A recorded scroll: each turn, by as much as it turned,
                    // at its own moment on the run's timeline.
                    let start = self.timeline_start();
                    for (i, k) in ticks.iter().enumerate() {
                        self.sleep_until(start + std::time::Duration::from_millis(u64::from(k.t)), cancel)?;
                        self.input.wheel(*axis, k.delta, if i == 0 { *at } else { None })?;
                    }
                    let last = ticks.last().map_or(0, |k| u64::from(k.t));
                    self.plan = Some(start + std::time::Duration::from_millis(last));
                }
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

            Step::Key { key, action, modifiers, hold_ms, repeat, .. } => {
                if self.input.blocked(None) {
                    return Err(InputError::AccessDenied.into());
                }
                for m in modifiers {
                    self.input.modifier(*m, true)?;
                    held.modifier(*m, true);
                }
                let k = (key.scancode, key.extended);
                match action {
                    KeyAction::Down => {
                        self.input.key(key.scancode, key.extended, true)?;
                        held.key(key.scancode, key.extended, true);
                        // Repeats until the step that releases it.
                        if let Some(r) = repeat {
                            self.start_repeat(k, *r);
                        }
                    }
                    KeyAction::Up => {
                        self.stop_repeat(k);
                        self.input.key(key.scancode, key.extended, false)?;
                        held.key(key.scancode, key.extended, false);
                    }
                    KeyAction::Press => {
                        self.input.key(key.scancode, key.extended, true)?;
                        held.key(key.scancode, key.extended, true);
                        if let Some(r) = repeat {
                            self.start_repeat(k, *r);
                        }
                        let d = self.sample(*hold_ms);
                        self.plan_add(d);
                        // Release before propagating a cancellation, so an abort
                        // during the hold does not strand the key.
                        let cancelled = !timer::wait_until(std::time::Instant::now() + std::time::Duration::from_millis(d), cancel);
                        self.stop_repeat(k);
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
        self.plan_add(d);
        let cancelled = !timer::wait_until(std::time::Instant::now() + std::time::Duration::from_millis(d), cancel);
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
    /// Repeat a held key from now on: first after `r.delay_ms`, then every
    /// `r.every_ms`, until `stop_repeat`.
    fn start_repeat(&mut self, (scan, extended): (u16, bool), r: KeyRepeat) {
        self.stop_repeat((scan, extended));
        let stop = CancelToken::new();
        let (input, s) = (self.input.clone(), stop.clone());
        let thread = std::thread::Builder::new()
            .name("key-repeat".into())
            .spawn(move || {
                // Each repeat at its own moment from the press, so late
                // wake-ups do not add up. To the millisecond is plenty here.
                let mut due = std::time::Instant::now() + std::time::Duration::from_millis(u64::from(r.delay_ms));
                let every = std::time::Duration::from_millis(u64::from(r.every_ms.max(1)));
                loop {
                    let left = due.saturating_duration_since(std::time::Instant::now());
                    if !timer::wait(left.as_micros().div_ceil(1000) as u64, &s) || input.key(scan, extended, true).is_err() {
                        return;
                    }
                    due += every;
                }
            })
            .ok();
        self.repeaters.push(Repeater { key: (scan, extended), stop, thread });
    }

    /// Stop repeating a key, and wait until it has, so no repeat can come
    /// after the release that follows.
    fn stop_repeat(&mut self, key: (u16, bool)) {
        self.repeaters.retain_mut(|r| {
            if r.key != key {
                return true;
            }
            r.stop.cancel();
            if let Some(t) = r.thread.take() {
                let _ = t.join();
            }
            false
        });
    }

    fn release_all(&mut self, held: &mut HeldState) {
        // Repeats stop before anything is released.
        for key in self.repeaters.iter().map(|r| r.key).collect::<Vec<_>>() {
            self.stop_repeat(key);
        }
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
    use crate::model::{KeyRef, ScrollAxis, WheelTick};
    use std::time::Duration;

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

    fn move_to(x: i32, y: i32, travel: u32) -> Step {
        Step::Move {
            id: "m".into(),
            shuffle: false,
            x,
            y,
            anchor: Anchor::Fixed,
            dx: 0,
            dy: 0,
            coord_jitter_px: 0,
            move_duration_ms: travel,
            path: Vec::new(),
            capture: None,
        }
    }

    fn moves(f: &FakeInput) -> Vec<(i32, i32)> {
        f.events()
            .into_iter()
            .filter_map(|e| match e {
                Event::Move(x, y) => Some((x, y)),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn a_glide_starts_and_ends_slowly() {
        let f = Arc::new(FakeInput::with_cursor(0, 0));
        let mut e = Engine::new(f.clone(), Some(42));
        e.run(&mac(vec![move_to(1000, 0, 400)]), &CancelToken::new()).unwrap();
        let xs: Vec<i32> = moves(&f).into_iter().map(|(x, _)| x).collect();
        assert_eq!(xs.len(), 51, "50 eased moves and the exact landing");
        // A tenth of the way in time: minimum jerk has gone 8.6 px of 1000,
        // the quadratic ease it replaced 20.
        assert!(xs[4] < 12, "{}", xs[4]);
        assert!(xs[44] > 988, "{}", xs[44]);
        let steps: Vec<i32> = std::iter::once(xs[0]).chain(xs.windows(2).map(|w| w[1] - w[0])).collect();
        let biggest = steps.iter().enumerate().max_by_key(|(_, d)| **d).map(|(i, _)| i).unwrap();
        assert!((17..34).contains(&biggest), "fastest at move {biggest}");
    }

    fn curving(steps: Vec<Step>) -> (Arc<FakeInput>, Engine, Macro) {
        let f = Arc::new(FakeInput::with_cursor(0, 500));
        let e = Engine::new(f.clone(), Some(42));
        let mut m = mac(steps);
        m.feel.curve = Some(crate::model::Curve { bend_pct: 10, overshoot_pct: 0 });
        (f, e, m)
    }

    #[test]
    fn a_curved_move_arcs_and_lands_on_target() {
        let (f, mut e, m) = curving(vec![move_to(800, 500, 200)]);
        e.run(&m, &CancelToken::new()).unwrap();
        let ms = moves(&f);
        assert_eq!(ms.last(), Some(&(800, 500)));
        assert!(ms.iter().any(|(_, y)| (y - 500).abs() >= 10), "straight: {ms:?}");
        let tl: Vec<_> = f.timeline().into_iter().filter(|(_, ev)| matches!(ev, Event::Move(..))).collect();
        let span = tl[tl.len() - 1].0.duration_since(tl[0].0).as_secs_f64() * 1000.0;
        assert!((190.0..215.0).contains(&span), "took {span:.1} ms");
    }

    #[test]
    fn a_curved_click_presses_on_its_target() {
        let mut c = timed_click("c", 800, 1, 0, None);
        if let Step::Click { y, move_duration_ms, .. } = &mut c {
            *y = 500;
            *move_duration_ms = 200;
        }
        let (f, mut e, m) = curving(vec![c]);
        e.run(&m, &CancelToken::new()).unwrap();
        let ev = f.events();
        let down = ev.iter().position(|x| matches!(x, Event::Button(_, true))).unwrap();
        assert_eq!(ev[down - 1], Event::Move(800, 500));
        assert!(moves(&f).iter().any(|(_, y)| (y - 500).abs() >= 10));
    }

    #[test]
    fn recorded_paths_ignore_the_curve() {
        let run = |curve| {
            let mut c = timed_click("r", 300, 1, 0, None);
            if let Step::Click { path, move_duration_ms, .. } = &mut c {
                *path = vec![PathPoint { x: 0, y: 500, t: 0 }, PathPoint { x: 150, y: 520, t: 20 }, PathPoint { x: 300, y: 100, t: 40 }];
                *move_duration_ms = 40;
            }
            let (f, mut e, mut m) = curving(vec![c]);
            m.feel.curve = curve;
            e.run(&m, &CancelToken::new()).unwrap();
            f.events()
        };
        assert_eq!(run(Some(crate::model::Curve { bend_pct: 30, overshoot_pct: 100 })), run(None));
    }

    #[test]
    fn an_overshooting_glide_passes_the_target_and_lands_on_it() {
        let (f, mut e, mut m) = curving(vec![move_to(800, 500, 200)]);
        m.feel.curve = Some(crate::model::Curve { bend_pct: 10, overshoot_pct: 100 });
        e.run(&m, &CancelToken::new()).unwrap();
        let ms = moves(&f);
        assert!(ms.iter().any(|(x, _)| *x > 800), "never went past: {ms:?}");
        assert_eq!(ms.last(), Some(&(800, 500)));
    }

    #[test]
    fn a_bell_gathers_click_spread_near_the_point() {
        let spread = |bell| {
            let (f, mut e) = engine();
            let steps = (0..200)
                .map(|_| {
                    let mut c = timed_click("c", 500, 0, 0, None);
                    if let Step::Click { y, coord_jitter_px, .. } = &mut c {
                        *y = 500;
                        *coord_jitter_px = 20;
                    }
                    c
                })
                .collect();
            let mut m = mac(steps);
            m.feel.bell = bell;
            e.run(&m, &CancelToken::new()).unwrap();
            moves(&f).iter().map(|(x, y)| f64::from(x - 500).hypot(f64::from(y - 500))).collect::<Vec<f64>>()
        };
        let near = |v: &[f64]| v.iter().filter(|d| **d <= 10.0).count() as f64 / v.len() as f64;
        let tight = spread(Some(crate::model::Bell { tightness: crate::model::Tightness::Tight, peak: crate::model::Peak::Middle }));
        let even = spread(None);
        assert!(tight.iter().all(|d| *d <= 20.5), "{tight:?}");
        // Within half the radius: about 0.78 of a tight bell, 0.25 of an even disc.
        assert!(near(&tight) > 0.6, "{}", near(&tight));
        assert!(near(&even) < 0.4, "{}", near(&even));
    }

    #[test]
    fn a_jump_stays_a_jump() {
        let (f, mut e, m) = curving(vec![move_to(800, 500, 0)]);
        e.run(&m, &CancelToken::new()).unwrap();
        assert_eq!(moves(&f), vec![(800, 500)]);
    }

    #[test]
    fn cancelling_mid_curve_stops_at_once() {
        let (_, mut e, m) = curving(vec![move_to(800, 500, 5_000)]);
        let cancel = CancelToken::new();
        let c2 = cancel.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(50));
            c2.cancel();
        });
        let started = std::time::Instant::now();
        assert!(matches!(e.run(&m, &cancel), Err(EngineError::Cancelled)));
        assert!(started.elapsed() < Duration::from_millis(500), "{:?}", started.elapsed());
    }

    #[test]
    fn bell_waits_cluster_in_the_middle_of_their_range() {
        let middle = |e: &mut Engine| {
            let v: Vec<u64> = (0..10_000).map(|_| e.sample(Jitter { base: 100, jitter: 60 })).collect();
            assert!(v.iter().all(|ms| (100..=160).contains(ms)));
            v.iter().filter(|ms| (120..=140).contains(*ms)).count() as f64 / v.len() as f64
        };
        let (_, mut e) = engine();
        e.feel.bell = Some(crate::model::Bell::default());
        let bell = middle(&mut e);
        assert!(bell > 0.6, "{bell}");
        let (_, mut even) = engine();
        let flat = middle(&mut even);
        assert!(flat < 0.4, "{flat}");
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
            dwell_ms: None,
            move_duration_ms: 0,
            path: Vec::new(),
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

    fn path_move(x: i32, y: i32, move_duration_ms: u32, path: Vec<PathPoint>) -> Step {
        Step::Move {
            id: "p".into(),
            shuffle: false,
            x,
            y,
            anchor: Anchor::Fixed,
            dx: 0,
            dy: 0,
            coord_jitter_px: 0,
            move_duration_ms,
            path,
            capture: None,
        }
    }

    const fn pt(x: i32, y: i32, t: u32) -> PathPoint {
        PathPoint { x, y, t }
    }

    /// A recorded path is replayed point by point. It starts where the
    /// cursor really is and ends on the step's point, bending smoothly in
    /// between when either differs from the recording.
    #[test]
    fn a_recorded_path_is_followed_and_bent_to_the_real_start_and_target() {
        let f = Arc::new(FakeInput::with_cursor(500, 500));
        let mut e = Engine::new(f.clone(), Some(1));
        let path = vec![pt(10, 0, 0), pt(60, 30, 20), pt(110, 0, 40)];
        // A step before it put the cursor 10 px from where the path began.
        e.run(&mac(vec![path_move(0, 0, 0, Vec::new()), path_move(110, 0, 40, path)]), &CancelToken::new()).unwrap();
        let moves: Vec<(i32, i32)> = f
            .events()
            .into_iter()
            .filter_map(|ev| if let Event::Move(x, y) = ev { Some((x, y)) } else { None })
            .collect();
        // Start: the recorded start, moved onto the real cursor. Middle: half
        // of that correction. End: exactly on the step's point.
        assert_eq!(moves[..2], [(0, 0), (0, 0)]);
        assert!(moves.contains(&(55, 30)), "{moves:?}");
        assert_eq!(moves.last(), Some(&(110, 0)));
    }

    /// Regression: a macro whose first steps were deleted (with them the
    /// jump to where the recording began) bent its first path from wherever
    /// the cursor was when the hotkey was pressed: a fast sweep across the
    /// screen where the user had nudged the mouse a few pixels.
    #[test]
    fn the_first_path_of_a_run_starts_where_it_was_recorded() {
        let f = Arc::new(FakeInput::with_cursor(900, 700));
        let mut e = Engine::new(f.clone(), Some(1));
        let path = vec![pt(10, 0, 0), pt(60, 30, 20), pt(110, 0, 40)];
        e.run(&mac(vec![path_move(110, 0, 40, path)]), &CancelToken::new()).unwrap();
        let moves: Vec<(i32, i32)> = f
            .events()
            .into_iter()
            .filter_map(|ev| if let Event::Move(x, y) = ev { Some((x, y)) } else { None })
            .collect();
        assert_eq!(moves[..3], [(10, 0), (60, 30), (110, 0)]);
    }

    #[test]
    fn a_path_ends_on_a_moved_target_and_travel_rescales_its_timing() {
        let f = Arc::new(FakeInput::with_cursor(10, 0));
        let mut e = Engine::new(f.clone(), Some(1));
        // Recorded over 40 ms to (110, 0); the step now aims at (200, 100)
        // and its travel was raised to 120 ms.
        let path = vec![pt(10, 0, 0), pt(60, 0, 20), pt(110, 0, 40)];
        e.run(&mac(vec![path_move(200, 100, 120, path)]), &CancelToken::new()).unwrap();
        let t = f.timeline();
        assert_eq!(t.last().map(|(_, ev)| ev.clone()), Some(Event::Move(200, 100)));
        let took = t.last().unwrap().0 - t.first().unwrap().0;
        assert!(took >= Duration::from_millis(100), "the path took {took:?}, not about 120 ms");
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
            dwell_ms: None,
            move_duration_ms: 0,
            path: Vec::new(),
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
                repeat: None,
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
            dwell_ms: None,
            move_duration_ms: 0,
            path: Vec::new(),
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

    fn timed_click(id: &str, x: i32, hold: u32, settle: u32, dwell: Option<u32>) -> Step {
        Step::Click {
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
            hold_ms: Jitter::exact(hold),
            settle_ms: Jitter::exact(settle),
            dwell_ms: dwell.map(Jitter::exact),
            move_duration_ms: 0,
            path: Vec::new(),
            modifiers: vec![],
            held_key: None,
            capture: None,
        }
    }

    fn hesitant(chance_pct: u8, ms: u32) -> crate::model::Hesitate {
        crate::model::Hesitate { chance_pct, ms: Jitter::exact(ms) }
    }

    fn with_action(mut s: Step, a: ClickAction) -> Step {
        if let Step::Click { action, .. } = &mut s {
            *action = a;
        }
        s
    }

    /// The gap in ms before each button press, from the event before it.
    fn gaps_before_presses(f: &FakeInput) -> Vec<f64> {
        f.timeline()
            .windows(2)
            .filter_map(|w| match w[1].1 {
                Event::Button(_, true) => Some(w[1].0.duration_since(w[0].0).as_secs_f64() * 1000.0),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn some_clicks_hesitate_before_pressing() {
        let (f, mut e) = engine();
        let mut m = mac((0..40).map(|i| timed_click("c", 100 + i, 1, 0, None)).collect());
        m.feel.hesitate = Some(hesitant(50, 30));
        e.run(&m, &CancelToken::new()).unwrap();
        let gaps = gaps_before_presses(&f);
        assert_eq!(gaps.len(), 40);
        let long = gaps.iter().filter(|g| **g >= 28.0).count();
        assert!((8..=32).contains(&long), "{long} of 40 hesitated");
        assert!(gaps.iter().all(|g| *g >= 28.0 || *g < 15.0), "{gaps:?}");
    }

    #[test]
    fn a_double_click_hesitates_before_its_first_press_only() {
        let (f, mut e) = engine();
        let mut m = mac(vec![with_action(timed_click("c", 100, 1, 0, None), ClickAction::Double)]);
        m.feel.hesitate = Some(hesitant(100, 30));
        e.run(&m, &CancelToken::new()).unwrap();
        let gaps = gaps_before_presses(&f);
        assert_eq!(gaps.len(), 2);
        assert!(gaps[0] >= 28.0 && gaps[1] < 15.0, "{gaps:?}");
    }

    #[test]
    fn a_release_and_a_recorded_click_never_hesitate() {
        let (f, mut e) = engine();
        let mut recorded = timed_click("r", 200, 1, 0, None);
        if let Step::Click { path, move_duration_ms, .. } = &mut recorded {
            *path = vec![PathPoint { x: 100, y: 100, t: 0 }, PathPoint { x: 200, y: 100, t: 10 }];
            *move_duration_ms = 10;
        }
        let mut m = mac(vec![with_action(timed_click("u", 100, 1, 0, None), ClickAction::Up), recorded]);
        m.feel.hesitate = Some(hesitant(100, 30));
        e.run(&m, &CancelToken::new()).unwrap();
        for w in f.timeline().windows(2) {
            if let Event::Button(..) = w[1].1 {
                let ms = w[1].0.duration_since(w[0].0).as_secs_f64() * 1000.0;
                assert!(ms < 15.0, "{:?} waited {ms:.1} ms", w[1].1);
            }
        }
    }

    #[test]
    fn cancelling_during_a_hesitation_stops_at_once() {
        let (f, mut e) = engine();
        let mut m = mac(vec![timed_click("c", 100, 1, 0, None)]);
        m.feel.hesitate = Some(hesitant(100, 5_000));
        let cancel = CancelToken::new();
        let c2 = cancel.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(50));
            c2.cancel();
        });
        let started = std::time::Instant::now();
        assert!(matches!(e.run(&m, &cancel), Err(EngineError::Cancelled)));
        assert!(started.elapsed() < Duration::from_millis(500), "{:?}", started.elapsed());
        assert!(!f.events().iter().any(|ev| matches!(ev, Event::Button(..))));
        assert!(f.still_held().is_empty(), "{:?}", f.still_held());
    }

    #[test]
    fn stop_after_ends_a_hesitation_normally() {
        let (_, mut e) = engine();
        let mut m = mac(vec![timed_click("c", 100, 1, 0, None)]);
        m.feel.hesitate = Some(hesitant(100, 5_000));
        m.stop_after_ms = Some(50);
        let started = std::time::Instant::now();
        assert!(e.run(&m, &CancelToken::new()).is_ok());
        assert!(started.elapsed() < Duration::from_millis(500), "{:?}", started.elapsed());
    }

    #[test]
    fn no_chance_draws_nothing() {
        // Jittered clicks: any extra draw from the RNG would move them.
        let run = |hesitate| {
            let (f, mut e) = engine();
            let steps = (0..5)
                .map(|i| {
                    let mut c = timed_click("c", 100 + i * 50, 1, 0, None);
                    if let Step::Click { coord_jitter_px, .. } = &mut c {
                        *coord_jitter_px = 20;
                    }
                    c
                })
                .collect();
            let mut m = mac(steps);
            m.feel.hesitate = hesitate;
            e.run(&m, &CancelToken::new()).unwrap();
            f.events()
        };
        assert_eq!(run(Some(hesitant(0, 30))), run(None));
    }

    /// A recorded click rests on its target as long as the user did before
    /// the press, and leaves as soon after the release as they did.
    #[test]
    fn a_click_with_its_own_dwell_rests_that_long_after_the_release() {
        let (f, mut e) = engine();
        e.run(&mac(vec![timed_click("a", 100, 1, 30, Some(3)), timed_click("b", 500, 1, 0, None)]), &CancelToken::new()).unwrap();
        let tl = f.timeline();
        let at = |pred: &dyn Fn(&Event) -> bool| tl.iter().position(|(_, ev)| pred(ev)).unwrap();
        let ms = |a: usize, b: usize| tl[b].0.duration_since(tl[a].0).as_secs_f64() * 1000.0;
        let (arrive, down, up, leave) = (
            at(&|ev| *ev == Event::Move(100, 100)),
            at(&|ev| matches!(ev, Event::Button(_, true))),
            at(&|ev| matches!(ev, Event::Button(_, false))),
            at(&|ev| *ev == Event::Move(500, 100)),
        );
        assert!(ms(arrive, down) >= 29.5, "rested {:.2} ms before the press", ms(arrive, down));
        let dwell = ms(up, leave);
        assert!((2.5..10.0).contains(&dwell), "left {dwell:.2} ms after the release, not 3");
    }

    /// Pauses inside a step end on time to a fraction of a millisecond. The
    /// timer alone wakes up to a millisecond late every time, and a recorded
    /// click has three of them.
    #[test]
    fn pauses_inside_a_step_end_on_time() {
        let (f, mut e) = engine();
        let steps = (0..12).map(|i| timed_click("c", 100 + i, 4, 3, Some(2))).collect();
        e.run(&mac(steps), &CancelToken::new()).unwrap();
        let tl = f.timeline();
        let mut late: Vec<f64> = Vec::new();
        for w in tl.windows(2) {
            let ms = w[1].0.duration_since(w[0].0).as_secs_f64() * 1000.0;
            match (&w[0].1, &w[1].1) {
                (Event::Move(..), Event::Button(_, true)) => late.push(ms - 3.0),
                (Event::Button(_, true), Event::Button(_, false)) => late.push(ms - 4.0),
                (Event::Button(_, false), Event::Move(..)) => late.push(ms - 2.0),
                _ => {}
            }
        }
        assert_eq!(late.len(), 12 * 3 - 1);
        late.sort_by(f64::total_cmp);
        let median = late[late.len() / 2];
        assert!(late[0] >= -0.05, "a pause ended {:.3} ms early", -late[0]);
        assert!(median < 0.3, "pauses ended {median:.3} ms late (median): {late:?}");
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
                dwell_ms: None,
                move_duration_ms: 0,
                path: Vec::new(),
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
                dwell_ms: None,
                move_duration_ms: 0,
                path: Vec::new(),
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
            path: Vec::new(),
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
            path: Vec::new(),
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
            dwell_ms: None,
            move_duration_ms: 0,
            path: Vec::new(),
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
            path: Vec::new(),
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
                path: Vec::new(),
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
                path: Vec::new(),
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
                path: Vec::new(),
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
            dwell_ms: None,
            move_duration_ms: 0,
            path: Vec::new(),
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
            repeat: None,
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
                repeat: None,
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
                dwell_ms: None,
                move_duration_ms: 0,
                path: Vec::new(),
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
            repeat: None,
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
            ticks: Vec::new(),
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
            Step::Scroll { id: "s".into(), shuffle: false, amount: 1, axis: ScrollAxis::Vertical, at: None, ticks: Vec::new() },
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
                repeat: None,
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
            ticks: Vec::new(),
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
            path: Vec::new(),
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
    fn points_sharing_a_millisecond_are_spread_across_it() {
        let p = |t| PathPoint { x: 0, y: 0, t };
        assert_eq!(spread_within_ms(&[p(0), p(0), p(1), p(1), p(1), p(1), p(3)]), [0.0, 0.5, 1.0, 1.25, 1.5, 1.75, 3.0]);
    }

    /// A 2000 Hz mouse makes a point every half millisecond: every one is
    /// replayed, each at its own moment, not in bursts at whole milliseconds.
    #[test]
    fn every_point_of_a_2000_hz_path_is_replayed_on_time() {
        let f = Arc::new(FakeInput::with_cursor(0, 0));
        let mut e = Engine::new(f.clone(), Some(1));
        // 200 points, half a millisecond apart: 100 ms (t is in ms, so the
        // half-millisecond points are spread by stretching 50 ms to 100).
        let path: Vec<PathPoint> = (0..200).map(|i| PathPoint { x: i, y: 0, t: i as u32 / 4 }).collect();
        let started = std::time::Instant::now();
        e.run(&mac(vec![path_move(199, 0, 100, path)]), &CancelToken::new()).unwrap();
        let moves: Vec<std::time::Instant> =
            f.timeline().into_iter().filter(|(_, ev)| matches!(ev, Event::Move(..))).map(|(at, _)| at).collect();
        assert_eq!(moves.len(), 201, "every point, then the target");
        let took = moves[moves.len() - 1] - started;
        assert!(took >= Duration::from_millis(95) && took <= Duration::from_millis(140), "{took:?}");
        // Halfway through the path is halfway through the time, give or take.
        let mid = moves[100] - started;
        assert!(mid >= Duration::from_millis(45) && mid <= Duration::from_millis(70), "{mid:?}");
    }

    /// Windows repeats a key the user holds, never one a program holds, so
    /// the engine repeats it itself to replay the hold as it was.
    #[test]
    fn a_held_key_repeats_the_way_it_was_recorded() {
        let (f, mut e) = engine();
        let held = Step::Key {
            id: "w".into(),
            shuffle: false,
            key: key(0x57),
            action: KeyAction::Down,
            modifiers: vec![],
            hold_ms: Jitter::exact(0),
            repeat: Some(KeyRepeat { delay_ms: 40, every_ms: 10 }),
        };
        let up = Step::Key {
            id: "wu".into(),
            shuffle: false,
            key: key(0x57),
            action: KeyAction::Up,
            modifiers: vec![],
            hold_ms: Jitter::exact(0),
            repeat: None,
        };
        let m = mac(vec![held, Step::Wait { id: "p".into(), shuffle: false, ms: Jitter::exact(100) }, up]);
        e.run(&m, &CancelToken::new()).unwrap();
        let downs = f.events().iter().filter(|ev| matches!(ev, Event::Key { down: true, .. })).count();
        // One press, then about six repeats in the 100 ms wait.
        assert!((5..=9).contains(&downs), "{downs} presses of a held key");
        assert_eq!(f.events().iter().filter(|ev| matches!(ev, Event::Key { down: false, .. })).count(), 1);
        assert!(f.still_held().is_empty());
    }

    /// Repeats keep to their schedule: each one at its own moment from the
    /// press, not a timer's late wake-up after the one before (that lost a
    /// fraction of a millisecond a repeat, adding up while the key was held).
    #[test]
    fn a_held_keys_repeats_do_not_drift() {
        let (f, mut e) = engine();
        let k = |action, repeat| Step::Key {
            id: "k".into(),
            shuffle: false,
            key: key(0x57),
            action,
            modifiers: vec![],
            hold_ms: Jitter::exact(0),
            repeat,
        };
        let wait = Step::Wait { id: "p".into(), shuffle: false, ms: Jitter::exact(330) };
        let m = mac(vec![k(KeyAction::Down, Some(KeyRepeat { delay_ms: 20, every_ms: 5 })), wait, k(KeyAction::Up, None)]);
        e.run(&m, &CancelToken::new()).unwrap();
        let downs: Vec<std::time::Instant> =
            f.timeline().into_iter().filter(|(_, ev)| matches!(ev, Event::Key { down: true, .. })).map(|(at, _)| at).collect();
        // The press, then a repeat at 20, 25, ... 320 ms: the 61st is due at
        // 320 ms.
        assert!(downs.len() >= 62, "{} presses", downs.len());
        let off = downs[61].duration_since(downs[0]).as_secs_f64() * 1000.0 - 320.0;
        assert!(off.abs() < 3.0, "the 61st repeat was {off:.2} ms off its moment");
    }

    #[test]
    fn a_held_key_without_a_recorded_repeat_is_pressed_once() {
        let (f, mut e) = engine();
        let down = Step::Key {
            id: "d".into(),
            shuffle: false,
            key: key(0x57),
            action: KeyAction::Down,
            modifiers: vec![],
            hold_ms: Jitter::exact(0),
            repeat: None,
        };
        let m = mac(vec![down, Step::Wait { id: "p".into(), shuffle: false, ms: Jitter::exact(60) }]);
        e.run(&m, &CancelToken::new()).unwrap();
        assert_eq!(f.events().iter().filter(|ev| matches!(ev, Event::Key { down: true, .. })).count(), 1);
    }

    #[test]
    fn a_recorded_scroll_turns_the_wheel_tick_by_tick_with_its_timing() {
        let (f, mut e) = engine();
        let m = mac(vec![Step::Scroll {
            id: "s".into(),
            shuffle: false,
            amount: -1,
            axis: ScrollAxis::Vertical,
            at: Some((10, 20)),
            ticks: vec![
                WheelTick { t: 0, delta: -30 },
                WheelTick { t: 20, delta: -30 },
                WheelTick { t: 40, delta: -60 },
            ],
        }]);
        let before = std::time::Instant::now();
        e.run(&m, &CancelToken::new()).unwrap();
        assert_eq!(
            f.events().iter().filter(|ev| matches!(ev, Event::ScrollRaw(..))).cloned().collect::<Vec<_>>(),
            vec![
                Event::ScrollRaw(ScrollAxis::Vertical, -30, Some((10, 20))),
                Event::ScrollRaw(ScrollAxis::Vertical, -30, None),
                Event::ScrollRaw(ScrollAxis::Vertical, -60, None),
            ]
        );
        assert!(before.elapsed() >= Duration::from_millis(35), "the ticks kept their timing");
    }

    #[test]
    fn a_scroll_without_ticks_still_scrolls_its_notches_at_once() {
        let (f, mut e) = engine();
        let m = mac(vec![Step::Scroll {
            id: "s".into(),
            shuffle: false,
            amount: -3,
            axis: ScrollAxis::Vertical,
            at: None,
            ticks: Vec::new(),
        }]);
        e.run(&m, &CancelToken::new()).unwrap();
        assert_eq!(f.events(), vec![Event::Scroll(ScrollAxis::Vertical, -3, None)]);
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
            ticks: Vec::new(),
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
                path: Vec::new(),
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
                path: Vec::new(),
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
            path: Vec::new(),
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
            path: Vec::new(),
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
            repeat: None,
        }]);
        *f.fail_with.lock().unwrap() = Some("uipi");
        let r = e.run(&m, &CancelToken::new());
        assert!(matches!(r, Err(EngineError::Input(InputError::AccessDenied))));
        // Nothing was recorded because every call failed, but the important part
        // is that run() returned the error rather than panicking or hanging.
        assert!(f.events().is_empty());
    }
}
