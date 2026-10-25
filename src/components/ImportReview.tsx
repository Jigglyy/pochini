import { useEffect, useState } from "react";
import { Pencil, TriangleAlert } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { comboLabel } from "@/components/KeyCapture";
import { getMacro } from "@/lib/ipc";
import { macroConcerns, stepConcern } from "@/lib/review";
import { summarize } from "@/lib/steps";
import type { Macro } from "@/types";

export type ReviewThen = "enable" | "run";

/** Shown before an imported macro is switched on or run for the first time:
 *  every step in plain words, with the ones that type or press shortcuts
 *  flagged. "Looks good" marks it reviewed and carries on with `then`. */
export function ImportReview({
  id,
  then,
  onConfirm,
  onEdit,
  onClose,
}: {
  id: string | null;
  then: ReviewThen;
  onConfirm: (id: string) => void;
  onEdit: (id: string) => void;
  onClose: () => void;
}) {
  const [m, setM] = useState<Macro | null>(null);

  // Keyed on the id alone: `onClose` is a new function on every render.
  useEffect(() => {
    setM(null);
    if (id) getMacro(id).then(setM).catch(() => {});
  }, [id]);

  const concerns = m ? macroConcerns(m) : [];
  const runs =
    m?.repeat.kind === "forever" ? "until stopped" : m?.repeat.kind === "count" ? `${m.repeat.n} times` : "once";

  return (
    <AlertDialog open={id !== null} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent className="sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>Check "{m?.name ?? "this macro"}" first</AlertDialogTitle>
          <AlertDialogDescription>
            It came from a file, so someone else wrote it. It moves your mouse and presses keys: make sure
            you know what it does before it runs.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {m && (
          <div className="flex flex-col gap-3 text-sm">
            <p className="text-muted-foreground">
              Hotkey <span className="text-foreground">{m.trigger ? comboLabel(m.trigger) : "none"}</span>, runs{" "}
              <span className="text-foreground">{runs}</span>
              {m.guard?.process ? (
                <>
                  , only in <span className="text-foreground">{m.guard.process}</span>
                </>
              ) : null}
              .
            </p>
            {concerns.map((c) => (
              <p key={c} className="flex items-start gap-2 text-warning">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                {c}
              </p>
            ))}
            <ol
              aria-label="Steps"
              className="flex max-h-72 flex-col divide-y divide-border overflow-y-auto rounded-md border border-border bg-card/40"
            >
              {m.steps.length === 0 && <li className="px-3 py-2 text-muted-foreground">No steps.</li>}
              {m.steps.map((s, i) => {
                const concern = stepConcern(s);
                return (
                  <li key={s.id} className="flex flex-col gap-0.5 px-3 py-2">
                    <span className="flex gap-2">
                      <span className="w-5 shrink-0 text-right text-muted-foreground tabular-nums">{i + 1}.</span>
                      <span className="min-w-0 break-words">
                        {s.type === "text" ? `Type "${s.value}"` : summarize(s)}
                      </span>
                    </span>
                    {concern && (
                      <span className="flex items-center gap-1.5 pl-7 text-xs text-warning">
                        <TriangleAlert className="size-3.5 shrink-0" />
                        {concern}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button variant="outline" disabled={!m} onClick={() => m && onEdit(m.id)}>
            <Pencil />
            Open in editor
          </Button>
          <AlertDialogAction disabled={!m} onClick={() => m && onConfirm(m.id)}>
            {then === "run" ? "Looks good, run it" : "Looks good, turn it on"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
