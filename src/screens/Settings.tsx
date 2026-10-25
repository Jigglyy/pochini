import { useEffect, useState } from "react";
import { Check, ClipboardCopy, Download, FileText, FolderOpen, Monitor, Moon, Sun } from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HotkeyCheck } from "@/components/HotkeyCheck";
import { StepColorSettings } from "@/components/StepColors";
import { KeyCapture, comboLabel } from "@/components/KeyCapture";
import { Field, KeyCombo, Section } from "@/components/layout";
import { DEFAULT_COLORS, KINDS, resetStepColors, useStepColors } from "@/lib/colors";
import { appInfo, exportAll, openDataDir, saveSettings, thirdPartyNotices, type AppInfo } from "@/lib/ipc";
import { SHORTCUTS } from "@/lib/shortcuts";
import type { ThemePref } from "@/lib/theme";
import { cn } from "@/lib/utils";
import type { Settings as SettingsT } from "@/types";

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
  const colors = useStepColors();
  const customColors = KINDS.some((k) => colors[k] !== DEFAULT_COLORS[k]);
  useEffect(() => {
    appInfo().then(setInfo).catch(() => {});
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

      <Section
        title="Hotkey check"
        help="Shows what Pochini receives when you press one of your hotkeys, to explain one that does nothing. Only keys you have set up are listed, never other typing."
      >
        <HotkeyCheck toggleCombo={settings.toggle_hotkey ? comboLabel(settings.toggle_hotkey) : null} />
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
