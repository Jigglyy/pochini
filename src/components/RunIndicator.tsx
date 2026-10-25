import { useEffect, useRef, useState } from "react";
import { Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RUN_COUNTDOWN_MS, runStatus, stopMacro } from "@/lib/ipc";
import type { RunStatus } from "@/types";
import { Kbd } from "./layout";

export type PendingRun = { label: string; at: number; token: number };

/** Bottom pill: the countdown after Run/Test, then "Running <name>" with how
 *  many presses are queued, and a Stop that also clears the queue. Shows runs
 *  started by a hotkey too. The user must always be able to tell that
 *  something is driving their mouse, and stop it: the pill names the panic
 *  key, which works even when this window is in the background. */
export function RunIndicator({
  pending,
  onDone,
  panicKey,
}: {
  pending: PendingRun | null;
  onDone: () => void;
  panicKey: string;
}) {
  const [status, setStatus] = useState<RunStatus | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const seenRunning = useRef(false);

  useEffect(() => {
    seenRunning.current = false;
  }, [pending?.token]);

  useEffect(() => {
    const t = window.setInterval(async () => {
      setNow(Date.now());
      try {
        const s = await runStatus();
        setStatus(s);
        if (s.macro_id) {
          seenRunning.current = true;
        } else if (pending && (seenRunning.current || Date.now() - pending.at > RUN_COUNTDOWN_MS + 2000)) {
          onDone();
        }
      } catch {
        /* backend busy for a tick; try again */
      }
    }, 200);
    return () => window.clearInterval(t);
  }, [pending, onDone]);

  const running = status?.macro_id ?? null;
  if (!running && !pending) return null;

  const left = pending ? RUN_COUNTDOWN_MS - (now - pending.at) : 0;
  const counting = pending !== null && left > 0;
  const queued = status?.queued ?? 0;

  return (
    <div
      role="status"
      className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 animate-in items-center gap-3 rounded-full border border-border bg-popover py-1.5 pl-4 pr-1.5 text-sm text-popover-foreground shadow-2xl duration-200 fade-in-0 slide-in-from-bottom-3"
    >
      <span className="relative flex size-2.5">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
        <span className="relative inline-flex size-2.5 rounded-full bg-primary" />
      </span>
      {counting ? (
        <span>
          <span className="font-medium tabular-nums">Starting in {Math.ceil(left / 1000)}</span>
          <span className="text-muted-foreground">: switch to your target and place the mouse</span>
        </span>
      ) : (
        <span>
          <span className="text-muted-foreground">Running </span>
          <span className="font-medium">{status?.name || pending?.label || "a macro"}</span>
          {queued > 0 && <span className="tabular-nums text-muted-foreground"> · {queued} queued</span>}
        </span>
      )}
      <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex" aria-label={`${panicKey} stops it`}>
        <Kbd>{panicKey}</Kbd> stops it
      </span>
      <Button
        size="sm"
        variant="outline"
        className="rounded-full"
        onClick={() => {
          void stopMacro();
          onDone();
        }}
      >
        <Square className="fill-current" />
        {counting ? "Cancel" : queued > 0 ? "Stop all" : "Stop"}
      </Button>
    </div>
  );
}
