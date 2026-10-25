# 9. Release builds unwind, so a panic still lets go of held keys

- **Status:** accepted
- **Date:** 2026-10-25

## Context

A macro can hold keys and buttons (a shift-click, "hold down Q"). `HeldState` and the release
pass make sure every cancel and error lets go of them. The release profile used
`panic = "abort"`, Tauri's template default, so a panic anywhere in a step ended the process
with Windows still holding the key down for the whole system.

## Decision

`panic = "unwind"` in the release profile. `Engine::run_at` runs the steps inside
`catch_unwind`, always runs the release pass, and reports the panic as
`EngineError::Internal`, which also keeps the worker alive.

## Consequences

- A slightly larger exe.
- Never switch the profile back to `abort` (CLAUDE.md > Conventions).
