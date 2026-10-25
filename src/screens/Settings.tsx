import { useEffect, useState } from "react";
import { Check, ClipboardCopy, Download, FileText, FolderOpen, Monitor, Moon, ShieldCheck, Sun } from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HotkeyCheck } from "@/components/HotkeyCheck";
import { StepColorSettings } from "@/components/StepColors";
import { KeyCapture, comboLabel } from "@/components/KeyCapture";
import { Field, KeyCombo, Section, ToggleRow } from "@/components/layout";
import { DEFAULT_COLORS, KINDS, resetStepColors, useStepColors } from "@/lib/colors";
import {
  appInfo,
  autostartEnabled,
  clearRunHistory,
  exportAll,
  isElevated,
  onRunFinished,
  openDataDir,
  restartElevated,
  runHistory,
  saveSettings,
  setAutostart,
  thirdPartyNotices,
  type AppInfo,
} from "@/lib/ipc";
import { fmtRange } from "@/lib/steps";
import { SHORTCUTS } from "@/lib/shortcuts";
import type { ThemePref } from "@/lib/theme";
import { cn } from "@/lib/utils";
import type { RunRecord, Settings as SettingsT } from "@/types";

/** A run's ending, in words, for the history. */
function outcomeText(r: RunRecord): string {
  switch (r.outcome.kind) {
    case "finished":
      return "Finished";
    case "stopped":
      return "Stopped";
    case "cancelled":
      return "Cancelled before it started";
    case "failed":
      return r.outcome.message;
  }
}

const THEMES: { value: ThemePref; label: string; hint: string; Icon: typeof Sun }[] = [
  { value: "system", label: "System", hint: "Follow Windows", Icon: Monitor },
  { value: "light", label: "Light", hint: "Always light", Icon: Sun },
  { value: "dark", label: "Dark", hint: "Always dark", Icon: Moon },
];

export function Settings({
  settings,
  onSettings,
  theme,
  onTheme,
}: {
  settings: SettingsT | null;
  onSettings: (s: SettingsT) => void;
  theme: ThemePref;
  onTheme: (t: ThemePref) => void;
}) {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [notices, setNotices] = useState<string | null>(null);
  /** The last Backup result, or an error. */
  const [backup, setBackup] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [autostart, setAutostartState] = useState<boolean | null>(null);
  const [elevated, setElevated] = useState<boolean | null>(null);
  const [history, setHistory] = useState<RunRecord[]>([]);
  const colors = useStepColors();
  const customColors = KINDS.some((k) => colors[k] !== DEFAULT_COLORS[k]);
  useEffect(() => {
    appInfo().then(setInfo).catch(() => {});
    autostartEnabled().then(setAutostartState).catch(() => {});
    isElevated().then(setElevated).catch(() => {});
    runHistory().then(setHistory).catch(() => {});
    const un = onRunFinished((r) => setHistory((h) => [r, ...h].slice(0, 30)));
    return () => {
      void un.then((f) => f());
    };
  }, []);

  if (!settings) return <p className="mx-auto max-w-4xl text-sm text-muted-foreground">Loading...</p>;

  // Settings apply as soon as they change; there is no Save button.
  const save = (next: SettingsT) => {
    onSettings(next);
    void saveSettings(next);
  };

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
      <h2 className="font-display text-xl font-semibold tracking-tight">Settings</h2>

      <Section title="Hotkeys">
        <Field
          label="Macros on/off"
          help="Turns every macro hotkey on or off from anywhere, even inside a fullscreen game. It keeps working while macros are off, so it can turn them back on."
        >
          <KeyCapture
            value={settings.toggle_hotkey}
            onChange={(toggle_hotkey) => save({ ...settings, toggle_hotkey })}
            emptyLabel="No hotkey"
          />
        </Field>
        <Field
          label="Panic stop"
          help="Stops a running macro or countdown at once. Never blocked from other apps, and works while macros are off."
        >
          <KeyCapture
            value={{ key: settings.panic_key, modifiers: [] }}
            onChange={(h) => h && save({ ...settings, panic_key: h.key })}
            allowModifiers={false}
            allowClear={false}
          />
        </Field>
      </Section>

      <Section title="Window">
        <ToggleRow
          label="Keep running in the tray when the window is closed"
          help="Closing the window then leaves Pochini in the tray (by the clock), with every hotkey still working. Quit from the tray icon's menu."
          hint={settings.close_to_tray === null ? "Pochini asks the first time you close the window." : undefined}
          checked={settings.close_to_tray === true}
          onChange={(on) => save({ ...settings, close_to_tray: on })}
        />
        <ToggleRow
          label="Start with Windows"
          help="Pochini starts in the tray when you sign in to Windows, so your hotkeys are ready. Off unless you turn it on."
          checked={autostart === true}
          disabled={autostart === null}
          onChange={(on) =>
            setAutostart(on)
              .then(() => setAutostartState(on))
              .catch(() => {})
          }
        />
        <Field
          label="Administrator"
          help="Windows only lets programs that also run as administrator send input to apps that run as administrator. Pochini never asks for it on its own."
        >
          <span className="flex flex-1 items-center gap-1.5 pt-2 text-sm text-muted-foreground">
            {elevated && <ShieldCheck className="size-4 text-success" />}
            {elevated === null ? "" : elevated ? "Running as administrator" : "Not running as administrator"}
          </span>
          {elevated === false && (
            <Button variant="outline" onClick={() => void restartElevated()}>
              Restart as administrator
            </Button>
          )}
        </Field>
      </Section>

      <Section title="Appearance">
        <RadioGroup
          value={theme}
          onValueChange={(v) => onTheme(v as ThemePref)}
          className="grid grid-cols-1 gap-2 sm:grid-cols-3"
        >
          {THEMES.map(({ value, label, hint, Icon }) => (
            <label
              key={value}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm transition-colors",
                theme === value ? "border-primary/60 bg-accent" : "border-border hover:bg-accent",
              )}
            >
              <RadioGroupItem value={value} className="mt-0.5" />
              <span className="flex flex-col gap-0.5">
                <span className="flex items-center gap-1.5 font-medium text-foreground">
                  <Icon className="size-3.5" />
                  {label}
                </span>
                <span className="text-xs text-muted-foreground">{hint}</span>
              </span>
            </label>
          ))}
        </RadioGroup>
      </Section>

      <Section
        title="Step colors"
        help="Each kind of step has its own color in the editor. You can also right-click a step there to recolor it."
        action={
          customColors && (
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={resetStepColors}>
              Reset all
            </Button>
          )
        }
      >
        <StepColorSettings />
      </Section>

      <Section
        title="Backup"
        help="Saves every macro to one file you choose. Import on the macro list reads it back, here or on another PC."
      >
        <Field label="All macros">
          <Button
            variant="outline"
            onClick={() =>
              exportAll()
                .then((path) => path && setBackup({ ok: true, text: `Saved to ${path}` }))
                .catch((e) => setBackup({ ok: false, text: String(e) }))
            }
          >
            <Download />
            Export all macros...
          </Button>
          {backup && (
            <span role="status" className={cn("min-w-0 text-xs break-all", backup.ok ? "text-muted-foreground" : "text-destructive")}>
              {backup.text}
            </span>
          )}
        </Field>
      </Section>

      <Section
        title="Run history"
        help="The last runs since Pochini started, newest first, and how each one ended. Kept in memory only."
        action={
          history.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => clearRunHistory().then(() => setHistory([]))}
            >
              Clear
            </Button>
          )
        }
      >
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No runs yet.</p>
        ) : (
          history.map((r, i) => (
            <div key={`${r.at_ms}-${i}`} className="flex items-start gap-4 text-sm">
              <span className="w-20 shrink-0 pt-px text-xs tabular-nums text-muted-foreground">
                {new Date(r.at_ms).toLocaleTimeString()}
              </span>
              <span className="w-40 shrink-0 truncate font-medium">{r.name}</span>
              <span
                className={cn(
                  "min-w-0 flex-1 break-words",
                  r.outcome.kind === "failed" ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {outcomeText(r)}
              </span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{fmtRange([r.duration_ms, r.duration_ms])}</span>
            </div>
          ))
        )}
      </Section>

      <Section
        title="Hotkey check"
        help="Shows what Pochini receives when you press one of your hotkeys, to explain one that does nothing. Only keys you have set up are listed, never other typing."
      >
        <HotkeyCheck toggleCombo={settings.toggle_hotkey ? comboLabel(settings.toggle_hotkey) : null} />
      </Section>

      <Section
        title="App shortcuts"
        help="Keys that work while this window is focused. They are not hotkeys: a macro's hotkey that blocks its key from other apps comes first."
      >
        {SHORTCUTS.map((s) => (
          <div key={s.keys} className="flex items-center gap-4 text-sm">
            <span className="w-32 shrink-0">
              <KeyCombo combo={s.keys} />
            </span>
            <span className="min-w-0 flex-1">{s.action}</span>
            <span className="hidden text-xs text-muted-foreground sm:inline">{s.where}</span>
          </div>
        ))}
      </Section>

      {info && (
        <Section title="About">
          <Field label="Version">
            <span className="pt-2 text-sm tabular-nums">Pochini {info.version}</span>
          </Field>
          <Field
            label="Data folder"
            help="macros.json holds your macros (macros.bak is the previous save) and settings.json your settings."
          >
            <code className="min-w-0 flex-1 select-text break-all pt-2 font-mono text-xs text-muted-foreground">
              {info.data_dir}
            </code>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Copy the folder's path"
              title="Copy the folder's path"
              onClick={() =>
                navigator.clipboard.writeText(info.data_dir).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                })
              }
            >
              {copied ? <Check className="animate-pop text-success" /> : <ClipboardCopy />}
            </Button>
            <Button variant="outline" onClick={() => void openDataDir()}>
              <FolderOpen />
              Open
            </Button>
          </Field>
          <Field label="License">
            <span className="flex-1 pt-2 text-sm text-muted-foreground">
              MIT. Pochini also contains open source software by others.
            </span>
            <Button variant="outline" onClick={() => thirdPartyNotices().then(setNotices)}>
              <FileText />
              Third-party licenses
            </Button>
          </Field>
        </Section>
      )}

      <Dialog open={notices !== null} onOpenChange={(o) => !o && setNotices(null)}>
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Third-party licenses</DialogTitle>
            <DialogDescription>The open source software inside Pochini, and its licenses.</DialogDescription>
          </DialogHeader>
          <pre className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-card/40 p-3 font-mono text-xs whitespace-pre-wrap select-text">
            {notices}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}
