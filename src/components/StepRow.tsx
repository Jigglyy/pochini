import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode, type Ref } from "react";
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  ChevronRight,
  Copy,
  Crosshair,
  GripVertical,
  ListChecks,
  ListPlus,
  Pipette,
  RotateCcw,
  Route,
  Shuffle,
  SquareCheck,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
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
  KINDS,
  resetStepColor,
  setStepColor,
  tone,
  useStepColors,
  type ColorKind,
} from "@/lib/colors";
import { cancelPick, pixelAt, windowOrigin } from "@/lib/ipc";
import { decodePath } from "@/lib/path";
import { pickPoint } from "@/lib/pick";
import { cn } from "@/lib/utils";
import { fmtAim, hasPath, summarize, type Aim, type NewStepKind } from "@/lib/steps";
import type { Anchor, Guard, Modifier, Step } from "@/types";
import { CoordPicker } from "./CoordPicker";
import { JitterField } from "./JitterField";
import { KeyCapture } from "./KeyCapture";
import { Field, Segmented } from "./layout";
import { useSortableItem, type DragHandle } from "./sortable";
import { Collapse } from "./Collapse";
import { colorName, KIND_ICONS, KindChip, SwatchGrid } from "./StepColors";

const MODS: Modifier[] = ["ctrl", "alt", "shift", "win"];

export function stepIcon(s: Step) {
  return KIND_ICONS[colorKind(s)];
}

function IconAction({ label, onClick, children, danger, small }: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  danger?: boolean;
  /** For the dense rows. */
  small?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size={small ? "icon-xs" : "icon-sm"}
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

function ModifierSwitches({ value, onChange }: { value: Modifier[]; onChange: (m: Modifier[]) => void }) {
  return MODS.map((m) => (
    <label key={m} className="flex cursor-pointer items-center gap-2 text-sm capitalize">
      <Switch
        checked={value.includes(m)}
        onCheckedChange={(c) => onChange(c ? [...value, m] : value.filter((x) => x !== m))}
      />
      {m}
    </label>
  ));
}

/** On a step's header (and its drag copy) while it is marked to shuffle. */
function ShuffleMark() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span role="img" aria-label="Shuffled" className="shrink-0 text-muted-foreground">
          <Shuffle className="size-4" />
        </span>
      </TooltipTrigger>
      <TooltipContent>Trades places with the other shuffled steps</TooltipContent>
    </Tooltip>
  );
}

const TARGETS = [
  { value: "fixed", label: "Fixed position" },
  { value: "activation", label: "Mouse start + offset" },
  { value: "previous", label: "Previous point + offset" },
  { value: "window", label: "App window + offset" },
] as const;

function TargetPicker({ anchor, onChange }: { anchor: Anchor; onChange: (a: Anchor) => void }) {
  return <Segmented label="Target" value={anchor} options={TARGETS} onChange={onChange} />;
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
    <p>
      <span className="font-medium">App window + offset</span>: measured from the top-left of the App only
      app's window, so the point moves with the window.
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

/** What a step's settings need to know about the macro around it. */
export type StepContext = {
  /** Where this step aims on the first pass (click and move steps). */
  aim?: Aim | null;
  /** Some earlier step has a point, so "previous point" means that one. */
  hasEarlierPoint?: boolean;
  /** How many steps of the macro are marked to shuffle, this one included. */
  shuffled?: number;
  /** The macro's App only app, for points in its window. */
  guard?: Guard | null;
};

type StepRowProps = StepContext & {
  step: Step;
  index: number;
  count: number;
  onChange: (s: Step) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMove: (delta: number) => void;
  onMoveTo: (edge: "top" | "bottom") => void;
  onInsert: (kind: NewStepKind, where: "above" | "below") => void;
  /** Its settings are showing: under the header, or (split view) beside
   *  the list. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Just added: opens with a scroll into view. */
  revealOnMount?: boolean;
  /** A dense row in one shared panel (compact and split views), not a card. */
  dense?: boolean;
  /** The settings open under the header. Off in split view, where the
   *  header picks the step shown beside the list. */
  inline?: boolean;
  /** A run is on this step right now. */
  running?: boolean;
  /** Choosing steps to change together: a checkbox replaces the grip, and a
   *  click (Shift+click for a range) ticks the step instead of opening it. */
  selecting?: boolean;
  selected?: boolean;
  onSelect?: (on: boolean, range: boolean) => void;
  /** Ctrl+click or the menu's Select: start choosing, with this step. */
  onStartSelect?: () => void;
  /** The menu's "Select every <kind> step". */
  onSelectKind?: () => void;
};

/** A StepRow inside the editor's sortable list: drag its header to reorder. */
export function SortableStepRow(props: StepRowProps) {
  const s = useSortableItem(props.step.id);
  return <StepRow {...props} itemRef={s.ref} style={s.style} handle={s.handle} />;
}

/** The lifted copy of a step while it is being dragged. Same layout as the
 *  StepRow header, card or dense row. */
export function StepFace({ step, index, dense = false }: { step: Step; index: number; dense?: boolean }) {
  const kind = colorKind(step);
  const color = useStepColors()[kind];
  const t = tone(color);
  return (
    <div
      className={cn(
        "relative flex cursor-grabbing items-center gap-3 rounded-lg border bg-card text-card-foreground",
        dense ? "border-primary/40 py-1.5 pr-3 pl-4" : "border-l-[3px] border-primary/40 px-3 py-2.5",
      )}
      style={dense ? undefined : outlineStyle(t)}
    >
      {dense && t && <span aria-hidden className="absolute inset-y-1.5 left-1 w-[3px] rounded-full" style={{ backgroundColor: t.bar }} />}
      <GripVertical className="size-4 shrink-0 text-muted-foreground" />
      <span className="w-6 text-right text-xs tabular-nums text-muted-foreground">{index + 1}</span>
      <KindChip kind={kind} color={color} small={dense} />
      <span className={cn("min-w-0 flex-1 truncate text-sm", !dense && "py-1.5")}>{summarize(step)}</span>
      {step.shuffle && <ShuffleMark />}
    </div>
  );
}

/** The step kinds as menu items, to insert a new step above or below. */
function InsertMenu({ where, onInsert }: { where: "above" | "below"; onInsert: (k: NewStepKind) => void }) {
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <ListPlus />
        Insert {where}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="w-48">
        {KINDS.map((k) => {
          const Icon = KIND_ICONS[k];
          return (
            <ContextMenuItem key={k} onSelect={() => onInsert(k)}>
              <Icon />
              {KIND_LABELS[k]}
            </ContextMenuItem>
          );
        })}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

/** Right-click on a step header (Kanbini's card menu): recolor this kind of
 *  step, then the same actions as the header buttons, and more. */
function StepMenu({
  kind,
  first,
  last,
  shuffle,
  selecting,
  onMove,
  onMoveTo,
  onInsert,
  onDuplicate,
  onShuffle,
  onDelete,
  onStartSelect,
  onSelectKind,
}: {
  kind: ColorKind;
  first: boolean;
  last: boolean;
  shuffle: boolean;
  selecting: boolean;
  onMove: (delta: number) => void;
  onMoveTo: (edge: "top" | "bottom") => void;
  onInsert: (kind: NewStepKind, where: "above" | "below") => void;
  onDuplicate: () => void;
  onShuffle: (on: boolean) => void;
  onDelete: () => void;
  onStartSelect?: () => void;
  onSelectKind?: () => void;
}) {
  const color = useStepColors()[kind];
  return (
    // No focus return: it would scroll back to the header after Duplicate or
    // a move has scrolled the step into view.
    <ContextMenuContent className="w-60" onCloseAutoFocus={(e) => e.preventDefault()}>
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
      <InsertMenu where="above" onInsert={(k) => onInsert(k, "above")} />
      <InsertMenu where="below" onInsert={(k) => onInsert(k, "below")} />
      <ContextMenuSeparator />
      <ContextMenuItem disabled={first} onSelect={() => onMove(-1)}>
        <ArrowUp />
        Move up
      </ContextMenuItem>
      <ContextMenuItem disabled={last} onSelect={() => onMove(1)}>
        <ArrowDown />
        Move down
      </ContextMenuItem>
      <ContextMenuItem disabled={first} onSelect={() => onMoveTo("top")}>
        <ArrowUpToLine />
        Move to top
      </ContextMenuItem>
      <ContextMenuItem disabled={last} onSelect={() => onMoveTo("bottom")}>
        <ArrowDownToLine />
        Move to bottom
      </ContextMenuItem>
      <ContextMenuItem onSelect={onDuplicate}>
        <Copy />
        Duplicate
      </ContextMenuItem>
      <ContextMenuCheckboxItem checked={shuffle} onCheckedChange={onShuffle}>
        Shuffle
      </ContextMenuCheckboxItem>
      {(onStartSelect || onSelectKind) && <ContextMenuSeparator />}
      {onStartSelect && !selecting && (
        <ContextMenuItem onSelect={onStartSelect}>
          <SquareCheck />
          Select
        </ContextMenuItem>
      )}
      {onSelectKind && (
        <ContextMenuItem onSelect={onSelectKind}>
          <ListChecks />
          Select every {KIND_LABELS[kind]} step
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" onSelect={onDelete}>
        <Trash2 />
        Delete
      </ContextMenuItem>
    </ContextMenuContent>
  );
}

/** Move keyboard focus to the step header `delta` places away. */
function focusHeader(from: HTMLElement, delta: number) {
  const all = [...document.querySelectorAll<HTMLElement>("[data-step-header]")];
  all[all.indexOf(from) + delta]?.focus();
}

export function StepRow({
  step,
  index,
  count,
  onChange,
  onDelete,
  onDuplicate,
  onMove,
  onMoveTo,
  onInsert,
  open,
  onOpenChange,
  revealOnMount = false,
  dense = false,
  inline = true,
  running = false,
  selecting = false,
  selected = false,
  onSelect,
  onStartSelect,
  onSelectKind,
  itemRef,
  style,
  handle,
  ...context
}: StepRowProps & {
  itemRef?: Ref<HTMLDivElement>;
  style?: CSSProperties;
  /** Drag listeners; spread on the header so the open body (inputs) never drags. */
  handle?: DragHandle;
}) {
  const set = (patch: Partial<Step>) => onChange({ ...step, ...patch } as Step);
  const kind = colorKind(step);
  const color = useStepColors()[kind];
  const t = tone(color);
  // In split view the header picks the step; elsewhere it opens and closes.
  const activate = () => onOpenChange(inline ? !open : true);

  const press = (e: MouseEvent) => {
    if (selecting) onSelect?.(!selected, e.shiftKey);
    else if (e.ctrlKey && onStartSelect) onStartSelect();
    else activate();
  };

  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (selecting) onSelect?.(!selected, e.shiftKey);
      else activate();
    }
    if (e.altKey && e.key === "ArrowUp") onMove(-1);
    if (e.altKey && e.key === "ArrowDown") onMove(1);
    // Only on the header itself, never on its buttons.
    if (e.target !== e.currentTarget) return;
    const plain = !e.ctrlKey && !e.altKey && !e.shiftKey;
    if (plain && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      focusHeader(e.currentTarget, e.key === "ArrowUp" ? -1 : 1);
    }
    // While choosing, Delete removes every selected step (the editor's).
    if (!selecting && e.key === "Delete" && plain) {
      e.preventDefault();
      onDelete();
    }
    if (!selecting && e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "d") {
      e.preventDefault();
      onDuplicate();
    }
  };

  const tint = selected ? "color-mix(in oklab, var(--primary) 14%, var(--card))" : undefined;

  return (
    <div
      ref={itemRef}
      data-step-id={step.id}
      data-flip={step.id}
      data-selected={selected || undefined}
      data-running={running || undefined}
      style={{ ...style, ...(dense ? {} : outlineStyle(t)), backgroundColor: dense ? undefined : tint }}
      className={cn(
        "group/step text-card-foreground",
        dense
          ? "relative bg-transparent"
          : "rounded-lg border border-l-[3px] border-border bg-card transition-[border-color,box-shadow,background-color] duration-200 ease-smooth",
        !dense && running && "ring-2 ring-primary ring-offset-2 ring-offset-background",
      )}
    >
      {dense && t && (
        <span aria-hidden className="absolute top-1.5 left-1 z-[1] h-6 w-[3px] rounded-full" style={{ backgroundColor: t.bar }} />
      )}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            {...handle}
            data-step-header
            role="button"
            tabIndex={0}
            aria-expanded={inline ? open : undefined}
            aria-current={!inline && open ? "true" : undefined}
            aria-pressed={selecting ? selected : undefined}
            onClick={press}
            onFocus={(e) => {
              // Split view: arrowing through the list shows each step.
              if (!inline && !selecting && e.target === e.currentTarget && !open) onOpenChange(true);
            }}
            onKeyDown={keys}
            style={dense ? { backgroundColor: tint } : undefined}
            className={cn(
              "flex items-center outline-none focus-visible:ring-2 focus-visible:ring-ring",
              dense
                ? "gap-2.5 py-1.5 pr-2 pl-4 focus-visible:ring-inset"
                : "gap-3 rounded-lg px-3 py-2.5",
              dense && !selected && (!inline && open && !selecting ? "bg-accent" : "hover:bg-accent/50"),
              !dense && !selected && "hover:bg-accent/40",
              dense && running && "bg-primary/15 ring-2 ring-primary ring-inset",
            )}
          >
            {selecting ? (
              <Checkbox
                checked={selected}
                tabIndex={-1}
                aria-label={`Select step ${index + 1}`}
                // The header's own click does the ticking (and knows Shift).
                onClick={(e) => e.preventDefault()}
                className="pointer-events-none"
              />
            ) : (
              handle && (
                <GripVertical
                  aria-hidden
                  className="size-4 shrink-0 cursor-grab text-muted-foreground/40 transition-colors group-hover/step:text-muted-foreground"
                />
              )
            )}
            <span className="w-6 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{index + 1}</span>
            <KindChip kind={kind} color={color} small={dense} />
            <span className="min-w-0 flex-1 truncate text-sm">{summarize(step)}</span>
            {step.shuffle && <ShuffleMark />}
            {/* On hover or keyboard focus only; right-click has the same. Not
                in split view's narrow list, where the summary needs the room. */}
            {!selecting && inline && (
              <div className="flex items-center opacity-0 transition-opacity group-focus-within/step:opacity-100 group-hover/step:opacity-100">
                <IconAction label="Move up" onClick={() => onMove(-1)} small={dense}>
                  <ArrowUp className={cn(dense && "size-3.5", index === 0 && "opacity-30")} />
                </IconAction>
                <IconAction label="Move down" onClick={() => onMove(1)} small={dense}>
                  <ArrowDown className={cn(dense && "size-3.5", index === count - 1 && "opacity-30")} />
                </IconAction>
                <IconAction label="Duplicate" onClick={onDuplicate} small={dense}>
                  <Copy className={cn(dense && "size-3.5")} />
                </IconAction>
                <IconAction label="Delete" onClick={onDelete} danger small={dense}>
                  <Trash2 className={cn(dense && "size-3.5")} />
                </IconAction>
              </div>
            )}
            {inline && (
              <ChevronRight
                className={cn(
                  "size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-smooth",
                  open && "rotate-90",
                )}
              />
            )}
          </div>
        </ContextMenuTrigger>
        <StepMenu
          kind={kind}
          first={index === 0}
          last={index === count - 1}
          shuffle={step.shuffle}
          selecting={selecting}
          onMove={onMove}
          onMoveTo={onMoveTo}
          onInsert={onInsert}
          onDuplicate={onDuplicate}
          onShuffle={(shuffle) => set({ shuffle })}
          onDelete={onDelete}
          onStartSelect={onStartSelect}
          onSelectKind={onSelectKind}
        />
      </ContextMenu>

      {inline && (
        <Collapse open={open} revealOnMount={revealOnMount}>
          <div className={cn("border-t border-border px-4", dense ? "py-3.5 pl-6" : "py-4")}>
            <StepFields step={step} onChange={onChange} {...context} />
          </div>
        </Collapse>
      )}
    </div>
  );
}

/** A step's settings, by type: under its header, or beside the list in
 *  split view. */
export function StepFields({
  step,
  onChange,
  aim,
  hasEarlierPoint = false,
  shuffled = 0,
  guard = null,
}: StepContext & { step: Step; onChange: (s: Step) => void }) {
  const set = (patch: Partial<Step>) => onChange({ ...step, ...patch } as Step);
  return (
    <div className="flex flex-col gap-4">
      {(step.type === "click" || step.type === "move") && (
        <>
          <Field label="Target" help={TARGET_HELP}>
            <TargetPicker anchor={step.anchor} onChange={(anchor) => set({ anchor })} />
          </Field>
          {step.anchor === "fixed" ? (
            <Field label="Position">
              <CoordPicker x={step.x} y={step.y} onChange={(x, y, capture) => set({ x, y, capture })} />
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
              {step.anchor === "window" && (
                <WindowPick process={guard?.process ?? ""} onPick={(dx, dy) => set({ dx, dy })} />
              )}
            </Field>
          )}
          <Field
            label="Jitter"
            help="Aims at a random spot up to this many pixels from the target, so repeated clicks don't hit the exact same pixel."
          >
            <Input
              type="number"
              min={0}
              aria-label="Jitter"
              className="w-24 tabular-nums"
              value={step.coord_jitter_px}
              onChange={(e) => set({ coord_jitter_px: Math.max(0, +e.target.value || 0) })}
            />
            <span className="text-xs text-muted-foreground">px</span>
          </Field>
          <Field
            label="Travel"
            help="0 jumps straight to the target. Above 0 glides the cursor there over that many milliseconds; some targets only react to real movement. A recorded step follows the way your mouse went instead, over the same time."
            hint={
              hasPath(step)
                ? `Follows the recorded path (${decodePath(step.path).length} points). Changing the travel speeds it up or slows it down.`
                : undefined
            }
          >
            <Input
              type="number"
              min={0}
              aria-label="Travel"
              className="w-24 tabular-nums"
              value={step.move_duration_ms}
              onChange={(e) => set({ move_duration_ms: Math.max(0, +e.target.value || 0) })}
            />
            <span className="text-xs text-muted-foreground">ms</span>
            {hasPath(step) && (
              <Button variant="outline" onClick={() => set({ path: undefined })}>
                <Route />
                Straight line instead
              </Button>
            )}
          </Field>
        </>
      )}

      {step.type === "click" && (
        <>
          <Field label="Button">
            <Select value={step.button} onValueChange={(v) => set({ button: v as typeof step.button })}>
              <SelectTrigger className="w-32" aria-label="Mouse button">
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
              <SelectTrigger className="w-40" aria-label="Click action">
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
          <Field
            label="While holding"
            help="Keys held down for this click, like Shift for a shift-click. They go down once the cursor arrives and come up after the release, both a settle apart from the click. Record adds any other key."
          >
            <ModifierSwitches value={step.modifiers} onChange={(modifiers) => set({ modifiers })} />
            <KeyCapture
              value={step.held_key ? { key: step.held_key, modifiers: [] } : null}
              onChange={(h) => set({ held_key: h?.key ?? null })}
              allowModifiers={false}
              emptyLabel="No other key"
            />
          </Field>
          <JitterField
            label="Hold"
            help="How long the button stays down."
            value={step.hold_ms}
            onChange={(hold_ms) => set({ hold_ms })}
          />
          {step.dwell_ms ? (
            <>
              <JitterField
                label="Rest before"
                help="How long the cursor rests on the target before pressing, as recorded. Raise it if clicks get dropped."
                value={step.settle_ms}
                onChange={(settle_ms) => set({ settle_ms })}
              />
              <JitterField
                label="Rest after"
                help="How long the cursor stays after the release before moving on, as recorded."
                value={step.dwell_ms}
                onChange={(dwell_ms) => set({ dwell_ms })}
              />
            </>
          ) : (
            <JitterField
              label="Settle"
              help="Pauses before pressing and after releasing, so the target sees the cursor resting on it. Raise it if clicks get dropped."
              value={step.settle_ms}
              onChange={(settle_ms) => set({ settle_ms })}
            />
          )}
        </>
      )}

      {step.type === "scroll" && (
        <Field
          label="Scroll"
          help="Notches of the mouse wheel. Negative scrolls down (or left), positive up (or right). A recorded scroll turns the wheel the way you did, turn by turn; changing the notches makes it a plain scroll."
          hint={
            step.ticks?.length
              ? `Turns the wheel as recorded: ${step.ticks.length} turn${step.ticks.length === 1 ? "" : "s"} over ${step.ticks[step.ticks.length - 1].t} ms.`
              : undefined
          }
        >
          <Input
            type="number"
            aria-label="Notches"
            className="w-24 tabular-nums"
            value={step.amount}
            // An amount typed in replaces the recorded turns.
            onChange={(e) => set({ amount: +e.target.value || 0, ticks: undefined })}
          />
          <span className="text-xs text-muted-foreground">notches</span>
          <Select value={step.axis} onValueChange={(v) => set({ axis: v as typeof step.axis })}>
            <SelectTrigger className="w-36" aria-label="Direction">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="vertical">Vertical</SelectItem>
              <SelectItem value="horizontal">Horizontal</SelectItem>
            </SelectContent>
          </Select>
          {step.ticks?.length ? (
            <Button variant="outline" onClick={() => set({ ticks: undefined })}>
              Plain scroll instead
            </Button>
          ) : null}
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
              <SelectTrigger className="w-36" aria-label="Key action">
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
            <ModifierSwitches value={step.modifiers} onChange={(modifiers) => set({ modifiers })} />
          </Field>
          <JitterField
            label="Hold"
            help="How long the key stays down."
            value={step.hold_ms}
            onChange={(hold_ms) => set({ hold_ms })}
          />
          {step.repeat && step.action !== "up" && (
            <Field
              label="Repeat"
              help="Windows repeats a key you hold, but never one a program holds, so Pochini repeats it the way it repeated when you recorded it (typing in a text box, holding Backspace)."
              hint={`Repeats while held: first after ${step.repeat.delay_ms} ms, then every ${step.repeat.every_ms} ms.`}
            >
              <Button variant="outline" onClick={() => set({ repeat: undefined })}>
                Don't repeat
              </Button>
            </Field>
          )}
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

      {step.type === "wait_color" && <WaitColorFields step={step} set={set} />}

      <Field
        label="Shuffle"
        help='Shuffled steps trade places with each other at random, in a new order every pass. Steps with Shuffle off never move. A "Previous point" step measures from whichever step ran just before it.'
        hint={
          step.shuffle && shuffled < 2
            ? "Turn Shuffle on for another step too; on its own this one has nothing to trade places with."
            : undefined
        }
      >
        <Switch aria-label="Shuffle" checked={step.shuffle} onCheckedChange={(shuffle) => set({ shuffle })} />
      </Field>
    </div>
  );
}

/** A "wait for a color" step: the point to watch, the color (picked, typed,
 *  or read from the screen as it is now), how close counts, and what to do
 *  if it never shows. */
function WaitColorFields({
  step,
  set,
}: {
  step: Extract<Step, { type: "wait_color" }>;
  set: (patch: Partial<Step>) => void;
}) {
  const valid = /^#[0-9a-f]{6}$/i.test(step.color);
  const [reading, setReading] = useState(false);
  return (
    <>
      <Field label="Point" help="The screen pixel to watch. Pick it like a click's position.">
        <CoordPicker x={step.x} y={step.y} onChange={(x, y) => set({ x, y })} />
      </Field>
      <Field
        label="Color"
        help="The macro waits until the pixel has this color. Read color takes the color the pixel has right now."
        hint={valid ? undefined : "Use six hex digits, like #33aa55."}
      >
        <input
          type="color"
          aria-label="Color"
          value={valid ? step.color.toLowerCase() : "#000000"}
          onChange={(e) => set({ color: e.target.value })}
          className="h-9 w-12 cursor-pointer rounded-md border border-input bg-background p-1"
        />
        <Input
          aria-label="Color code"
          className="w-28 font-mono"
          value={step.color}
          onChange={(e) => set({ color: e.target.value.trim() })}
        />
        <Button
          variant="outline"
          disabled={reading}
          onClick={() => {
            setReading(true);
            pixelAt(step.x, step.y)
              .then((color) => set({ color }))
              .finally(() => setReading(false));
          }}
        >
          <Pipette />
          Read color
        </Button>
      </Field>
      <Field
        label="Tolerance"
        help="How far each of red, green and blue may be from the color, 0 to 255. Raise it for colors that shimmer or fade."
      >
        <Input
          type="number"
          min={0}
          max={255}
          aria-label="Tolerance"
          className="w-24 tabular-nums"
          value={step.tolerance}
          onChange={(e) => set({ tolerance: Math.min(255, Math.max(0, Math.round(+e.target.value || 0))) })}
        />
      </Field>
      <Field
        label="Give up after"
        help="If the color has not shown by then, the macro stops (and says why), or carries on with the next step."
      >
        <Input
          type="number"
          min={0}
          aria-label="Give up after"
          className="w-28 tabular-nums"
          value={step.timeout_ms}
          onChange={(e) => set({ timeout_ms: Math.max(0, Math.round(+e.target.value || 0)) })}
        />
        <span className="text-xs text-muted-foreground">ms, then</span>
        <Select value={step.on_timeout} onValueChange={(v) => set({ on_timeout: v as "stop" | "continue" })}>
          <SelectTrigger className="w-44" aria-label="When it never shows">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="stop">Stop the macro</SelectItem>
            <SelectItem value="continue">Carry on</SelectItem>
          </SelectContent>
        </Select>
      </Field>
    </>
  );
}

/** Pick a point inside the App only app's window: the click's screen point,
 *  less the window's top-left. */
function WindowPick({ process, onPick }: { process: string; onPick: (dx: number, dy: number) => void }) {
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState<string | null>(null);
  // Leaving while a pick waits cancels it (see CoordPicker).
  const waiting = useRef(false);
  useEffect(
    () => () => {
      if (waiting.current) void cancelPick();
    },
    [],
  );
  if (!process) {
    return (
      <span className="basis-full text-xs text-warning">
        Turn on App only above and choose the app: the point is measured from its window.
      </span>
    );
  }
  return (
    <>
      <Button
        variant="outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setWhy(null);
          waiting.current = true;
          const at = await pickPoint();
          waiting.current = false;
          if (at) {
            const origin = await windowOrigin(process).catch(() => null);
            if (origin) onPick(at[0] - origin[0], at[1] - origin[1]);
            else setWhy(`${process} has no window open.`);
          }
          setBusy(false);
        }}
      >
        <Crosshair />
        {busy ? "Click in the window... (Esc cancels)" : "Pick in the window"}
      </Button>
      {why && <span className="basis-full text-xs text-warning">{why}</span>}
    </>
  );
}
