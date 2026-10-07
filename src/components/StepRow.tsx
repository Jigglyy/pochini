import { useState, type CSSProperties, type ReactNode, type Ref } from "react";
import { ArrowDown, ArrowUp, ChevronRight, Copy, GripVertical, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  colorKind,
  outlineStyle,
  DEFAULT_COLORS,
  KIND_LABELS,
  resetStepColor,
  setStepColor,
  tone,
  useStepColors,
  type ColorKind,
} from "@/lib/colors";
import { cn } from "@/lib/utils";
import { fmtAim, summarize, type Aim } from "@/lib/steps";
import type { Anchor, Modifier, Step } from "@/types";
import { CoordPicker } from "./CoordPicker";
import { JitterField } from "./JitterField";
import { KeyCapture } from "./KeyCapture";
import { Field } from "./layout";
import { useSortableItem, type DragHandle } from "./sortable";
import { colorName, KIND_ICONS, KindChip, SwatchGrid } from "./StepColors";

const MODS: Modifier[] = ["ctrl", "alt", "shift", "win"];

export function stepIcon(s: Step) {
  return KIND_ICONS[colorKind(s)];
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
    { value: "activation", label: "Mouse start + offset" },
    { value: "previous", label: "Previous point + offset" },
  ];
  return (
    <div role="group" aria-label="Target" className="inline-flex flex-wrap rounded-md border border-input p-0.5">
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

const TARGET_HELP = (
  <div className="flex flex-col gap-1.5">
    <p>
      <span className="font-medium">Fixed position</span>: the same screen point every time.
    </p>
    <p>
      <span className="font-medium">Mouse start + offset</span>: measured from where the mouse was when the
      macro started (where you pressed the hotkey, or where it sat when the Run countdown ended).
    </p>
    <p>
      <span className="font-medium">Previous point + offset</span>: measured from where the previous click or
      move aimed. Jitter never adds up along a chain. With Repeat, a chain that starts this way keeps going
      on the next pass.
    </p>
  </div>
);

function OffsetField({ dx, dy, onChange }: { dx: number; dy: number; onChange: (dx: number, dy: number) => void }) {
  const num = (v: string) => Math.trunc(+v || 0);
  return (
    <>
      <span className="text-sm text-muted-foreground">X</span>
      <Input
        type="number"
        aria-label="Offset X"
        className="w-24 tabular-nums"
        value={dx}
        onChange={(e) => onChange(num(e.target.value), dy)}
      />
      <span className="text-sm text-muted-foreground">Y</span>
      <Input
        type="number"
        aria-label="Offset Y"
        className="w-24 tabular-nums"
        value={dy}
        onChange={(e) => onChange(dx, num(e.target.value))}
      />
      <span className="text-xs text-muted-foreground">px</span>
    </>
  );
}

type StepRowProps = {
  step: Step;
  index: number;
  count: number;
  onChange: (s: Step) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMove: (delta: number) => void;
  defaultOpen?: boolean;
  /** Where this step aims on the first pass (click and move steps). */
  aim?: Aim | null;
  /** Some earlier step has a point, so "previous point" means that one. */
  hasEarlierPoint?: boolean;
};

/** A StepRow inside the editor's sortable list: drag its header to reorder. */
export function SortableStepRow(props: StepRowProps) {
  const s = useSortableItem(props.step.id);
  return <StepRow {...props} itemRef={s.ref} style={s.style} handle={s.handle} />;
}

/** The lifted copy of a step while it is being dragged. Same layout as the
 *  StepRow header. */
export function StepFace({ step, index }: { step: Step; index: number }) {
  const kind = colorKind(step);
  const color = useStepColors()[kind];
  return (
    <div
      className="flex cursor-grabbing items-center gap-3 rounded-lg border border-l-[3px] border-primary/40 bg-card px-3 py-2.5 text-card-foreground shadow-xl"
      style={outlineStyle(tone(color))}
    >
      <GripVertical className="size-4 shrink-0 text-muted-foreground" />
      <span className="w-5 text-right text-xs tabular-nums text-muted-foreground">{index + 1}</span>
      <KindChip kind={kind} color={color} />
      <span className="min-w-0 flex-1 truncate py-1.5 text-sm">{summarize(step)}</span>
    </div>
  );
}

/** Right-click on a step header (Kanbini's card menu): recolor this kind of
 *  step, then the same actions as the header buttons. */
function StepMenu({
  kind,
  first,
  last,
  onMove,
  onDuplicate,
  onDelete,
}: {
  kind: ColorKind;
  first: boolean;
  last: boolean;
  onMove: (delta: number) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const color = useStepColors()[kind];
  return (
    <ContextMenuContent className="w-60">
      <ContextMenuLabel className="text-xs font-medium text-muted-foreground">
        Color for every {KIND_LABELS[kind]} step
      </ContextMenuLabel>
      <SwatchGrid value={color} onPick={(c) => setStepColor(kind, c)} Item={ContextMenuItem} />
      {color !== DEFAULT_COLORS[kind] && (
        <ContextMenuItem onSelect={() => resetStepColor(kind)}>
          <RotateCcw />
          Reset to {colorName(DEFAULT_COLORS[kind]).toLowerCase()}
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem disabled={first} onSelect={() => onMove(-1)}>
        <ArrowUp />
        Move up
      </ContextMenuItem>
      <ContextMenuItem disabled={last} onSelect={() => onMove(1)}>
        <ArrowDown />
        Move down
      </ContextMenuItem>
      <ContextMenuItem onSelect={onDuplicate}>
        <Copy />
        Duplicate
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" onSelect={onDelete}>
        <Trash2 />
        Delete
      </ContextMenuItem>
    </ContextMenuContent>
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
  aim,
  hasEarlierPoint = false,
  itemRef,
  style,
  handle,
}: StepRowProps & {
  itemRef?: Ref<HTMLDivElement>;
  style?: CSSProperties;
  /** Drag listeners; spread on the header so the open body (inputs) never drags. */
  handle?: DragHandle;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const set = (patch: Partial<Step>) => onChange({ ...step, ...patch } as Step);
  const kind = colorKind(step);
  const color = useStepColors()[kind];

  return (
    <div
      ref={itemRef}
      data-step-id={step.id}
      style={{ ...style, ...outlineStyle(tone(color)) }}
      className="group/step rounded-lg border border-l-[3px] border-border bg-card text-card-foreground"
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            {...handle}
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
            {handle && (
              <GripVertical
              aria-hidden
              className="size-4 shrink-0 cursor-grab text-muted-foreground/40 transition-colors group-hover/step:text-muted-foreground"
            />
            )}
            <span className="w-5 text-right text-xs tabular-nums text-muted-foreground">{index + 1}</span>
            <KindChip kind={kind} color={color} />
            <span className="min-w-0 flex-1 truncate text-sm">{summarize(step)}</span>
            {/* On hover or keyboard focus only; right-click has the same. */}
            <div className="flex items-center opacity-0 transition-opacity group-focus-within/step:opacity-100 group-hover/step:opacity-100">
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
        </ContextMenuTrigger>
        <StepMenu
          kind={kind}
          first={index === 0}
          last={index === count - 1}
          onMove={onMove}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
        />
      </ContextMenu>

      {open && (
        <div className="flex flex-col gap-4 border-t border-border px-4 py-4">
          {(step.type === "click" || step.type === "move") && (
            <>
              <Field label="Target" help={TARGET_HELP}>
                <TargetPicker anchor={step.anchor} onChange={(anchor) => set({ anchor })} />
              </Field>
              {step.anchor === "fixed" ? (
                <Field label="Position">
                  <CoordPicker x={step.x} y={step.y} onChange={(x, y) => set({ x, y })} />
                </Field>
              ) : (
                <Field
                  label="Offset"
                  help="In pixels. Right and down are positive, left and up negative."
                  hint={
                    <span data-testid="lands-at">
                      {aim && `Lands at ${fmtAim(aim)}`}
                      {step.anchor === "previous" && !hasEarlierPoint && " (nothing before it, so from the mouse start)"}
                    </span>
                  }
                >
                  <OffsetField dx={step.dx} dy={step.dy} onChange={(dx, dy) => set({ dx, dy })} />
                </Field>
              )}
              <Field
                label="Jitter"
                help="Aims at a random spot up to this many pixels from the target, so repeated clicks don't hit the exact same pixel."
              >
                <Input
                  type="number"
                  min={0}
                  className="w-24 tabular-nums"
                  value={step.coord_jitter_px}
                  onChange={(e) => set({ coord_jitter_px: Math.max(0, +e.target.value || 0) })}
                />
                <span className="text-xs text-muted-foreground">px</span>
              </Field>
              <Field
                label="Travel"
                help="0 jumps straight to the target. Above 0 glides the cursor there over that many milliseconds; some targets only react to real movement."
              >
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
              <JitterField
                label="Hold"
                help="How long the button stays down."
                value={step.hold_ms}
                onChange={(hold_ms) => set({ hold_ms })}
              />
              <JitterField
                label="Settle"
                help="Pauses before pressing and after releasing, so the target sees the cursor resting on it. Raise it if clicks get dropped."
                value={step.settle_ms}
                onChange={(settle_ms) => set({ settle_ms })}
              />
            </>
          )}

          {step.type === "scroll" && (
            <Field label="Scroll" help="Notches of the mouse wheel. Negative scrolls down (or left), positive up (or right).">
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
              <Field label="With" help="Modifier keys held down while the key is pressed.">
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
              <JitterField
                label="Hold"
                help="How long the key stays down."
                value={step.hold_ms}
                onChange={(hold_ms) => set({ hold_ms })}
              />
            </>
          )}

          {step.type === "text" && (
            <>
              <Field
                label="Text"
                help="Typed as Unicode characters: right for text fields and chat boxes. Games usually ignore it; use Key steps there."
              >
                <Input
                  className="min-w-0 flex-1"
                  value={step.value}
                  placeholder="What to type"
                  onChange={(e) => set({ value: e.target.value })}
                />
              </Field>
              <JitterField
                label="Per char"
                help="The pause between characters."
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
