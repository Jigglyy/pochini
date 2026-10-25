// Undo and redo for the editor's unsaved macro: snapshots, newest last.
// Edits to the same thing within COALESCE_MS (typing a name, nudging one
// step's number) become one undo step, as text editors do. Pure, so the
// rules are unit-tested; MacroEditor holds the state.

export const LIMIT = 100;
export const COALESCE_MS = 600;

export type History<T> = {
  past: T[];
  present: T;
  future: T[];
  /** What the last edit touched, and when, for coalescing. */
  lastKey?: string;
  lastAt: number;
};

export const start = <T>(present: T): History<T> => ({ past: [], present, future: [], lastAt: 0 });

/** `next` replaces the present. `key` names what changed ("name", a step id);
 *  without one, every edit is its own undo step. */
export function record<T>(h: History<T>, next: T, now: number, key?: string): History<T> {
  const coalesce = key !== undefined && key === h.lastKey && now - h.lastAt < COALESCE_MS;
  return {
    past: coalesce ? h.past : [...h.past, h.present].slice(-LIMIT),
    present: next,
    future: [],
    lastKey: key,
    lastAt: now,
  };
}

export function undo<T>(h: History<T>): History<T> {
  const prev = h.past[h.past.length - 1];
  if (prev === undefined) return h;
  return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future], lastAt: 0 };
}

export function redo<T>(h: History<T>): History<T> {
  const [next, ...rest] = h.future;
  if (next === undefined) return h;
  return { past: [...h.past, h.present].slice(-LIMIT), present: next, future: rest, lastAt: 0 };
}
