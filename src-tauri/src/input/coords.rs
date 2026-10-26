//! Virtual-desktop pixel <-> `SendInput` normalized coordinate conversion.
//!
//! Pure math, no Win32, so it is testable on any host. The formula is not the
//! one the MSDN wording implies; see the measurements in
//! docs/02-windows-input-research.md.

/// The bounding rectangle of all monitors combined, in physical pixels.
/// `x`/`y` are the origin and may be negative when a monitor sits left of or
/// above the primary.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VirtualRect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

impl VirtualRect {
    pub fn contains(&self, x: i32, y: i32) -> bool {
        x >= self.x && y >= self.y && x < self.x + self.w && y < self.y + self.h
    }

    /// Clamp a point into the desktop so a stale coordinate from a since-removed
    /// monitor cannot send the cursor somewhere undefined.
    pub fn clamp(&self, x: i32, y: i32) -> (i32, i32) {
        (
            x.clamp(self.x, self.x + self.w.max(1) - 1),
            y.clamp(self.y, self.y + self.h.max(1) - 1),
        )
    }
}

/// Pixel -> normalized, for `MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK`.
///
/// Windows converts back with `floor(n * w / 65536)`, so we take the smallest
/// `n` that floors onto the pixel we want: `ceil(px * 65536 / w)`.
///
/// Measured over 90 points on a 3-monitor mixed-DPI desktop with a negative
/// origin, this lands on the exact requested pixel every time. The two obvious
/// alternatives do not: `round(px * 65535 / (w - 1))` is off by 1 px, and
/// `floor(px * 65536 / w)` is off by thousands (it put a click aimed at the
/// leftmost monitor onto a different monitor entirely).
pub fn to_normalized(r: VirtualRect, x: i32, y: i32) -> (i32, i32) {
    let w = r.w.max(1) as i64;
    let h = r.h.max(1) as i64;
    let dx = (x - r.x) as i64;
    let dy = (y - r.y) as i64;
    let nx = ((dx * 65536 + w - 1).div_euclid(w)).clamp(0, 65535);
    let ny = ((dy * 65536 + h - 1).div_euclid(h)).clamp(0, 65535);
    (nx as i32, ny as i32)
}

/// The inverse Windows applies. Only used by tests and by the "show me" preview.
pub fn from_normalized(r: VirtualRect, nx: i32, ny: i32) -> (i32, i32) {
    let w = r.w.max(1) as i64;
    let h = r.h.max(1) as i64;
    (
        ((nx as i64 * w).div_euclid(65536)) as i32 + r.x,
        ((ny as i64 * h).div_euclid(65536)) as i32 + r.y,
    )
}

/// Offset a point by a uniform sample from a disc of `radius_px`, for the
/// per-click coordinate jitter. `u1`/`u2` are uniform in `[0, 1)`; taking them
/// as arguments keeps this deterministic under test.
pub fn jitter_point(x: i32, y: i32, radius_px: u32, u1: f64, u2: f64) -> (i32, i32) {
    if radius_px == 0 {
        return (x, y);
    }
    // sqrt on the radius keeps the distribution uniform over area rather than
    // clustering in the middle.
    let r = (radius_px as f64) * u1.sqrt();
    let theta = u2 * std::f64::consts::TAU;
    (
        x + (r * theta.cos()).round() as i32,
        y + (r * theta.sin()).round() as i32,
    )
}

/// Offset a point the way people's clicks scatter: most land near the
/// point, fewer further out, none past `radius_px`. The distance is a
/// Rayleigh draw (a 2D bell) with `radius / spread` as its sigma, cut off
/// at the radius by drawing from that part of its curve only, so nothing
/// piles up on the rim. `u1`/`u2` as in `jitter_point`.
pub fn jitter_point_bell(x: i32, y: i32, radius_px: u32, spread: f64, u1: f64, u2: f64) -> (i32, i32) {
    if radius_px == 0 {
        return (x, y);
    }
    let radius = radius_px as f64;
    let sigma = radius / spread;
    let inside = 1.0 - (-(radius * radius) / (2.0 * sigma * sigma)).exp();
    let r = (sigma * (-2.0 * (1.0 - u1 * inside).ln()).sqrt()).min(radius);
    let theta = u2 * std::f64::consts::TAU;
    (
        x + (r * theta.cos()).round() as i32,
        y + (r * theta.sin()).round() as i32,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn layouts() -> Vec<VirtualRect> {
        vec![
            VirtualRect { x: 0, y: 0, w: 1920, h: 1080 },
            VirtualRect { x: 0, y: 0, w: 3840, h: 1080 },
            // secondary left of primary
            VirtualRect { x: -1920, y: 0, w: 3840, h: 1080 },
            // secondary above and left, mixed heights
            VirtualRect { x: -2560, y: -1440, w: 4480, h: 2520 },
            // the dev machine: 3 monitors, mixed DPI, negative origin
            VirtualRect { x: -1920, y: 0, w: 6400, h: 1440 },
            // deliberately awkward sizes
            VirtualRect { x: -7, y: 3, w: 2551, h: 1439 },
        ]
    }

    /// The property that matters: every pixel must survive the round trip
    /// through the conversion Windows actually applies.
    #[test]
    fn every_pixel_roundtrips_exactly() {
        for r in layouts() {
            for dx in 0..r.w {
                let (nx, _) = to_normalized(r, r.x + dx, r.y);
                let (bx, _) = from_normalized(r, nx, 0);
                assert_eq!(bx, r.x + dx, "x={} in {:?} -> n={} -> {}", r.x + dx, r, nx, bx);
            }
            for dy in 0..r.h {
                let (_, ny) = to_normalized(r, r.x, r.y + dy);
                let (_, by) = from_normalized(r, 0, ny);
                assert_eq!(by, r.y + dy, "y={} in {:?} -> n={} -> {}", r.y + dy, r, ny, by);
            }
        }
    }

    #[test]
    fn normalized_values_stay_in_range() {
        for r in layouts() {
            for &(x, y) in &[
                (r.x, r.y),
                (r.x + r.w - 1, r.y + r.h - 1),
                (r.x + r.w / 2, r.y + r.h / 2),
            ] {
                let (nx, ny) = to_normalized(r, x, y);
                assert!((0..=65535).contains(&nx), "nx={nx} for {x} in {r:?}");
                assert!((0..=65535).contains(&ny), "ny={ny} for {y} in {r:?}");
            }
        }
    }

    /// Regression guard for the two formulas that were measured wrong. If
    /// someone "simplifies" to_normalized back to either of these, this fails.
    #[test]
    fn rejects_the_two_formulas_that_measured_wrong() {
        let r = VirtualRect { x: -1920, y: 0, w: 6400, h: 1440 };

        // The MSDN reading: round(px * 65535 / (w - 1)). Off by one here.
        let target = -1832;
        let d = (target - r.x) as i64;
        let msdn = ((d * 65535 + (r.w as i64 - 1) / 2) / (r.w as i64 - 1)) as i32;
        assert_ne!(
            from_normalized(r, msdn, 0).0,
            target,
            "the MSDN formula is expected to miss this pixel; if it now hits, re-measure"
        );

        // Plain floor against 65536: lands on a different monitor.
        let corner = r.x;
        let floored = (((corner - r.x) as i64 * 65536) / r.w as i64) as i32;
        assert_eq!(from_normalized(r, floored, 0).0, corner);

        // Ours hits both exactly.
        let (nx, _) = to_normalized(r, target, 0);
        assert_eq!(from_normalized(r, nx, 0).0, target);
        let (nx, _) = to_normalized(r, corner, 0);
        assert_eq!(from_normalized(r, nx, 0).0, corner);
    }

    #[test]
    fn negative_origin_does_not_underflow() {
        let r = VirtualRect { x: -2560, y: -1440, w: 4480, h: 2520 };
        let (nx, ny) = to_normalized(r, -2560, -1440);
        assert_eq!((nx, ny), (0, 0));
        assert_eq!(from_normalized(r, 0, 0), (-2560, -1440));
    }

    #[test]
    fn clamp_keeps_points_inside() {
        let r = VirtualRect { x: -1920, y: 0, w: 6400, h: 1440 };
        assert_eq!(r.clamp(-9999, -9999), (-1920, 0));
        assert_eq!(r.clamp(99999, 99999), (4479, 1439));
        assert_eq!(r.clamp(0, 0), (0, 0));
        assert!(r.contains(-1920, 0));
        assert!(!r.contains(4480, 0));
    }

    #[test]
    fn jitter_stays_within_its_radius() {
        for i in 0..100u32 {
            let u1 = i as f64 / 100.0;
            for j in 0..100u32 {
                let u2 = j as f64 / 100.0;
                let (x, y) = jitter_point(500, 500, 10, u1, u2);
                let d = (((x - 500).pow(2) + (y - 500).pow(2)) as f64).sqrt();
                assert!(d <= 10.5, "distance {d} exceeded radius for u1={u1} u2={u2}");
            }
        }
        assert_eq!(jitter_point(5, 6, 0, 0.9, 0.9), (5, 6));
    }

    #[test]
    fn bell_jitter_stays_within_its_radius() {
        for spread in [2.0, 2.5, 3.5] {
            for i in 0..100u32 {
                let u1 = i as f64 / 100.0;
                for j in 0..100u32 {
                    let u2 = j as f64 / 100.0;
                    let (x, y) = jitter_point_bell(500, 500, 10, spread, u1, u2);
                    let d = (((x - 500).pow(2) + (y - 500).pow(2)) as f64).sqrt();
                    assert!(d <= 10.5, "distance {d} exceeded radius for spread={spread} u1={u1} u2={u2}");
                }
            }
        }
        assert_eq!(jitter_point_bell(5, 6, 0, 2.5, 0.9, 0.9), (5, 6));
        assert_eq!(jitter_point_bell(5, 6, 10, 2.5, 0.0, 0.3), (5, 6));
    }

    #[test]
    fn bell_jitter_clusters_near_the_point() {
        // The share of an even sweep of u1 that lands within half the radius:
        // a truncated Rayleigh's CDF at R/2 (0.455, 0.567, 0.786), against an
        // even disc's 0.25.
        let near = |f: &dyn Fn(f64) -> (i32, i32)| {
            let n = 10_000;
            (0..n)
                .filter(|i| {
                    let (x, y) = f(*i as f64 / n as f64);
                    (((x - 500).pow(2) + (y - 500).pow(2)) as f64).sqrt() <= 50.0
                })
                .count() as f64
                / n as f64
        };
        for (spread, lo, hi) in [(2.0, 0.43, 0.48), (2.5, 0.54, 0.60), (3.5, 0.76, 0.81)] {
            let s = near(&|u1| jitter_point_bell(500, 500, 100, spread, u1, 0.3));
            assert!(s > lo && s < hi, "spread {spread}: {s}");
        }
        let even = near(&|u1| jitter_point(500, 500, 100, u1, 0.3));
        assert!(even > 0.23 && even < 0.27, "{even}");
    }
}
