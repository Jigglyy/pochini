import { useEffect, useState } from "react";
import { hotkeyDiagnostics } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import type { HotkeyDiagnostics, RecentKey } from "@/types";
import { KeyCombo, Notice } from "./layout";

function describe(k: RecentKey): string {
  const name = k.macro_name ? `"${k.macro_name}"` : "a macro";
  switch (k.result.kind) {
    case "toggle":
      return "Turned macros on/off";
    case "panic":
      return "Panic stop";
    case "run":
      return `Ran ${name}`;
    case "outside_app":
      return `Ignored: the mouse was not over ${k.app ?? "its app"} (${name} is App only)`;
    case "macros_off":
      return "Ignored: macros are off";
    case "wrong_modifiers":
      return "No hotkey uses this combination";
  }
}

function ago(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return `${m}m ago`;
}

function Dot({ ok }: { ok: boolean }) {
  return <span aria-hidden className={cn("size-2 shrink-0 rounded-full", ok ? "bg-success" : "bg-destructive")} />;
}

/** Live view of what Pochini receives when you press one of your hotkeys, so a
 *  hotkey that "does nothing" can be explained. Lists only keys you have set
 *  up (panic, on/off, macro hotkeys), never other typing. */
export function HotkeyCheck({ toggleCombo }: { toggleCombo: string | null }) {
  const [d, setD] = useState<HotkeyDiagnostics | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = () => {
      setNow(Date.now());
      hotkeyDiagnostics().then(setD).catch(() => {});
    };
    tick();
    const t = window.setInterval(tick, 700);
    return () => window.clearInterval(t);
  }, []);

  if (!d) return <p className="text-sm text-muted-foreground">Checking...</p>;
  const { hook, recent } = d;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 text-sm">
        <span className="flex items-center gap-2">
          <Dot ok={hook.installed} />
          {hook.installed ? (
            <span>
              Keyboard hook active
              <span className="text-muted-foreground"> · {hook.key_events.toLocaleString()} key presses seen</span>
            </span>
          ) : (
            <span>Keyboard hook is not running. Restart Pochini.</span>
          )}
        </span>
        {toggleCombo && (
          <span className="flex items-center gap-2">
            <Dot ok={hook.toggle_registered} />
            {hook.toggle_registered ? (
              <span>
                On/off hotkey <span className="font-medium">{toggleCombo}</span> is registered with Windows
              </span>
            ) : (
              <span>
                On/off hotkey <span className="font-medium">{toggleCombo}</span> could not be registered
              </span>
            )}
          </span>
        )}
      </div>

      {hook.toggle_taken && toggleCombo && (
        <Notice>
          Another program already owns {toggleCombo}, so Windows will not give it to Pochini. Pochini still
          watches for it with its keyboard hook, but choose a different on/off hotkey above to be safe.
        </Notice>
      )}

      <div className="flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">
          Press any hotkey you have set up. Pochini lists what it received. Only your hotkeys are shown, never
          other typing.
        </p>
        {recent.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-3 text-center text-sm text-muted-foreground">
            Nothing yet
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {recent.map((k, i) => (
              <li key={`${k.at_ms}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                <KeyCombo combo={k.combo} />
                <span className="min-w-0 flex-1">{describe(k)}</span>
                <span className="text-xs text-muted-foreground">
                  {k.via === "windows" ? "Windows hotkey" : "keyboard hook"} · {ago(k.at_ms, now)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
