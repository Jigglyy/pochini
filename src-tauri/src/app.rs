//! Application state and the engine worker.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{Receiver, Sender};
use std::sync::{Arc, Mutex};

use crate::engine::{timer, CancelToken, Engine, EngineError};
use crate::hotkey::logic::{Seen, SeenResult, Via};
use crate::hotkey::{BindingTable, TriggerEvent};
use crate::input::InputBackend;
use crate::model::{Macro, MacroFile, QueueFrom, Repeat, Settings, TriggerMode};
use crate::storage::{LoadProblem, Store};

/// How many presses can wait behind a running macro. A cap rather than
/// unlimited, so a held-down or repeatedly mashed key cannot line up an hour
/// of clicking.
pub const MAX_QUEUE: usize = 50;

/// Lets the worker tell the UI something changed (the toggle hotkey flipped
/// the master switch while the window was in the background). A trait rather
/// than a Tauri `AppHandle` so tests can run without a window.
pub trait Notify: Send + Sync {
    fn settings_changed(&self, settings: &Settings);
    /// What runs, or is queued, changed (replaces polling in the UI).
    fn run_changed(&self, _status: &RunStatus) {}
    /// A run ended, however it ended.
    fn run_finished(&self, _record: &RunRecord) {}
}

/// How a run ended, for the run history and the run pill.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Outcome {
    Finished,
    /// Panic key, Stop, switching off, or its own hotkey.
    Stopped,
    /// Cancelled during the countdown, before it touched anything.
    Cancelled,
    /// `admin`: Windows was blocking input to an app running as
    /// administrator, which restarting Pochini as administrator fixes.
    Failed { message: String, admin: bool },
}

/// One run, newest first in the history.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct RunRecord {
    pub name: String,
    pub macro_id: String,
    /// Unix milliseconds when it started (or was cancelled).
    pub at_ms: u64,
    pub duration_ms: u64,
    pub outcome: Outcome,
}

/// How many runs Settings > Run history keeps (in memory only).
pub const HISTORY: usize = 30;

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// What a run's result means for the user.
pub fn outcome_of(started: bool, result: &Result<(), EngineError>) -> Outcome {
    match (started, result) {
        (false, _) => Outcome::Cancelled,
        (true, Ok(())) => Outcome::Finished,
        (true, Err(EngineError::Cancelled)) => Outcome::Stopped,
        (true, Err(e)) => Outcome::Failed {
            message: e.to_string(),
            admin: matches!(e, EngineError::Input(crate::input::InputError::AccessDenied)),
        },
    }
}

pub struct AppState {
    pub store: Store,
    pub macros: Mutex<MacroFile>,
    pub settings: Mutex<Settings>,
    pub input: Arc<dyn InputBackend>,
    pub tx: Sender<TriggerEvent>,
    /// Whatever is running now (or counting down to run). At most one.
    /// Lock order: `running` before `queue`, everywhere.
    pub running: Mutex<Option<RunHandle>>,
    /// Presses of queue-enabled macros that arrived while something ran.
    pub queue: Mutex<VecDeque<Pending>>,
    /// Newest first; the Settings "Hotkey check".
    pub recent_keys: Mutex<VecDeque<RecentKey>>,
    pub notify: Option<Box<dyn Notify>>,
    /// Set when `macros.json` could not be read at startup (see
    /// `Store::open_macros`). While it is `locked`, nothing is saved.
    pub storage_problem: Mutex<Option<LoadProblem>>,
    /// A key is being recorded in the window (see `BindingTable::paused`).
    pub recording: AtomicBool,
    /// Bumped on every `set_recording`, so an old expiry timer does nothing.
    pub recording_gen: AtomicU64,
    /// The last runs, newest first (Settings > Run history).
    pub history: Mutex<VecDeque<RunRecord>>,
}

/// A recording that is never finished (the window crashed, say) stops
/// pausing the hotkeys after this long.
pub const RECORDING_EXPIRES_MS: u64 = 60_000;

pub struct RunHandle {
    /// Unique per run. The same macro can be running and queued at once, so
    /// the macro id alone cannot tell this run from the next one.
    pub run_id: u64,
    pub macro_id: String,
    pub name: String,
    pub cancel: CancelToken,
}

/// A run waiting to start.
pub struct Pending {
    pub mac: Macro,
    pub delay_ms: u64,
    /// Where the mouse was at the press that queued it.
    pub at: Option<(i32, i32)>,
    /// Queued with `QueueFrom::FirstPress`: start from where the chain of
    /// back-to-back runs started instead of from `at`.
    pub from_chain_start: bool,
}

/// How many recent hotkey reports the Settings "Hotkey check" keeps.
pub const RECENT_KEYS: usize = 8;

/// One press of a watched key, ready to show in the Settings "Hotkey check".
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct RecentKey {
    /// e.g. "Ctrl+Shift+F12".
    pub combo: String,
    pub result: SeenResult,
    pub via: Via,
    /// Name of the macro involved, if any.
    pub macro_name: Option<String>,
    /// For an app-only miss: the app the macro is restricted to.
    pub app: Option<String>,
    /// Unix milliseconds.
    pub at_ms: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
pub struct RunStatus {
    pub macro_id: Option<String>,
    pub name: Option<String>,
    pub queued: usize,
}

static NEXT_RUN: AtomicU64 = AtomicU64::new(1);

/// What a save says while an unreadable library is locked.
pub const LOCKED: &str =
    "Not saved: your macros file could not be read, and Pochini will not write over it until you choose Start fresh.";

impl AppState {
    pub fn binding_table(&self) -> Arc<BindingTable> {
        let macros = self.macros.lock().unwrap();
        let settings = self.settings.lock().unwrap();
        let mut t = BindingTable::build(&macros.macros, settings.panic_key.vk, settings.enabled);
        if let Some(h) = &settings.toggle_hotkey {
            t = t.with_toggle(h.key.vk, h.modifiers.clone());
        }
        t.paused = self.recording.load(Ordering::SeqCst);
        Arc::new(t)
    }

    /// The window starts or stops recording a key: hotkeys stand aside
    /// meanwhile. A recording left on expires on its own.
    pub fn set_recording(self: &Arc<Self>, on: bool) {
        let gen = self.recording_gen.fetch_add(1, Ordering::SeqCst) + 1;
        self.recording.store(on, Ordering::SeqCst);
        self.refresh_bindings();
        if on {
            let st = self.clone();
            let _ = std::thread::Builder::new().name("recording-expiry".into()).spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(RECORDING_EXPIRES_MS));
                if st.recording_gen.load(Ordering::SeqCst) == gen {
                    st.set_recording(false);
                }
            });
        }
    }

    pub fn persist(&self) -> Result<(), String> {
        if self.storage_problem.lock().unwrap().as_ref().is_some_and(|p| p.locked) {
            return Err(LOCKED.into());
        }
        let m = self.macros.lock().unwrap();
        self.store.save_macros(&m).map_err(|e| e.to_string())
    }

    pub fn find(&self, id: &str) -> Option<Macro> {
        self.macros
            .lock()
            .unwrap()
            .macros
            .iter()
            .find(|m| m.id == id)
            .cloned()
    }

    /// Tell the UI what runs now. Never call it while holding `running` or
    /// `queue`: it locks both.
    pub fn notify_status(&self) {
        if let Some(n) = &self.notify {
            n.run_changed(&self.run_status());
        }
    }

    pub fn record_run(&self, r: RunRecord) {
        {
            let mut h = self.history.lock().unwrap();
            h.push_front(r.clone());
            h.truncate(HISTORY);
        }
        if let Some(n) = &self.notify {
            n.run_finished(&r);
        }
    }

    pub fn run_history(&self) -> Vec<RunRecord> {
        self.history.lock().unwrap().iter().cloned().collect()
    }

    /// Stop whatever is running or counting down, and drop everything queued.
    pub fn abort(&self) {
        {
            let mut g = self.running.lock().unwrap();
            self.queue.lock().unwrap().clear();
            if let Some(h) = g.take() {
                h.cancel.cancel();
            }
        }
        self.notify_status();
    }

    /// Stop `macro_id` if it is the one running, and drop its queued runs.
    /// Other macros' queued runs still go ahead.
    pub fn abort_if(&self, macro_id: &str) {
        {
            let mut g = self.running.lock().unwrap();
            self.queue.lock().unwrap().retain(|p| p.mac.id != macro_id);
            if g.as_ref().is_some_and(|h| h.macro_id == macro_id) {
                if let Some(h) = g.take() {
                    h.cancel.cancel();
                }
            }
        }
        self.notify_status();
    }

    /// End `macro_id`'s run the way its own hotkey does (a hold-to-repeat key
    /// released, a toggle pressed again): a normal end, not an abort, so
    /// "move mouse back" still happens.
    pub fn stop_if(&self, macro_id: &str) {
        {
            let mut g = self.running.lock().unwrap();
            if g.as_ref().is_some_and(|h| h.macro_id == macro_id) {
                if let Some(h) = g.take() {
                    h.cancel.stop();
                }
            }
        }
        self.notify_status();
    }

    pub fn running_id(&self) -> Option<String> {
        self.running.lock().unwrap().as_ref().map(|h| h.macro_id.clone())
    }

    pub fn run_status(&self) -> RunStatus {
        let g = self.running.lock().unwrap();
        let queued = self.queue.lock().unwrap().len();
        RunStatus {
            macro_id: g.as_ref().map(|h| h.macro_id.clone()),
            name: g.as_ref().map(|h| h.name.clone()),
            queued,
        }
    }

    /// Replace the settings, persist them, re-arm the hook, and tell the UI.
    /// Turning the master switch off also stops whatever is running and clears
    /// the queue: "off" has to mean off.
    pub fn apply_settings(&self, next: Settings) -> Result<(), String> {
        let was_enabled = {
            let mut s = self.settings.lock().unwrap();
            let was = s.enabled;
            *s = next.clone();
            was
        };
        let saved = self.store.save_settings(&next).map_err(|e| e.to_string());
        self.refresh_bindings();
        if was_enabled && !next.enabled {
            self.abort();
        }
        if let Some(n) = &self.notify {
            n.settings_changed(&next);
        }
        saved
    }

    pub fn set_enabled(&self, enabled: bool) -> Result<(), String> {
        let mut s = self.settings.lock().unwrap().clone();
        s.enabled = enabled;
        self.apply_settings(s)
    }

    /// Turn a hook report into something readable and keep the last few.
    pub fn record_seen(&self, seen: Seen) {
        let mut parts: Vec<&str> = Vec::new();
        for (bit, name) in [(1u8, "Ctrl"), (2, "Alt"), (4, "Shift"), (8, "Win")] {
            if seen.mods & bit != 0 {
                parts.push(name);
            }
        }
        let key = crate::input::keys::label_for_vk(seen.vk);
        parts.push(&key);
        let combo = parts.join("+");

        let (macro_name, app) = match &seen.result {
            SeenResult::Run { macro_id } | SeenResult::OutsideApp { macro_id } => match self.find(macro_id) {
                Some(m) => (Some(m.name), m.guard.map(|g| g.process)),
                None => (None, None),
            },
            _ => (None, None),
        };
        let at_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let mut r = self.recent_keys.lock().unwrap();
        r.push_front(RecentKey { combo, result: seen.result, via: seen.via, macro_name, app, at_ms });
        r.truncate(RECENT_KEYS);
    }

    pub fn recent_keys(&self) -> Vec<RecentKey> {
        self.recent_keys.lock().unwrap().iter().cloned().collect()
    }

    pub fn refresh_bindings(&self) {
        #[cfg(windows)]
        crate::hotkey::HookThread::update(self.binding_table());
    }
}

/// Drains `TriggerEvent`s. The loop itself never blocks on a macro: runs
/// happen on their own thread, so a Panic or Stop arriving mid-run is handled
/// at once. (The first version ran macros inline here, which meant the panic
/// key and the release of a "repeat while held" key both waited behind the
/// very macro they were meant to stop.)
///
/// One macro runs at a time. A press that arrives while something runs is
/// queued if that macro has `queue` on (docs/06-open-questions.md #2), and
/// ignored otherwise.
pub fn spawn_worker(state: Arc<AppState>, rx: Receiver<TriggerEvent>) -> std::thread::JoinHandle<()> {
    std::thread::Builder::new()
        .name("macro-worker".into())
        .spawn(move || {
            for ev in rx {
                handle(&state, ev);
            }
        })
        .expect("failed to spawn the macro worker")
}

fn handle(state: &Arc<AppState>, ev: TriggerEvent) {
    match ev {
        TriggerEvent::Panic => state.abort(),
        // Only the running instance: a hold-repeat run is never queued.
        TriggerEvent::Stop { macro_id } => state.stop_if(&macro_id),
        TriggerEvent::ToggleEnabled => {
            let now = !state.settings.lock().unwrap().enabled;
            let _ = state.set_enabled(now);
        }
        TriggerEvent::Start { macro_id, delay_ms, at } => {
            let Some(mut m) = state.find(&macro_id) else {
                return;
            };
            let mode = m.trigger.as_ref().map(|t| t.mode);
            // "Press to start, press again to stop": the second press of a
            // Toggle-mode hotkey stops its own run instead of being ignored.
            if mode == Some(TriggerMode::Toggle)
                && delay_ms == 0
                && state.running_id().as_deref() == Some(macro_id.as_str())
            {
                state.stop_if(&macro_id);
                return;
            }
            // HoldRepeat loops until the key comes up (a Stop event).
            if mode == Some(TriggerMode::HoldRepeat) && delay_ms == 0 {
                m.repeat = Repeat::Forever;
            }
            // Queueing only makes sense for one run per press.
            let queueable = m.queue && matches!(mode, None | Some(TriggerMode::Once));
            let from_chain_start = queueable && m.queue_from == QueueFrom::FirstPress;
            launch(state, Pending { mac: m, delay_ms, at, from_chain_start }, queueable);
        }
        TriggerEvent::RunAdhoc { mac, delay_ms } => {
            launch(state, Pending { mac: *mac, delay_ms, at: None, from_chain_start: false }, false)
        }
        TriggerEvent::Seen(seen) => state.record_seen(seen),
    }
}

fn claim(slot: &mut Option<RunHandle>, mac: &Macro) -> (u64, CancelToken) {
    let run_id = NEXT_RUN.fetch_add(1, Ordering::Relaxed);
    let cancel = CancelToken::new();
    *slot = Some(RunHandle {
        run_id,
        macro_id: mac.id.clone(),
        name: mac.name.clone(),
        cancel: cancel.clone(),
    });
    (run_id, cancel)
}

/// Start `first` on a run thread, or queue it (if `queueable`) when something
/// is already running. The run thread drains the queue before it exits, so
/// queued runs follow each other back to back.
fn launch(state: &Arc<AppState>, first: Pending, queueable: bool) {
    let claimed = {
        let mut g = state.running.lock().unwrap();
        if g.is_some() {
            if queueable {
                let mut q = state.queue.lock().unwrap();
                if q.len() < MAX_QUEUE {
                    q.push_back(first);
                }
            }
            None
        } else {
            Some((claim(&mut g, &first.mac), first))
        }
    };
    state.notify_status();
    let Some(((run_id, cancel), first)) = claimed else {
        return;
    };

    let st = state.clone();
    let spawned = std::thread::Builder::new().name("macro-run".into()).spawn(move || {
        let mut job = Some((first, run_id, cancel));
        // The activation point of the first run in this chain of back-to-back
        // runs, for queued runs set to start from the first press.
        let mut chain_start: Option<(i32, i32)> = None;
        while let Some((p, run_id, cancel)) = job.take() {
            // The countdown lives here rather than in the UI: a webview timer
            // gets throttled the moment the user switches to the game, which
            // is exactly what the countdown is for. It is cancellable.
            let go = p.delay_ms == 0 || timer::wait(p.delay_ms, &cancel);
            let started = std::time::Instant::now();
            let at_ms = now_ms();
            let mut result = Ok(());
            if go {
                let at = match chain_start {
                    Some(start) if p.from_chain_start => Some(start),
                    // No point from a press (the Run countdown just ended):
                    // read it now, which is what the engine would do anyway,
                    // so the chain knows where it started.
                    _ => p.at.or_else(|| st.input.cursor_pos().ok()),
                };
                chain_start = chain_start.or(at);
                let seed = st.settings.lock().unwrap().rng_seed;
                let mut engine = Engine::new(st.input.clone(), seed);
                result = engine.run_at(&p.mac, &cancel, at);
            }
            st.record_run(RunRecord {
                name: p.mac.name.clone(),
                macro_id: p.mac.id.clone(),
                at_ms,
                duration_ms: started.elapsed().as_millis() as u64,
                outcome: outcome_of(go, &result),
            });

            // Hand over to the next queued run, or release the slot. If an
            // abort already took the slot (panic clears the queue; disabling
            // one macro only drops its own entries), whatever is left still
            // runs, unless a fresh press has claimed the slot in the meantime.
            {
                let mut g = st.running.lock().unwrap();
                let ours = g.as_ref().is_some_and(|h| h.run_id == run_id);
                if ours || g.is_none() {
                    let next = st.queue.lock().unwrap().pop_front();
                    match next {
                        Some(n) => {
                            let (id, c) = claim(&mut g, &n.mac);
                            job = Some((n, id, c));
                        }
                        None => {
                            if ours {
                                *g = None;
                            }
                        }
                    }
                }
            }
            st.notify_status();
        }
    });
    if spawned.is_err() {
        *state.running.lock().unwrap() = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::input::fake::{Event, FakeInput};
    use crate::model::{Anchor, Jitter, KeyRef, Step, Trigger};
    use std::time::{Duration, Instant};

    struct Recorder(Mutex<Vec<bool>>);
    impl Notify for Arc<Recorder> {
        fn settings_changed(&self, s: &Settings) {
            self.0.lock().unwrap().push(s.enabled);
        }
    }

    fn state_with(macros: Vec<Macro>) -> (Arc<AppState>, Arc<FakeInput>, Arc<Recorder>) {
        let dir = std::env::temp_dir().join(format!("ccm-app-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&dir).unwrap();
        let input = Arc::new(FakeInput::new());
        let rec = Arc::new(Recorder(Mutex::new(Vec::new())));
        let (tx, _rx) = std::sync::mpsc::channel();
        let st = Arc::new(AppState {
            store: Store::new(dir),
            macros: Mutex::new(MacroFile { schema_version: 1, macros }),
            settings: Mutex::new(Settings::default()),
            input: input.clone(),
            tx,
            running: Mutex::new(None),
            queue: Mutex::new(VecDeque::new()),
            recent_keys: Mutex::new(VecDeque::new()),
            notify: Some(Box::new(rec.clone())),
            storage_problem: Mutex::new(None),
            recording: AtomicBool::new(false),
            recording_gen: AtomicU64::new(0),
            history: Mutex::new(VecDeque::new()),
        });
        (st, input, rec)
    }

    fn start(id: &str) -> TriggerEvent {
        TriggerEvent::Start { macro_id: id.into(), delay_ms: 0, at: None }
    }

    fn long_wait(id: &str) -> Macro {
        let mut m = Macro::new(id);
        m.id = id.into();
        m.steps.push(Step::Wait { id: "w".into(), shuffle: false, ms: Jitter::exact(30_000) });
        m
    }

    /// A macro that marks each run with one cursor move, then waits a little.
    fn marker(id: &str, queue: bool, anchor: Anchor) -> Macro {
        let mut m = Macro::new(id);
        m.id = id.into();
        m.queue = queue;
        m.steps.push(Step::Move {
            id: "mv".into(),
            shuffle: false,
            x: 7,
            y: 7,
            anchor,
            dx: 0,
            dy: 0,
            coord_jitter_px: 0,
            move_duration_ms: 0,
            capture: None,
        });
        m.steps.push(Step::Wait { id: "w".into(), shuffle: false, ms: Jitter::exact(40) });
        m
    }

    fn moves(input: &FakeInput) -> Vec<Event> {
        input.events().into_iter().filter(|e| matches!(e, Event::Move(..))).collect()
    }

    fn wait_until(mut f: impl FnMut() -> bool, ms: u64) -> bool {
        let t = Instant::now();
        while t.elapsed() < Duration::from_millis(ms) {
            if f() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        f()
    }

    /// Regression: the panic key used to queue behind the running macro.
    #[test]
    fn panic_stops_a_running_macro_immediately() {
        let (st, _, _) = state_with(vec![long_wait("m")]);
        handle(&st, start("m"));
        assert!(wait_until(|| st.running_id().is_some(), 500));
        let t = Instant::now();
        handle(&st, TriggerEvent::Panic);
        assert!(wait_until(|| st.running_id().is_none(), 1000), "still running after Panic");
        assert!(t.elapsed() < Duration::from_millis(500), "panic took {:?}", t.elapsed());
    }

    /// Regression: releasing a "repeat while held" key used to queue behind
    /// the loop it was meant to end.
    #[test]
    fn releasing_a_hold_repeat_key_stops_the_loop() {
        let mut m = Macro::new("h");
        m.id = "h".into();
        m.trigger = Some(Trigger {
            key: KeyRef { vk: 0x41, scancode: 0x1E, extended: false, label: "A".into() },
            modifiers: vec![],
            mode: TriggerMode::HoldRepeat,
            swallow: false,
        });
        m.steps.push(Step::Wait { id: "w".into(), shuffle: false, ms: Jitter::exact(5) });
        let (st, _, _) = state_with(vec![m]);
        handle(&st, start("h"));
        std::thread::sleep(Duration::from_millis(60));
        assert_eq!(st.running_id().as_deref(), Some("h"), "should still be looping");
        handle(&st, TriggerEvent::Stop { macro_id: "h".into() });
        assert!(wait_until(|| st.running_id().is_none(), 500));
    }

    /// Regression: "Toggle on/off" mode ignored its second press, so a
    /// toggle-mode macro could only be stopped with the panic key.
    #[test]
    fn a_toggle_mode_hotkey_stops_its_own_run_on_the_second_press() {
        let mut m = long_wait("t");
        m.trigger = Some(Trigger {
            key: KeyRef { vk: 0x41, scancode: 0x1E, extended: false, label: "A".into() },
            modifiers: vec![],
            mode: TriggerMode::Toggle,
            swallow: false,
        });
        let (st, _, _) = state_with(vec![m]);
        handle(&st, start("t"));
        assert!(wait_until(|| st.running_id().is_some(), 500));
        handle(&st, start("t"));
        assert!(wait_until(|| st.running_id().is_none(), 500), "second press must stop it");
    }

    #[test]
    fn without_queue_a_press_while_running_is_ignored() {
        let (st, input, _) = state_with(vec![marker("m", false, Anchor::Fixed)]);
        for _ in 0..3 {
            handle(&st, start("m"));
        }
        assert!(wait_until(|| st.running_id().is_none(), 1000));
        std::thread::sleep(Duration::from_millis(80));
        assert_eq!(moves(&input).len(), 1, "only the first press runs");
    }

    /// The feature: press five times, it runs five times, back to back,
    /// never interrupting the run in progress.
    #[test]
    fn with_queue_every_press_runs_in_order_after_the_current_one() {
        let (st, input, _) = state_with(vec![marker("q", true, Anchor::Fixed)]);
        for _ in 0..5 {
            handle(&st, start("q"));
        }
        assert_eq!(st.run_status().queued, 4, "four waiting behind the first");
        assert!(wait_until(|| moves(&input).len() == 5 && st.running_id().is_none(), 2000));

        // Sequential, not overlapping: each run's move comes after the
        // previous run's 40 ms wait.
        let t: Vec<Instant> = input
            .timeline()
            .into_iter()
            .filter(|(_, e)| matches!(e, Event::Move(..)))
            .map(|(t, _)| t)
            .collect();
        for w in t.windows(2) {
            assert!(w[1].duration_since(w[0]) >= Duration::from_millis(38), "runs overlapped");
        }
    }

    #[test]
    fn with_each_press_every_queued_run_uses_the_mouse_position_from_its_own_press() {
        let mut m = marker("q", true, Anchor::Activation);
        m.queue_from = QueueFrom::EachPress;
        let (st, input, _) = state_with(vec![m]);
        for p in [(1, 1), (2, 2), (3, 3)] {
            handle(&st, TriggerEvent::Start { macro_id: "q".into(), delay_ms: 0, at: Some(p) });
        }
        assert!(wait_until(|| moves(&input).len() == 3, 2000));
        assert_eq!(moves(&input), vec![Event::Move(1, 1), Event::Move(2, 2), Event::Move(3, 3)]);
    }

    fn press(id: &str, at: (i32, i32)) -> TriggerEvent {
        TriggerEvent::Start { macro_id: id.into(), delay_ms: 0, at: Some(at) }
    }

    fn first_press_marker(id: &str) -> Macro {
        let m = marker(id, true, Anchor::Activation);
        assert_eq!(m.queue_from, QueueFrom::FirstPress, "the default");
        m
    }

    /// The feature: presses made while the macro runs catch the cursor
    /// wherever the macro moved it; "first press" ignores that and reuses
    /// where the chain started.
    #[test]
    fn with_first_press_every_queued_run_starts_where_the_chain_started() {
        let (st, input, _) = state_with(vec![first_press_marker("q")]);
        for p in [(1, 1), (2, 2), (3, 3)] {
            handle(&st, press("q", p));
        }
        assert!(wait_until(|| moves(&input).len() == 3, 2000));
        assert_eq!(moves(&input), vec![Event::Move(1, 1); 3]);
    }

    #[test]
    fn a_chain_started_by_run_uses_the_cursor_at_the_end_of_the_countdown() {
        let (st, input, _) = state_with(vec![first_press_marker("q")]);
        handle(&st, TriggerEvent::Start { macro_id: "q".into(), delay_ms: 30, at: None });
        handle(&st, press("q", (9, 9)));
        assert!(wait_until(|| moves(&input).len() == 2, 2000));
        // FakeInput's cursor starts at (0, 0).
        assert_eq!(moves(&input), vec![Event::Move(0, 0), Event::Move(0, 0)]);
    }

    #[test]
    fn after_the_queue_drains_the_next_press_starts_a_new_chain() {
        let (st, input, _) = state_with(vec![first_press_marker("q")]);
        handle(&st, press("q", (1, 1)));
        handle(&st, press("q", (2, 2)));
        assert!(wait_until(|| moves(&input).len() == 2 && st.running_id().is_none(), 2000));
        handle(&st, press("q", (5, 5)));
        assert!(wait_until(|| moves(&input).len() == 3, 2000));
        assert_eq!(moves(&input), vec![Event::Move(1, 1), Event::Move(1, 1), Event::Move(5, 5)]);
    }

    /// A typical queued macro: click where the mouse started, two fixed
    /// clicks, move the mouse back. A second Space press lands while run 1 is on its
    /// last click, so it catches the cursor there.
    fn start_and_two_clicks(id: &str, from: QueueFrom) -> Macro {
        let click = |anchor, x, y| Step::Click {
            id: "c".into(),
            shuffle: false,
            x,
            y,
            button: crate::model::MouseButton::Left,
            action: crate::model::ClickAction::Click,
            anchor,
            dx: 0,
            dy: 0,
            coord_jitter_px: 0,
            hold_ms: Jitter::exact(5),
            settle_ms: Jitter::exact(5),
            move_duration_ms: 0,
            modifiers: vec![],
            held_key: None,
            capture: None,
        };
        let mut m = Macro::new(id);
        m.id = id.into();
        m.queue = true;
        m.queue_from = from;
        m.return_to_start = true;
        m.steps = vec![click(Anchor::Activation, 0, 0), click(Anchor::Fixed, 1127, 830), click(Anchor::Fixed, 1504, 938)];
        m
    }

    /// The first click of each run, which aims at that run's start point.
    fn run_starts(input: &FakeInput) -> Vec<Event> {
        moves(input).into_iter().filter(|e| !matches!(e, Event::Move(1127, 830) | Event::Move(1504, 938))).collect()
    }

    #[test]
    fn start_and_two_clicks_with_each_press_drifts_to_where_the_macro_left_the_cursor() {
        let (st, input, _) = state_with(vec![start_and_two_clicks("s", QueueFrom::EachPress)]);
        handle(&st, press("s", (500, 400)));
        handle(&st, press("s", (1504, 938))); // pressed during run 1's last click
        assert!(wait_until(|| st.running_id().is_none() && moves(&input).len() >= 8, 3000));
        // Run 2 starts at the macro's own last click and "moves back" there,
        // so every later run drifts too: the drift that was reported.
        let (start, a, b) = (Event::Move(500, 400), Event::Move(1127, 830), Event::Move(1504, 938));
        assert_eq!(
            moves(&input),
            vec![start.clone(), a.clone(), b.clone(), start, b.clone(), a, b.clone(), b]
        );
    }

    #[test]
    fn start_and_two_clicks_with_first_press_starts_every_run_where_the_first_press_was() {
        let (st, input, _) = state_with(vec![start_and_two_clicks("s", QueueFrom::FirstPress)]);
        handle(&st, press("s", (500, 400)));
        handle(&st, press("s", (1504, 938)));
        handle(&st, press("s", (1127, 830)));
        assert!(wait_until(|| st.running_id().is_none() && moves(&input).len() >= 12, 3000));
        // Each run: start click at (500, 400), and "move back" returns there.
        assert_eq!(run_starts(&input), vec![Event::Move(500, 400); 6]);
    }

    #[test]
    fn a_new_macro_queues_from_the_first_press() {
        assert_eq!(Macro::new("n").queue_from, QueueFrom::FirstPress);
    }

    #[test]
    fn panic_clears_the_queue_too() {
        let mut q = long_wait("q");
        q.queue = true;
        let (st, input, _) = state_with(vec![q]);
        for _ in 0..4 {
            handle(&st, start("q"));
        }
        assert_eq!(st.run_status().queued, 3);
        handle(&st, TriggerEvent::Panic);
        assert!(wait_until(|| st.running_id().is_none(), 500));
        std::thread::sleep(Duration::from_millis(80));
        assert_eq!(st.run_status(), RunStatus::default(), "nothing running, nothing queued");
        assert!(input.events().is_empty());
    }

    #[test]
    fn switching_a_macro_off_drops_its_queued_runs_but_not_others() {
        let mut a = long_wait("a");
        a.queue = true;
        let b = marker("b", true, Anchor::Fixed);
        let (st, input, _) = state_with(vec![a, b]);
        handle(&st, start("a")); // running
        handle(&st, start("a")); // queued
        handle(&st, start("b")); // queued
        handle(&st, start("a")); // queued
        assert_eq!(st.run_status().queued, 3);
        st.abort_if("a");
        // a stops, its queued runs vanish, b still runs once
        assert!(wait_until(|| moves(&input).len() == 1 && st.running_id().is_none(), 1500));
        assert_eq!(st.run_status(), RunStatus::default());
    }

    #[test]
    fn the_queue_is_capped() {
        let mut q = long_wait("q");
        q.queue = true;
        let (st, _, _) = state_with(vec![q]);
        for _ in 0..(MAX_QUEUE + 20) {
            handle(&st, start("q"));
        }
        assert_eq!(st.run_status().queued, MAX_QUEUE);
        st.abort();
    }

    #[test]
    fn hold_repeat_and_toggle_macros_never_queue() {
        for mode in [TriggerMode::HoldRepeat, TriggerMode::Toggle] {
            let mut m = long_wait("x");
            m.queue = true;
            m.trigger = Some(Trigger {
                key: KeyRef { vk: 0x41, scancode: 0x1E, extended: false, label: "A".into() },
                modifiers: vec![],
                mode,
                swallow: false,
            });
            let (st, _, _) = state_with(vec![m]);
            handle(&st, start("x"));
            assert!(wait_until(|| st.running_id().is_some(), 500));
            handle(&st, start("x"));
            assert_eq!(st.run_status().queued, 0, "{mode:?} must not queue");
            st.abort();
        }
    }

    #[test]
    fn run_status_names_the_running_macro() {
        let mut m = long_wait("m");
        m.name = "Demo".into();
        let (st, _, _) = state_with(vec![m]);
        handle(&st, start("m"));
        assert!(wait_until(|| st.running_id().is_some(), 500));
        let s = st.run_status();
        assert_eq!((s.macro_id.as_deref(), s.name.as_deref(), s.queued), (Some("m"), Some("Demo"), 0));
        st.abort();
    }

    #[test]
    fn the_countdown_delays_the_first_input_and_can_be_cancelled() {
        let mut m = Macro::new("c");
        m.id = "c".into();
        m.steps.push(Step::Move {
            id: "mv".into(),
            shuffle: false,
            x: 10,
            y: 10,
            anchor: Anchor::Fixed,
            dx: 0,
            dy: 0,
            coord_jitter_px: 0,
            move_duration_ms: 0,
            capture: None,
        });
        let (st, input, _) = state_with(vec![m]);

        // cancelled mid-countdown: nothing is ever sent
        handle(&st, TriggerEvent::Start { macro_id: "c".into(), delay_ms: 2_000, at: None });
        std::thread::sleep(Duration::from_millis(50));
        assert_eq!(st.running_id().as_deref(), Some("c"), "counting down counts as running");
        handle(&st, TriggerEvent::Panic);
        assert!(wait_until(|| st.running_id().is_none(), 500));
        std::thread::sleep(Duration::from_millis(50));
        assert!(input.events().is_empty(), "a cancelled countdown must not send input");

        // allowed to finish: input arrives only after the delay
        let t = Instant::now();
        handle(&st, TriggerEvent::Start { macro_id: "c".into(), delay_ms: 120, at: None });
        assert!(wait_until(|| !input.events().is_empty(), 1000));
        assert!(t.elapsed() >= Duration::from_millis(110), "input came after {:?}", t.elapsed());
        assert_eq!(input.events(), vec![Event::Move(10, 10)]);
    }

    #[test]
    fn the_toggle_flips_the_master_switch_and_tells_the_ui() {
        let (st, _, rec) = state_with(vec![]);
        assert!(st.settings.lock().unwrap().enabled);
        handle(&st, TriggerEvent::ToggleEnabled);
        assert!(!st.settings.lock().unwrap().enabled);
        handle(&st, TriggerEvent::ToggleEnabled);
        assert!(st.settings.lock().unwrap().enabled);
        assert_eq!(*rec.0.lock().unwrap(), vec![false, true]);
        // and it was persisted
        assert!(st.store.load_settings().unwrap().enabled);
    }

    #[test]
    fn switching_off_stops_whatever_is_running_and_clears_the_queue() {
        let mut m = long_wait("m");
        m.queue = true;
        let (st, _, _) = state_with(vec![m]);
        handle(&st, start("m"));
        handle(&st, start("m"));
        assert!(wait_until(|| st.running_id().is_some(), 500));
        handle(&st, TriggerEvent::ToggleEnabled); // on -> off
        assert!(wait_until(|| st.running_id().is_none(), 500), "off must mean off");
        assert_eq!(st.run_status().queued, 0);
    }

    #[test]
    fn hotkey_reports_become_readable_and_are_capped() {
        let mut m = long_wait("m");
        m.name = "Demo".into();
        m.guard = Some(crate::model::Guard { process: "game.exe".into(), label: String::new() });
        let (st, _, _) = state_with(vec![m]);
        handle(&st, TriggerEvent::Seen(Seen { vk: 0x7B, mods: 5, result: SeenResult::Toggle, via: Via::Windows }));
        handle(
            &st,
            TriggerEvent::Seen(Seen {
                vk: 0x20,
                mods: 0,
                result: SeenResult::OutsideApp { macro_id: "m".into() },
                via: Via::Hook,
            }),
        );
        let r = st.recent_keys();
        assert_eq!(r[0].combo, "Space");
        assert_eq!(r[0].macro_name.as_deref(), Some("Demo"));
        assert_eq!(r[0].app.as_deref(), Some("game.exe"));
        assert_eq!(r[1].combo, "Ctrl+Shift+F12");
        assert_eq!(r[1].via, Via::Windows);

        for _ in 0..20 {
            handle(&st, TriggerEvent::Seen(Seen { vk: 0x1B, mods: 0, result: SeenResult::Panic, via: Via::Hook }));
        }
        assert_eq!(st.recent_keys().len(), RECENT_KEYS);
    }

    fn hold_repeat_returning(id: &str) -> Macro {
        let mut m = long_wait(id);
        m.return_to_start = true;
        m.trigger = Some(Trigger {
            key: KeyRef { vk: 0x41, scancode: 0x1E, extended: false, label: "A".into() },
            modifiers: vec![],
            mode: TriggerMode::HoldRepeat,
            swallow: false,
        });
        m
    }

    #[test]
    fn releasing_a_hold_repeat_key_returns_the_mouse_to_the_press_point() {
        let (st, input, _) = state_with(vec![hold_repeat_returning("h")]);
        handle(&st, TriggerEvent::Start { macro_id: "h".into(), delay_ms: 0, at: Some((90, 45)) });
        assert!(wait_until(|| st.running_id().is_some(), 500));
        handle(&st, TriggerEvent::Stop { macro_id: "h".into() });
        assert!(wait_until(|| st.running_id().is_none(), 500));
        assert!(wait_until(|| input.events() == vec![Event::Move(90, 45)], 500), "{:?}", input.events());
    }

    #[test]
    fn panic_never_moves_the_mouse_back() {
        let (st, input, _) = state_with(vec![hold_repeat_returning("h")]);
        handle(&st, TriggerEvent::Start { macro_id: "h".into(), delay_ms: 0, at: Some((90, 45)) });
        assert!(wait_until(|| st.running_id().is_some(), 500));
        handle(&st, TriggerEvent::Panic);
        assert!(wait_until(|| st.running_id().is_none(), 500));
        std::thread::sleep(Duration::from_millis(80));
        assert!(input.events().is_empty(), "{:?}", input.events());
    }

    /// Regression: an unreadable library started empty, and the next save
    /// wrote that empty library over the file (and the one after, over its
    /// backup). While locked, nothing may reach the disk.
    #[test]
    fn a_locked_library_is_never_saved_over() {
        let (st, _, _) = state_with(vec![]);
        std::fs::write(st.store.macros_path(), br#"{"schema_version": 99, "macros": []}"#).unwrap();
        let opened = st.store.open_macros();
        *st.storage_problem.lock().unwrap() = opened.problem;

        st.macros.lock().unwrap().macros.push(Macro::new("made while locked"));
        assert_eq!(st.persist(), Err(LOCKED.to_string()));
        assert!(std::fs::read_to_string(st.store.macros_path()).unwrap().contains("99"));

        // Start fresh: saving works again.
        *st.storage_problem.lock().unwrap() = None;
        st.persist().unwrap();
        assert_eq!(st.store.load_macros().unwrap().macros[0].name, "made while locked");
    }

    #[test]
    fn every_run_lands_in_the_history_with_how_it_ended() {
        let (st, input, _) = state_with(vec![marker("ok", false, Anchor::Fixed), long_wait("slow")]);
        handle(&st, start("ok"));
        assert!(wait_until(|| st.run_history().len() == 1, 1000));
        handle(&st, start("slow"));
        assert!(wait_until(|| st.running_id().is_some(), 500));
        handle(&st, TriggerEvent::Panic);
        assert!(wait_until(|| st.run_history().len() == 2, 1000));
        handle(&st, TriggerEvent::Start { macro_id: "ok".into(), delay_ms: 5_000, at: None });
        assert!(wait_until(|| st.running_id().is_some(), 500));
        handle(&st, TriggerEvent::Panic); // during the countdown
        assert!(wait_until(|| st.run_history().len() == 3, 1000));
        input.blocked.store(true, Ordering::SeqCst);
        let mut typing = Macro::new("types");
        typing.id = "types".into();
        typing.steps.push(Step::Text { id: "t".into(), shuffle: false, value: "x".into(), per_char_ms: Jitter::exact(0) });
        st.macros.lock().unwrap().macros.push(typing);
        handle(&st, start("types"));
        assert!(wait_until(|| st.run_history().len() == 4, 1000));

        let h = st.run_history();
        let names: Vec<&str> = h.iter().map(|r| r.name.as_str()).collect();
        assert_eq!(names, ["types", "ok", "slow", "ok"], "newest first");
        assert!(matches!(&h[0].outcome, Outcome::Failed { admin: true, .. }), "{:?}", h[0].outcome);
        assert_eq!(h[1].outcome, Outcome::Cancelled);
        assert_eq!(h[2].outcome, Outcome::Stopped);
        assert_eq!(h[3].outcome, Outcome::Finished);
    }

    #[test]
    fn the_history_is_capped() {
        let (st, _, _) = state_with(vec![]);
        for i in 0..(HISTORY + 5) {
            st.record_run(RunRecord { name: i.to_string(), macro_id: "m".into(), at_ms: 0, duration_ms: 0, outcome: Outcome::Finished });
        }
        assert_eq!(st.run_history().len(), HISTORY);
        assert_eq!(st.run_history()[0].name, (HISTORY + 4).to_string());
    }

    #[test]
    fn recording_a_key_pauses_the_hotkeys_until_it_ends() {
        let (st, _, _) = state_with(vec![]);
        assert!(!st.binding_table().paused);
        st.set_recording(true);
        assert!(st.binding_table().paused);
        st.set_recording(false);
        assert!(!st.binding_table().paused);
    }

    #[test]
    fn the_binding_table_includes_the_toggle_hotkey() {
        let (st, _, _) = state_with(vec![]);
        let t = st.binding_table();
        assert_eq!(t.toggle.as_ref().map(|(vk, _)| *vk), Some(0x7B));
    }
}
