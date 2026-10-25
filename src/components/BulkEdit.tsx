import { useState, type ReactNode } from "react";
import { MoveRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  hasFixedPoint,
  modifierState,
  setJitterPart,
  setModifier,
  shared,
  shiftFixed,
  typesOf,
  update,
  type StepOf,
  type StepType,
} from "@/lib/bulk";
import { useStepColors } from "@/lib/colors";
import { cn } from "@/lib/utils";
import type { Jitter, Modifier, Step } from "@/types";
import { Field } from "./layout";
import { KindChip } from "./StepColors";

// Change many steps at once: the selected steps grouped by type, each field
// showing the value they share or "Mixed". A change sets that one field on
// every selected step of the type, at once (it is one undo step, like any
// edit); fields left alone keep each step's own value. Rules in lib/bulk.ts.

const GROUP_LABELS: Record<StepType, string> = {
  click: "Clicks",
  move: "Moves",
  key: "Keys",
  text: "Type text",
  wait: "Waits",
  wait_color: "Wait for color",
  scroll: "Scrolls",
};

const MODS: Modifier[] = ["ctrl", "alt", "shift", "win"];

/** true / false / "indeterminate" for a Checkbox. */
const tri = (v: boolean | "some") => (v === "some" ? "indeterminate" : v);

/** A number input that can say "Mixed". Applies each valid number as it is
 *  typed; clearing the box changes nothing. */
function BulkNumber({
  label,
  value,
  onChange,
  min = 0,
  max,
  unit,
  className,
}: {
  label: string;
  value: number | undefined;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  unit?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className="relative">
      <Input
        type="number"
        min={min}
        max={max}
        aria-label={label}
        placeholder="Mixed"
        className={cn("w-28 tabular-nums placeholder:italic", unit && "pr-9", className)}
        value={draft ?? (value === undefined ? "" : value)}
        onChange={(e) => {
          setDraft(e.target.value);
          if (e.target.value.trim() === "" || Number.isNaN(+e.target.value)) return;
          let n = Math.round(+e.target.value);
          n = Math.max(min, max === undefined ? n : Math.min(max, n));
          onChange(n);
        }}
        onBlur={() => setDraft(null)}
      />
      {unit && (
        <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-muted-foreground">
          {unit}
        </span>
      )}
    </div>
  );
}

/** A Select that can say "Mixed". */
function BulkSelect<V extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: V | undefined;
  options: readonly { value: V; label: string }[];
  onChange: (v: V) => void;
  className?: string;
}) {
  return (
    <Select value={value ?? ""} onValueChange={(v) => onChange(v as V)}>
      <SelectTrigger className={className} aria-label={label}>
        <SelectValue placeholder="Mixed" />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** A duration with randomness, for many steps: the base and the random
 *  extra are set separately, so "add 50 ms of randomness to every wait"
 *  keeps each wait's own length. */
function BulkJitter({
  label,
  help,
  values,
  onChange,
}: {
  label: string;
  help?: string;
  values: Jitter[];
  onChange: (part: keyof Jitter, n: number) => void;
}) {
  const base = shared(values, (j) => j.base);
  const extra = shared(values, (j) => j.jitter);
  const hint =
    base !== undefined && extra !== undefined && extra > 0 ? `A random ${base} to ${base + extra} ms each time.` : undefined;
  return (
    <Field label={label} help={help} hint={hint}>
      <BulkNumber label={label} value={base} unit="ms" onChange={(n) => onChange("base", n)} />
      <span className="text-sm text-muted-foreground">random extra up to +</span>
      <BulkNumber label={`${label} random extra`} value={extra} unit="ms" onChange={(n) => onChange("jitter", n)} />
    </Field>
  );
}

function Group({ type, count, children }: { type: StepType; count: number; children: ReactNode }) {
  const colors = useStepColors();
  return (
    <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0" data-bulk-group={type}>
      <div className="flex items-center gap-2 text-sm font-medium">
        <KindChip kind={type} color={colors[type]} small />
        {GROUP_LABELS[type]}
        <span className="text-xs font-normal text-muted-foreground tabular-nums">{count}</span>
      </div>
      {children}
    </div>
  );
}

export function BulkEdit({
  steps,
  selected,
  onChange,
}: {
  /** Every step of the macro, in order. */
  steps: Step[];
  selected: Set<string>;
  /** The new steps; `key` names the field, so typing undoes as one step. */
  onChange: (steps: Step[], key: string) => void;
}) {
  const picked = steps.filter((s) => selected.has(s.id));
  const of = <T extends StepType>(type: T) => picked.filter((s): s is StepOf<T> => s.type === type);
  const apply = <T extends StepType>(type: T, field: string, f: (s: StepOf<T>) => StepOf<T>) =>
    onChange(update(steps, selected, type, f), `bulk:${type}:${field}`);
  const [shift, setShift] = useState({ dx: 0, dy: 0 });

  if (picked.length === 0) {
    return <p className="text-sm text-muted-foreground">Tick the steps to change together.</p>;
  }

  const points = picked.filter(hasFixedPoint).length;
  const shuffle = picked.every((s) => s.shuffle) ? true : picked.some((s) => s.shuffle) ? "indeterminate" : false;

  const pointer = (type: "click" | "move") => {
    const list = of(type);
    return (
      <>
        <Field
          label="Jitter"
          help="Aims at a random spot up to this many pixels from each target, so repeated clicks don't hit the exact same pixel."
        >
          <BulkNumber
            label="Jitter"
            unit="px"
            value={shared(list, (s) => s.coord_jitter_px)}
            onChange={(n) => apply(type, "jitter", (s) => ({ ...s, coord_jitter_px: n }))}
          />
        </Field>
        <Field label="Travel" help="0 jumps straight to the target. Above 0 glides the cursor there over that many milliseconds.">
          <BulkNumber
            label="Travel"
            unit="ms"
            value={shared(list, (s) => s.move_duration_ms)}
            onChange={(n) => apply(type, "travel", (s) => ({ ...s, move_duration_ms: n }))}
          />
        </Field>
      </>
    );
  };

  return (
    <div className="flex flex-col divide-y divide-border">
      {typesOf(picked).map(({ type, count }) => (
        <Group key={type} type={type} count={count}>
          {type === "click" && (
            <>
              {pointer("click")}
              <Field label="Button">
                <BulkSelect
                  label="Mouse button"
                  className="w-32"
                  value={shared(of("click"), (s) => s.button)}
                  options={[
                    { value: "left", label: "Left" },
                    { value: "right", label: "Right" },
                    { value: "middle", label: "Middle" },
                    { value: "x1", label: "Side 1" },
                    { value: "x2", label: "Side 2" },
                  ]}
                  onChange={(button) => apply("click", "button", (s) => ({ ...s, button }))}
                />
                <BulkSelect
                  label="Click action"
                  className="w-40"
                  value={shared(of("click"), (s) => s.action)}
                  options={[
                    { value: "click", label: "Click" },
                    { value: "double", label: "Double-click" },
                    { value: "down", label: "Press and hold" },
                    { value: "up", label: "Release" },
                  ]}
                  onChange={(action) => apply("click", "action", (s) => ({ ...s, action }))}
                />
              </Field>
              <Field label="While holding" help="Keys held down for each click, like Shift for a shift-click. A dash means some of the clicks hold it.">
                {MODS.map((m) => (
                  <label key={m} className="flex cursor-pointer items-center gap-2 text-sm capitalize">
                    <Checkbox
                      checked={tri(modifierState(of("click"), m))}
                      onCheckedChange={(c) =>
                        apply("click", `mod:${m}`, (s) => ({ ...s, modifiers: setModifier(s.modifiers, m, c === true) }))
                      }
                    />
                    {m}
                  </label>
                ))}
              </Field>
              <BulkJitter
                label="Hold"
                help="How long the button stays down."
                values={of("click").map((s) => s.hold_ms)}
                onChange={(part, n) => apply("click", `hold:${part}`, (s) => ({ ...s, hold_ms: setJitterPart(s.hold_ms, part, n) }))}
              />
              <BulkJitter
                label="Settle"
                help="Pauses before pressing and after releasing. Raise it if clicks get dropped."
                values={of("click").map((s) => s.settle_ms)}
                onChange={(part, n) =>
                  apply("click", `settle:${part}`, (s) => ({ ...s, settle_ms: setJitterPart(s.settle_ms, part, n) }))
                }
              />
            </>
          )}
          {type === "move" && pointer("move")}
          {type === "key" && (
            <BulkJitter
              label="Hold"
              help="How long each key stays down."
              values={of("key").map((s) => s.hold_ms)}
              onChange={(part, n) => apply("key", `hold:${part}`, (s) => ({ ...s, hold_ms: setJitterPart(s.hold_ms, part, n) }))}
            />
          )}
          {type === "text" && (
            <BulkJitter
              label="Per char"
              help="The pause between characters."
              values={of("text").map((s) => s.per_char_ms)}
              onChange={(part, n) =>
                apply("text", `per_char:${part}`, (s) => ({ ...s, per_char_ms: setJitterPart(s.per_char_ms, part, n) }))
              }
            />
          )}
          {type === "wait" && (
            <BulkJitter
              label="Wait"
              values={of("wait").map((s) => s.ms)}
              onChange={(part, n) => apply("wait", `ms:${part}`, (s) => ({ ...s, ms: setJitterPart(s.ms, part, n) }))}
            />
          )}
          {type === "wait_color" && (
            <>
              <Field label="Tolerance" help="How far each of red, green and blue may be from the color, 0 to 255.">
                <BulkNumber
                  label="Tolerance"
                  max={255}
                  value={shared(of("wait_color"), (s) => s.tolerance)}
                  onChange={(tolerance) => apply("wait_color", "tolerance", (s) => ({ ...s, tolerance }))}
                />
              </Field>
              <Field label="Give up after">
                <BulkNumber
                  label="Give up after"
                  unit="ms"
                  value={shared(of("wait_color"), (s) => s.timeout_ms)}
                  onChange={(timeout_ms) => apply("wait_color", "timeout", (s) => ({ ...s, timeout_ms }))}
                />
                <span className="text-xs text-muted-foreground">then</span>
                <BulkSelect
                  label="When it never shows"
                  className="w-44"
                  value={shared(of("wait_color"), (s) => s.on_timeout)}
                  options={[
                    { value: "stop", label: "Stop the macro" },
                    { value: "continue", label: "Carry on" },
                  ]}
                  onChange={(on_timeout) => apply("wait_color", "on_timeout", (s) => ({ ...s, on_timeout }))}
                />
              </Field>
            </>
          )}
          {type === "scroll" && (
            <Field label="Scroll" help="Notches of the mouse wheel. Negative scrolls down (or left), positive up (or right).">
              <BulkNumber
                label="Notches"
                min={-1000}
                value={shared(of("scroll"), (s) => s.amount)}
                onChange={(amount) => apply("scroll", "amount", (s) => ({ ...s, amount }))}
              />
              <span className="text-xs text-muted-foreground">notches</span>
            </Field>
          )}
        </Group>
      ))}

      <div className="flex flex-col gap-3 pt-4">
        <div className="text-sm font-medium">
          Every selected step <span className="text-xs font-normal text-muted-foreground tabular-nums">{picked.length}</span>
        </div>
        <Field
          label="Shuffle"
          help="Shuffled steps trade places with each other at random, in a new order every pass. A dash means some of them shuffle."
        >
          <Checkbox
            aria-label="Shuffle"
            checked={shuffle}
            onCheckedChange={(c) =>
              onChange(
                steps.map((s) => (selected.has(s.id) ? { ...s, shuffle: c === true } : s)),
                "bulk:shuffle",
              )
            }
          />
        </Field>
        {points > 0 && (
          <Field
            label="Shift points"
            help="Moves every fixed screen point by this much, for when the window you click in has moved. Offset steps are left alone: they follow the mouse, the window or the step before."
            hint={`${points} of the selected steps ${points === 1 ? "has a fixed point" : "have fixed points"}.`}
          >
            <span className="text-sm text-muted-foreground">X</span>
            <Input
              type="number"
              aria-label="Shift X"
              className="w-24 tabular-nums"
              value={shift.dx}
              onChange={(e) => setShift({ ...shift, dx: Math.trunc(+e.target.value || 0) })}
            />
            <span className="text-sm text-muted-foreground">Y</span>
            <Input
              type="number"
              aria-label="Shift Y"
              className="w-24 tabular-nums"
              value={shift.dy}
              onChange={(e) => setShift({ ...shift, dy: Math.trunc(+e.target.value || 0) })}
            />
            <span className="text-xs text-muted-foreground">px</span>
            <Button
              variant="outline"
              disabled={shift.dx === 0 && shift.dy === 0}
              onClick={() => {
                onChange(shiftFixed(steps, selected, shift.dx, shift.dy), `bulk:shift:${performance.now()}`);
                setShift({ dx: 0, dy: 0 });
              }}
            >
              <MoveRight />
              Shift
            </Button>
          </Field>
        )}
      </div>
    </div>
  );
}
