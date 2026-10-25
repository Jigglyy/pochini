import { useEffect, useRef, useState, type ReactNode } from "react";
import { follow } from "@/lib/motion";

const DURATION = 220;

/** Content that opens and closes by animating its real height, Kanbini's
 *  grid-template-rows 0fr to 1fr technique. It stays mounted while closing so
 *  the close animates too, is inert while closed, and lets focus rings show
 *  past its edges once fully open.
 *
 *  Opening moves the screen with it, so the whole card it belongs to (its
 *  parent element) ends up in view; content that opens below the fold never
 *  stays hidden (see `follow`). Not on first render, so a screen does
 *  not jump when it loads with something already open (that is simply
 *  drawn open), unless `revealOnMount` (a step that was just added). */
export function Collapse({
  open,
  revealOnMount = false,
  children,
}: {
  open: boolean;
  revealOnMount?: boolean;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(open);
  // Open from the start: drawn open, not animated (a screen does not unfold
  // its sections as it loads), unless it is to be revealed.
  const [shown, setShown] = useState(open && !revealOnMount);
  const [settled, setSettled] = useState(open && !revealOnMount);
  const box = useRef<HTMLDivElement>(null);
  const innerEl = useRef<HTMLDivElement>(null);
  // The open state on the previous run (null before the first), so only a
  // real closed-to-open change reveals. Survives React StrictMode's double
  // effect run in development, which a "first run" flag would not.
  const prevOpen = useRef<boolean | null>(null);
  const revealed = useRef(false);
  const pendingReveal = useRef(false);

  // Opening is two steps. First mount the box (closed)...
  useEffect(() => {
    const was = prevOpen.current;
    prevOpen.current = open;
    if (open) {
      pendingReveal.current = was === false || (revealOnMount && !revealed.current);
      setMounted(true);
      return;
    }
    setSettled(false);
    setShown(false);
    const t = window.setTimeout(() => setMounted(false), DURATION);
    return () => window.clearTimeout(t);
    // revealOnMount only matters on the first run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ...then, once it is really on the page, animate it open and move the
  // screen along. Doing both in one effect raced on a busy machine: the
  // frames came before React had drawn the box, so there was nothing to
  // animate or follow and the step opened half off-screen.
  useEffect(() => {
    if (!open || !mounted) return;
    // Two frames: paint the closed state first, so the opening animates.
    // A timer (not transitionend, which never fires with animations off)
    // marks it fully open.
    let inner = 0;
    let settle = 0;
    let unfollow = () => {};
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        setShown(true);
        settle = window.setTimeout(() => setSettled(true), DURATION);
        const owner = box.current?.parentElement;
        if (pendingReveal.current && owner) {
          pendingReveal.current = false;
          revealed.current = true;
          unfollow = follow(owner, DURATION + 80);
        }
      });
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
      window.clearTimeout(settle);
      unfollow();
    };
  }, [open, mounted]);

  if (!mounted) return null;
  return (
    <div
      ref={box}
      className="grid transition-[grid-template-rows,opacity] duration-200 ease-smooth motion-reduce:transition-none"
      style={{ gridTemplateRows: shown ? "1fr" : "0fr", opacity: shown ? 1 : 0 }}
      inert={!shown}
    >
      <div ref={innerEl} className={settled ? "min-h-0" : "min-h-0 overflow-hidden"}>
        {children}
      </div>
    </div>
  );
}
