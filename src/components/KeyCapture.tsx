import { useEffect, useState } from "react";
import { Keyboard, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { hotkeyClash, keyRefForVk, setRecording as pauseHotkeys } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { modLabel } from "@/lib/steps";
import type { Hotkey, Modifier } from "@/types";
import { KeyCombo } from "./layout";

const MOD_VKS = new Set([0x10, 0x11, 0x12, 0x5b, 0x5c, 0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5]);

export const comboLabel = (h: Hotkey) => [...h.modifiers.map(modLabel), h.key.label].join("+");

/** Records a key (optionally with modifiers) from the next key press in this
 *  window. Every key can be recorded, Escape included (a Key step that presses
 *  it, or the panic key set back to it); the Cancel button cancels. */
export function KeyCapture({
  value,
  onChange,
  allowModifiers = true,
  allowClear = true,
  emptyLabel = "Not set",
  clashFor,
}: {
  value: Hotkey | null;
  onChange: (h: Hotkey | null) => void;
  allowModifiers?: boolean;
  allowClear?: boolean;
  emptyLabel?: string;
  /** A macro's hotkey: warn when it would clash with another hotkey. */
  clashFor?: { macroId: string; guard: string | null };
}) {
  const [recording, setRecording] = useState(false);
  const [clash, setClash] = useState<string | null>(null);
  const [shake, setShake] = useState(0);

  // While recording, hotkeys stand aside, so recording a combo that is
  // already bound (or the on/off hotkey) records it instead of firing it.
  useEffect(() => {
    if (!recording) return;
    void pauseHotkeys(true);
    return () => void pauseHotkeys(false);
  }, [recording]);

  const vk = value?.key.vk;
  const mods = value?.modifiers.join("+") ?? "";
  const macroId = clashFor?.macroId;
  const guard = clashFor?.guard ?? null;
  useEffect(() => {
    if (vk === undefined || macroId === undefined) {
      setClash(null);
      return;
    }
    let live = true;
    hotkeyClash(vk, (mods ? mods.split("+") : []) as Modifier[], guard, macroId)
      .then((c) => live && setClash(c))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [vk, mods, macroId, guard]);

  useEffect(() => {
    if (!recording) return;
    const handler = async (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // Modifiers alone are not a binding; wait for a real key.
      if (MOD_VKS.has(e.keyCode)) return;

      const mods: Modifier[] = [];
      if (allowModifiers) {
        if (e.ctrlKey) mods.push("ctrl");
        if (e.altKey) mods.push("alt");
        if (e.shiftKey) mods.push("shift");
        if (e.metaKey) mods.push("win");
      }
      // e.keyCode is deprecated in the spec but on Windows WebView2 it carries
      // the real virtual key code, which is what the backend needs. The
      // backend resolves the layout-independent scan code from it.
      const key = await keyRefForVk(e.keyCode);
      onChange({ key, modifiers: mods });
      setRecording(false);
      if (clashFor) {
        const c = await hotkeyClash(key.vk, mods, clashFor.guard, clashFor.macroId).catch(() => null);
        if (c) setShake((n) => n + 1);
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [recording, allowModifiers, onChange, clashFor]);

  return (
    <div className="flex flex-col gap-1.5">
    <div className="flex flex-wrap items-center gap-2">
      <div
        key={shake}
        className={cn(
          "flex h-9 min-w-32 items-center rounded-md border border-input bg-background px-2.5",
          shake > 0 && "animate-shake",
          clash && !recording && "border-warning/60",
        )}
      >
        {recording ? (
          <span className="animate-pulse text-sm text-primary">Press a key...</span>
        ) : value ? (
          <KeyCombo combo={comboLabel(value)} />
        ) : (
          <span className="text-sm text-muted-foreground">{emptyLabel}</span>
        )}
      </div>
      <Button variant="outline" onClick={() => setRecording((r) => !r)}>
        <Keyboard />
        {recording ? "Cancel" : value ? "Change" : "Record"}
      </Button>
      {allowClear && value && !recording && (
        <Button variant="ghost" className="text-muted-foreground" onClick={() => onChange(null)}>
          <X />
          Clear
        </Button>
      )}
    </div>
    {clash && !recording && (
      <p className="flex items-center gap-1.5 text-xs text-warning" role="status">
        <TriangleAlert className="size-3.5 shrink-0" />
        {clash}
      </p>
    )}
    </div>
  );
}
