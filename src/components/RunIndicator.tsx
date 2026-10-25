import { useEffect, useState } from "react";
import { Check, ShieldAlert, Square, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isElevated, onRunFinished, onRunStatus, restartElevated, RUN_COUNTDOWN_MS, runStatus, stopMacro } from "@/lib/ipc";
import type { RunRecord, RunStatus } from "@/types";
import { Kbd } from "./layout";

export type PendingRun = { label: string; at: number; token: number };

/** How long "Finished" stays on the pill. */
const FINISHED_MS = 1500;

/** Bottom pill: the countdown after Run/Test, then "Running <name>" with how
 *  many presses are queued, and a Stop that also clears the queue. Shows runs
 *  started by a hotkey too, from the backend's run events (no polling). The
 *  user must always be able to tell that something is driving their mouse,
 *  and stop it: the pill names the panic key, which works even when this
 *  window is in the background. When a run ends it says so briefly, and when
 *  it fails it stays with the reason (and, if Windows blocked an app running
 *  as administrator, an offer to restart Pochini as administrator). */
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
  const [ended, setEnded] = useState<RunRecord | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [elevated, setElevated] = useState(true);

  useEffect(() => {
    runStatus().then(setStatus).catch(() => {});
    isElevated().then(setElevated).catch(() => {});
    const a = onRunStatus(setStatus);
    const b = onRunFinished((r) => setEnded(r));
    return () => {
      void a.then((f) => f());
      void b.then((f) => f());
    };
  }, []);

  // The countdown is the backend's; this only redraws the number.
  useEffect(() => {
    if (!pending) return;
    const t = window.setInterval(() => setNow(Date.now()), 100);
    // A Run that never started (the backend refused it) must not hang here.
    const giveUp = window.setTimeout(onDone, RUN_COUNTDOWN_MS + 5000);
    return () => {
      window.clearInterval(t);
      window.clearTimeout(giveUp);
    };
  }, [pending, onDone]);

  // A new Run or Test replaces whatever the pill said about the last one.
  useEffect(() => {
    if (pending) setEnded(null);
  }, [pending]);

  useEffect(() => {
    if (!ended) return;
    if (pending && ended.at_ms >= pending.at - 1000) onDone();
    if (ended.outcome.kind === "failed") return; // stays until dismissed
    const t = window.setTimeout(() => setEnded(null), ended.outcome.kind === "finished" ? FINISHED_MS : 0);
    return () => window.clearTimeout(t);
  }, [ended, pending, onDone]);

  const running = status?.macro_id ?? null;

  if (!running && !pending && ended) {
    const o = ended.outcome;
    if (o.kind === "failed") {
      return (
        <div
          role="alert"
          className="fixed bottom-6 left-1/2 z-50 flex max-w-[min(42rem,calc(100vw-2rem))] -translate-x-1/2 animate-in items-start gap-3 rounded-2xl border border-destructive/50 bg-popover py-2.5 pr-2 pl-4 text-sm text-popover-foreground shadow-2xl duration-200 fade-in-0 slide-in-from-bottom-3"
        >
          {o.admin ? (
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
          ) : (
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
          )}
          <span className="min-w-0 flex-1">
            <span className="font-medium">{ended.name}</span> stopped: {o.message}
          </span>
          {o.admin && !elevated && (
            <Button size="sm" variant="outline" className="rounded-full" onClick={() => void restartElevated()}>
              Restart as administrator
            </Button>
          )}
          <Button size="icon-sm" variant="ghost" className="rounded-full" aria-label="Dismiss" onClick={() => setEnded(null)}>
            <X />
          </Button>
        </div>
      );
    }
    if (o.kind === "finished") {
      return (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 animate-in items-center gap-2 rounded-full border border-success/40 bg-popover px-4 py-2 text-sm text-popover-foreground shadow-2xl duration-200 fade-in-0"
        >
          <Check className="size-4 animate-pop text-success" />
          <span>
            <span className="text-muted-foreground">Finished </span>
            <span className="font-medium">{ended.name}</span>
          </span>
        </div>
      );
    }
    return null;
  }

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
