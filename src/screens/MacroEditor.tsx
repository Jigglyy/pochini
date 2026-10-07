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
import { Field, Notice, Section, ToggleRow } from "@/components/layout";
import { getMacro, saveMacro, testSteps } from "@/lib/ipc";
import { tone, useStepColors } from "@/lib/colors";
import { aimPoints, blankStep, fmtRange, newId, stepRange, type NewStepKind } from "@/lib/steps";
import type { Macro, Repeat, Step, TriggerMode } from "@/types";

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

  const moveStep = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= m.steps.length) return;
    const steps = [...m.steps];
    [steps[i], steps[j]] = [steps[j], steps[i]];
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
          className="h-10 min-w-48 flex-1 text-lg font-semibold"
        />
        <Button
          variant="outline"
          disabled={m.steps.length === 0}
          onClick={() => {
            onRun(`${m.name} (test)`);
            testSteps(m.steps).catch((e) => setErr(String(e)));
          }}
        >
          <Play />
          Test
        </Button>
        <Button onClick={save} disabled={!dirty}>
          {dirty ? <Save /> : <Check />}
          {dirty ? "Save" : "Saved"}
        </Button>
      </div>

      {err && (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 p-2.5 text-sm text-destructive">
          {err}
        </p>
      )}

      <Section title="Trigger">
        <Field
          label="Hotkey"
          hint={t ? undefined : "Record a key to run this macro from anywhere, even inside a game."}
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
          <Field label="Mode">
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

        <div className="flex flex-col gap-2">
          <ToggleRow
            label="Hotkey on"
            hint="When off, this macro ignores its hotkey. Run and Test still work."
            checked={m.enabled}
            onChange={(enabled) => edit({ enabled })}
          />
          {t && (
            <ToggleRow
              label="Block the key from other apps"
              hint="The app or game you are in never sees the key press. Off by default, so the key keeps working normally too."
              checked={t.swallow}
              onChange={(swallow) => edit({ trigger: { ...t, swallow } })}
            />
          )}
          {risky && (
            <Notice>
              {t?.key.label} is a key you type all the time. With blocking on, it stops working in every
              other app while macros are on.
            </Notice>
          )}
          <ToggleRow
            label="App only"
            hint="The hotkey only works while the mouse is over the chosen app. Anywhere else the key behaves normally and is never blocked."
            checked={m.guard !== null}
            onChange={(on) => edit({ guard: on ? (m.guard ?? { process: "", label: "" }) : null })}
          >
            <AppPicker value={m.guard?.process ? m.guard : null} onChange={(guard) => edit({ guard })} />
            {m.guard && !m.guard.process && (
              <p className="mt-2 text-xs text-warning">Choose an app, or this hotkey will never fire.</p>
            )}
          </ToggleRow>
        </div>
      </Section>

      <Section title="When it runs">
        <Field label="Repeat">
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
        {m.repeat.kind === "forever" && (
          <p className="text-xs text-muted-foreground">
            Runs until you press the panic key, flip it off, or press a toggle-mode hotkey again.
          </p>
        )}

        <div className="flex flex-col gap-2">
          <ToggleRow
            label="Queue presses"
            hint={
              t && t.mode !== "once"
                ? 'Only for "Run once per press" mode.'
                : "Pressing the hotkey while this macro runs queues another run instead of ignoring the press. Queued runs follow one after another, each using the mouse position from its own press. Panic stop clears the queue."
            }
            checked={m.queue}
            disabled={!!t && t.mode !== "once"}
            onChange={(queue) => edit({ queue })}
          />
          <ToggleRow
            label="Move mouse back to where it started"
            hint="When the macro finishes, the cursor jumps back to where it was when you pressed the hotkey (or when the Run countdown ended). Also after releasing a hold-to-repeat key or pressing a toggle hotkey again; not after Panic or Stop, which leave the mouse alone."
            checked={m.return_to_start}
            onChange={(return_to_start) => edit({ return_to_start })}
          />
        </div>
      </Section>

      <Section
        title="Steps"
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
          <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No steps yet. Add one below.
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
              <div className="flex flex-col gap-2">
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
                    onDelete={() => edit({ steps: m.steps.filter((_, j) => j !== i) })}
                    onDuplicate={() => {
                      const steps = [...m.steps];
                      steps.splice(i + 1, 0, { ...s, id: newId() } as Step);
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

        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
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
