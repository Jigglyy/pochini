//! Random draws for a macro's `Feel`: the shape random amounts take inside
//! their range. Pure functions of the run's RNG, so a seeded run stays
//! reproducible.

use rand::Rng;

use crate::model::{Bell, Peak, Tightness};

/// A standard normal draw (Box-Muller).
pub fn normal(rng: &mut impl Rng) -> f64 {
    // (0, 1], so the log never sees 0.
    let u1 = 1.0 - rng.gen::<f64>();
    let u2: f64 = rng.gen();
    (-2.0 * u1.ln()).sqrt() * (std::f64::consts::TAU * u2).cos()
}

/// A Gamma(`shape`, 1) draw by Marsaglia and Tsang's method, for
/// `shape >= 1` (every bell's are). Well over 90% of tries are accepted;
/// after 32 refusals in a row it settles for the mean rather than loop on.
pub fn gamma(shape: f64, rng: &mut impl Rng) -> f64 {
    let d = shape - 1.0 / 3.0;
    let c = 1.0 / (9.0 * d).sqrt();
    for _ in 0..32 {
        let z = normal(rng);
        let v = 1.0 + c * z;
        if v <= 0.0 {
            continue;
        }
        let v = v * v * v;
        let u = 1.0 - rng.gen::<f64>();
        if u.ln() < 0.5 * z * z + d - d * v + d * v.ln() {
            return d * v;
        }
    }
    shape
}

/// The Beta curve `(a, b)` a bell draws from: its peak (the mode) where the
/// bell says, gathered as tightly as it says. Medium and Middle is
/// Beta(4, 4), whose spread is a sixth of the range.
pub fn beta_params(bell: Bell) -> (f64, f64) {
    let mode = match bell.peak {
        Peak::Early => 0.2,
        Peak::Middle => 0.5,
        Peak::Late => 0.8,
    };
    let k = match bell.tightness {
        Tightness::Loose => 4.0,
        Tightness::Medium => 8.0,
        Tightness::Tight => 20.0,
    };
    (1.0 + mode * (k - 2.0), 1.0 + (1.0 - mode) * (k - 2.0))
}

/// A draw in `[0, 1]`: evenly spread without a bell, else from its Beta
/// curve, which never leaves the range.
pub fn unit(bell: Option<Bell>, rng: &mut impl Rng) -> f64 {
    let Some(bell) = bell else {
        return rng.gen();
    };
    let (a, b) = beta_params(bell);
    let x = gamma(a, rng);
    let y = gamma(b, rng);
    if x + y > 0.0 {
        x / (x + y)
    } else {
        0.5
    }
}

/// How many standard deviations of a bell-shaped click spread fit in its
/// radius (`jitter_point_bell`). The peak means nothing for a position.
pub fn spread(t: Tightness) -> f64 {
    match t {
        Tightness::Loose => 2.0,
        Tightness::Medium => 2.5,
        Tightness::Tight => 3.5,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Bell, Peak, Tightness};
    use rand::rngs::StdRng;
    use rand::SeedableRng;

    const N: usize = 100_000;

    fn bell(tightness: Tightness, peak: Peak) -> Option<Bell> {
        Some(Bell { tightness, peak })
    }

    fn draws(bell: Option<Bell>) -> Vec<f64> {
        let mut rng = StdRng::seed_from_u64(7);
        (0..N).map(|_| unit(bell, &mut rng)).collect()
    }

    fn share(v: &[f64], keep: impl Fn(f64) -> bool) -> f64 {
        v.iter().filter(|x| keep(**x)).count() as f64 / v.len() as f64
    }

    fn middle_third(v: &[f64]) -> f64 {
        share(v, |x| x > 1.0 / 3.0 && x < 2.0 / 3.0)
    }

    fn mean(v: &[f64]) -> f64 {
        v.iter().sum::<f64>() / v.len() as f64
    }

    // The targets below come from integrating each Beta curve.

    #[test]
    fn unit_stays_in_range() {
        let mut all = vec![None];
        for t in [Tightness::Loose, Tightness::Medium, Tightness::Tight] {
            for p in [Peak::Early, Peak::Middle, Peak::Late] {
                all.push(bell(t, p));
            }
        }
        for b in all {
            assert!(draws(b).iter().all(|x| (0.0..=1.0).contains(x)), "{b:?}");
        }
    }

    #[test]
    fn a_medium_bell_holds_two_thirds_in_the_middle_third() {
        assert_eq!(beta_params(Bell::default()), (4.0, 4.0));
        let v = draws(bell(Tightness::Medium, Peak::Middle));
        let mid = middle_third(&v);
        assert!(mid > 0.63 && mid < 0.68, "{mid}");
        assert!((mean(&v) - 0.5).abs() < 0.005, "{}", mean(&v));
    }

    #[test]
    fn tightness_narrows_the_bell() {
        let loose = middle_third(&draws(bell(Tightness::Loose, Peak::Middle)));
        let medium = middle_third(&draws(bell(Tightness::Medium, Peak::Middle)));
        let tight = middle_third(&draws(bell(Tightness::Tight, Peak::Middle)));
        assert!(loose < medium && medium < tight, "{loose} {medium} {tight}");
        assert!(loose > 0.46 && loose < 0.50, "{loose}");
        assert!(tight > 0.85 && tight < 0.89, "{tight}");
    }

    #[test]
    fn an_early_peak_is_mostly_short_with_a_long_tail() {
        let early = draws(bell(Tightness::Medium, Peak::Early));
        assert!(mean(&early) > 0.26 && mean(&early) < 0.29, "{}", mean(&early));
        let tail = share(&early, |x| x > 0.6);
        assert!(tail > 0.02 && tail < 0.035, "{tail}");
        let late = draws(bell(Tightness::Medium, Peak::Late));
        assert!(mean(&late) > 0.71 && mean(&late) < 0.74, "{}", mean(&late));
    }

    #[test]
    fn even_draws_hold_a_third_in_the_middle_third() {
        let mid = middle_third(&draws(None));
        assert!(mid > 0.32 && mid < 0.35, "{mid}");
    }
}
