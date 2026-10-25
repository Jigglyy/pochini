import { useEffect, useState } from "react";
import { FolderOpen, TriangleAlert } from "lucide-react";
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
import { clearStorageProblem, openDataDir, storageProblem } from "@/lib/ipc";
import type { LoadProblem } from "@/types";

/** Says so when the macro file could not be read at startup, instead of
 *  quietly showing an empty list (see Store::open_macros). A locked library
 *  is never saved over until the user picks Start fresh. */
export function StorageNotice() {
  const [problem, setProblem] = useState<LoadProblem | null>(null);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    storageProblem().then(setProblem).catch(() => {});
  }, []);

  if (!problem) return null;

  const dismiss = async () => {
    await clearStorageProblem();
    setProblem(null);
  };
  const newer = problem.reason.includes("cannot read");
  const kept = problem.kept_at ? ` A copy of it was kept as ${problem.kept_at}.` : "";

  return (
    <div
      role="alert"
      className="mx-auto mb-6 flex w-full max-w-4xl flex-col gap-3 rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm"
    >
      <p className="flex items-start gap-2 font-medium text-destructive">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" />
        {problem.locked ? "Your macros could not be loaded" : "Your macros were restored from the backup"}
      </p>
      <p className="text-muted-foreground">
        {problem.locked
          ? `The macros file could not be read (${problem.reason}).${kept} Pochini will not save anything until you choose Start fresh, so the file stays as it is.`
          : `The macros file could not be read (${problem.reason}), so Pochini loaded the copy from before your last save.${kept}`}
        {newer && " It was saved by a newer Pochini: updating this one is the way to get your macros back."}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => void openDataDir()}>
          <FolderOpen />
          Open data folder
        </Button>
        {problem.locked ? (
          <Button variant="destructive" onClick={() => setConfirm(true)}>
            Start fresh...
          </Button>
        ) : (
          <Button variant="ghost" onClick={dismiss}>
            Got it
          </Button>
        )}
      </div>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start with an empty list?</AlertDialogTitle>
            <AlertDialogDescription>
              Pochini will save new macros over the unreadable file.
              {problem.kept_at ? " The copy it kept stays where it is." : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={dismiss}
            >
              Start fresh
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
