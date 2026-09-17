# 1. Record architecture decisions

- **Status:** accepted
- **Date:** 2026-09-17

## Context

This project has a handful of decisions that are expensive to revisit — the stack, the hotkey
mechanism, the input API — and the reasoning behind them is not visible from the code. A
future reader (human or Claude) looking at `WH_KEYBOARD_LL` in `hotkey/` has no way to know
that `RegisterHotKey` was considered and rejected for a specific reason, and will waste time
re-deriving it or, worse, "simplify" it back.

## Decision

Record each significant decision as a short numbered file in `docs/adr/`, in the format
popularised by Michael Nygard: context, decision, consequences.

An ADR is warranted when a choice is hard to reverse, when a plausible alternative was
rejected for a non-obvious reason, or when the decision constrains future work. Routine
choices do not need one.

ADRs are immutable once accepted. A change means a new ADR that supersedes the old one, with
both statuses updated.

## Consequences

- Slight overhead per significant decision.
- The "why not X?" question has an answer in the repo instead of in someone's memory.
- `CLAUDE.md` can stay short by linking to ADRs rather than restating rationale.
