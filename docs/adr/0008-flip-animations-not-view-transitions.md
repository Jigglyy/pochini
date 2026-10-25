# 8. List animations use FLIP, not View Transitions

- **Status:** accepted
- **Date:** 2026-10-12

## Context

Lists that change by a click (sorting, starring, moving a step) should glide like Kanbini's.
The browser's View Transitions API does this with one call, and was tried first. While a
transition runs, Chromium sends every click to the page root, so quick repeated clicks (Move
down, Move down) were silently swallowed.

## Decision

`useFlip()` (`src/lib/motion.ts`): measure items before a change, apply it, and animate each
from where it was with the Web Animations API (transforms only), which never blocks input.
Expanding content uses grid-template-rows (`Collapse`), and follows the opening card so it
never ends up off-screen. Windows' "Animation effects" off turns all of it off.

## Consequences

- A little more code than one API call.
- `e2e/motion.spec.ts` guards the quick-repeated-clicks case.
