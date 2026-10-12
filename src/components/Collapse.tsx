import { useEffect, useState, type ReactNode } from "react";

const DURATION = 220;

/** Content that opens and closes by animating its real height, Kanbini's
 *  grid-template-rows 0fr to 1fr technique. It stays mounted while closing so
 *  the close animates too, is inert while closed, and lets focus rings show
 *  past its edges once fully open. */
export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      // Two frames: paint the closed state first, so the opening animates.
      // A timer (not transitionend, which never fires with animations off)
      // marks it fully open.
      let inner = 0;
      let settle = 0;
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => {
          setShown(true);
          settle = window.setTimeout(() => setSettled(true), DURATION);
        });
      });
      return () => {
        cancelAnimationFrame(outer);
        cancelAnimationFrame(inner);
        window.clearTimeout(settle);
      };
    }
    setSettled(false);
    setShown(false);
    const t = window.setTimeout(() => setMounted(false), DURATION);
    return () => window.clearTimeout(t);
  }, [open]);

  if (!mounted) return null;
  return (
    <div
      className="grid transition-[grid-template-rows,opacity] duration-200 ease-smooth motion-reduce:transition-none"
      style={{ gridTemplateRows: shown ? "1fr" : "0fr", opacity: shown ? 1 : 0 }}
      inert={!shown}
    >
      <div className={settled ? "min-h-0" : "min-h-0 overflow-hidden"}>{children}</div>
    </div>
  );
}
