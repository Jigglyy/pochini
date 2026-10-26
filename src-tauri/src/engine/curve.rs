//! The cursor's way between two points when it glides: how fast along the
//! way (minimum jerk) and, with a macro's `Feel::curve`, which way.

use rand::Rng;

use super::random;
use crate::input::VirtualRect;
use crate::model::{Bell, Curve, PathPoint};

/// How far along the way a hand is at `t` (0 to 1) of the time: the
/// minimum-jerk profile (Flash and Hogan, 1985) that reaching movements
/// follow, `10t³ − 15t⁴ + 6t⁵`. It sets off and arrives at rest, with no
/// sudden change of acceleration, and is fastest halfway.
pub fn min_jerk(t: f64) -> f64 {
    let t = t.clamp(0.0, 1.0);
    t * t * t * (10.0 + t * (-15.0 + 6.0 * t))
}

/// Shorter than this, a glide stays a straight line: there is no room to bend.
const MIN_BEND_PX: f64 = 8.0;
/// Shorter than this, a glide never overshoots.
const MIN_OVERSHOOT_PX: f64 = 40.0;
/// How many pieces the arc is measured in, to move along it evenly.
const ARC_SAMPLES: usize = 64;

type P = (f64, f64);

fn bezier([p0, p1, p2, p3]: [P; 4], u: f64) -> P {
    let v = 1.0 - u;
    let (a, b, c, d) = (v * v * v, 3.0 * v * v * u, 3.0 * v * u * u, u * u * u);
    (a * p0.0 + b * p1.0 + c * p2.0 + d * p3.0, a * p0.1 + b * p1.1 + c * p2.1 + d * p3.1)
}

/// The way a curved glide goes (`Feel::curve`), as points `t` ms after
/// setting off from `from`, about every 8 ms, the last exactly on `to` at
/// `duration_ms`. Replayed like a recorded path.
///
/// An arc: a cubic Bezier whose two control points sit on one side of the
/// straight line, a third and two thirds of the way along, each pushed off
/// it by half to all of `bend_pct` of the distance. It is travelled with
/// minimum-jerk timing over its length, so the hand's speed rises and falls
/// once. With overshoot, the arc ends a few pixels past `to` at 80% of the
/// time and a short straight correction comes back. Every point stays on
/// the desktop (`bounds`).
pub fn curve_path(
    from: (i32, i32),
    to: (i32, i32),
    duration_ms: u32,
    curve: Curve,
    bell: Option<Bell>,
    bounds: VirtualRect,
    rng: &mut impl Rng,
) -> Vec<PathPoint> {
    let start = (f64::from(from.0), f64::from(from.1));
    let end = (f64::from(to.0), f64::from(to.1));
    let (dx, dy) = (end.0 - start.0, end.1 - start.1);
    let len = dx.hypot(dy);

    // Where the way is at `tau` (0 to 1) of the time.
    let at: Box<dyn Fn(f64) -> P> = if len < MIN_BEND_PX {
        Box::new(move |tau| {
            let e = min_jerk(tau);
            (start.0 + dx * e, start.1 + dy * e)
        })
    } else {
        let over = curve.overshoot_pct > 0
            && len >= MIN_OVERSHOOT_PX
            && rng.gen_bool(f64::from(curve.overshoot_pct.min(100)) / 100.0);
        let (arc_end, arc_share) = if over {
            let past = (0.03 * len).clamp(3.0, 15.0) / len;
            ((end.0 + dx * past, end.1 + dy * past), 0.8)
        } else {
            (end, 1.0)
        };
        let (ax, ay) = (arc_end.0 - start.0, arc_end.1 - start.1);
        let alen = ax.hypot(ay);
        let normal = (-ay / alen, ax / alen);
        let side = if rng.gen_bool(0.5) { 1.0 } else { -1.0 };
        let most = alen * f64::from(curve.bend_pct.min(50)) / 100.0;
        let mut push = || side * most * (0.5 + 0.5 * random::unit(bell, rng));
        let (o1, o2) = (push(), push());
        let ctrl = [
            start,
            (start.0 + ax / 3.0 + normal.0 * o1, start.1 + ay / 3.0 + normal.1 * o1),
            (start.0 + ax * 2.0 / 3.0 + normal.0 * o2, start.1 + ay * 2.0 / 3.0 + normal.1 * o2),
            arc_end,
        ];
        // Length along the arc at each of ARC_SAMPLES + 1 even steps of u.
        let mut lengths = vec![0.0; ARC_SAMPLES + 1];
        let mut prev = start;
        for k in 1..=ARC_SAMPLES {
            let p = bezier(ctrl, k as f64 / ARC_SAMPLES as f64);
            lengths[k] = lengths[k - 1] + (p.0 - prev.0).hypot(p.1 - prev.1);
            prev = p;
        }
        let total = lengths[ARC_SAMPLES];
        Box::new(move |tau| {
            if tau > arc_share {
                // The correction back from past the target.
                let e = min_jerk((tau - arc_share) / (1.0 - arc_share));
                return (arc_end.0 + (end.0 - arc_end.0) * e, arc_end.1 + (end.1 - arc_end.1) * e);
            }
            let s = min_jerk(tau / arc_share) * total;
            let k = lengths.partition_point(|l| *l < s).clamp(1, ARC_SAMPLES);
            let piece = lengths[k] - lengths[k - 1];
            let within = if piece > 0.0 { (s - lengths[k - 1]) / piece } else { 0.0 };
            bezier(ctrl, (k as f64 - 1.0 + within.clamp(0.0, 1.0)) / ARC_SAMPLES as f64)
        })
    };

    let n = (duration_ms / 8).max(1);
    let mut points: Vec<PathPoint> = (0..=n)
        .map(|i| {
            let t = (f64::from(i) * f64::from(duration_ms) / f64::from(n)).round() as u32;
            let tau = if duration_ms == 0 { 1.0 } else { f64::from(t) / f64::from(duration_ms) };
            let (x, y) = at(tau);
            let (x, y) = bounds.clamp(x.round() as i32, y.round() as i32);
            PathPoint { x, y, t }
        })
        .collect();
    if let Some(last) = points.last_mut() {
        *last = PathPoint { x: to.0, y: to.1, t: duration_ms };
    }
    points
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::input::VirtualRect;
    use crate::model::{Curve, PathPoint};
    use rand::rngs::StdRng;
    use rand::SeedableRng;

    const WIDE: VirtualRect = VirtualRect { x: -1920, y: 0, w: 6400, h: 1440 };

    fn seeded(from: (i32, i32), to: (i32, i32), ms: u32, bend_pct: u8, overshoot_pct: u8, seed: u64) -> Vec<PathPoint> {
        let mut rng = StdRng::seed_from_u64(seed);
        curve_path(from, to, ms, Curve { bend_pct, overshoot_pct }, None, WIDE, &mut rng)
    }

    fn across(from: (i32, i32), to: (i32, i32), bend_pct: u8, overshoot_pct: u8) -> impl Iterator<Item = Vec<PathPoint>> {
        (0..20).map(move |seed| seeded(from, to, 400, bend_pct, overshoot_pct, seed))
    }

    const A: (i32, i32) = (100, 500);
    const B: (i32, i32) = (900, 500);

    #[test]
    fn a_curve_starts_and_ends_exactly() {
        for p in across(A, B, 10, 0) {
            assert_eq!(p[0], PathPoint { x: 100, y: 500, t: 0 });
            assert_eq!(p[p.len() - 1], PathPoint { x: 900, y: 500, t: 400 });
            assert!(p.windows(2).all(|w| w[1].t >= w[0].t));
        }
    }

    #[test]
    fn a_curve_bends_one_way_within_its_bend() {
        let mut sides = std::collections::HashSet::new();
        for p in across(A, B, 10, 0) {
            let off: Vec<i32> = p.iter().map(|q| q.y - 500).collect();
            assert!(off.iter().all(|o| o.abs() <= 81), "{off:?}");
            assert!(off.iter().map(|o| o.abs()).max().unwrap_or(0) >= 20, "{off:?}");
            assert!(off.iter().all(|o| *o >= 0) || off.iter().all(|o| *o <= 0), "an S: {off:?}");
            sides.insert(off.iter().sum::<i32>().signum());
        }
        assert_eq!(sides.len(), 2, "both sides turn up");
    }

    #[test]
    fn no_bend_is_a_straight_line() {
        for p in across(A, B, 0, 0) {
            assert!(p.iter().all(|q| q.y == 500));
        }
    }

    #[test]
    fn a_curve_is_slow_at_both_ends() {
        for p in across(A, B, 10, 0) {
            let d: Vec<f64> = p.windows(2).map(|w| f64::from(w[1].x - w[0].x).hypot(f64::from(w[1].y - w[0].y))).collect();
            let top = d.iter().cloned().fold(0.0, f64::max);
            let ends = d[..3].iter().chain(&d[d.len() - 3..]);
            assert!(ends.into_iter().all(|x| *x < top / 3.0), "{d:?}");
        }
    }

    #[test]
    fn overshoot_passes_the_target_and_comes_back() {
        for p in across(A, B, 10, 100) {
            assert!(p.iter().any(|q| (901..=916).contains(&q.x)), "no overshoot");
            assert_eq!(p[p.len() - 1], PathPoint { x: 900, y: 500, t: 400 });
        }
        for p in across(A, B, 10, 0) {
            assert!(p.iter().all(|q| q.x <= 900));
        }
    }

    #[test]
    fn no_distance_and_a_few_pixels_stay_straight() {
        for p in across(A, A, 30, 100) {
            assert!(p.iter().all(|q| (q.x, q.y) == A), "{p:?}");
            assert_eq!(p[p.len() - 1].t, 400);
        }
        for p in across(A, (105, 500), 30, 100) {
            assert!(p.iter().all(|q| q.y == 500 && (100..=105).contains(&q.x)), "{p:?}");
        }
    }

    #[test]
    fn a_tiny_travel_still_lands() {
        let p = seeded(A, B, 3, 10, 0, 1);
        assert!(p.len() >= 2);
        assert_eq!(p[p.len() - 1], PathPoint { x: 900, y: 500, t: 3 });
    }

    #[test]
    fn a_curve_stays_on_screen() {
        let screen = VirtualRect { x: 0, y: 0, w: 1920, h: 1080 };
        for seed in 0..20 {
            let mut rng = StdRng::seed_from_u64(seed);
            let p = curve_path((10, 1075), (1900, 1075), 400, Curve { bend_pct: 30, overshoot_pct: 100 }, None, screen, &mut rng);
            assert!(p.iter().all(|q| screen.contains(q.x, q.y)), "{p:?}");
        }
    }

    #[test]
    fn a_curve_on_a_left_monitor() {
        for p in across((-1800, 300), (-200, 300), 10, 0) {
            assert_eq!((p[0].x, p[0].y), (-1800, 300));
            assert_eq!((p[p.len() - 1].x, p[p.len() - 1].y), (-200, 300));
            assert!(p.iter().all(|q| WIDE.contains(q.x, q.y)));
        }
    }

    #[test]
    fn the_same_seed_makes_the_same_path() {
        assert_eq!(seeded(A, B, 400, 20, 50, 3), seeded(A, B, 400, 20, 50, 3));
        assert_ne!(seeded(A, B, 400, 20, 50, 3), seeded(A, B, 400, 20, 50, 4));
    }

    #[test]
    fn min_jerk_starts_and_ends_at_rest() {
        assert_eq!(min_jerk(0.0), 0.0);
        assert_eq!(min_jerk(1.0), 1.0);
        assert!((min_jerk(0.5) - 0.5).abs() < 1e-12);
        assert!(min_jerk(0.05) < 0.002);
        assert!(1.0 - min_jerk(0.95) < 0.002);
        let v: Vec<f64> = (0..=1000).map(|i| min_jerk(i as f64 / 1000.0)).collect();
        assert!(v.windows(2).all(|w| w[1] >= w[0]));
    }
}
