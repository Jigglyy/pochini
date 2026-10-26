//! Record mode: physical input captured by the hooks, turned into steps.
//!
//! While the user records, the keyboard hook and a mouse hook report every
//! key, button, wheel and mouse movement that is not injected (ours or
//! another tool's) as a `Rec`, timestamped by the hook with a precise clock.
//! Nothing is written anywhere: the events live in memory until `to_steps`
//! turns them into the steps the user then sees and edits, and are dropped.
//!
//! The steps replay the recording exactly: every press and release happens
//! when it did, for as long as it did, and the mouse goes the way it went.
//! The conversion is pure, so every rule here is unit-tested:
//! - a key or button pressed and released with nothing else happening in
//!   between is one step (a key press, a click) holding for as long as it was
//!   held; one held while other things happen (W held while clicking, a drag)
//!   is a "hold down" step and a "release" step, each at its moment;
//!   (a modifier is no different: Ctrl+C is Ctrl held around C, each going
//!   down and coming up at its own moment);
//! - a key that repeated while you held it repeats the same way on replay
//!   (`model::KeyRepeat`), because Windows repeats only a key a person
//!   holds, never one a program holds;
//! - the way the mouse went to a click is that click's `path`
//!   (`model::PathPoint`), and the moment it rested on the target before the
//!   press is the click's settle, and the moment it stayed after the
//!   release its dwell; movement that stops short (a rest of IDLE_MS or
//!   more) or comes before a key is a Move step of its own;
//! - wheel turns in a row are one scroll that replays each turn with its own
//!   timing, fractions of a notch included (`model::WheelTick`);
//! - a recording that begins with movement begins where the mouse was;
//! - the time between steps is Wait steps (optional), to the millisecond,
//!   so the timing never drifts.

use serde::{Deserialize, Serialize};

use crate::input::keys;
use crate::model::{
    Anchor, ClickAction, Jitter, KeyAction, KeyRef, KeyRepeat, Modifier, MouseButton, PathPoint, ScrollAxis, Step,
    WheelTick,
};

/// One captured event. `t` is milliseconds on the hook's clock.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Rec {
    Key { vk: u16, scan: u16, extended: bool, down: bool, t: u32 },
    Button { button: MouseButton, down: bool, x: i32, y: i32, t: u32 },
    /// `delta` in wheel units: 120 is one notch, a smooth wheel or a
    /// touchpad sends less.
    Wheel { axis: ScrollAxis, delta: i32, x: i32, y: i32, t: u32 },
    /// The cursor moved here: every report the mouse makes (a 2000 Hz mouse
    /// makes 2000 a second), less repeats of the same position.
    Move { x: i32, y: i32, t: u32 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Options {
    /// Insert Wait steps for the time between actions.
    pub keep_timing: bool,
}

/// A press and release this close (px) count as a click, not a drag, and
/// movement this small while a key is held does not count.
const CLICK_SLOP: i32 = 4;
/// A click's rest after its release shorter than this is the click's own
/// dwell; a longer one is a Wait step.
const MIN_WAIT_MS: u32 = 15;
/// Wheel turns this close together (ms) are one scroll.
const WHEEL_JOIN_MS: u32 = 200;
/// How fast a held key repeats when the recording caught only one repeat
/// (Windows' own default pace, about 30 a second).
const DEFAULT_REPEAT_MS: u32 = 33;
/// The mouse resting this long ends a movement: it becomes a Move step of
/// its own, and the rest a pause, instead of the way to the next click.
const IDLE_MS: u32 = 250;
/// A drag whose movement was not caught glides at most this long.
const MAX_GLIDE_MS: u32 = 2_000;

/// A step, when the engine starts it, and when it is done with it.
struct Act {
    start: u32,
    finish: u32,
    step: Step,
}

fn id(n: usize) -> String {
    format!("rec-{}-{n}", ulid::Ulid::new())
}

fn near(a: (i32, i32), b: (i32, i32)) -> bool {
    (a.0 - b.0).abs() <= CLICK_SLOP && (a.1 - b.1).abs() <= CLICK_SLOP
}

fn time_of(e: &Rec) -> u32 {
    match *e {
        Rec::Key { t, .. } | Rec::Button { t, .. } | Rec::Wheel { t, .. } | Rec::Move { t, .. } => t,
    }
}

#[allow(clippy::too_many_arguments)]
fn click(n: usize, (x, y): (i32, i32), button: MouseButton, action: ClickAction, hold: u32, (settle, dwell): (u32, Option<u32>), modifiers: Vec<Modifier>, (path, travel): (Vec<PathPoint>, u32)) -> Step {
    Step::Click {
        id: id(n),
        shuffle: false,
        x,
        y,
        button,
        action,
        anchor: Anchor::Fixed,
        dx: 0,
        dy: 0,
        coord_jitter_px: 0,
        hold_ms: Jitter::exact(hold),
        settle_ms: Jitter::exact(settle),
        dwell_ms: dwell.map(Jitter::exact),
        move_duration_ms: travel,
        path,
        modifiers,
        held_key: None,
        capture: None,
    }
}

/// A key step. Never any `modifiers`: a modifier the user held is its own
/// hold and release step, at the moments they pressed and let go.
fn key_step(n: usize, (vk, scan, extended): (u16, u16, bool), action: KeyAction, hold: u32, repeat: Option<KeyRepeat>) -> Step {
    Step::Key {
        id: id(n),
        shuffle: false,
        key: KeyRef { vk, scancode: scan, extended, label: keys::label_for_vk(vk) },
        action,
        modifiers: Vec::new(),
        hold_ms: Jitter::exact(hold),
        repeat,
    }
}

/// How a key that went down at `down` repeated, from the times Windows
/// repeated it: the wait before the first repeat, then the usual gap.
fn key_repeat(down: u32, repeats: &[u32]) -> Option<KeyRepeat> {
    let first = *repeats.first()?;
    let mut gaps: Vec<u32> = repeats.windows(2).map(|w| w[1].saturating_sub(w[0])).collect();
    gaps.sort_unstable();
    let every = gaps.get(gaps.len() / 2).copied().filter(|g| *g > 0).unwrap_or(DEFAULT_REPEAT_MS);
    Some(KeyRepeat { delay_ms: first.saturating_sub(down), every_ms: every })
}

/// Wheel units as whole notches, for the step's `amount`: less than a notch
/// still counts as one, so the step reads sensibly and replays without its
/// ticks if they are ever dropped.
fn notches(delta: i32) -> i32 {
    match (f64::from(delta) / 120.0).round() as i32 {
        0 => delta.signum(),
        n => n,
    }
}

/// A Move step straight to a point, with no path and no travel.
fn jump(id: String, x: i32, y: i32) -> Step {
    Step::Move {
        id,
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

/// A movement as a path (times from its first point) and how long it took;
/// nothing when it did not really go anywhere.
fn as_path(seg: &[PathPoint]) -> (Vec<PathPoint>, u32) {
    match (seg.first(), seg.last()) {
        (Some(a), Some(b)) if seg.len() > 1 && b.t > a.t => {
            (seg.iter().map(|p| PathPoint { x: p.x, y: p.y, t: p.t - a.t }).collect(), b.t - a.t)
        }
        _ => (Vec::new(), 0),
    }
}

/// The steps for `events`, in order.
pub fn to_steps(events: &[Rec], opts: Options) -> Vec<Step> {
    let n = events.len();

    // 1. Pair every press with its release. Auto-repeat (more downs of a
    //    held key) and releases of keys pressed before the recording are
    //    ignored.
    let mut ignored = vec![false; n];
    let mut up_of: Vec<Option<usize>> = vec![None; n];
    let mut down_of: Vec<Option<usize>> = vec![None; n];
    // When each held key was repeated by Windows, so the replay can repeat
    // it the same way.
    let mut repeats: Vec<Vec<u32>> = vec![Vec::new(); n];
    {
        let mut keys_open: Vec<(u16, usize)> = Vec::new();
        let mut buttons_open: Vec<(MouseButton, usize)> = Vec::new();
        for (i, e) in events.iter().enumerate() {
            match *e {
                Rec::Key { vk, down: true, t, .. } => match keys_open.iter().find(|k| k.0 == vk) {
                    // Windows repeating the key the user is holding.
                    Some(&(_, d)) => {
                        ignored[i] = true;
                        repeats[d].push(t);
                    }
                    None => keys_open.push((vk, i)),
                },
                Rec::Key { vk, down: false, .. } => match keys_open.iter().position(|k| k.0 == vk) {
                    Some(p) => {
                        let (_, d) = keys_open.remove(p);
                        up_of[d] = Some(i);
                        down_of[i] = Some(d);
                    }
                    None => ignored[i] = true,
                },
                Rec::Button { button, down: true, .. } => {
                    buttons_open.retain(|b| b.0 != button);
                    buttons_open.push((button, i));
                }
                Rec::Button { button, down: false, .. } => match buttons_open.iter().position(|b| b.0 == button) {
                    Some(p) => {
                        let (_, d) = buttons_open.remove(p);
                        up_of[d] = Some(i);
                        down_of[i] = Some(d);
                    }
                    None => ignored[i] = true,
                },
                _ => {}
            }
        }
    }
    let is_action = |i: usize| !ignored[i] && !matches!(events[i], Rec::Move { .. });

    // Where the cursor was before each event, as far as known.
    let mut pos_before: Vec<Option<(i32, i32)>> = vec![None; n];
    {
        let mut pos = None;
        for (i, e) in events.iter().enumerate() {
            pos_before[i] = pos;
            if let Rec::Button { x, y, .. } | Rec::Wheel { x, y, .. } | Rec::Move { x, y, .. } = *e {
                pos = Some((x, y));
            }
        }
    }
    // Did the mouse really move between events `d` and `u`?
    let moved = |d: usize, u: usize, from: Option<(i32, i32)>| {
        let mut reference = from;
        events[d + 1..u].iter().any(|e| match *e {
            Rec::Move { x, y, .. } => match reference {
                Some(r) => !near(r, (x, y)),
                None => {
                    reference = Some((x, y));
                    false
                }
            },
            _ => false,
        })
    };

    // 2. One step or two: a press is one step (a click, a key press) when
    //    nothing else happened before its release.
    let mut compact = vec![false; n];
    for d in 0..n {
        let Some(u) = up_of[d] else { continue };
        let quiet = !(d + 1..u).any(is_action);
        compact[d] = quiet
            && match events[d] {
                Rec::Button { x, y, .. } => {
                    let Rec::Button { x: ux, y: uy, .. } = events[u] else { continue };
                    near((x, y), (ux, uy)) && !moved(d, u, Some((x, y)))
                }
                _ => !moved(d, u, pos_before[d]),
            };
    }

    // A modifier is not folded into the step it surrounds: Ctrl held around
    // C becomes "hold Ctrl", "press C", "release Ctrl", each at the moment it
    // happened, which is what the user did. (Folding moved the press and the
    // release to right around the key, tens of milliseconds out.)

    // When the next thing happens after event `i`.
    let next_after = |i: usize| (i + 1..n).find(|&j| !ignored[j]).map(|j| time_of(&events[j]));
    // A click's rest after its press or release at `at` (event `i`): until
    // the next thing happens when that is too soon for a Wait step, else
    // nothing (the Wait is the rest). `None` when nothing follows: the rest
    // before serves both sides, as for any click.
    let dwell_after = |i: usize, at: u32| {
        next_after(i).map(|next| match next.saturating_sub(at) {
            gap if gap < MIN_WAIT_MS => gap,
            _ => 0,
        })
    };

    // 4. Walk the recording: steps in order, movement as paths and moves.
    let mut acts: Vec<Act> = Vec::new();
    let mut seg: Vec<PathPoint> = Vec::new();
    let mut last_pos: Option<(i32, i32)> = None;
    let mut ids = 0usize;
    let mut next_id = || {
        ids += 1;
        ids
    };
    // Movement that is not the way to a click: a Move step of its own.
    let flush = |seg: &mut Vec<PathPoint>, acts: &mut Vec<Act>, last_pos: &mut Option<(i32, i32)>, nid: usize| {
        let (Some(a), Some(b)) = (seg.first().copied(), seg.last().copied()) else { return };
        let went = (seg.len() > 1 && b.t > a.t) || last_pos.is_none_or(|p| !near(p, (b.x, b.y)));
        if went && seg.iter().any(|p| !near((p.x, p.y), (a.x, a.y)) || last_pos.is_none_or(|q| !near(q, (p.x, p.y)))) {
            let (path, travel) = as_path(seg);
            acts.push(Act {
                start: a.t,
                finish: b.t,
                step: Step::Move {
                    id: id(nid),
                    shuffle: false,
                    x: b.x,
                    y: b.y,
                    anchor: Anchor::Fixed,
                    dx: 0,
                    dy: 0,
                    coord_jitter_px: 0,
                    move_duration_ms: travel,
                    path,
                    capture: None,
                },
            });
        }
        *last_pos = Some((b.x, b.y));
        seg.clear();
    };
    // The movement reaching event `i` without a rest: the way to it.
    let reach = |seg: &mut Vec<PathPoint>, t: u32| -> Option<(Vec<PathPoint>, u32, u32)> {
        let last = seg.last().copied()?;
        if t.saturating_sub(last.t) >= IDLE_MS {
            return None;
        }
        let (path, travel) = as_path(seg);
        if travel == 0 {
            return None;
        }
        seg.clear();
        Some((path, travel, t - last.t))
    };

    // Indices inside a one-step click: tiny movement there is no movement.
    let mut in_click = vec![false; n];
    for d in 0..n {
        if let (true, Some(u), Rec::Button { .. }) = (compact[d], up_of[d], events[d]) {
            for flag in &mut in_click[d + 1..u] {
                *flag = true;
            }
        }
    }

    for (i, e) in events.iter().enumerate() {
        match *e {
            Rec::Move { x, y, t } => {
                if in_click[i] {
                    continue;
                }
                // The first thing in the recording: put the cursor where it
                // was when recording started, so the movement after it goes
                // the way it went instead of being bent from elsewhere.
                if last_pos.is_none() && seg.is_empty() {
                    acts.push(Act { start: t, finish: t, step: jump(id(next_id()), x, y) });
                    last_pos = Some((x, y));
                }
                if seg.last().is_some_and(|p| t.saturating_sub(p.t) >= IDLE_MS) {
                    let nid = next_id();
                    flush(&mut seg, &mut acts, &mut last_pos, nid);
                }
                seg.push(PathPoint { x, y, t });
            }
            _ if ignored[i] => {}
            Rec::Button { button, down: true, x, y, t } => {
                let way = reach(&mut seg, t);
                if way.is_none() {
                    let nid = next_id();
                    flush(&mut seg, &mut acts, &mut last_pos, nid);
                }
                let (path, travel, rest) = way.unwrap_or((Vec::new(), 0, 0));
                last_pos = Some((x, y));
                match up_of[i] {
                    Some(u) if compact[i] => {
                        let up = time_of(&events[u]);
                        let dwell = dwell_after(u, up);
                        let step = click(next_id(), (x, y), button, ClickAction::Click, up - t, (rest, dwell), Vec::new(), (path, travel));
                        acts.push(Act { start: t.saturating_sub(travel + rest), finish: up + dwell.unwrap_or(rest), step });
                    }
                    _ => {
                        let dwell = dwell_after(i, t);
                        let step = click(next_id(), (x, y), button, ClickAction::Down, 0, (rest, dwell), Vec::new(), (path, travel));
                        acts.push(Act { start: t.saturating_sub(travel + rest), finish: t + dwell.unwrap_or(rest), step });
                    }
                }
            }
            Rec::Button { button, down: false, x, y, t } => {
                let Some(d) = down_of[i] else { continue };
                if compact[d] {
                    continue;
                }
                let way = reach(&mut seg, t);
                if way.is_none() {
                    let nid = next_id();
                    flush(&mut seg, &mut acts, &mut last_pos, nid);
                }
                let (path, travel, rest) = match way {
                    Some(w) => w,
                    // No movement caught: glide there for as long as the drag took.
                    None if last_pos.is_some_and(|p| !near(p, (x, y))) => {
                        (Vec::new(), t.saturating_sub(time_of(&events[d])).min(MAX_GLIDE_MS), 0)
                    }
                    None => (Vec::new(), 0, 0),
                };
                last_pos = Some((x, y));
                let dwell = dwell_after(i, t);
                let step = click(next_id(), (x, y), button, ClickAction::Up, 0, (rest, dwell), Vec::new(), (path, travel));
                acts.push(Act { start: t.saturating_sub(travel + rest), finish: t + dwell.unwrap_or(rest), step });
            }
            Rec::Key { vk, scan, extended, down: true, t } => {
                let nid = next_id();
                flush(&mut seg, &mut acts, &mut last_pos, nid);
                let k = (vk, scan, extended);
                match up_of[i] {
                    Some(u) if compact[i] => {
                        let up = time_of(&events[u]);
                        let r = key_repeat(t, &repeats[i]);
                        acts.push(Act { start: t, finish: up, step: key_step(next_id(), k, KeyAction::Press, up - t, r) });
                    }
                    // Held through other things: it repeats while it is down.
                    _ => {
                        let r = key_repeat(t, &repeats[i]);
                        acts.push(Act { start: t, finish: t, step: key_step(next_id(), k, KeyAction::Down, 0, r) });
                    }
                }
            }
            Rec::Key { vk, scan, extended, down: false, t } => {
                if down_of[i].is_some_and(|d| compact[d]) {
                    continue;
                }
                let nid = next_id();
                flush(&mut seg, &mut acts, &mut last_pos, nid);
                acts.push(Act { start: t, finish: t, step: key_step(next_id(), (vk, scan, extended), KeyAction::Up, 0, None) });
            }
            Rec::Wheel { axis, delta, x, y, t } => {
                let nid = next_id();
                flush(&mut seg, &mut acts, &mut last_pos, nid);
                last_pos = Some((x, y));
                // Turns in a row are one scroll, each kept with its own
                // moment so the replay turns the wheel as the user did.
                if let Some(prev) = acts.last_mut() {
                    let (since, from) = (t.saturating_sub(prev.finish), prev.start);
                    if let Step::Scroll { amount, axis: pa, at: Some((px, py)), ticks, .. } = &mut prev.step {
                        if *pa == axis && since <= WHEEL_JOIN_MS && near((*px, *py), (x, y)) {
                            ticks.push(WheelTick { t: t.saturating_sub(from), delta });
                            *amount = notches(ticks.iter().map(|k| k.delta).sum());
                            prev.finish = t;
                            continue;
                        }
                    }
                }
                acts.push(Act {
                    start: t,
                    finish: t,
                    step: Step::Scroll {
                        id: id(next_id()),
                        shuffle: false,
                        amount: notches(delta),
                        axis,
                        at: Some((x, y)),
                        ticks: vec![WheelTick { t: 0, delta }],
                    },
                });
            }
        }
    }
    // Movement after the last action (to the Stop button) is left out.

    // 5. The waits: the time from one step being done to the next starting,
    //    to the millisecond. (A click's short rests are its own, so short
    //    waits are rare; carrying them into the next wait instead made every
    //    step until then run early.)
    let mut steps = Vec::new();
    let mut done: Option<u32> = None;
    for a in acts {
        if let (true, Some(prev)) = (opts.keep_timing, done) {
            let gap = a.start.saturating_sub(prev);
            if gap > 0 {
                steps.push(Step::Wait { id: id(steps.len() + 10_000), shuffle: false, ms: Jitter::exact(gap) });
            }
        }
        done = Some(done.map_or(a.finish, |d| d.max(a.finish)));
        steps.push(a.step);
    }
    steps
}

#[cfg(test)]
mod tests {
    use super::*;

    const TIMED: Options = Options { keep_timing: true };
    const UNTIMED: Options = Options { keep_timing: false };

    fn btn(down: bool, x: i32, y: i32, t: u32) -> Rec {
        Rec::Button { button: MouseButton::Left, down, x, y, t }
    }

    fn key(vk: u16, down: bool, t: u32) -> Rec {
        Rec::Key { vk, scan: 0x1E, extended: false, down, t }
    }

    fn lshift(down: bool, t: u32) -> Rec {
        Rec::Key { vk: 0xA0, scan: 0x2A, extended: false, down, t }
    }

    fn mv(x: i32, y: i32, t: u32) -> Rec {
        Rec::Move { x, y, t }
    }

    fn kinds(steps: &[Step]) -> Vec<String> {
        steps
            .iter()
            .map(|s| match s {
                Step::Click { action, x, y, modifiers, .. } if modifiers.is_empty() => format!("{action:?} {x},{y}"),
                Step::Click { action, x, y, modifiers, .. } => format!("{action:?} {modifiers:?} {x},{y}"),
                Step::Key { key, modifiers, action: KeyAction::Press, .. } => format!("key {modifiers:?}{}", key.label),
                Step::Key { key, action: KeyAction::Down, .. } => format!("hold {}", key.label),
                Step::Key { key, action: KeyAction::Up, .. } => format!("release {}", key.label),
                Step::Wait { ms, .. } => format!("wait {}", ms.base),
                Step::Scroll { amount, .. } => format!("scroll {amount}"),
                Step::Move { x, y, .. } => format!("move {x},{y}"),
                other => format!("{other:?}"),
            })
            .collect()
    }

    fn path_of(s: &Step) -> (&[PathPoint], u32) {
        match s {
            Step::Click { path, move_duration_ms, .. } | Step::Move { path, move_duration_ms, .. } => (path, *move_duration_ms),
            other => panic!("no path on {other:?}"),
        }
    }

    fn hold_of(s: &Step) -> u32 {
        match s {
            Step::Click { hold_ms, .. } | Step::Key { hold_ms, .. } => hold_ms.base,
            other => panic!("no hold on {other:?}"),
        }
    }

    #[test]
    fn clicks_keep_their_hold_and_the_pauses_between_them_exactly() {
        let s = to_steps(&[btn(true, 10, 20, 1000), btn(false, 11, 21, 1060), btn(true, 300, 40, 1803), btn(false, 300, 40, 1850)], TIMED);
        assert_eq!(kinds(&s), ["Click 10,20", "wait 743", "Click 300,40"]);
        assert_eq!(hold_of(&s[0]), 60);
        // No settle of its own: the recorded timing already has the pauses.
        assert!(matches!(&s[0], Step::Click { settle_ms, .. } if settle_ms.base == 0 && settle_ms.jitter == 0));
    }

    #[test]
    fn without_timing_there_are_no_waits() {
        let s = to_steps(&[btn(true, 1, 1, 0), btn(false, 1, 1, 50), btn(true, 9, 9, 5000), btn(false, 9, 9, 5050)], UNTIMED);
        assert_eq!(kinds(&s), ["Click 1,1", "Click 9,9"]);
    }

    #[test]
    fn two_quick_clicks_stay_two_clicks_with_their_own_timing() {
        let s = to_steps(&[btn(true, 5, 5, 0), btn(false, 5, 5, 40), btn(true, 6, 5, 200), btn(false, 6, 5, 240)], TIMED);
        assert_eq!(kinds(&s), ["Click 5,5", "wait 160", "Click 6,5"]);
    }

    #[test]
    fn a_long_pause_is_kept_as_it_was() {
        let s = to_steps(&[btn(true, 1, 1, 0), btn(false, 1, 1, 10), btn(true, 1, 90, 60_010), btn(false, 1, 90, 60_020)], TIMED);
        assert_eq!(kinds(&s), ["Click 1,1", "wait 60000", "Click 1,90"]);
    }

    #[test]
    fn a_key_keeps_its_whole_hold_however_long() {
        let s = to_steps(&[key(0x41, true, 0), key(0x41, true, 500), key(0x41, true, 530), key(0x41, false, 3000)], TIMED);
        assert_eq!(kinds(&s), ["key []A"]);
        assert_eq!(hold_of(&s[0]), 3000, "held from the first down to the up");
    }

    #[test]
    fn a_release_from_before_the_recording_is_ignored() {
        let s = to_steps(&[key(0x41, false, 0), key(0x42, true, 10), key(0x42, false, 90)], UNTIMED);
        assert_eq!(kinds(&s), ["key []B"]);
    }

    #[test]
    fn a_key_held_while_clicking_is_held_and_released_around_the_clicks() {
        let s = to_steps(&[key(0x57, true, 0), btn(true, 5, 5, 500), btn(false, 5, 5, 550), key(0x57, false, 1000)], TIMED);
        assert_eq!(kinds(&s), ["hold W", "wait 500", "Click 5,5", "wait 450", "release W"]);
    }

    #[test]
    fn a_key_held_while_the_mouse_moves_is_held_through_the_move() {
        // Regression: the key's auto-repeat threw away the movement.
        let s = to_steps(
            &[key(0x57, true, 0), mv(10, 0, 100), key(0x57, true, 130), mv(50, 0, 200), key(0x57, false, 300)],
            TIMED,
        );
        assert_eq!(kinds(&s), ["hold W", "wait 100", "move 10,0", "move 50,0", "wait 100", "release W"]);
        assert_eq!(path_of(&s[3]), (&[PathPoint { x: 10, y: 0, t: 0 }, PathPoint { x: 50, y: 0, t: 100 }][..], 100));
    }

    #[test]
    fn a_shift_click_holds_shift_down_and_releases_it_when_you_did() {
        let s = to_steps(&[lshift(true, 0), lshift(true, 40), btn(true, 3, 3, 100), btn(false, 3, 3, 140), lshift(false, 200)], TIMED);
        assert_eq!(kinds(&s), ["hold LShift", "wait 100", "Click 3,3", "wait 60", "release LShift"]);
    }

    #[test]
    fn ctrl_c_holds_ctrl_around_c_at_the_moments_you_pressed_them() {
        let s = to_steps(&[key(0x11, true, 0), key(0x43, true, 20), key(0x43, false, 70), key(0x11, false, 90), key(0x41, true, 500), key(0x41, false, 540)], TIMED);
        assert_eq!(kinds(&s), ["hold Ctrl", "wait 20", "key []C", "wait 20", "release Ctrl", "wait 410", "key []A"]);
    }

    #[test]
    fn ctrl_shift_s_holds_both_in_the_order_you_pressed_them() {
        let s = to_steps(&[key(0x11, true, 0), lshift(true, 10), key(0x53, true, 30), key(0x53, false, 60), lshift(false, 70), key(0x11, false, 80)], UNTIMED);
        assert_eq!(kinds(&s), ["hold Ctrl", "hold LShift", "key []S", "release LShift", "release Ctrl"]);
    }

    fn repeat_of(s: &Step) -> Option<KeyRepeat> {
        match s {
            Step::Key { repeat, .. } => *repeat,
            other => panic!("not a key: {other:?}"),
        }
    }

    #[test]
    fn a_held_key_repeats_as_it_did() {
        let s = to_steps(&[key(0x41, true, 0), key(0x41, true, 500), key(0x41, true, 533), key(0x41, true, 566), key(0x41, true, 600), key(0x41, false, 620)], UNTIMED);
        assert_eq!(repeat_of(&s[0]), Some(KeyRepeat { delay_ms: 500, every_ms: 33 }));
        // Released before it repeated: no repeat.
        let s = to_steps(&[key(0x41, true, 0), key(0x41, false, 90)], UNTIMED);
        assert_eq!(repeat_of(&s[0]), None);
        // Repeated once: the usual pace after it.
        let s = to_steps(&[key(0x41, true, 0), key(0x41, true, 400), key(0x41, false, 420)], UNTIMED);
        assert_eq!(repeat_of(&s[0]), Some(KeyRepeat { delay_ms: 400, every_ms: 33 }));
    }

    #[test]
    fn a_key_held_through_other_actions_repeats_on_its_hold_step() {
        let s = to_steps(&[key(0x57, true, 0), key(0x57, true, 300), btn(true, 5, 5, 320), btn(false, 5, 5, 350), key(0x57, true, 340), key(0x57, false, 400)], UNTIMED);
        assert_eq!(kinds(&s), ["hold W", "Click 5,5", "release W"]);
        assert_eq!(repeat_of(&s[0]), Some(KeyRepeat { delay_ms: 300, every_ms: 40 }));
    }

    #[test]
    fn shift_held_across_two_clicks_is_held_and_released() {
        let s = to_steps(
            &[lshift(true, 0), btn(true, 1, 1, 100), btn(false, 1, 1, 130), btn(true, 9, 9, 300), btn(false, 9, 9, 330), lshift(false, 400)],
            UNTIMED,
        );
        assert_eq!(kinds(&s), ["hold LShift", "Click 1,1", "Click 9,9", "release LShift"]);
    }

    #[test]
    fn the_way_the_mouse_went_to_a_click_is_its_path() {
        let s = to_steps(
            &[btn(true, 0, 0, 0), btn(false, 0, 0, 50), mv(10, 5, 300), mv(50, 20, 500), mv(100, 40, 700), btn(true, 100, 40, 760), btn(false, 100, 40, 800)],
            TIMED,
        );
        // The travel starts when the mouse set off (300), and the 60 ms it
        // rested on the target before the press is the click's settle.
        assert_eq!(kinds(&s), ["Click 0,0", "wait 250", "Click 100,40"]);
        assert!(matches!(&s[2], Step::Click { settle_ms, .. } if settle_ms.base == 60));
        assert_eq!(
            path_of(&s[2]),
            (&[PathPoint { x: 10, y: 5, t: 0 }, PathPoint { x: 50, y: 20, t: 200 }, PathPoint { x: 100, y: 40, t: 400 }][..], 400)
        );
        assert_eq!(path_of(&s[0]), (&[][..], 0));
    }

    #[test]
    fn a_recording_that_starts_with_movement_starts_where_the_mouse_was() {
        let s = to_steps(&[mv(10, 10, 0), mv(60, 30, 100), lshift(true, 120), btn(true, 60, 30, 160), btn(false, 60, 30, 200), lshift(false, 250)], UNTIMED);
        assert_eq!(kinds(&s), ["move 10,10", "move 60,30", "hold LShift", "Click 60,30", "release LShift"]);
        assert_eq!(path_of(&s[0]), (&[][..], 0), "a jump to the start");
        assert_eq!(path_of(&s[1]).1, 100);
    }

    #[test]
    fn resting_on_the_target_before_clicking_is_a_move_then_a_pause() {
        let s = to_steps(&[mv(10, 5, 300), mv(50, 20, 500), mv(100, 40, 700), btn(true, 100, 40, 1500), btn(false, 100, 40, 1540)], TIMED);
        assert_eq!(kinds(&s), ["move 10,5", "move 100,40", "wait 800", "Click 100,40"]);
        assert_eq!(path_of(&s[1]).1, 400);
        assert_eq!(path_of(&s[3]), (&[][..], 0));
    }

    #[test]
    fn stopping_halfway_makes_two_moves_with_the_pause_between() {
        let s = to_steps(&[mv(0, 0, 0), mv(50, 0, 100), mv(60, 0, 1100), mv(100, 0, 1200), btn(true, 100, 0, 1220), btn(false, 100, 0, 1250)], TIMED);
        assert_eq!(kinds(&s), ["move 0,0", "move 50,0", "wait 1000", "Click 100,0"]);
        assert_eq!(path_of(&s[3]).1, 100);
    }

    #[test]
    fn moving_after_the_last_action_is_left_out() {
        let s = to_steps(&[btn(true, 1, 1, 0), btn(false, 1, 1, 30), mv(500, 500, 400), mv(900, 900, 600)], TIMED);
        assert_eq!(kinds(&s), ["Click 1,1"]);
    }

    #[test]
    fn a_drag_follows_the_way_it_went() {
        let s = to_steps(&[btn(true, 10, 10, 0), mv(50, 10, 100), mv(200, 50, 300), btn(false, 200, 50, 400)], TIMED);
        // The drag sets off at 100, as it did, and rests 100 ms before the release.
        assert_eq!(kinds(&s), ["Down 10,10", "wait 100", "Up 200,50"]);
        assert_eq!(path_of(&s[2]), (&[PathPoint { x: 50, y: 10, t: 0 }, PathPoint { x: 200, y: 50, t: 200 }][..], 200));
    }

    #[test]
    fn a_drag_without_movement_caught_glides_for_its_length() {
        let s = to_steps(&[btn(true, 10, 10, 0), btn(false, 200, 50, 400)], TIMED);
        assert_eq!(kinds(&s), ["Down 10,10", "Up 200,50"]);
        assert_eq!(path_of(&s[1]), (&[][..], 400));
    }

    #[test]
    fn moving_before_a_key_press_is_a_move_first() {
        // Where the mouse is matters to a key press in many games.
        let s = to_steps(&[mv(1, 1, 0), mv(80, 80, 100), key(0x41, true, 150), key(0x41, false, 200)], TIMED);
        assert_eq!(kinds(&s), ["move 1,1", "move 80,80", "wait 50", "key []A"]);
    }

    fn wheel(delta: i32, t: u32) -> Rec {
        Rec::Wheel { axis: ScrollAxis::Vertical, delta, x: 50, y: 50, t }
    }

    fn ticks_of(s: &Step) -> Vec<(u32, i32)> {
        match s {
            Step::Scroll { ticks, .. } => ticks.iter().map(|k| (k.t, k.delta)).collect(),
            other => panic!("not a scroll: {other:?}"),
        }
    }

    #[test]
    fn wheel_turns_in_a_row_are_one_scroll_that_keeps_their_timing() {
        let s = to_steps(&[wheel(-120, 0), wheel(-120, 60), wheel(-120, 120), wheel(120, 1000)], TIMED);
        assert_eq!(kinds(&s), ["scroll -3", "wait 880", "scroll 1"]);
        assert_eq!(ticks_of(&s[0]), [(0, -120), (60, -120), (120, -120)]);
    }

    #[test]
    fn a_smooth_wheel_keeps_its_fractions_of_a_notch() {
        let s = to_steps(&[wheel(-30, 0), wheel(-30, 10), wheel(-30, 20), wheel(-30, 30), wheel(-15, 40)], UNTIMED);
        assert_eq!(kinds(&s), ["scroll -1"]);
        assert_eq!(ticks_of(&s[0]), [(0, -30), (10, -30), (20, -30), (30, -30), (40, -15)]);
    }

    fn rests_of(s: &Step) -> (u32, Option<u32>) {
        match s {
            Step::Click { settle_ms, dwell_ms, .. } => (settle_ms.base, dwell_ms.map(|d| d.base)),
            other => panic!("no rests on {other:?}"),
        }
    }

    /// Regression: one settle served both sides of a recorded click, so it
    /// was cut to the moment the mouse set off again after the release (0 to
    /// 5 ms for most clicks). The replay then moved later than the user did
    /// and arrived just as it pressed, where the user had rested first.
    #[test]
    fn a_click_rests_on_its_target_as_long_as_it_did_though_the_mouse_leaves_at_once() {
        let s = to_steps(
            &[mv(0, 0, 0), mv(50, 0, 30), mv(100, 0, 60), btn(true, 100, 0, 90), btn(false, 100, 0, 140), mv(120, 0, 142), mv(200, 0, 170), btn(true, 200, 0, 200), btn(false, 200, 0, 250)],
            TIMED,
        );
        assert_eq!(kinds(&s), ["move 0,0", "Click 100,0", "Click 200,0"]);
        // 30 ms on the target before the press, 2 after the release.
        assert_eq!(rests_of(&s[1]), (30, Some(2)));
        assert_eq!(path_of(&s[1]).1, 60);
        assert_eq!(path_of(&s[2]).1, 28);
        // Nothing after the last one: its rest serves both sides, as usual.
        assert_eq!(rests_of(&s[2]), (30, None));
    }

    /// Regression: gaps too small for a Wait step were carried into the next
    /// wait, so every step until then ran up to 14 ms early.
    #[test]
    fn a_gap_too_small_for_a_wait_is_the_clicks_rest_after_the_release() {
        let s = to_steps(&[btn(true, 1, 1, 0), btn(false, 1, 1, 10), btn(true, 1, 1, 20), btn(false, 1, 1, 30), btn(true, 1, 1, 70), btn(false, 1, 1, 80)], TIMED);
        assert_eq!(kinds(&s), ["Click 1,1", "Click 1,1", "wait 40", "Click 1,1"]);
        assert_eq!(rests_of(&s[0]), (0, Some(10)));
        assert_eq!(rests_of(&s[1]), (0, Some(0)));
    }

    #[test]
    fn a_small_gap_after_a_key_is_a_short_wait_of_its_own() {
        let s = to_steps(&[lshift(true, 0), btn(true, 1, 1, 6), btn(false, 1, 1, 40), lshift(false, 100)], TIMED);
        assert_eq!(kinds(&s), ["hold LShift", "wait 6", "Click 1,1", "wait 60", "release LShift"]);
    }

    #[test]
    fn a_key_still_down_when_recording_stops_is_left_held() {
        let s = to_steps(&[key(0x57, true, 0), key(0x57, true, 40)], UNTIMED);
        assert_eq!(kinds(&s), ["hold W"]);
    }

    #[test]
    fn nothing_recorded_is_no_steps() {
        assert!(to_steps(&[], TIMED).is_empty());
    }

    #[test]
    fn every_step_gets_its_own_id() {
        let s = to_steps(&[btn(true, 1, 1, 0), btn(false, 1, 1, 9), btn(true, 50, 1, 900), btn(false, 50, 1, 909)], TIMED);
        let mut ids: Vec<&str> = s.iter().map(|x| x.id()).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), s.len());
    }
}

#[cfg(test)]
mod replay {
    use super::*;
    use crate::engine::{CancelToken, Engine};
    use crate::input::fake::{Event, FakeInput};
    use std::sync::Arc;

    /// Regression: a replay drifted about 2 ms per click from its recording
    /// (74 ms late after 40 clicks), every late wake-up adding up. The engine
    /// now keeps the run's timeline (`Engine::plan`); measured within 1 ms.
    #[test]
    fn a_replay_keeps_the_recordings_timing() {
        // 25 clicks, each reached by a 60 ms movement, ~150 ms apart.
        let mut ev = Vec::new();
        let mut t = 0u32;
        let mut x = 100;
        for i in 0..25 {
            for k in 0..8 {
                ev.push(Rec::Move { x: x + k * 5, y: 200, t: t + k as u32 * 8 });
            }
            x += 40;
            t += 70;
            ev.push(Rec::Button { button: MouseButton::Left, down: true, x, y: 200, t });
            ev.push(Rec::Button { button: MouseButton::Left, down: false, x, y: 200, t: t + 30 + (i % 3) * 10 });
            t += 80;
        }
        let downs: Vec<u32> = ev.iter().filter_map(|e| match e { Rec::Button { down: true, t, .. } => Some(*t), _ => None }).collect();
        let steps = to_steps(&ev, Options { keep_timing: true });
        let f = Arc::new(FakeInput::with_cursor(100, 200));
        let mut e = Engine::new(f.clone(), Some(1));
        let mut m = crate::model::Macro::new("probe");
        m.steps = steps;
        e.run(&m, &CancelToken::new()).unwrap();
        let tl = f.timeline();
        let presses: Vec<std::time::Instant> = tl.iter().filter(|(_, e)| *e == Event::Button(MouseButton::Left, true)).map(|(i, _)| *i).collect();
        let t0 = presses[0];
        let errs: Vec<i64> = presses.iter().zip(&downs).map(|(p, d)| p.duration_since(t0).as_millis() as i64 - (*d - downs[0]) as i64).collect();
        assert_eq!(presses.len(), 25);
        // Generous for a busy machine; the drift this guards against was 74 ms.
        let worst = errs.iter().map(|e| e.abs()).max().unwrap_or(0);
        assert!(worst <= 15, "a press was {worst} ms off its recorded moment: {errs:?}");
    }

    /// Regression: the user rested on each target before clicking and set
    /// off again a moment after letting go. The replay rested only that
    /// moment before each press, so the cursor moved later than the user did
    /// and arrived just as it clicked.
    #[test]
    fn a_replay_rests_on_each_target_and_leaves_it_as_the_user_did() {
        // 8 clicks: 40 ms of movement, 25 ms on the target, a 50 ms press,
        // then off again 1 ms after the release.
        let mut ev = Vec::new();
        let mut t = 0u32;
        for i in 0..8 {
            let x = 100 + i * 60;
            for k in 0..=8 {
                ev.push(Rec::Move { x: x - 40 + k * 5, y: 300, t: t + k as u32 * 5 });
            }
            t += 40 + 25;
            ev.push(Rec::Button { button: MouseButton::Left, down: true, x, y: 300, t });
            t += 50;
            ev.push(Rec::Button { button: MouseButton::Left, down: false, x, y: 300, t });
            t += 1;
        }
        let f = Arc::new(FakeInput::with_cursor(0, 0));
        let mut e = Engine::new(f.clone(), Some(1));
        let mut m = crate::model::Macro::new("probe");
        m.steps = to_steps(&ev, Options { keep_timing: true });
        e.run(&m, &CancelToken::new()).unwrap();
        let tl = f.timeline();
        let ms = |a: std::time::Instant, b: std::time::Instant| b.duration_since(a).as_secs_f64() * 1000.0;
        let mut rests = Vec::new();
        let mut leaves = Vec::new();
        for (i, (at, ev)) in tl.iter().enumerate() {
            match ev {
                Event::Button(_, true) => {
                    let arrived = tl[..i].iter().rev().find(|(_, e)| matches!(e, Event::Move(..))).map(|(a, _)| *a).unwrap();
                    rests.push(ms(arrived, *at));
                }
                Event::Button(_, false) => {
                    if let Some((left, _)) = tl[i..].iter().find(|(_, e)| matches!(e, Event::Move(..))) {
                        leaves.push(ms(*at, *left));
                    }
                }
                _ => {}
            }
        }
        assert_eq!(rests.len(), 8);
        assert!(rests.iter().all(|r| (24.0..30.0).contains(r)), "rested before the presses: {rests:?}");
        assert!(leaves.iter().all(|l| *l < 6.0), "left the targets after: {leaves:?}");
    }
}
