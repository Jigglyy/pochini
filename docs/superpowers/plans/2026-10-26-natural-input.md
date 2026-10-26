# Natural Input Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each macro three optional, configurable ways to feel less mechanical (bell-curve randomness, an occasional hesitation before a click, curved mouse paths), and add a fourth step layout, Squares.

**Architecture:** One per-macro `feel` object in the model (all off by default, additive, no schema bump). The engine reads it at the start of a run. Pure, seeded-RNG helpers do the maths: `engine/random.rs` for the bell, `input/coords.rs` for the bell-shaped click spread, `engine/curve.rs` for minimum-jerk timing and Bezier paths. Curved glides are generated as a `Vec<PathPoint>` and replayed by the existing recorded-path replayer, so timeline scheduling, cancellation and exact landing come for free.

**Tech Stack:** Rust (`rand` 0.8 `StdRng`, already a dependency), React 19 + TypeScript, Vitest, Playwright.

**Spec:** The Design section below. It comes from the research in the 2026-10-26 session. The owner approved it with three answers: each option is configurable; the bell curve gets a tightness and a movable peak; and a Squares layout shows the chosen square's settings beside the grid, each square showing its kind icon, number and a short label.

## Design

The macro gains:

```json
"feel": {
  "bell": { "tightness": "medium", "peak": "middle" },
  "hesitate": { "chance_pct": 10, "ms": { "base": 150, "jitter": 350 } },
  "curve": { "bend_pct": 10, "overshoot_pct": 0 }
}
```

1. **One `feel` per macro, everything off by default.** *(my call: per-step fields would add three controls to every step card and need Bulk edit support.)*
2. **Bell-curve randomness** (`bell`, configurable: tightness Loose / Medium / Tight, peak Early / Middle / Late; owner's answer).
   - A random amount is drawn from a Beta curve on its range: always inside the range, so every estimate and every "A random 50 to 75 ms" hint stays true.
   - The peak sits at the mode `m` (Early 0.2, Middle 0.5, Late 0.8) and tightness sets the concentration `κ` (Loose 4, Medium 8, Tight 20), giving `a = 1 + m(κ − 2)`, `b = 1 + (1 − m)(κ − 2)`. Medium, Middle is Beta(4, 4), a bell with standard deviation 1/6 of the range. An Early peak is right-skewed: mostly short with the occasional long one, as human timing is (ex-Gaussian / log-normal in the research).
   - It applies to every `Jitter` the engine samples in that macro, the hesitation and the curve bend included.
   - Click spread (`coord_jitter_px`) uses a truncated Rayleigh radius with σ = R/2 (Loose), R/2.5 (Medium) or R/3.5 (Tight). The peak does not apply to positions.
   - With `bell` off the RNG is drawn exactly as today, so seeded runs are unchanged.
3. **Hesitation** (`hesitate`). Before the press of a Click, Double or Down step, with `chance_pct`% chance, an extra pause sampled from `ms`. It comes after travel and the UIPI check, before held keys go down, so Shift is not held through it. It is never between a double click's presses, never on Up, and never on a click with a recorded `path`. It is an in-step pause on the run's timeline (the same call as the settle). When switched on: 10%, 150 to 500 ms *(my call)*. Estimate: the worst case adds `ms`'s maximum once per eligible click when `chance_pct > 0`; the best case is unchanged.
4. **Curved paths** (`curve`). These replace the straight glide only: a step with Travel above 0 and no recorded path.
   - The path is a cubic Bezier, with both control points on one random side (an arc, never an S), at 1/3 and 2/3 of the way.
   - Each control point is pushed off the line by `[0.5, 1] × bend_pct%` of the distance.
   - Timing is minimum jerk over arc length, with points about every 8 ms, clamped to the virtual desktop.
   - Under 8 px the path is straight.
   - **Overshoot:** for glides of 40 px or more, with `overshoot_pct`% chance, the arc ends 3% of the distance past the target (3 to 15 px) at 80% of the travel time, then a straight minimum-jerk correction comes back in the last 20%.
   - When switched on: bend 10%, overshoot 0% *(my call: overshoot sweeps the cursor over whatever is beyond the target)*.
5. **Straight glides switch from quadratic ease-in-out to minimum jerk:** position `10t³ − 15t⁴ + 6t⁵`, the same endpoints and duration *(my call; Task 3 stands alone and can be dropped)*.
6. **UI:** three toggle rows at the end of the editor's "When it runs" section, with phrases in its folded summary *(my call: not a new section, because Trigger and When it runs sit side by side from `xl`)*.
7. **Recorded movement and timing win.** Hesitation and curves skip steps with a recorded `path`.
8. **Squares layout** (owner's answers). A fourth `StepView`, `"squares"`, labelled "Squares" (lucide `LayoutGrid`).
   - The steps are a grid of square tiles, in run order left to right.
   - Each tile shows its number (top left), its kind icon in its colour (centre), and a short label (bottom): "640, 380", "500 ms", "Ctrl+A", "Down 3". The full summary is in a tooltip and in screen-reader text.
   - Clicking a tile shows its settings in the panel beside the grid, exactly as Side by side does, with the same column widths. Select, Ctrl+click, Shift ranges and the panel's bulk edit work the same.
   - Tiles drag to reorder (dnd-kit `rectSortingStrategy`), have the step right-click menu, and are outlined in their colour like cards. Arrow keys move between tiles: left and right by one, up and down by a row.

Later, not in this plan: automatic Travel from Fitts's law, slowing on bends, WindMouse, a skewed (log-normal) shape, per-step settings.

## Global Constraints

- No em dash (U+2014) anywhere: code, comments, docs, UI copy.
- No new dependencies. The normal distribution is Box-Muller on the existing `StdRng`.
- No `unwrap()` or `expect()` in `engine/` outside `#[cfg(test)]`.
- Additive fields with `#[serde(default)]` only. Do not bump `SCHEMA_VERSION`.
- `src/types.ts` mirrors `model.rs` by hand. A Rust estimate test and its TS mirror use the same numbers.
- With `feel` at its default, a seeded run produces exactly the events it does today (no extra RNG draws).
- UI: theme tokens only, `ToggleRow` / `Field` / `JitterField` primitives, explanations behind `help`, controls `h-9`, sentence case, no `window.confirm`.
- UI copy talks about feel. Never "undetectable", never anything about avoiding detection (CLAUDE.md scope boundary).
- No commits, pushes or releases unless the owner says. Changes collect under `## Unreleased` in `CHANGELOG.md`.
- The working tree holds unfinished record-mode work (`dwell_ms`, `pause`, `follow_path`'s `from_recorded_start`), being edited by another session on 2026-10-26. Do not revert or reformat it. Find code by function name, not line number. Rust is not rustfmt-formatted.
- Tests never inject real input. F12, F13 and F14 are never used.

## Review Focus

1. **Cursor already on the target, or a few pixels away, with curves on:** no NaN or panic from a zero distance, and the path is straight or a jump. Test in Task 5.
2. **A target near a screen edge or on a left monitor (negative x):** curve points stay inside the virtual desktop. Test in Task 5.
3. **Panic or cancel during a long hesitation or curved glide:** stops at once, and the release pass runs. Tests in Tasks 4 and 6.
4. **"Stop after" running out mid-hesitation:** the run ends normally (TimeUp), not as an error. Test in Task 4.
5. **Travel of 1 to 7 ms with curves on:** at least one segment, and it ends on the target. Test in Task 5.

---

### Task 0: Start from a green tree

- [ ] **Step 1:** Confirm with the owner that the record-mode work in the tree is finished (or which files it is still touching).
- [ ] **Step 2:** Run `npm run verify` and `npm test`. Expected: all green. If anything is red, stop and report; do not build on a red tree.

### Task 1: The `feel` model and the estimate

**Files:**
- Modify: `src-tauri/src/model.rs` (new types beside `Jitter`, `Macro.feel`, `Macro::new`, `Macro::duration_range`, `Step::hesitates`)
- Modify: `src/types.ts`, `src/lib/steps.ts`, `src/screens/MacroEditor.tsx` (the `est` memo), `e2e/data.ts` (`macro()` default)
- Test: `model.rs` tests, `src/lib/steps.test.ts`

**Interfaces:**
- Produces (Rust, `model.rs`):
  - `pub struct Feel { pub bell: Option<Bell>, pub hesitate: Option<Hesitate>, pub curve: Option<Curve> }`: `Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize`, every field `#[serde(default)]`
  - `pub struct Bell { pub tightness: Tightness, pub peak: Peak }` (both `#[serde(default)]`), `pub enum Tightness { Loose, #[default] Medium, Tight }`, `pub enum Peak { Early, #[default] Middle, Late }`, both `snake_case`
  - `pub struct Hesitate { pub chance_pct: u8, pub ms: Jitter }`
  - `pub struct Curve { pub bend_pct: u8, pub overshoot_pct: u8 }`
  - `Macro.feel: Feel` with `#[serde(default)]`, placed after `stop_after_ms`, `Feel::default()` in `Macro::new`
  - `Step::hesitates(&self) -> bool`: true only for `Step::Click` with action `Click | Double | Down` and an empty `path`
- Produces (TS): `Feel`, `Bell`, `Tightness`, `Peak`, `Hesitate`, `Curve` types and `Macro.feel: Feel` in `types.ts`; `stepHesitates(s: Step): boolean` and `macroRange(m: Pick<Macro, "steps" | "feel">): [number, number]` in `lib/steps.ts`

- [ ] **Step 1: Write the failing Rust tests** in `model.rs`'s test module:

```rust
#[test]
fn feel_is_off_in_files_written_before_it() {
    let mut v = serde_json::to_value(Macro::new("x")).unwrap();
    v.as_object_mut().unwrap().remove("feel");
    let m: Macro = serde_json::from_value(v).unwrap();
    assert_eq!(m.feel, Feel::default());
}

#[test]
fn feel_round_trips() {
    let mut m = Macro::new("x");
    m.feel = Feel { bell: Some(Bell { tightness: Tightness::Tight, peak: Peak::Early }), hesitate: Some(Hesitate { chance_pct: 10, ms: Jitter { base: 150, jitter: 350 } }), curve: Some(Curve { bend_pct: 10, overshoot_pct: 20 }) };
    let back: Macro = serde_json::from_str(&serde_json::to_string(&m).unwrap()).unwrap();
    assert_eq!(back.feel, m.feel);
}

#[test]
fn hesitation_adds_its_longest_pause_once_per_press() {
    // Steps: a Click, a Down, an Up, and a Click with a two-point recorded path.
    // Only the first two hesitate.
    let (lo, hi) = plain.duration_range();
    with_feel.feel.hesitate = Some(Hesitate { chance_pct: 10, ms: Jitter { base: 150, jitter: 350 } });
    assert_eq!(with_feel.duration_range(), (lo, hi + 2 * 500));
    with_feel.feel.hesitate = Some(Hesitate { chance_pct: 0, ms: Jitter { base: 150, jitter: 350 } });
    assert_eq!(with_feel.duration_range(), (lo, hi), "no chance, no extra");
}
```

- [ ] **Step 2:** Run `cargo test --manifest-path src-tauri/Cargo.toml feel hesitation`. Expected: compile errors (`Feel` not found).
- [ ] **Step 3: Implement the types, `Macro.feel`, `Step::hesitates` and the hesitation term in `Macro::duration_range`.** Doc comments are in the style of `Jitter`'s.
- [ ] **Step 4:** Run the same command. Expected: PASS. Then the whole `cargo test`: all pass.
- [ ] **Step 5: Write the failing TS test** in `steps.test.ts`, a `describe("macroRange")` mirroring the Rust test with the same four steps and both assertions (`hi + 1000`, and no change at `chance_pct: 0`). Add a comment that it mirrors `Macro::duration_range`.
- [ ] **Step 6: Add the TS types and `stepHesitates` / `macroRange`.** `macroRange` sums `stepRange` and adds the hesitation term. Replace the `est` memo's reduce in `MacroEditor.tsx` with `macroRange(m)`, and add `feel: { bell: null, hesitate: null, curve: null }` to `e2e/data.ts`'s `macro()`. (TS uses `null` where Rust has `None`, as for `guard`.)
- [ ] **Step 7:** Run `npm test` and `npm run typecheck`. Expected: PASS, no type errors.

### Task 2: Bell-curve randomness

**Files:**
- Create: `src-tauri/src/engine/random.rs`
- Modify: `src-tauri/src/engine/mod.rs` (`pub mod random;`, `Engine.feel`, `run_at`, `sample`, `resolve_point`)
- Modify: `src-tauri/src/input/coords.rs` (`jitter_point_bell` + tests)

**Interfaces:**
- Consumes: `model::Feel` (Task 1)
- Produces:
  - `engine::random::normal(rng: &mut impl Rng) -> f64`: a standard normal by Box-Muller, with `u1 = 1.0 - rng.gen::<f64>()` so `ln` never sees 0
  - `engine::random::gamma(shape: f64, rng: &mut impl Rng) -> f64`: Marsaglia-Tsang for `shape >= 1` (always true here), at most 32 tries, then `shape` (its mean)
  - `engine::random::beta_params(bell: Bell) -> (f64, f64)`: the `(a, b)` of the Design section
  - `engine::random::unit(bell: Option<Bell>, rng: &mut impl Rng) -> f64`: in `[0, 1]`. Returns `rng.gen()` when `None`; else `x / (x + y)` with `x = gamma(a)` and `y = gamma(b)`
  - `engine::random::spread(t: Tightness) -> f64`: 2.0 / 2.5 / 3.5, the σ divisor for click spread
  - `coords::jitter_point_bell(x: i32, y: i32, radius_px: u32, spread: f64, u1: f64, u2: f64) -> (i32, i32)`
  - `Engine.feel: Feel`, set from `m.feel` at the start of `run_at` (beside `window_app`). Tasks 4 and 6 read it

- [ ] **Step 1: Write the failing tests.** In `random.rs` (seeded `StdRng::seed_from_u64(7)`, 100 000 draws each; the targets come from integrating each Beta curve):
  - `unit_stays_in_range`: every draw is in `[0, 1]` for `None` and all nine bells
  - `a_medium_bell_holds_two_thirds_in_the_middle_third`: Medium, Middle. The share in `(1/3, 2/3)` is in `(0.63, 0.68)` (theory 0.653), and the mean is within 0.005 of 0.5
  - `tightness_narrows_the_bell`: the middle-third shares are in order Loose < Medium < Tight, with Loose in `(0.46, 0.50)` and Tight in `(0.85, 0.89)`
  - `an_early_peak_is_mostly_short_with_a_long_tail`: Medium, Early. The mean is in `(0.26, 0.29)` (theory 0.275), and the share above 0.6 is in `(0.02, 0.035)` (theory 0.0275). Late mirrors it: the mean is in `(0.71, 0.74)`
  - `even_draws_hold_a_third_in_the_middle_third`: `None`, the share is in `(0.32, 0.35)`

  In `coords.rs`:
  - `bell_jitter_stays_within_its_radius`: the same grid and `d <= 10.5` tolerance as `jitter_stays_within_its_radius`, for spreads 2.0, 2.5 and 3.5. Also `jitter_point_bell(5, 6, 0, 2.5, 0.9, 0.9) == (5, 6)` and `jitter_point_bell(5, 6, 10, 2.5, 0.0, 0.3) == (5, 6)`
  - `bell_jitter_clusters_near_the_point`: R = 100, `u1 = i / 10_000` for i in 0..10 000, `u2 = 0.3`. The share within 50 px is in `(0.43, 0.48)` for spread 2.0, `(0.54, 0.60)` for 2.5 and `(0.76, 0.81)` for 3.5 (theory 0.455, 0.567, 0.786). The same sweep through `jitter_point` gives `(0.23, 0.27)`

  In `engine/mod.rs` tests:
  - `bell_waits_cluster_in_the_middle_of_their_range`: `e.feel.bell = Some(Bell::default())`, 10 000 × `e.sample(Jitter { base: 100, jitter: 60 })`. All in `[100, 160]`, and the share in `[120, 140]` is above 0.6. With `bell: None` it is below 0.4
- [ ] **Step 2:** Run `cargo test --manifest-path src-tauri/Cargo.toml bell even_draws unit_stays tightness early_peak`. Expected: compile errors.
- [ ] **Step 3: Implement.**
  - `jitter_point_bell`: σ = R / spread, `c = 1 − e^(−R² / 2σ²)`, `r = σ·sqrt(−2·ln(1 − u1·c))`, `θ = u2·τ`, rounded like `jitter_point`.
  - `Engine::sample` with `self.feel.bell` set: `base + (unit(bell, rng) × jitter).round()`. The `None` branch is untouched.
  - `resolve_point` calls `jitter_point_bell(.., spread(bell.tightness), ..)` when a bell is set, else `jitter_point`, with the same two `rng.gen()` draws.
- [ ] **Step 4:** Run the same command, then the whole `cargo test`. Expected: all pass, with existing seeded tests unchanged.

### Task 3: Minimum-jerk straight glides *(my call; droppable)*

**Files:**
- Create: `src-tauri/src/engine/curve.rs` (`pub mod curve;` in `engine/mod.rs`)
- Modify: `Engine::glide`'s ease in `engine/mod.rs`

**Interfaces:**
- Produces: `engine::curve::min_jerk(t: f64) -> f64` = `t³(10 − 15t + 6t²)`, for t in `[0, 1]`

- [ ] **Step 1: Write the failing tests.**
  - `min_jerk_starts_and_ends_at_rest` (`curve.rs`): `min_jerk(0.0) == 0.0`, `min_jerk(1.0) == 1.0`, `(min_jerk(0.5) - 0.5).abs() < 1e-12`, `min_jerk(0.05) < 0.002`, `1.0 - min_jerk(0.95) < 0.002`, and the values are non-decreasing over 1 000 even steps.
  - `a_glide_starts_and_ends_slowly` (`engine/mod.rs`): `FakeInput::with_cursor(0, 0)`, a Move to `(1000, 0)` over 400 ms (50 moves). The 5th Move (10% of the time) is under 12 px and the 45th is over 988 px: minimum jerk gives about 8.6 px, the quadratic ease 20 px. The biggest step falls in the middle third of the moves.
- [ ] **Step 2:** Run `cargo test --manifest-path src-tauri/Cargo.toml min_jerk glide_starts`. Expected: FAIL (compile error, then the 5th Move at 20 px under the quadratic ease).
- [ ] **Step 3: Add `min_jerk` and use it in `glide` in place of the quadratic ease.** Update the comment there.
- [ ] **Step 4:** Run the whole `cargo test`. Expected: all pass.

### Task 4: Hesitation

**Files:**
- Modify: the `Step::Click` arm of `Engine::run_step` in `engine/mod.rs`, plus tests

**Interfaces:**
- Consumes: `Feel.hesitate`, `Step::hesitates` (Task 1); `Engine.feel`, `Engine::sample` (Task 2)

- [ ] **Step 1: Write the failing tests.** Build steps like `timed_click` (settle 0, hold 1, travel 0), engine seeded 42, `e.feel.hesitate = Some(...)`:
  - `some_clicks_hesitate_before_pressing`: chance 50, `ms` exact 30, 40 clicks. The number of Move to Button-down gaps of 28 ms or more is between 8 and 32, and every other such gap is under 15 ms.
  - `a_double_click_hesitates_before_its_first_press_only`: chance 100, `ms` exact 30. Exactly one gap of 28 ms or more, the one before the first Button-down.
  - `a_release_and_a_recorded_click_never_hesitate`: chance 100, `ms` exact 30. An Up step, and a Click with a two-point `path` and travel 10. No gap of 28 ms or more before either's button event.
  - `cancelling_during_a_hesitation_stops_at_once`: chance 100, `ms` exact 5 000, cancelled from another thread after 50 ms (as `cancelling_during_a_held_click_releases_its_keys` does). `Err(Cancelled)` within 500 ms, no Button event, `f.still_held()` empty.
  - `stop_after_ends_a_hesitation_normally`: `stop_after_ms: Some(50)`, chance 100, `ms` exact 5 000. `run` returns `Ok(())` within 500 ms.
  - `no_chance_draws_nothing`: chance 0. The events equal those of the same seeded run with `hesitate: None`.
- [ ] **Step 2:** Run `cargo test --manifest-path src-tauri/Cargo.toml hesitat no_chance`. Expected: FAIL (no pauses happen).
- [ ] **Step 3: Implement.** After the `blocked` check and before `hold_keys`: when `self.feel.hesitate` has `chance_pct > 0` and `step.hesitates()`, draw `self.rng.gen_bool(chance / 100)`. On true, `self.sample(h.ms)`, then the same in-step pause call the settle uses. Draw nothing in any other case.
- [ ] **Step 4:** Run the whole `cargo test`. Expected: all pass.

### Task 5: The curve generator

**Files:**
- Modify: `src-tauri/src/engine/curve.rs` (`curve_path` + tests)

**Interfaces:**
- Consumes: `min_jerk` (Task 3), `random::unit` (Task 2), `model::{Curve, PathPoint}`, `input::VirtualRect`
- Produces: `engine::curve::curve_path(from: (i32, i32), to: (i32, i32), duration_ms: u32, curve: Curve, bell: Option<Bell>, bounds: VirtualRect, rng: &mut impl Rng) -> Vec<PathPoint>`. Points are absolute virtual-desktop pixels, `t` in ms from 0, the first point is `from` at `t: 0`, the last is `to` at `t: duration_ms`.

Algorithm (what the signature and tests leave open):

1. `d = to − from`, `L = |d|`. If `L < 8`, the path is the straight line with minimum-jerk timing (no overshoot, no draws). This also covers `from == to` without dividing by zero.
2. Overshoot first, when `L >= 40` and `overshoot_pct > 0` and `gen_bool(min(overshoot_pct, 100) / 100)`: the arc ends at `A = to + d/L × clamp(0.03·L, 3, 15)` at `0.8·T`, then a straight minimum-jerk leg `A → to` until `T`. Otherwise the arc ends at `A = to` at `T`.
3. The arc runs `from → A`: `a = A − from`, `n = (−a.y, a.x) / |a|`, `side = ±1` (one `gen_bool(0.5)`), `max = |a| × min(bend_pct, 50) / 100`. `P1 = from + a/3 + n·side·max·(0.5 + 0.5·unit(bell))`, `P2 = from + 2a/3 + n·side·max·(0.5 + 0.5·unit(bell))`. With `bend_pct == 0` the control points sit on the line.
4. Arc length: 64 even samples of the Bezier, cumulative lengths. For each output time in the arc's span, `s = min_jerk(τ) × length` maps to the Bezier parameter by linear interpolation in that table.
5. Output times: `n = max(1, T / 8)` even segments, `t_i = round(i·T / n)`, so `T = 3` gives points at 0 and 3. Each point is rounded, then `bounds.clamp`. The final point is set exactly to `to`.

- [ ] **Step 1: Write the failing tests** (seeded `StdRng`, from `(100, 500)` to `(900, 500)`, 400 ms, bounds `VirtualRect { x: -1920, y: 0, w: 6400, h: 1440 }` unless stated):
  - `a_curve_starts_and_ends_exactly`: first `== PathPoint { x: 100, y: 500, t: 0 }`, last `== PathPoint { x: 900, y: 500, t: 400 }`, `t` non-decreasing.
  - `a_curve_bends_one_way_within_its_bend`: bend 10. Every `|y − 500| <= 81`, the largest is at least 20, and all non-zero `y − 500` share one sign.
  - `no_bend_is_a_straight_line`: bend 0. Every `y == 500`.
  - `a_curve_is_slow_at_both_ends`: the distance between consecutive points in the first 3 and the last 3 is under a third of the largest.
  - `overshoot_passes_the_target_and_comes_back`: overshoot 100. Some `x` in `901..=916`, last `x == 900`. With overshoot 0, no `x > 900`.
  - `no_distance_and_a_few_pixels_stay_straight`: `from == to` gives every point `== to`, no panic. `(100, 500) → (105, 500)` with bend 30 gives every `y == 500`.
  - `a_tiny_travel_still_lands`: 3 ms. At least 2 points, last `t == 3` and on `to`.
  - `a_curve_stays_on_screen`: bounds `{ x: 0, y: 0, w: 1920, h: 1080 }`, `(10, 1075) → (1900, 1075)`, bend 30. Every point `bounds.contains`.
  - `a_curve_on_a_left_monitor`: `(-1800, 300) → (-200, 300)`. The ends are exact, and every point is inside the default bounds.
  - `the_same_seed_makes_the_same_path`.
- [ ] **Step 2:** Run `cargo test --manifest-path src-tauri/Cargo.toml curve`. Expected: compile error (`curve_path` missing).
- [ ] **Step 3: Implement `curve_path`** per the algorithm above.
- [ ] **Step 4:** Run the same command. Expected: PASS.

### Task 6: Curved travel in the engine

**Files:**
- Modify: `Engine::travel` in `engine/mod.rs`, plus tests

**Interfaces:**
- Consumes: `curve_path` (Task 5), `Engine.feel` (Task 2), the existing recorded-path replayer (`follow_path`)

- [ ] **Step 1: Write the failing tests** (`FakeInput::with_cursor(0, 500)`, `e.feel.curve = Some(Curve { bend_pct: 10, overshoot_pct: 0 })`):
  - `a_curved_move_arcs_and_lands_on_target`: a Move to `(800, 500)` over 200 ms. The last Move is `(800, 500)`, some Move has `|y − 500| >= 10`, and the first to last Move spans 190 to 215 ms (`f.timeline()`).
  - `a_curved_click_presses_on_its_target`: a Click at `(800, 500)` with travel 200. The Move just before the Button-down is `(800, 500)`.
  - `recorded_paths_ignore_the_curve`: a Click with a recorded `path`. The events equal those of the same seeded run with `curve: None`.
  - `a_jump_stays_a_jump`: travel 0. Exactly one Move before the press.
  - `cancelling_mid_curve_stops_at_once`: travel 5 000, cancelled after 50 ms. `Err(Cancelled)` within 500 ms.
- [ ] **Step 2:** Run `cargo test --manifest-path src-tauri/Cargo.toml curved jump_stays cancelling_mid recorded_paths_ignore`. Expected: FAIL (straight glide).
- [ ] **Step 3: Implement.** In `travel`, when there is no recorded path (fewer than 2 points), `duration_ms > 0` and `self.feel.curve` is set:
  - read `from` from `cursor_pos` (falling back to `to`);
  - build `curve_path` with `self.input.virtual_rect()` and `self.feel.bell`;
  - replay it through `follow_path` the way a path that does not start from its recorded spot is replayed (`from_recorded_start` false).

  Everything else keeps its current branch.
- [ ] **Step 4:** Run the whole `cargo test` and `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`. Expected: all pass, no warnings.

### Task 7: The editor controls

**Files:**
- Modify: `src/screens/MacroEditor.tsx` (the end of the "When it runs" `Section`, after "Move mouse back to where it started")
- Modify: `src/lib/describe.ts` (`runSummary` also picks `"feel"`)
- Test: `src/lib/describe.test.ts`, `e2e/editor.spec.ts`

Exact copy and defaults:

| Row | `ToggleRow` label | `help` | Controls when on | Value when switched on |
|---|---|---|---|---|
| Bell | Bell-curve randomness | Random amounts in this macro (waits, holds, settles, click spread) gather around a peak instead of spreading evenly, and never leave their range. Tightness is how strongly they gather; Peak is where (Early: mostly short, with the odd long one). Click spread uses the tightness only. | `Select` `aria-label="Tightness"` (Loose, Medium, Tight), `Select` `aria-label="Peak"` (Early, Middle, Late) | `{ tightness: "medium", peak: "middle" }` |
| Hesitate | Hesitate now and then | Some clicks wait a little longer before pressing, the way a person sometimes pauses on a button. Recorded clicks keep their own timing. | number `aria-label="Hesitation chance"` (1 to 100) then "% of clicks", then a `JitterField` labelled "Extra wait" | `{ chance_pct: 10, ms: { base: 150, jitter: 350 } }` |
| Curve | Curved mouse paths | Glides bend into a gentle arc and speed up and slow down like a hand. Only steps with a Travel time glide, and recorded paths replay as recorded. With overshoot, that share of glides goes a few pixels past the target and comes back. | number `aria-label="Curve bend"` (1 to 30) then "% bend", number `aria-label="Overshoot chance"` (0 to 100) then "% overshoot" | `{ bend_pct: 10, overshoot_pct: 0 }` |

The Hesitate row's `hint`: `` `${chance}% of clicks wait ${lo} to ${hi} ms longer.` ``. Typing edits pass undo keys `"hesitate_chance"`, `"hesitate_ms"`, `"curve_bend"` and `"curve_overshoot"`.

- [ ] **Step 1: Write the failing tests.**
  - `describe.test.ts`: `runSummary` with all three on ends with `", bell-curve randomness, hesitates, curved paths"`. With the default `feel`, the output is unchanged from today's cases.
  - `editor.spec.ts`, `test.describe("feel")`, shaped like the "stop after" test. Seed one macro and open it. Click the switches `/^Bell-curve randomness/`, `/^Hesitate now and then/` and `/^Curved mouse paths/`. Wait for each control to have no `[inert]` ancestor, then pick Tightness "Tight" and Peak "Early", fill "Hesitation chance" 25, "Curve bend" 15 and "Overshoot chance" 20, and save. `macros.json`'s `macros[0].feel` must equal `{ bell: { tightness: "tight", peak: "early" }, hesitate: { chance_pct: 25, ms: { base: 150, jitter: 350 } }, curve: { bend_pct: 15, overshoot_pct: 20 } }`.
- [ ] **Step 2:** Run `npm test`. Expected: the `describe` test FAILS.
- [ ] **Step 3: Implement the rows and the summary phrases.**
- [ ] **Step 4:** Run `npm test` and `npm run e2e -- editor -g feel`. Expected: PASS.

### Task 8: The Squares layout

**Files:**
- Modify: `src/lib/prefs.ts` (`StepView` gains `"squares"`)
- Modify: `src/lib/steps.ts` (`shortLabel`) + `src/lib/steps.test.ts`
- Modify: `src/components/StepRow.tsx` (a `square` layout for `StepRow` and `StepFace`, grid arrow keys)
- Modify: `src/screens/MacroEditor.tsx` (`VIEWS`, a `beside` flag for split and squares, the grid container, `rectSortingStrategy`)
- Test: `e2e/steps.spec.ts`

**Interfaces:**
- Produces: `shortLabel(s: Step): string` in `lib/steps.ts`:
  - click and move with a fixed anchor: `"640, 380"`, with `"2× "` in front for a double click;
  - other anchors: `"Start"`, `"Previous"` or `"Window"`, followed by the signed offset when it isn't zero (`"Start +20, -5"`);
  - key: the combo (`"Ctrl+A"`), with `"Hold "` or `"Release "` in front for down and up;
  - text: the value in quotes, cut to 10 characters plus `"..."` (empty: `"Text"`);
  - wait: the range as `summarize` writes it (`"500 ms"`, `"500-700 ms"`);
  - scroll: the way and amount (`"Down 3"`);
  - wait for color: the color.
- Produces: `StepRow`'s and `StepFace`'s `square?: boolean` prop (with `inline` false; `dense` is ignored when square).

- [ ] **Step 1: Write the failing tests.**
  - `steps.test.ts`, `describe("shortLabel")`: one expectation per case above, including `"2× 640, 380"`, `"Start +20, -5"`, `"Hold Ctrl+A"`, `'"hello worl..."'` and `"Down 3"`.
  - `steps.spec.ts`, `test("squares show the steps as tiles with the settings beside")` with the existing five-step seed:
    - click "Squares"; `[data-step-view="squares"]` is visible and holds 5 tiles;
    - `header(page, "c2")` contains `"20, 20"`, and its accessible text contains `"Click at (20, 20)"`;
    - clicking it makes `step-detail` contain "Step 3 of 5", and filling X with 25 makes the tile contain `"25, 20"`;
    - with it focused, ArrowRight shows "Step 4 of 5" and ArrowLeft goes back;
    - after a reload, `[data-step-view="squares"]` is still the layout.
  - `steps.spec.ts`, `test("squares reorder by dragging")`: drag the last tile onto the first with the `drag()` helper. It becomes first in `stepOrder` and in the saved `macros.json`.
- [ ] **Step 2:** Run `npm test` and `npm run e2e -- steps -g squares`. Expected: FAIL (no `shortLabel`, no Squares button).
- [ ] **Step 3: Implement.**
  - The tile: `aspect-square`, `rounded-lg border bg-card` with `outlineStyle`, the number top left (`text-xs text-muted-foreground tabular-nums`), the `KindChip` centred, the label at the bottom (`text-xs truncate`), and the shuffle mark or the selection checkbox top right.
  - States: the shown step gets `bg-accent`, a running step `ring-2 ring-primary`, a selected step the same tint as cards.
  - The full summary goes in a ShadCN `Tooltip` and an `sr-only` span.
  - The grid is `grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-2` inside the same two-column wrapper and `aside` as split.
  - Arrow keys: left and right move one tile; up and down move by the column count (the tiles sharing the first tile's `top`).
  - Every `view === "split"` check in `MacroEditor.tsx` becomes `beside`.
- [ ] **Step 4:** Run `npm test`, `npm run typecheck` and `npm run e2e -- steps`. Expected: PASS (the existing layout tests too).

### Task 9: Docs and the full check

**Files:**
- `docs/03-macro-format.md`:
  - a `feel` entry under "Macro";
  - fix the glide line under `click`, which says "a small per-point jitter" (the code has none), to describe the minimum-jerk straight glide and the curve option.
- `docs/02-windows-input-research.md` "Randomness": the bell option, why it stays inside the range, and the research sources (Flash & Hogan minimum jerk; ex-Gaussian reaction times; the Fitts effective width of 4.133σ).
- `CHANGELOG.md` `## Unreleased` → `### Added`: one bullet for the three options, in the file's voice.
- `README.md`: extend the "Natural timing" feature line.
- `CLAUDE.md`: test counts (240 / 104 / 112), Layout (`engine/random.rs`, `engine/curve.rs`), one line in the intro paragraph about the feel options, and "The step list has three layouts" becomes four (Squares).

- [ ] **Step 1:** Write the doc changes, with no em dashes. `npm run guards` (also part of `verify`) catches any.
- [ ] **Step 2:** Run `npm run verify`, `npm test` and `npm run e2e`. Expected: all green. Put the new counts into CLAUDE.md.
- [ ] **Step 3:** Leave everything in the working tree. Do not commit: report to the owner what is ready.
