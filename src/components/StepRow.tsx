import { useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronRight,
  Copy,
  Crosshair,
  Keyboard,
  MousePointerClick,
  Move,
  Timer,
  Trash2,
  Type,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { summarize } from "@/lib/steps";
import type { Anchor, Modifier, Step } from "@/types";
import { CoordPicker } from "./CoordPicker";
import { JitterField } from "./JitterField";
import { KeyCapture } from "./KeyCapture";
import { Field } from "./layout";

const MODS: Modifier[] = ["ctrl", "alt", "shift", "win"];

export function stepIcon(s: Step) {
  switch (s.type) {
    case "click":
      return s.anchor === "activation" ? Crosshair : MousePointerClick;
    case "move":
      return Move;
    case "key":
      return Keyboard;
    case "text":
      return Type;
    case "wait":
      return Timer;
    case "scroll":
      return ArrowUpDown;
  }
}

function IconAction({ label, onClick, children, danger }: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  danger?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
          className={cn("text-muted-foreground", danger && "hover:text-destructive")}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function TargetPicker({ anchor, onChange }: { anchor: Anchor; onChange: (a: Anchor) => void }) {
  const opts: { value: Anchor; label: string }[] = [
    { value: "fixed", label: "Fixed position" },
    { value: "activation", label: "Where the mouse is at activation" },
  ];
  return (
    <div className="inline-flex rounded-md border border-input p-0.5">
      {opts.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={anchor === o.value}
          className={cn(
            "rounded-[5px] px-2.5 py-1 text-sm transition-colors",
            anchor === o.value
              ? "bg-accent font-medium text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function StepRow({
  step,
  index,
  count,
  onChange,
  onDelete,
  onDuplicate,
  onMove,
  defaultOpen = false,
}: {
  step: Step;
  index: number;
  count: number;
  onChange: (s: Step) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMove: (delta: number) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const set = (patch: Partial<Step>) => onChange({ ...step, ...patch } as Step);
  const Icon = stepIcon(step);

  return (
    <div className="rounded-lg border border-border bg-card text-card-foreground">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((o) => !o);
          }
          if (e.altKey && e.key === "ArrowUp") onMove(-1);
          if (e.altKey && e.key === "ArrowDown") onMove(1);
        }}
        className="flex items-center gap-3 rounded-lg px-3 py-2.5 outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="w-5 text-right text-xs tabular-nums text-muted-foreground">{index + 1}</span>
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Icon className="size-4" />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm">{summarize(step)}</span>
        <div className="flex items-center">
          <IconAction label="Move up" onClick={() => onMove(-1)}>
            <ArrowUp className={cn(index === 0 && "opacity-30")} />
          </IconAction>
          <IconAction label="Move down" onClick={() => onMove(1)}>
            <ArrowDown className={cn(index === count - 1 && "opacity-30")} />
          </IconAction>
          <IconAction label="Duplicate" onClick={onDuplicate}>
            <Copy />
          </IconAction>
          <IconAction label="Delete" onClick={onDelete} danger>
            <Trash2 />
          </IconAction>
        </div>
        <ChevronRight
          className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
        />
      </div>

      {open && (
        <div className="flex flex-col gap-4 border-t border-border px-4 py-4">
          {(step.type === "click" || step.type === "move") && (
            <>
              <Field
                label="Target"
                hint={
                  step.anchor === "activation"
                    ? "Aims wherever the mouse was when the macro started: where you pressed the hotkey, or where it sat when the Run countdown ended."
                    : undefined
                }
              >
                <TargetPicker anchor={step.anchor} onChange={(anchor) => set({ anchor })} />
              </Field>
              {step.anchor === "fixed" && (
                <Field label="Position">
                  <CoordPicker x={step.x} y={step.y} onChange={(x, y) => set({ x, y })} />
                </Field>
              )}
              <Field label="Jitter" hint="Random offset within this many pixels of the target.">
                <Input
                  type="number"
                  min={0}
                  className="w-24 tabular-nums"
                  value={step.coord_jitter_px}
                  onChange={(e) => set({ coord_jitter_px: Math.max(0, +e.target.value || 0) })}
                />
                <span className="text-xs text-muted-foreground">px</span>
              </Field>
              <Field label="Travel" hint="0 jumps straight there. Some targets only react to real movement.">
                <Input
                  type="number"
                  min={0}
                  className="w-24 tabular-nums"
                  value={step.move_duration_ms}
                  onChange={(e) => set({ move_duration_ms: Math.max(0, +e.target.value || 0) })}
                />
                <span className="text-xs text-muted-foreground">ms</span>
              </Field>
            </>
          )}

          {step.type === "click" && (
            <>
              <Field label="Button">
                <Select value={step.button} onValueChange={(v) => set({ button: v as typeof step.button })}>
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="left">Left</SelectItem>
                    <SelectItem value="right">Right</SelectItem>
                    <SelectItem value="middle">Middle</SelectItem>
                    <SelectItem value="x1">Side 1</SelectItem>
                    <SelectItem value="x2">Side 2</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={step.action} onValueChange={(v) => set({ action: v as typeof step.action })}>
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="click">Click</SelectItem>
                    <SelectItem value="double">Double-click</SelectItem>
                    <SelectItem value="down">Press and hold</SelectItem>
                    <SelectItem value="up">Release</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <JitterField label="Hold" value={step.hold_ms} onChange={(hold_ms) => set({ hold_ms })} />
              <JitterField
                label="Settle"
                hint="Paused before pressing and after releasing, so the target sees the cursor resting on it. Raise it if a click gets dropped."
                value={step.settle_ms}
                onChange={(settle_ms) => set({ settle_ms })}
              />
            </>
          )}

          {step.type === "scroll" && (
            <Field label="Scroll" hint="Negative scrolls down or left.">
              <Input
                type="number"
                className="w-24 tabular-nums"
                value={step.amount}
                onChange={(e) => set({ amount: +e.target.value || 0 })}
              />
              <span className="text-xs text-muted-foreground">notches</span>
              <Select value={step.axis} onValueChange={(v) => set({ axis: v as typeof step.axis })}>
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="vertical">Vertical</SelectItem>
                  <SelectItem value="horizontal">Horizontal</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          )}

          {step.type === "key" && (
            <>
              <Field label="Key">
                <KeyCapture
                  value={{ key: step.key, modifiers: [] }}
                  onChange={(h) => h && set({ key: h.key })}
                  allowModifiers={false}
                  allowClear={false}
                />
                <Select value={step.action} onValueChange={(v) => set({ action: v as typeof step.action })}>
                  <SelectTrigger className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="press">Press</SelectItem>
                    <SelectItem value="down">Hold down</SelectItem>
                    <SelectItem value="up">Release</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="With">
                {MODS.map((m) => (
                  <label key={m} className="flex cursor-pointer items-center gap-2 text-sm capitalize">
                    <Switch
                      checked={step.modifiers.includes(m)}
                      onCheckedChange={(c) =>
                        set({ modifiers: c ? [...step.modifiers, m] : step.modifiers.filter((x) => x !== m) })
                      }
                    />
                    {m}
                  </label>
                ))}
              </Field>
              <JitterField label="Hold" value={step.hold_ms} onChange={(hold_ms) => set({ hold_ms })} />
            </>
          )}

          {step.type === "text" && (
            <>
              <Field label="Text" hint="Sent as Unicode characters. Right for text fields; games generally will not see it.">
                <Input
                  className="min-w-0 flex-1"
                  value={step.value}
                  placeholder="What to type"
                  onChange={(e) => set({ value: e.target.value })}
                />
              </Field>
              <JitterField
                label="Per char"
                value={step.per_char_ms}
                onChange={(per_char_ms) => set({ per_char_ms })}
              />
            </>
          )}

          {step.type === "wait" && <JitterField label="Wait" value={step.ms} onChange={(ms) => set({ ms })} />}
        </div>
      )}
    </div>
  );
}
