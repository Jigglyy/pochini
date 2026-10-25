import { onPicked, startPick } from "./ipc";

let busy: Promise<[number, number] | null> | null = null;

/** Click-to-pick: resolves with where the user clicks next, anywhere on
 *  screen (the click never reaches the app there), or null if they cancel
 *  with the panic key. A magnifier follows the cursor meanwhile. One pick at
 *  a time: a second call joins the first. */
export function pickPoint(): Promise<[number, number] | null> {
  if (busy) return busy;
  busy = new Promise((resolve) => {
    let stop: (() => void) | undefined;
    const done = (at: [number, number] | null) => {
      stop?.();
      busy = null;
      resolve(at);
    };
    onPicked(done)
      .then((un) => {
        stop = un;
        return startPick();
      })
      .catch(() => done(null));
  });
  return busy;
}
