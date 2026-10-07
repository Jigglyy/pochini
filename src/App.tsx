import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, Settings as SettingsIcon } from "lucide-react";
import logo from "../assets/pochini-icon.svg";
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
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { comboLabel } from "@/components/KeyCapture";
import { RunIndicator, type PendingRun } from "@/components/RunIndicator";
import { getSettings, onSettingsChanged, setEnabled } from "@/lib/ipc";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { MacroEditor } from "@/screens/MacroEditor";
import { MacroList } from "@/screens/MacroList";
import { Settings } from "@/screens/Settings";
import type { Settings as SettingsT } from "@/types";

type Route = { kind: "home" } | { kind: "editor"; id: string } | { kind: "settings"; back: Route };

export default function App() {
  const [route, setRoute] = useState<Route>({ kind: "home" });
  const [settings, setSettings] = useState<SettingsT | null>(null);
  const [editorName, setEditorName] = useState("");
  const [pending, setPending] = useState<PendingRun | null>(null);
  const [theme, setTheme] = useTheme();
  const [editorDirty, setEditorDirty] = useState(false);
  const [pendingNav, setPendingNav] = useState<Route | null>(null);

  /** Navigate, but ask first if the editor has unsaved changes. */
  const navigate = (to: Route) => {
    if (route.kind === "editor" && editorDirty) {
      setPendingNav(to);
      return;
    }
    setRoute(to);
  };

  useEffect(() => {
    getSettings().then(setSettings).catch(() => {});
    // The toggle hotkey can flip the master switch while we are in the
    // background; keep the switch on screen honest.
    const un = onSettingsChanged(setSettings);
    return () => {
      void un.then((f) => f());
    };
  }, []);

  const onRun = useCallback((label: string) => {
    setPending({ label, at: Date.now(), token: Math.random() });
  }, []);
  const onRunDone = useCallback(() => setPending(null), []);

  const enabled = settings?.enabled ?? true;
  const toggleMaster = (next: boolean) => {
    if (settings) setSettings({ ...settings, enabled: next });
    void setEnabled(next);
  };

  const goHome = () => navigate({ kind: "home" });

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-6 py-3">
        <img src={logo} alt="" aria-hidden draggable={false} className="size-9 shrink-0" />
        <h1 className="text-lg font-semibold tracking-tight">Pochini</h1>

        {route.kind !== "home" && (
          <>
            <span aria-hidden className="h-5 w-px bg-border" />
            <button
              type="button"
              onClick={() => (route.kind === "settings" ? setRoute(route.back) : goHome())}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ChevronLeft className="size-4" />
              {route.kind === "settings" && route.back.kind === "editor" ? "Back" : "Macros"}
            </button>
            <span aria-hidden className="text-muted-foreground/60">
              /
            </span>
            <span className="max-w-64 truncate text-sm font-medium">
              {route.kind === "editor" ? editorName || "Untitled" : "Settings"}
            </span>
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <label
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-1.5 text-sm transition-colors",
                  enabled ? "border-success/40 bg-success/10" : "border-border bg-muted/50",
                )}
              >
                <span
                  aria-hidden
                  className={cn("size-2 rounded-full", enabled ? "bg-success" : "bg-muted-foreground/50")}
                />
                <span className={cn("font-medium", !enabled && "text-muted-foreground")}>
                  {enabled ? "Macros on" : "Macros off"}
                </span>
                <Switch checked={enabled} onCheckedChange={toggleMaster} aria-label="Macros on or off" />
              </label>
            </TooltipTrigger>
            <TooltipContent>
              {settings?.toggle_hotkey
                ? `Toggle from anywhere with ${comboLabel(settings.toggle_hotkey)}`
                : "Set a toggle hotkey in Settings"}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Settings"
                onClick={() => route.kind !== "settings" && navigate({ kind: "settings", back: route })}
                className={cn(route.kind === "settings" && "bg-accent")}
              >
                <SettingsIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Settings</TooltipContent>
          </Tooltip>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-6 py-8">
        {route.kind === "home" && (
          <MacroList
            settings={settings}
            onOpen={(id) => {
              setEditorName("");
              setRoute({ kind: "editor", id });
            }}
            onRun={onRun}
          />
        )}
        {route.kind === "editor" && (
          <MacroEditor
            key={route.id}
            id={route.id}
            onName={setEditorName}
            onRun={onRun}
            onDirtyChange={setEditorDirty}
          />
        )}
        {route.kind === "settings" && (
          <Settings settings={settings} onSettings={setSettings} theme={theme} onTheme={setTheme} />
        )}
      </main>

      <RunIndicator pending={pending} onDone={onRunDone} />

      <AlertDialog open={pendingNav !== null} onOpenChange={(o) => !o && setPendingNav(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              "{editorName || "This macro"}" has changes that are not saved yet.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const to = pendingNav;
                setPendingNav(null);
                setEditorDirty(false);
                if (to) setRoute(to);
              }}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
