//! Application state and the engine worker.

use std::sync::mpsc::{Receiver, Sender};
use std::sync::{Arc, Mutex};

use crate::engine::{timer, CancelToken, Engine};
use crate::hotkey::{BindingTable, TriggerEvent};
use crate::input::InputBackend;
use crate::model::{Macro, MacroFile, Repeat, Settings, TriggerMode};
use crate::storage::Store;

/// Lets the worker tell the UI something changed (the toggle hotkey flipped
/// the master switch while the window was in the background). A trait rather
/// than a Tauri `AppHandle` so tests can run without a window.
pub trait Notify: Send + Sync {
    fn settings_changed(&self, settings: &Settings);
}

pub struct AppState {
    pub store: Store,
    pub macros: Mutex<MacroFile>,
    pub settings: Mutex<Settings>,
    pub input: Arc<dyn InputBackend>,
    pub tx: Sender<TriggerEvent>,
    /// Whatever is running now (or counting down to run). At most one.
    pub running: Mutex<Option<RunHandle>>,
    pub notify: Option<Box<dyn Notify>>,
}

pub struct RunHandle {
    pub macro_id: String,
    pub cancel: CancelToken,
}

impl AppState {
    pub fn binding_table(&self) -> Arc<BindingTable> {
        let macros = self.macros.lock().unwrap();
        let settings = self.settings.lock().unwrap();
        let mut t = BindingTable::build(&macros.macros, settings.panic_key.vk, settings.enabled);
        if let Some(h) = &settings.toggle_hotkey {
            t = t.with_toggle(h.key.vk, h.modifiers.clone());
        }
        Arc::new(t)
    }

    pub fn persist(&self) -> Result<(), String> {
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

    /// Abort whatever is running or counting down.
    pub fn abort(&self) {
        if let Some(h) = self.running.lock().unwrap().take() {
            h.cancel.cancel();
        }
    }

    /// Abort only if `macro_id` is the one running.
    pub fn abort_if(&self, macro_id: &str) {
        let mut g = self.running.lock().unwrap();
        if g.as_ref().is_some_and(|h| h.macro_id == macro_id) {
            if let Some(h) = g.take() {
                h.cancel.cancel();
            }
        }
    }

    pub fn running_id(&self) -> Option<String> {
        self.running.lock().unwrap().as_ref().map(|h| h.macro_id.clone())
    }

    /// Replace the settings, persist them, re-arm the hook, and tell the UI.
    /// Turning the master switch off also stops whatever is running: "off"
    /// has to mean off.
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

    pub fn refresh_bindings(&self) {
        #[cfg(windows)]
        crate::hotkey::HookThread::update(self.binding_table());
    }
}

/// Drains `TriggerEvent`s. The loop itself never blocks on a macro: each run
/// gets its own thread, so a Panic or Stop arriving mid-run is handled at once.
/// (The first version ran macros inline here, which meant the panic key and
/// the release of a "repeat while held" key both waited behind the very macro
/// they were meant to stop.)
///
/// Concurrency policy (docs/06-open-questions.md #2): one macro at a time; a
/// trigger arriving while something runs is ignored rather than queued.
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
        TriggerEvent::Stop { macro_id } => state.abort_if(&macro_id),
        TriggerEvent::ToggleEnabled => {
            let now = !state.settings.lock().unwrap().enabled;
            let _ = state.set_enabled(now);
        }
        TriggerEvent::Start { macro_id, delay_ms } => {
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
                state.abort_if(&macro_id);
                return;
            }
            // HoldRepeat loops until the key comes up (a Stop event).
            if mode == Some(TriggerMode::HoldRepeat) && delay_ms == 0 {
                m.repeat = Repeat::Forever;
            }
            launch(state, m, delay_ms);
        }
        TriggerEvent::RunAdhoc { mac, delay_ms } => launch(state, *mac, delay_ms),
    }
}

/// Start `m` on its own thread unless something is already running. The
/// running slot is claimed under the lock before the thread starts, so two
/// triggers in quick succession cannot both get through.
fn launch(state: &Arc<AppState>, m: Macro, delay_ms: u64) {
    let cancel = CancelToken::new();
    {
        let mut g = state.running.lock().unwrap();
        if g.is_some() {
            return;
        }
        *g = Some(RunHandle { macro_id: m.id.clone(), cancel: cancel.clone() });
    }
    let st = state.clone();
    let spawned = std::thread::Builder::new().name("macro-run".into()).spawn(move || {
        // The countdown lives here rather than in the UI: a webview timer gets
        // throttled the moment the user switches to the game, which is exactly
        // what the countdown is for. It is cancellable like any other wait.
        let go = delay_ms == 0 || timer::wait(delay_ms, &cancel);
        if go {
            let seed = st.settings.lock().unwrap().rng_seed;
            let mut engine = Engine::new(st.input.clone(), seed);
            let _ = engine.run(&m, &cancel);
        }
        let mut g = st.running.lock().unwrap();
        if g.as_ref().is_some_and(|h| h.macro_id == m.id) {
            *g = None;
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
    use crate::model::{Jitter, KeyRef, Step, Trigger};
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
            notify: Some(Box::new(rec.clone())),
        });
        (st, input, rec)
    }

    fn long_wait(id: &str) -> Macro {
        let mut m = Macro::new(id);
        m.id = id.into();
        m.steps.push(Step::Wait { id: "w".into(), ms: Jitter::exact(30_000) });
        m
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
        handle(&st, TriggerEvent::Start { macro_id: "m".into(), delay_ms: 0 });
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
        m.steps.push(Step::Wait { id: "w".into(), ms: Jitter::exact(5) });
        let (st, _, _) = state_with(vec![m]);
        handle(&st, TriggerEvent::Start { macro_id: "h".into(), delay_ms: 0 });
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
        handle(&st, TriggerEvent::Start { macro_id: "t".into(), delay_ms: 0 });
        assert!(wait_until(|| st.running_id().is_some(), 500));
        handle(&st, TriggerEvent::Start { macro_id: "t".into(), delay_ms: 0 });
        assert!(wait_until(|| st.running_id().is_none(), 500), "second press must stop it");
    }

    #[test]
    fn a_second_trigger_while_running_is_ignored() {
        let (st, _, _) = state_with(vec![long_wait("a"), long_wait("b")]);
        handle(&st, TriggerEvent::Start { macro_id: "a".into(), delay_ms: 0 });
        assert!(wait_until(|| st.running_id().is_some(), 500));
        handle(&st, TriggerEvent::Start { macro_id: "b".into(), delay_ms: 0 });
        std::thread::sleep(Duration::from_millis(30));
        assert_eq!(st.running_id().as_deref(), Some("a"));
        st.abort();
    }

    #[test]
    fn the_countdown_delays_the_first_input_and_can_be_cancelled() {
        let mut m = Macro::new("c");
        m.id = "c".into();
        m.steps.push(Step::Move {
            id: "mv".into(),
            x: 10,
            y: 10,
            anchor: crate::model::Anchor::Fixed,
            coord_jitter_px: 0,
            move_duration_ms: 0,
            capture: None,
        });
        let (st, input, _) = state_with(vec![m]);

        // cancelled mid-countdown: nothing is ever sent
        handle(&st, TriggerEvent::Start { macro_id: "c".into(), delay_ms: 2_000 });
        std::thread::sleep(Duration::from_millis(50));
        assert_eq!(st.running_id().as_deref(), Some("c"), "counting down counts as running");
        handle(&st, TriggerEvent::Panic);
        assert!(wait_until(|| st.running_id().is_none(), 500));
        std::thread::sleep(Duration::from_millis(50));
        assert!(input.events().is_empty(), "a cancelled countdown must not send input");

        // allowed to finish: input arrives only after the delay
        let t = Instant::now();
        handle(&st, TriggerEvent::Start { macro_id: "c".into(), delay_ms: 120 });
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
    fn switching_off_stops_whatever_is_running() {
        let (st, _, _) = state_with(vec![long_wait("m")]);
        handle(&st, TriggerEvent::Start { macro_id: "m".into(), delay_ms: 0 });
        assert!(wait_until(|| st.running_id().is_some(), 500));
        handle(&st, TriggerEvent::ToggleEnabled); // on -> off
        assert!(wait_until(|| st.running_id().is_none(), 500), "off must mean off");
    }

    #[test]
    fn the_binding_table_includes_the_toggle_hotkey() {
        let (st, _, _) = state_with(vec![]);
        let t = st.binding_table();
        assert_eq!(t.toggle.as_ref().map(|(vk, _)| *vk), Some(0x7B));
    }
}
