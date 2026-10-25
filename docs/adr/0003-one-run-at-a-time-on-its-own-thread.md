# 3. One macro at a time, each run on its own thread

- **Status:** accepted
- **Date:** 2026-10-07

## Context

The first engine ran macros inline in the worker loop that receives hotkey events. A run of
any length then held up everything behind it: the panic key, the Stop button, and the release
of a "repeat while held" key all waited for the very macro they were meant to stop. Running
two macros at once is no better: two runs moving one cursor produce nonsense.

## Decision

The worker loop never blocks. Each run gets its own thread; the loop handles Panic, Stop,
Toggle and new presses the moment they arrive, and cancels the run through a `CancelToken`
whose waits are interruptible kernel waits (`engine/timer.rs`).

Only one macro runs at a time. A press that arrives meanwhile is ignored, unless that macro
has **Queue presses** on: then it waits in a FIFO queue (at most 50) and the run thread starts
it as soon as the current run ends. Panic and the master switch clear the queue.

## Consequences

- The panic key always works, whatever is running (CLAUDE.md rule 8).
- `app.rs` tests drive the real worker with a fake backend: panic mid-run, hold-repeat
  release, toggle second press, countdown cancel, queue order and cap.
- Running two macros together would need a new design, not a flag.
