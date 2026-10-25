# 7. Imported macros arrive switched off and must be reviewed

- **Status:** accepted
- **Date:** 2026-10-25

## Context

Macros are shared as `.pochini.json` files or pasted as text. A shared macro is a small
program: it can type into whatever has focus and press shortcuts that open things, so a
file doing Win+R, then typing a command, then Enter is one switch flip away from running.

## Decision

Every imported macro is a new macro (fresh ids, a unique name) with its hotkey **off** and
`review: true`. The backend refuses to switch it on or run it while `review` is set; doing
either in the UI first shows every step in plain words, with the ones that type text or press
Ctrl/Alt/Win shortcuts flagged. "Looks good" clears `review`, and so does saving the macro in
the editor, which shows every step. Exports leave out what is about the sender: the star, the
window title an app was picked from, the monitor each point was picked on.

## Consequences

- One extra dialog the first time someone uses a macro they did not write.
- The hotkey travels with the macro (useful for sharing), but cannot fire before the review.
