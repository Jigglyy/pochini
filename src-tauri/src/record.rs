//! Record mode: physical input captured by the hooks, turned into steps.
//!
//! While the user records, the keyboard hook and a mouse hook report every
//! key, button and wheel event that is not injected (ours or another
//! tool's) as a `Rec`, with the system's millisecond timestamp. Nothing is
//! written anywhere: the events live in memory until `to_steps` turns them
//! into the steps the user then sees and edits, and are dropped.
//!
//! The conversion is pure, so every rule here is unit-tested:
//! - a press and release on the same spot is a click (two quick ones, a
//!   double click); a press here and a release there is a drag (press,
//!   move, release);
//! - a key pressed with Ctrl, Alt, Shift or Win held is one Key step with
//!   those modifiers; a click made while holding them holds them too;
//! - wheel notches in a row are one scroll;
//! - the pauses between actions become Wait steps (optional).

use serde::{Deserialize, Serialize};

use crate::input::keys;
use crate::model::{Anchor, ClickAction, Jitter, KeyAction, KeyRef, Modifier, MouseButton, ScrollAxis, Step};

/// One captured event. `t` is the system tick in milliseconds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Rec {
    Key { vk: u16, scan: u16, extended: bool, down: bool, t: u32 },
    Button { button: MouseButton, down: bool, x: i32, y: i32, t: u32 },
    Wheel { axis: ScrollAxis, notches: i32, x: i32, y: i32, t: u32 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Options {
    /// Insert Wait steps for the pauses between actions.
    pub keep_timing: bool,
}

/// A press and release this close (px) count as a click, not a drag.
const CLICK_SLOP: i32 = 4;
/// Two clicks this close in time (ms, release to press) make a double click.
const DOUBLE_MS: u32 = 450;
/// Pauses shorter than this are not worth a Wait step.
const MIN_WAIT_MS: u32 = 30;
/// Wheel notches this close together (ms) are one scroll.
const WHEEL_JOIN_MS: u32 = 200;
/// A longer pause (the user looking for the next thing) becomes this long a
/// wait: recorded thinking time is rarely wanted on replay.
const MAX_WAIT_MS: u32 = 10_000;

/// An action with when it started and ended, before the waits go in.
struct Act {
    start: u32,
    end: u32,
    step: Step,
}

fn modifier_of(vk: u16) -> Option<Modifier> {
    keys::modifier_for_vk(vk)
}

fn id(n: usize) -> String {
    format!("rec-{}-{n}", ulid::Ulid::new())
}

fn near(a: (i32, i32), b: (i32, i32)) -> bool {
    (a.0 - b.0).abs() <= CLICK_SLOP && (a.1 - b.1).abs() <= CLICK_SLOP
}

fn click(n: usize, x: i32, y: i32, button: MouseButton, action: ClickAction, hold: u32, modifiers: Vec<Modifier>) -> Step {
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
        hold_ms: Jitter::exact(hold.clamp(10, 1_000)),
        settle_ms: Jitter::exact(40),
        move_duration_ms: 0,
        modifiers,
        held_key: None,
        capture: None,
    }
}

/// The steps for `events`, in order.
pub fn to_steps(events: &[Rec], opts: Options) -> Vec<Step> {
    let mut acts: Vec<Act> = Vec::new();
    let mut mods: Vec<Modifier> = Vec::new();
    // Keys and buttons pressed during the recording and not yet released.
    let mut keys_down: Vec<(u16, u16, bool, u32, Vec<Modifier>)> = Vec::new();
    let mut buttons_down: Vec<(MouseButton, i32, i32, u32, Vec<Modifier>)> = Vec::new();
    let mut n = 0usize;
    let mut next_id = || {
        n += 1;
        n
    };

    for e in events {
        match *e {
            Rec::Key { vk, scan, extended, down, t } => {
                if let Some(m) = modifier_of(vk) {
                    if down && !mods.contains(&m) {
                        mods.push(m);
                    } else if !down {
                        mods.retain(|x| *x != m);
                    }
                    continue;
                }
                if down {
                    // Auto-repeat sends more downs: the first one counts.
                    if !keys_down.iter().any(|k| k.0 == vk) {
                        keys_down.push((vk, scan, extended, t, mods.clone()));
                    }
                } else if let Some(i) = keys_down.iter().position(|k| k.0 == vk) {
                    let (vk, scan, extended, at, held) = keys_down.remove(i);
                    let key = KeyRef { vk, scancode: scan, extended, label: keys::label_for_vk(vk) };
                    acts.push(Act {
                        start: at,
                        end: t,
                        step: Step::Key {
                            id: id(next_id()),
                            shuffle: false,
                            key,
                            action: KeyAction::Press,
                            modifiers: held,
                            hold_ms: Jitter::exact(t.saturating_sub(at).clamp(10, 1_000)),
                        },
                    });
                }
                // A release without a press began before the recording.
            }
            Rec::Button { button, down, x, y, t } => {
                if down {
                    buttons_down.retain(|b| b.0 != button);
                    buttons_down.push((button, x, y, t, mods.clone()));
                    continue;
                }
                let Some(i) = buttons_down.iter().position(|b| b.0 == button) else {
                    continue;
                };
                let (_, bx, by, at, held) = buttons_down.remove(i);
                if near((bx, by), (x, y)) {
                    // A second quick click on the same spot: a double click.
                    if let Some(prev) = acts.last_mut() {
                        if let Step::Click { x: px, y: py, button: pb, action: pa @ ClickAction::Click, .. } = &mut prev.step {
                            if *pb == button && near((*px, *py), (bx, by)) && at.saturating_sub(prev.end) <= DOUBLE_MS {
                                *pa = ClickAction::Double;
                                prev.end = t;
                                continue;
                            }
                        }
                    }
                    let step = click(next_id(), bx, by, button, ClickAction::Click, t.saturating_sub(at), held);
                    acts.push(Act { start: at, end: t, step });
                } else {
                    // A drag: press here, travel, release there.
                    let travel = t.saturating_sub(at).min(2_000);
                    acts.push(Act { start: at, end: at, step: click(next_id(), bx, by, button, ClickAction::Down, 10, held.clone()) });
                    let mut up = click(next_id(), x, y, button, ClickAction::Up, 10, held);
                    if let Step::Click { move_duration_ms, .. } = &mut up {
                        *move_duration_ms = travel;
                    }
                    acts.push(Act { start: at, end: t, step: up });
                }
            }
            Rec::Wheel { axis, notches, x, y, t } => {
                if let Some(prev) = acts.last_mut() {
                    if let Step::Scroll { amount, axis: pa, at: Some((px, py)), .. } = &mut prev.step {
                        if *pa == axis && t.saturating_sub(prev.end) <= WHEEL_JOIN_MS && near((*px, *py), (x, y)) {
                            *amount = amount.saturating_add(notches);
                            prev.end = t;
                            continue;
                        }
                    }
                }
                acts.push(Act {
                    start: t,
                    end: t,
                    step: Step::Scroll { id: id(next_id()), shuffle: false, amount: notches, axis, at: Some((x, y)) },
                });
            }
        }
    }

    acts.sort_by_key(|a| a.start);
    let mut steps = Vec::new();
    let mut last_end: Option<u32> = None;
    for a in acts {
        if let (true, Some(prev)) = (opts.keep_timing, last_end) {
            let gap = a.start.saturating_sub(prev);
            if gap >= MIN_WAIT_MS {
                // Rounded to 10 ms, which reads better and is within timer noise.
                let ms = (gap + 5) / 10 * 10;
                steps.push(Step::Wait { id: id(steps.len() + 10_000), shuffle: false, ms: Jitter::exact(ms.min(MAX_WAIT_MS)) });
            }
        }
        last_end = Some(last_end.map_or(a.end, |e| e.max(a.end)));
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

    fn kinds(steps: &[Step]) -> Vec<String> {
        steps
            .iter()
            .map(|s| match s {
                Step::Click { action, x, y, .. } => format!("{action:?} {x},{y}"),
                Step::Key { key, modifiers, .. } => format!("key {modifiers:?}{}", key.label),
                Step::Wait { ms, .. } => format!("wait {}", ms.base),
                Step::Scroll { amount, .. } => format!("scroll {amount}"),
                other => format!("{other:?}"),
            })
            .collect()
    }

    #[test]
    fn a_press_and_release_on_one_spot_is_a_click_and_pauses_become_waits() {
        let s = to_steps(&[btn(true, 10, 20, 1000), btn(false, 11, 21, 1060), btn(true, 300, 40, 1800), btn(false, 300, 40, 1850)], TIMED);
        assert_eq!(kinds(&s), ["Click 10,20", "wait 740", "Click 300,40"]);
        if let Step::Click { hold_ms, .. } = &s[0] {
            assert_eq!(hold_ms.base, 60, "the recorded hold");
        }
    }

    #[test]
    fn without_timing_there_are_no_waits() {
        let s = to_steps(&[btn(true, 1, 1, 0), btn(false, 1, 1, 50), btn(true, 9, 9, 5000), btn(false, 9, 9, 5050)], UNTIMED);
        assert_eq!(kinds(&s), ["Click 1,1", "Click 9,9"]);
    }

    #[test]
    fn two_quick_clicks_on_one_spot_are_a_double_click() {
        let s = to_steps(&[btn(true, 5, 5, 0), btn(false, 5, 5, 40), btn(true, 6, 5, 200), btn(false, 6, 5, 240)], TIMED);
        assert_eq!(kinds(&s), ["Double 5,5"]);
        // Too slow for a double click: two clicks.
        let s = to_steps(&[btn(true, 5, 5, 0), btn(false, 5, 5, 40), btn(true, 5, 5, 900), btn(false, 5, 5, 940)], TIMED);
        assert_eq!(kinds(&s), ["Click 5,5", "wait 860", "Click 5,5"]);
    }

    #[test]
    fn a_press_here_and_release_there_is_a_drag() {
        let s = to_steps(&[btn(true, 10, 10, 0), btn(false, 200, 50, 400)], TIMED);
        assert_eq!(kinds(&s), ["Down 10,10", "Up 200,50"]);
        if let Step::Click { move_duration_ms, .. } = &s[1] {
            assert_eq!(*move_duration_ms, 400, "the drag takes as long as it did");
        }
    }

    #[test]
    fn keys_carry_the_modifiers_held_with_them() {
        // Ctrl down, C down/up, Ctrl up, then A alone.
        let s = to_steps(&[key(0x11, true, 0), key(0x43, true, 20), key(0x43, false, 70), key(0x11, false, 90), key(0x41, true, 500), key(0x41, false, 540)], TIMED);
        assert_eq!(kinds(&s), ["key [Ctrl]C", "wait 430", "key []A"]);
    }

    #[test]
    fn auto_repeat_is_one_press_and_a_key_released_before_recording_is_ignored() {
        let s = to_steps(&[key(0x41, false, 0), key(0x42, true, 10), key(0x42, true, 40), key(0x42, true, 70), key(0x42, false, 90)], UNTIMED);
        assert_eq!(kinds(&s), ["key []B"]);
        if let Step::Key { hold_ms, .. } = &s[0] {
            assert_eq!(hold_ms.base, 80, "held from the first down to the up");
        }
    }

    #[test]
    fn a_shift_click_holds_shift() {
        let s = to_steps(&[key(0x10, true, 0), btn(true, 3, 3, 10), btn(false, 3, 3, 30), key(0x10, false, 50)], UNTIMED);
        match &s[..] {
            [Step::Click { modifiers, .. }] => assert_eq!(modifiers, &vec![Modifier::Shift]),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn wheel_notches_in_a_row_are_one_scroll() {
        let wheel = |n, t| Rec::Wheel { axis: ScrollAxis::Vertical, notches: n, x: 50, y: 50, t };
        let s = to_steps(&[wheel(-1, 0), wheel(-1, 60), wheel(-1, 120), wheel(1, 1000)], TIMED);
        assert_eq!(kinds(&s), ["scroll -3", "wait 880", "scroll 1"]);
    }

    #[test]
    fn a_long_pause_becomes_a_ten_second_wait() {
        let s = to_steps(&[btn(true, 1, 1, 0), btn(false, 1, 1, 10), btn(true, 1, 90, 60_000), btn(false, 1, 90, 60_010)], TIMED);
        assert_eq!(kinds(&s), ["Click 1,1", "wait 10000", "Click 1,90"]);
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
