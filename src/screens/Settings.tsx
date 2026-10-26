import { useEffect, useState, type ReactNode } from "react";
import {
  Check,
  ClipboardCopy,
  Columns2,
  LayoutGrid,
  Download,
  FileText,
  FolderOpen,
  Monitor,
  Moon,
  Rows2,
  Rows4,
  ShieldCheck,
  Sun,
} from "lucide-react";
import logo from "../../assets/pochini-icon.svg";
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
import { readPrefs, writePrefs, type StepView } from "@/lib/prefs";
import { fmtRange } from "@/lib/steps";
import { SHORTCUTS, type ShortcutPlace } from "@/lib/shortcuts";
import type { ThemePref } from "@/lib/theme";
import { cn } from "@/lib/utils";
import type { RunRecord, Settings as SettingsT } from "@/types";

// Settings, laid out like Kanbini's: a sidebar of sections in groups, and
// one section at a time beside it. The section you were on is remembered
// (UI state, so its own localStorage key rather than the prefs blob, as in
// Kanbini). Every setting applies as soon as it changes; there is no Save.

export type SectionId =
  | "hotkeys"
  | "history"
  | "check"
  | "appearance"
  | "colors"
  | "shortcuts"
  | "system"
  | "backup"
  | "about";

/** The sidebar, top down: what macros do, how Pochini looks and is driven,
 *  then the utility rows (its place in Windows, your data, the app). A group
 *  without a header sits under a hairline instead. */
export const SECTION_GROUPS: { header: string | null; sections: { id: SectionId; label: string }[] }[] = [
  {
    header: "Macros",
    sections: [
      { id: "hotkeys", label: "Hotkeys" },
      { id: "history", label: "Run history" },
      { id: "check", label: "Hotkey check" },
    ],
  },
  {
    header: "Personalize",
    sections: [
      { id: "appearance", label: "Appearance" },
      { id: "colors", label: "Step colors" },
      { id: "shortcuts", label: "Shortcuts" },
    ],
  },
  {
    header: null,
    sections: [
      { id: "system", label: "Window and startup" },
      { id: "backup", label: "Backup" },
      { id: "about", label: "About" },
    ],
  },
];

const SECTION_KEY = "pochini.lastSettingsSection";

/** The section to open on: the last one, or Hotkeys when it is missing or
 *  no longer exists. */
export function loadSection(): SectionId {
  try {
    const raw = localStorage.getItem(SECTION_KEY);
    if (SECTION_GROUPS.some((g) => g.sections.some((s) => s.id === raw))) return raw as SectionId;
  } catch {
    /* storage blocked: start at the top */
  }
  return "hotkeys";
}

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

/** Mutually exclusive choices as a column of bordered rows, each with a
 *  hint (Kanbini's RadioRow). */
function ChoiceList<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string; hint: string; Icon: typeof Sun }[];
  onChange: (v: T) => void;
}) {
  return (
    <RadioGroup aria-label={label} value={value} onValueChange={(v) => onChange(v as T)} className="flex flex-col gap-2">
      {options.map(({ value: v, label: text, hint, Icon }) => (
        <label
          key={v}
          className={cn(
            "flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm transition-colors",
            value === v ? "border-primary/60 bg-accent" : "border-border hover:bg-accent",
          )}
        >
          <RadioGroupItem value={v} className="mt-0.5" />
          <span className="flex flex-col gap-0.5">
            <span className="flex items-center gap-1.5 font-medium text-foreground">
              <Icon className="size-3.5" />
              {text}
            </span>
            <span className="text-xs text-muted-foreground">{hint}</span>
          </span>
        </label>
      ))}
    </RadioGroup>
  );
}

const THEMES = [
  { value: "system", label: "System", hint: "Follow Windows.", Icon: Monitor },
  { value: "light", label: "Light", hint: "Always light.", Icon: Sun },
  { value: "dark", label: "Dark", hint: "Always dark.", Icon: Moon },
] as const satisfies readonly { value: ThemePref; label: string; hint: string; Icon: typeof Sun }[];

const STEP_VIEWS = [
  { value: "cards", label: "Cards", hint: "One card per step.", Icon: Rows2 },
  { value: "compact", label: "Compact list", hint: "Dense rows, about half the height.", Icon: Rows4 },
  { value: "split", label: "Side by side", hint: "The list, with the chosen step's settings beside it.", Icon: Columns2 },
  { value: "squares", label: "Squares", hint: "A grid of squares, with the chosen step's settings beside it.", Icon: LayoutGrid },
] as const satisfies readonly { value: StepView; label: string; hint: string; Icon: typeof Sun }[];

/** What the mouse does, for Settings > Shortcuts. */
const MOUSE: { action: string; how: string }[] = [
  { action: "Open or close a step", how: "Click its header" },
  { action: "Move a step or a macro", how: "Drag it" },
  { action: "Insert, move, recolor or select a step", how: "Right-click it" },
  { action: "Start selecting, with that step", how: "Ctrl+Click" },
  { action: "Tick every step in between, while selecting", how: "Shift+Click" },
];

const PLACES: ShortcutPlace[] = ["Macro list", "Editor", "Anywhere in the window"];

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
  const [section, setSectionState] = useState<SectionId>(loadSection);
  const setSection = (id: SectionId) => {
    setSectionState(id);
    try {
      localStorage.setItem(SECTION_KEY, id);
    } catch {
      /* the section just won't be remembered */
    }
  };

  if (!settings) return <p className="page-column text-sm text-muted-foreground">Loading...</p>;

  // Settings apply as soon as they change; there is no Save button.
  const save = (next: SettingsT) => {
    onSettings(next);
    void saveSettings(next);
  };

  return (
    <div className="page-column flex flex-col gap-6">
      <h2 className="font-display text-xl font-semibold tracking-tight">Settings</h2>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-[12rem_minmax(0,1fr)] md:gap-8">
        {/* A sidebar from md up; on a narrow window a row that scrolls
            sideways, where the group headers would only be noise. */}
        <nav aria-label="Settings sections" className="flex flex-row gap-1 overflow-x-auto md:flex-col md:gap-0.5">
          {SECTION_GROUPS.map((g, gi) => (
            <div
              key={g.header ?? `group-${gi}`}
              className={cn(
                "contents md:flex md:flex-col md:gap-0.5",
                gi > 0 && !g.header && "md:mt-3 md:border-t md:border-border md:pt-3",
              )}
            >
              {g.header && (
                <h3 className={cn("hidden px-3 pb-1 text-xs font-medium text-muted-foreground md:block", gi > 0 && "pt-3")}>
                  {g.header}
                </h3>
              )}
              {g.sections.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSection(s.id)}
                  aria-current={s.id === section ? "page" : undefined}
                  className={cn(
                    "shrink-0 rounded-md px-3 py-1.5 text-left text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    s.id === section
                      ? "bg-accent font-medium text-foreground"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          ))}
        </nav>

        {/* Keyed, so each section fades in like a screen does. */}
        <div key={section} className="flex min-w-0 animate-in flex-col gap-8 duration-200 fade-in-0 motion-reduce:animate-none">
          {section === "hotkeys" && <HotkeysSection settings={settings} save={save} />}
          {section === "history" && <HistorySection />}
          {section === "check" && (
            <Section
              title="Hotkey check"
              help="Shows what Pochini receives when you press one of your hotkeys, to explain one that does nothing. Only keys you have set up are listed, never other typing."
            >
              <HotkeyCheck toggleCombo={settings.toggle_hotkey ? comboLabel(settings.toggle_hotkey) : null} />
            </Section>
          )}
          {section === "appearance" && <AppearanceSection theme={theme} onTheme={onTheme} />}
          {section === "colors" && <ColorsSection />}
          {section === "shortcuts" && <ShortcutsSection />}
          {section === "system" && <SystemSection settings={settings} save={save} />}
          {section === "backup" && <BackupSection />}
          {section === "about" && <AboutSection />}
        </div>
      </div>
    </div>
  );
}

type SettingsProps = { settings: SettingsT; save: (next: SettingsT) => void };

function HotkeysSection({ settings, save }: SettingsProps) {
  return (
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
  );
}

function HistorySection() {
  const [history, setHistory] = useState<RunRecord[]>([]);
  useEffect(() => {
    runHistory().then(setHistory).catch(() => {});
    const un = onRunFinished((r) => setHistory((h) => [r, ...h].slice(0, 30)));
    return () => {
      void un.then((f) => f());
    };
  }, []);
  return (
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
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {fmtRange([r.duration_ms, r.duration_ms])}
            </span>
          </div>
        ))
      )}
    </Section>
  );
}

function AppearanceSection({ theme, onTheme }: { theme: ThemePref; onTheme: (t: ThemePref) => void }) {
  const [view, setView] = useState<StepView>(() => readPrefs().stepView ?? "cards");
  return (
    <>
      <Section title="Theme">
        <ChoiceList label="Theme" value={theme} options={THEMES} onChange={onTheme} />
      </Section>
      <Section
        title="Steps in the editor"
        help="How the editor lays out a macro's steps. The buttons above the steps switch it too, and either way it is remembered."
      >
        <ChoiceList
          label="Steps in the editor"
          value={view}
          options={STEP_VIEWS}
          onChange={(v) => {
            setView(v);
            writePrefs({ stepView: v });
          }}
        />
      </Section>
    </>
  );
}

function ColorsSection() {
  const colors = useStepColors();
  const custom = KINDS.some((k) => colors[k] !== DEFAULT_COLORS[k]);
  return (
    <Section
      title="Step colors"
      help="Each kind of step has its own color in the editor. You can also right-click a step there to recolor it."
      action={
        custom && (
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={resetStepColors}>
            Reset all
          </Button>
        )
      }
    >
      <StepColorSettings />
    </Section>
  );
}

function Row({ left, children }: { left: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-4 text-sm">
      <span className="w-36 shrink-0">{left}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

function ShortcutsSection() {
  return (
    <>
      {PLACES.map((place) => (
        <Section
          key={place}
          title={place}
          help={
            place === "Macro list"
              ? "Keys that work while this window is focused. They are not hotkeys: a macro's hotkey that blocks its key from other apps comes first."
              : undefined
          }
        >
          {SHORTCUTS.filter((s) => s.where === place).map((s) => (
            <Row key={`${s.keys}-${s.action}`} left={<KeyCombo combo={s.keys} />}>
              {s.action}
            </Row>
          ))}
        </Section>
      ))}
      <Section title="Mouse">
        {MOUSE.map((m) => (
          <Row
            key={m.action}
            // Keycaps for key combinations only; a plain click is words (Kanbini's).
            left={m.how.includes("+") ? <KeyCombo combo={m.how} /> : <span className="text-muted-foreground">{m.how}</span>}
          >
            {m.action}
          </Row>
        ))}
      </Section>
    </>
  );
}

function SystemSection({ settings, save }: SettingsProps) {
  const [autostart, setAutostartState] = useState<boolean | null>(null);
  const [elevated, setElevated] = useState<boolean | null>(null);
  useEffect(() => {
    autostartEnabled().then(setAutostartState).catch(() => {});
    isElevated().then(setElevated).catch(() => {});
  }, []);
  return (
    <>
      <Section title="Window">
        <ToggleRow
          label="Keep running in the tray when the window is closed"
          help="Closing the window then leaves Pochini in the tray (by the clock), with every hotkey still working. Quit from the tray icon's menu."
          hint={settings.close_to_tray === null ? "Pochini asks the first time you close the window." : undefined}
          checked={settings.close_to_tray === true}
          onChange={(on) => save({ ...settings, close_to_tray: on })}
        />
      </Section>
      <Section title="Startup">
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
      </Section>
      <Section title="Administrator">
        <Field
          label="Status"
          help="Windows only lets programs that also run as administrator send input to apps that run as administrator. Pochini never asks for it on its own."
        >
          <span className="flex flex-1 items-center gap-1.5 text-sm text-muted-foreground">
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
    </>
  );
}

function BackupSection() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  /** The last Export all result, or an error. */
  const [backup, setBackup] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    appInfo().then(setInfo).catch(() => {});
  }, []);
  return (
    <>
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
      {info && (
        <Section
          title="Data folder"
          help="macros.json holds your macros (macros.bak is the previous save) and settings.json your settings."
        >
          <Field label="Location">
            <code className="min-w-0 flex-1 select-text break-all rounded bg-muted px-1.5 py-1 font-mono text-xs text-foreground/90">
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
        </Section>
      )}
    </>
  );
}

function AboutSection() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [notices, setNotices] = useState<string | null>(null);
  useEffect(() => {
    appInfo().then(setInfo).catch(() => {});
  }, []);
  return (
    <>
      <Section title="About">
        <div className="flex items-center gap-3">
          <img src={logo} alt="" aria-hidden draggable={false} className="size-10 shrink-0" />
          <div className="flex flex-col">
            <span className="font-display text-base font-semibold">Pochini</span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {info ? `Version ${info.version}` : "Loading..."}
            </span>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Click and keyboard macros for Windows. No accounts, no telemetry, no network connections: your macros
          stay on this PC.
        </p>
      </Section>
      <Section title="License">
        <Field label="Pochini">
          <span className="flex-1 text-sm text-muted-foreground">MIT. It also contains open source software by others.</span>
          <Button variant="outline" onClick={() => thirdPartyNotices().then(setNotices)}>
            <FileText />
            Third-party licenses
          </Button>
        </Field>
      </Section>

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
    </>
  );
}
