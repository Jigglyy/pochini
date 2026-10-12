import { useEffect, useMemo, useState } from "react";
import { closestCenter, DndContext, DragOverlay, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import {
  ArrowUpDown,
  Check,
  Crosshair,
  Keyboard,
  MousePointerClick,
  Move,
  Play,
  Save,
  Timer,
  Type,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AppPicker } from "@/components/AppPicker";
import { KeyCapture } from "@/components/KeyCapture";
import { SortableStepRow, StepFace } from "@/components/StepRow";
import { DROP_ANIMATION, useDragSensors } from "@/components/sortable";
import { HelpTip } from "@/components/HelpTip";
import { Field, Notice, Section, Segmented, ToggleRow } from "@/components/layout";
import { getMacro, saveMacro, testSteps } from "@/lib/ipc";
import { tone, useStepColors } from "@/lib/colors";
import { useFlip } from "@/lib/motion";
import { aimPoints, blankStep, fmtRange, newId, stepRange, type NewStepKind } from "@/lib/steps";
import type { Macro, QueueFrom, Repeat, Step, TriggerMode } from "@/types";

const QUEUE_FROM: readonly { value: QueueFrom; label: string }[] = [
  { value: "first_press", label: "The first press" },
  { value: "each_press", label: "Each press" },
];

const ADD: { kind: NewStepKind; label: string; Icon: typeof Play; hint: string }[] = [
  { kind: "click", label: "Click", Icon: MousePointerClick, hint: "Click a fixed position" },
  { kind: "click_here", label: "Click at mouse", Icon: Crosshair, hint: "Click where the mouse is when the macro starts" },
  { kind: "move", label: "Move", Icon: Move, hint: "Move the cursor" },
  { kind: "key", label: "Key", Icon: Keyboard, hint: "Press a key" },
  { kind: "text", label: "Type text", Icon: Type, hint: "Type a string" },
  { kind: "wait", label: "Wait", Icon: Timer, hint: "Pause" },
  { kind: "scroll", label: "Scroll", Icon: ArrowUpDown, hint: "Scroll the wheel" },
];

/** Keys a user types constantly. Blocking one of these from other apps makes
 *  the keyboard feel broken, so it earns a warning at the moment of choice. */
const COMMON = new Set([
  0x20, 0x0d, 0x08, 0x09, 0x1b,
  ...Array.from({ length: 26 }, (_, i) => 0x41 + i),
  ...Array.from({ length: 10 }, (_, i) => 0x30 + i),
]);

export function MacroEditor({
  id,
  onName,
  onRun,
  onDirtyChange,
}: {
  id: string;
  onName: (name: string) => void;
  onRun: (label: string) => void;
  /** Lets the app ask before navigating away from unsaved changes. */
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [m, setM] = useState<Macro | null>(null);
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const [draggingStep, setDraggingStep] = useState<string | null>(null);
  const sensors = useDragSensors();
  // Steps glide when buttons or menus move, add or remove them.
  const flip = useFlip<HTMLDivElement>();
  const colors = useStepColors();

  useEffect(() => {
    getMacro(id)
      .then((x) => {
        setM(x);
        onName(x.name);
      })
      .catch((e) => setErr(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  // Ctrl+S saves, as everywhere else.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (dirty && m) void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const est = useMemo<[number, number]>(() => {
    if (!m) return [0, 0];
    return m.steps.reduce<[number, number]>(
      ([lo, hi], s) => {
        const [a, b] = stepRange(s);
        return [lo + a, hi + b];
      },
      [0, 0],
    );
  }, [m]);

  if (err && !m) {
    return <p className="mx-auto max-w-4xl text-sm text-destructive">{err}</p>;
  }
  if (!m) return <p className="mx-auto max-w-4xl text-sm text-muted-foreground">Loading...</p>;

  const edit = (patch: Partial<Macro>) => {
    setM({ ...m, ...patch });
    setDirty(true);
    if (patch.name !== undefined) onName(patch.name);
  };

  const setStep = (i: number, s: Step) => {
    const steps = [...m.steps];
    steps[i] = s;
    edit({ steps });
  };

  // Buttons and menus glide steps to their new places; a drag drop does
  // not, dnd-kit already animated it.
  const moveStep = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= m.steps.length) return;
    const steps = [...m.steps];
    [steps[i], steps[j]] = [steps[j], steps[i]];
    flip.prepare(m.steps[i].id); // keep the step being moved in view
    edit({ steps });
  };

  const draggingIndex = m.steps.findIndex((s) => s.id === draggingStep);
  const aims = aimPoints(m.steps);
  const dropStep = ({ active, over }: DragEndEvent) => {
    setDraggingStep(null);
    if (!over || active.id === over.id) return;
    const from = m.steps.findIndex((s) => s.id === active.id);
    const to = m.steps.findIndex((s) => s.id === over.id);
    if (from < 0 || to < 0) return;
    edit({ steps: arrayMove(m.steps, from, to) });
  };

  const add = (kind: NewStepKind) => {
    const s = blankStep(kind);
    flip.prepare();
    setJustAdded(s.id);
    edit({ steps: [...m.steps, s] });
  };

  async function save() {
    if (!m) return;
    try {
      await saveMacro(m);
      setDirty(false);
      setErr(null);
    } catch (e) {
      setErr(String(e));
    }
  }

  const t = m.trigger;
  const risky = t?.swallow && t.modifiers.length === 0 && COMMON.has(t.key.vk);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={m.name}
          onChange={(e) => edit({ name: e.target.value })}
          aria-label="Macro name"
          className="h-10 min-w-48 flex-1 font-display text-lg font-semibold"
        />
        <Button
          variant="outline"
          size="lg"
          disabled={m.steps.length === 0}
          onClick={() => {
            onRun(`${m.name} (test)`);
            testSteps(m.steps).catch((e) => setErr(String(e)));
          }}
        >
          <Play />
          Test
        </Button>
        <Button onClick={save} disabled={!dirty} variant={dirty ? "default" : "outline"} size="lg" className="min-w-28">
          {dirty ? <Save /> : <Check />}
          {dirty ? "Save" : "Saved"}
        </Button>
      </div>

      {dirty && (
        <p className="-mt-5 animate-in text-xs text-warning fade-in-0" role="status">
          Not saved yet. Your hotkey still runs the saved version.
        </p>
      )}

      {err && (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 p-2.5 text-sm text-destructive">
          {err}
        </p>
      )}

      <Section title="Trigger">
        <Field
          label="Hotkey"
          help="Press Record, then the key or combination. The macro runs whenever you press it, in any app, even inside a game."
        >
          <KeyCapture
            value={t ? { key: t.key, modifiers: t.modifiers } : null}
            onChange={(h) =>
              edit({
                trigger: h
                  ? { key: h.key, modifiers: h.modifiers, mode: t?.mode ?? "once", swallow: t?.swallow ?? false }
                  : null,
              })
            }
          />
        </Field>

        {t && (
          <Field
            label="Mode"
            help={
              <div className="flex flex-col gap-1.5">
                <p>
                  <span className="font-medium">Run once per press</span>: one run for each press.
                </p>
                <p>
                  <span className="font-medium">Repeat while held</span>: runs again and again until you let go.
                </p>
                <p>
                  <span className="font-medium">Press to start, press again to stop</span>: a toggle.
                </p>
              </div>
            }
          >
            <Select
              value={t.mode}
              onValueChange={(v) => edit({ trigger: { ...t, mode: v as TriggerMode } })}
            >
              <SelectTrigger className="w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="once">Run once per press</SelectItem>
                <SelectItem value="hold_repeat">Repeat while held</SelectItem>
                <SelectItem value="toggle">Press to start, press again to stop</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        )}

        <ToggleRow
          label="Hotkey on"
          help="When off, this macro ignores its hotkey. Run and Test still work."
          checked={m.enabled}
          onChange={(enabled) => edit({ enabled })}
        />
        {t && (
          <ToggleRow
            label="Block the key from other apps"
            help="The app or game you're in never sees the key press. Off by default, so the key keeps working there too."
            checked={t.swallow}
            onChange={(swallow) => edit({ trigger: { ...t, swallow } })}
          >
            {risky && (
              <Notice>
                {t.key.label} is a key you type all the time. With blocking on, it stops working in every
                other app while macros are on.
              </Notice>
            )}
          </ToggleRow>
        )}
        <ToggleRow
          label="App only"
          help="The hotkey only works while the mouse is over the chosen app. Anywhere else the key behaves normally and is never blocked."
          checked={m.guard !== null}
          onChange={(on) => edit({ guard: on ? (m.guard ?? { process: "", label: "" }) : null })}
        >
          <AppPicker value={m.guard?.process ? m.guard : null} onChange={(guard) => edit({ guard })} />
          {m.guard && !m.guard.process && (
            <p className="text-xs text-warning">Choose an app, or this hotkey will never fire.</p>
          )}
        </ToggleRow>
      </Section>

      <Section title="When it runs">
        <Field
          label="Repeat"
          help="How many times the steps run each time the macro starts."
          hint={m.repeat.kind === "forever" ? "Stop it with the panic key, or a toggle hotkey's second press." : undefined}
        >
          <Select
            value={m.repeat.kind}
            onValueChange={(v) => {
              const k = v as Repeat["kind"];
              edit({ repeat: k === "count" ? { kind: "count", n: 10 } : { kind: k } });
            }}
          >
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="once">Once</SelectItem>
              <SelectItem value="count">A set number of times</SelectItem>
              <SelectItem value="forever">Until stopped</SelectItem>
            </SelectContent>
          </Select>
          {m.repeat.kind === "count" && (
            <>
              <Input
                type="number"
                min={1}
                className="w-24 tabular-nums"
                value={m.repeat.n}
                onChange={(e) => edit({ repeat: { kind: "count", n: Math.max(1, +e.target.value || 1) } })}
              />
              <span className="text-xs text-muted-foreground">times</span>
            </>
          )}
        </Field>
        <ToggleRow
          label="Queue presses"
          hint={t && t.mode !== "once" ? 'Only in "Run once per press" mode.' : undefined}
          help="Pressing the hotkey while this macro runs queues another run instead of ignoring the press. Runs follow one after another. Panic stop clears the queue."
          checked={m.queue}
          disabled={!!t && t.mode !== "once"}
          // Turning the queue on starts from the first press: with a macro that
          // moves the mouse, "each press" almost never aims where you meant.
          onChange={(queue) => edit(queue ? { queue, queue_from: "first_press" } : { queue })}
        >
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Queued runs start from</span>
            <Segmented
              label="Queued runs start from"
              value={m.queue_from}
              options={QUEUE_FROM}
              onChange={(queue_from) => edit({ queue_from })}
            />
            <HelpTip about="where queued runs start">
              <div className="flex flex-col gap-1.5">
                <p>
                  <span className="font-medium">The first press</span>: every queued run starts where the first
                  press was, so "Click where the mouse started" keeps clicking that spot. A press after the queue
                  has emptied starts a new chain.
                </p>
                <p>
                  <span className="font-medium">Each press</span>: where the mouse was at that press. A press made
                  while the macro runs catches the mouse wherever the macro moved it.
                </p>
              </div>
            </HelpTip>
          </div>
        </ToggleRow>
        <ToggleRow
          label="Move mouse back to where it started"
          help="When the macro ends, the cursor jumps back to where it was when the macro started. Also after releasing a hold-to-repeat key or pressing a toggle hotkey again, but not after Panic or Stop."
          checked={m.return_to_start}
          onChange={(return_to_start) => edit({ return_to_start })}
        />
      </Section>

      <Section
        title="Steps"
        bare
        action={
          m.steps.length > 0 && (
            <span className="text-xs text-muted-foreground">
              Takes {fmtRange(est)}
              {m.repeat.kind === "count" ? `, ${m.repeat.n} times` : ""}
            </span>
          )
        }
      >
        {m.steps.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No steps yet. Add the first one below.
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={(e) => setDraggingStep(String(e.active.id))}
            onDragEnd={dropStep}
            onDragCancel={() => setDraggingStep(null)}
          >
            <SortableContext items={m.steps.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              <div ref={flip.ref} className="flex flex-col gap-2">
                {m.steps.map((s, i) => (
                  <SortableStepRow
                    key={s.id}
                    step={s}
                    index={i}
                    count={m.steps.length}
                    aim={aims[i]}
                    hasEarlierPoint={aims.slice(0, i).some((a) => a !== null)}
                    defaultOpen={s.id === justAdded}
                    onChange={(ns) => setStep(i, ns)}
                    onDelete={() => {
                      flip.prepare();
                      edit({ steps: m.steps.filter((_, j) => j !== i) });
                    }}
                    onDuplicate={() => {
                      const steps = [...m.steps];
                      steps.splice(i + 1, 0, { ...s, id: newId() } as Step);
                      flip.prepare();
                      edit({ steps });
                    }}
                    onMove={(d) => moveStep(i, d)}
                  />
                ))}
              </div>
            </SortableContext>
            <DragOverlay dropAnimation={DROP_ANIMATION}>
              {draggingIndex >= 0 && <StepFace step={m.steps[draggingIndex]} index={draggingIndex} />}
            </DragOverlay>
          </DndContext>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="mr-1 text-sm text-muted-foreground">Add</span>
          {ADD.map(({ kind, label, Icon, hint }) => (
            <Button key={kind} variant="outline" size="sm" onClick={() => add(kind)} title={hint}>
              <Icon style={{ color: tone(colors[kind])?.icon }} />
              {label}
            </Button>
          ))}
        </div>
      </Section>
    </div>
  );
}
