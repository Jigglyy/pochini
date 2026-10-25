//! A recording `InputBackend` for tests.
//!
//! This is what makes the engine testable without moving a real cursor: it
//! records the events that would have been injected, so a test can assert on
//! ordering, on every press having a matching release, and on jitter staying in
//! range - none of which you can check by squinting at a real screen.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Instant;

use super::coords::VirtualRect;
use super::{InputBackend, InputError, Monitor, Result};
use crate::model::{Modifier, MouseButton, ScrollAxis};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    Move(i32, i32),
    Button(MouseButton, bool),
    Scroll(ScrollAxis, i32, Option<(i32, i32)>),
    Key { scan: u16, extended: bool, down: bool },
    Modifier(Modifier, bool),
    Unicode(u16, bool),
}

pub struct FakeInput {
    pub rect: VirtualRect,
    events: Mutex<Vec<(Instant, Event)>>,
    /// When set, every call fails with this error, to exercise error paths.
    pub fail_with: Mutex<Option<&'static str>>,
    /// Where the cursor is before the first recorded move.
    start: (i32, i32),
    /// Pixels set by a test. Any other pixel is `[x, y, 0]` (as bytes), so a
    /// test can name a color that is already there.
    pixels: Mutex<HashMap<(i32, i32), [u8; 3]>>,
    /// Pretend the target runs as administrator (see `InputBackend::blocked`).
    pub blocked: AtomicBool,
    /// Where every app's window is (`InputBackend::window_origin`); `None`:
    /// no app has a window open.
    pub window: Mutex<Option<(i32, i32)>>,
}

impl FakeInput {
    pub fn new() -> Self {
        Self {
            // The dev machine's layout: 3 monitors, mixed DPI, negative origin.
            rect: VirtualRect { x: -1920, y: 0, w: 6400, h: 1440 },
            events: Mutex::new(Vec::new()),
            fail_with: Mutex::new(None),
            start: (0, 0),
            pixels: Mutex::new(HashMap::new()),
            blocked: AtomicBool::new(false),
            window: Mutex::new(Some((100, 50))),
        }
    }

    pub fn set_pixel(&self, x: i32, y: i32, rgb: [u8; 3]) {
        self.pixels.lock().unwrap().insert((x, y), rgb);
    }

    /// A fake whose cursor starts at (x, y), for activation-point tests.
    pub fn with_cursor(x: i32, y: i32) -> Self {
        Self { start: (x, y), ..Self::new() }
    }

    pub fn events(&self) -> Vec<Event> {
        self.events.lock().unwrap().iter().map(|(_, e)| e.clone()).collect()
    }

    /// Events with the instant each was injected, for asserting on the gaps
    /// between them (settle and dwell around a click).
    pub fn timeline(&self) -> Vec<(Instant, Event)> {
        self.events.lock().unwrap().clone()
    }

    pub fn clear(&self) {
        self.events.lock().unwrap().clear();
    }

    fn push(&self, e: Event) -> Result<()> {
        if self.fail_with.lock().unwrap().is_some() {
            return Err(InputError::AccessDenied);
        }
        self.events.lock().unwrap().push((Instant::now(), e));
        Ok(())
    }

    /// Every key/button that went down without a matching up, in press order.
    pub fn still_held(&self) -> Vec<Event> {
        let mut held: Vec<Event> = Vec::new();
        for e in self.events() {
            match &e {
                Event::Button(b, true) => held.push(Event::Button(*b, true)),
                Event::Button(b, false) => {
                    held.retain(|h| !matches!(h, Event::Button(hb, _) if hb == b))
                }
                Event::Key { scan, extended, down: true } => {
                    held.push(Event::Key { scan: *scan, extended: *extended, down: true })
                }
                Event::Key { scan, down: false, .. } => {
                    held.retain(|h| !matches!(h, Event::Key { scan: hs, .. } if hs == scan))
                }
                Event::Modifier(m, true) => held.push(Event::Modifier(*m, true)),
                Event::Modifier(m, false) => {
                    held.retain(|h| !matches!(h, Event::Modifier(hm, _) if hm == m))
                }
                Event::Unicode(u, true) => held.push(Event::Unicode(*u, true)),
                Event::Unicode(u, false) => {
                    held.retain(|h| !matches!(h, Event::Unicode(hu, _) if hu == u))
                }
                Event::Move(..) | Event::Scroll(..) => {}
            }
        }
        held
    }
}

impl Default for FakeInput {
    fn default() -> Self {
        Self::new()
    }
}

impl InputBackend for FakeInput {
    fn virtual_rect(&self) -> VirtualRect {
        self.rect
    }

    fn monitors(&self) -> Result<Vec<Monitor>> {
        Ok(vec![
            Monitor { device: r"\\.\DISPLAY1".into(), rect: [-1920, 156, 0, 1236], dpi: 96, primary: false },
            Monitor { device: r"\\.\DISPLAY2".into(), rect: [0, 0, 2560, 1440], dpi: 120, primary: true },
            Monitor { device: r"\\.\DISPLAY3".into(), rect: [2560, 159, 4480, 1239], dpi: 96, primary: false },
        ])
    }

    fn cursor_pos(&self) -> Result<(i32, i32)> {
        Ok(self
            .events()
            .iter()
            .rev()
            .find_map(|e| match e {
                Event::Move(x, y) => Some((*x, *y)),
                _ => None,
            })
            .unwrap_or(self.start))
    }

    fn move_to(&self, x: i32, y: i32) -> Result<()> {
        self.push(Event::Move(x, y))
    }

    fn button(&self, button: MouseButton, down: bool) -> Result<()> {
        self.push(Event::Button(button, down))
    }

    fn scroll(&self, axis: ScrollAxis, notches: i32, at: Option<(i32, i32)>) -> Result<()> {
        self.push(Event::Scroll(axis, notches, at))
    }

    fn key(&self, scan: u16, extended: bool, down: bool) -> Result<()> {
        self.push(Event::Key { scan, extended, down })
    }

    fn modifier(&self, m: Modifier, down: bool) -> Result<()> {
        self.push(Event::Modifier(m, down))
    }

    fn unicode(&self, unit: u16, down: bool) -> Result<()> {
        self.push(Event::Unicode(unit, down))
    }

    fn pixel(&self, x: i32, y: i32) -> Result<[u8; 3]> {
        Ok(self.pixels.lock().unwrap().get(&(x, y)).copied().unwrap_or([x as u8, y as u8, 0]))
    }

    fn blocked(&self, _at: Option<(i32, i32)>) -> bool {
        self.blocked.load(Ordering::SeqCst)
    }

    fn window_origin(&self, _process: &str) -> Option<(i32, i32)> {
        *self.window.lock().unwrap()
    }
}
