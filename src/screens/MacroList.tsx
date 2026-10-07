import { useEffect, useState } from "react";
import { Copy, MoreHorizontal, Pencil, Play, Plus, Trash2 } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { KeyCombo, Kbd } from "@/components/layout";
import { comboLabel } from "@/components/KeyCapture";
import {
  createMacro,
  deleteMacro,
  duplicateMacro,
  listMacros,
  runMacro,
  setMacroEnabled,
} from "@/lib/ipc";
import { fmtRange } from "@/lib/steps";
import { cn } from "@/lib/utils";
import type { MacroSummary, Settings } from "@/types";

export function MacroList({
  settings,
  onOpen,
  onRun,
}: {
  settings: Settings | null;
  onOpen: (id: string) => void;
  onRun: (label: string) => void;
}) {
  const [rows, setRows] = useState<MacroSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<MacroSummary | null>(null);

  const reload = () =>
    listMacros()
      .then((r) => {
        setRows(r);
        setErr(null);
      })
      .catch((e) => setErr(String(e)));

  useEffect(() => {
    reload();
  }, []);

  const create = async () => {
    try {
      const m = await createMacro("New macro");
      onOpen(m.id);
    } catch (e) {
      setErr(String(e));
    }
  };

  const toggleRow = async (r: MacroSummary, enabled: boolean) => {
    setRows((rs) => rs?.map((x) => (x.id === r.id ? { ...x, enabled } : x)) ?? rs);
    try {
      await setMacroEnabled(r.id, enabled);
    } catch (e) {
      setErr(String(e));
      reload();
    }
  };

  const off = settings ? !settings.enabled : false;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      {off && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Macros are off.</span>
          <span>Hotkeys are ignored. Turn them back on with the switch in the top right</span>
          {settings?.toggle_hotkey ? (
            <>
              <span>or press</span>
              <KeyCombo combo={comboLabel(settings.toggle_hotkey)} />
            </>
          ) : (
            <span>.</span>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight">Your macros</h2>
        <Button onClick={create}>
          <Plus />
          New macro
        </Button>
      </div>

      {err && (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 p-2.5 text-sm text-destructive">
          {err}
        </p>
      )}

      {rows && rows.length > 0 && (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li
              key={r.id}
              className={cn(
                "flex items-center gap-4 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:border-primary/40",
                !r.enabled && "bg-card/50",
              )}
            >
              <button
                type="button"
                onClick={() => onOpen(r.id)}
                className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left outline-none focus-visible:underline"
              >
                <span
                  className={cn(
                    "max-w-full truncate font-medium",
                    !r.enabled && "text-muted-foreground",
                  )}
                >
                  {r.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {r.step_count} step{r.step_count === 1 ? "" : "s"} · {fmtRange(r.duration_ms)}
                </span>
              </button>

              {r.conflict && (
                <Badge variant="outline" className="border-warning/50 text-warning">
                  Hotkey clash
                </Badge>
              )}
              <div className={cn("hidden sm:block", !r.enabled && "opacity-50")}>
                {r.hotkey ? (
                  <KeyCombo combo={r.hotkey} />
                ) : (
                  <span className="text-xs italic text-muted-foreground">No hotkey</span>
                )}
              </div>

              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <Switch
                      checked={r.enabled}
                      onCheckedChange={(c) => toggleRow(r, c)}
                      aria-label={`${r.name} hotkey ${r.enabled ? "on" : "off"}`}
                    />
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {r.enabled ? "Hotkey on. Click to ignore it." : "Hotkey off. Click to listen for it."}
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      onRun(r.name);
                      runMacro(r.id).catch((e) => setErr(String(e)));
                    }}
                  >
                    <Play />
                    Run
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Starts after a 3 second countdown</TooltipContent>
              </Tooltip>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${r.name}`}>
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => onOpen(r.id)}>
                    <Pencil />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={async () => {
                      await duplicateMacro(r.id);
                      reload();
                    }}
                  >
                    <Copy />
                    Duplicate
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => setPendingDelete(r)}>
                    <Trash2 />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}

      {rows && rows.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card/40 p-12 text-center">
          <p className="text-sm text-muted-foreground">
            No macros yet. Create one, add a few clicks, and bind it to a key.
          </p>
          <Button onClick={create}>
            <Plus />
            Create your first macro
          </Button>
        </div>
      )}

      {settings && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>Panic stop</span>
          <Kbd>{settings.panic_key.label}</Kbd>
          <span>stops a running macro at once.</span>
        </p>
      )}

      <AlertDialog open={pendingDelete !== null} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{pendingDelete?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Its steps and hotkey are removed. The previous version of your macro file is kept as
              macros.bak, but there is no undo here.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                if (!pendingDelete) return;
                await deleteMacro(pendingDelete.id);
                setPendingDelete(null);
                reload();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
