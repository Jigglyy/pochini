import { useEffect, useState } from "react";
import { Keyboard, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { keyRefForVk } from "@/lib/ipc";
import { modLabel } from "@/lib/steps";
import type { Hotkey, Modifier } from "@/types";
import { KeyCombo } from "./layout";

const MOD_VKS = new Set([0x10, 0x11, 0x12, 0x5b, 0x5c, 0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5]);

export const comboLabel = (h: Hotkey) => [...h.modifiers.map(modLabel), h.key.label].join("+");

/** Records a key (optionally with modifiers) from the next key press in this
 *  window. Escape cancels rather than binding Escape. */
export function KeyCapture({
  value,
  onChange,
  allowModifiers = true,
  allowClear = true,
  emptyLabel = "Not set",
}: {
  value: Hotkey | null;
  onChange: (h: Hotkey | null) => void;
  allowModifiers?: boolean;
  allowClear?: boolean;
  emptyLabel?: string;
}) {
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    if (!recording) return;
    const handler = async (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setRecording(false);
        return;
      }
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
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [recording, allowModifiers, onChange]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex h-9 min-w-32 items-center rounded-md border border-input bg-background px-2.5">
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
  );
}
