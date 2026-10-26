import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { closestCenter, DndContext, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, rectSortingStrategy, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import {
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronsDownUp,
  CircleDot,
  Columns2,
  LayoutGrid,
  Copy,
  ListChecks,
  Route,
  Rows2,
  Rows4,
  SlidersHorizontal,
  Square,
  SquareCheck,
  Redo2,
  Trash2,
  Undo2,
  Crosshair,
  Keyboard,
  MousePointerClick,
  Move,
  Pipette,
  Play,
  Save,
  Timer,
  Type,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AppPicker } from "@/components/AppPicker";
import { BulkEdit } from "@/components/BulkEdit";
import { KeyCapture } from "@/components/KeyCapture";
import { FeelRows } from "@/components/FeelRows";
import { SortableStepRow, StepFace, StepFields } from "@/components/StepRow";
import { KindChip } from "@/components/StepColors";
import { FloatingOverlay, useDragSensors } from "@/components/sortable";
import { HelpTip } from "@/components/HelpTip";
import { Field, Notice, Section, Segmented, ToggleRow } from "@/components/layout";
import {
  getMacro,
  onRecordingDone,
  onRunFinished,
  onRunStep,
  saveMacro,
  startRecording,
  stopRecording,
  testSteps,
} from "@/lib/ipc";
import { colorKind, KIND_LABELS, tone, useStepColors, type ColorKind } from "@/lib/colors";
import { runSummary, triggerSummary } from "@/lib/describe";
import { record, redo, start, undo, type History } from "@/lib/history";
import { useFlip } from "@/lib/motion";
import { readPrefs, writePrefs, type StepView } from "@/lib/prefs";
import {
  allState,
  duplicateSelected,
  kindCounts,
  kindState,
  prune,
  removeSelected,
  selectRange,
  toggleKind,
} from "@/lib/selection";
import { useShortcut, withKeys } from "@/lib/shortcuts";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { aimPoints, blankStep, fmtRange, macroRange, newId, summarize, type NewStepKind } from "@/lib/steps";
import { cn } from "@/lib/utils";
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
  { kind: "wait_color", label: "Wait for color", Icon: Pipette, hint: "Wait until a point on screen turns a color" },
  { kind: "scroll", label: "Scroll", Icon: ArrowUpDown, hint: "Scroll the wheel" },
];

/** The step list's layouts (lib/prefs.ts StepView). */
const VIEWS: { value: StepView; label: string; Icon: typeof Play }[] = [
  { value: "cards", label: "Cards", Icon: Rows2 },
  { value: "compact", label: "Compact list", Icon: Rows4 },
  { value: "split", label: "Side by side", Icon: Columns2 },
  { value: "squares", label: "Squares", Icon: LayoutGrid },
];

/** Layouts that show the chosen step's settings in a panel beside the steps. */
const besideView = (v: StepView) => v === "split" || v === "squares";

/** Keys a user types constantly. Blocking one of these from other apps makes
 *  the keyboard feel broken, so it earns a warning at the moment of choice. */
const COMMON = new Set([
  0x20, 0x0d, 0x08, 0x09, 0x1b,
  ...Array.from({ length: 26 }, (_, i) => 0x41 + i),
  ...Array.from({ length: 10 }, (_, i) => 0x30 + i),
]);

/** A one-line confirmation on the step list, with Undo. */
function UndoLine({ text, onUndo }: { text: string; onUndo?: () => void }) {
  return (
    <div
      role="status"
      className="flex animate-in items-center gap-3 rounded-md border border-border bg-muted/50 px-3 py-2 text-sm fade-in-0 motion-reduce:animate-none"
    >
      <span className="min-w-0 flex-1 truncate">{text}</span>
      {onUndo && (
        <Button variant="outline" size="sm" onClick={onUndo}>
          <Undo2 />
          Undo
        </Button>
      )}
    </div>
  );
}

export function MacroEditor({
  id,
  onName,
  onRun,
  onDirtyChange,
  panicKey,
}: {
  id: string;
  onName: (name: string) => void;
  onRun: (label: string) => void;
  /** Lets the app ask before navigating away from unsaved changes. */
  onDirtyChange: (dirty: boolean) => void;
  panicKey: string;
}) {
  // The unsaved macro, with undo and redo (lib/history.ts).
  const [hist, setHist] = useState<History<Macro> | null>(null);
  const m = hist?.present ?? null;
  /** The macro as last saved (or loaded), to tell whether anything changed. */
  const [saved, setSaved] = useState("");
  /** Bumped by each save, so the "Saved" check pops then and not on load. */
  const [saves, setSaves] = useState(0);
  const dirty = m !== null && JSON.stringify(m) !== saved;
  /** "Deleted ..." after deleting steps, for its Undo line. */
  const [deleted, setDeleted] = useState<string | null>(null);
  /** Record mode is on (the hooks report every click and key). */
  const [recording, setRecordingMode] = useState(false);
  const recordingRef = useRef(false);
  /** "Recorded 5 steps." after a recording, with Undo. */
  const [recorded, setRecorded] = useState<string | null>(null);
  /** The step a run of this macro is on, to light it up. */
  const [runningStep, setRunningStep] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const [draggingStep, setDraggingStep] = useState<string | null>(null);
  const sensors = useDragSensors();
  // Steps glide when buttons or menus move, add or remove them.
  const flip = useFlip<HTMLDivElement>();
  const colors = useStepColors();

  /** How the steps are laid out; remembered for every macro. */
  const [view, setViewState] = useState<StepView>(() => readPrefs().stepView ?? "cards");
  /** Split and squares show the chosen step's settings beside the steps. */
  const beside = besideView(view);
  /** Steps whose settings are open under their header (cards, compact). */
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  /** The step shown beside the list (split view). */
  const [current, setCurrent] = useState<string | null>(null);
  /** Choosing steps to change together, and which. The Set may name steps
   *  that are gone (deleted); `selected` below leaves those out, and Undo
   *  brings them back ticked. */
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  /** The last step ticked, where a Shift+click range starts. */
  const anchor = useRef<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  /** Sections folded to their summary line ("trigger", "runs"). */
  const [folded, setFolded] = useState<string[]>(() => readPrefs().folded ?? []);

  useEffect(() => {
    getMacro(id)
      .then((x) => {
        setHist(start(x));
        setSaved(JSON.stringify(x));
      })
      .catch((e) => setErr(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  // A recording's steps go on the end, as one undoable edit.
  useEffect(() => {
    const un = onRecordingDone((steps) => {
      recordingRef.current = false;
      setRecordingMode(false);
      if (steps.length === 0) {
        setRecorded("Nothing was recorded.");
        return;
      }
      flip.prepare();
      setDeleted(null);
      setHist((h) => h && record(h, { ...h.present, steps: [...h.present.steps, ...steps] }, performance.now()));
      setRecorded(`Recorded ${steps.length} step${steps.length === 1 ? "" : "s"}.`);
    });
    return () => {
      void un.then((f) => f());
      // Leaving mid-recording ends it: nothing else would.
      if (recordingRef.current) void stopRecording();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Light up the step a run of this macro is on (hotkey, Run, Test, dry run).
  useEffect(() => {
    const a = onRunStep((mid, i) => mid === id && setRunningStep(i));
    const b = onRunFinished((r) => r.macro_id === id && setRunningStep(null));
    return () => {
      void a.then((f) => f());
      void b.then((f) => f());
    };
  }, [id]);

  // The header shows the name as it is now, undo included.
  const name = m?.name;
  useEffect(() => {
    if (name !== undefined) onName(name);
  }, [name, onName]);

  const selected = useMemo(() => (m ? prune(m.steps, picked) : picked), [m, picked]);

  // Steps glide back into place on undo and redo too.
  const step = (to: (h: History<Macro>) => History<Macro>) => {
    flip.prepare();
    setDeleted(null);
    setHist((h) => h && to(h));
  };
  useShortcut("Ctrl+Z", () => step(undo));
  useShortcut(["Ctrl+Y", "Ctrl+Shift+Z"], () => step(redo));
  useShortcut("Ctrl+S", () => dirty && void save(), { inFields: true });
  useShortcut("Ctrl+Enter", () => runTest(), { inFields: true });
  useShortcut("Ctrl+A", () => selectAll(), { enabled: !!m && m.steps.length > 0 });
  useShortcut("Delete", () => deleteSelected(), { enabled: selecting && selected.size > 0 });

  const est = useMemo<[number, number]>(() => (m ? macroRange(m) : [0, 0]), [m]);

  // The settings panel beside the steps (split, squares) is as tall as the
  // step it shows. The steps area keeps the tallest it has been, so choosing
  // a step with fewer settings never shrinks the page: scrolled to the
  // bottom, the page shrank between the press and the release, the steps
  // jumped under the pointer, and a Ctrl+click or Shift+click missed.
  const panelRef = useRef<HTMLElement>(null);
  const [panelHeight, setPanelHeight] = useState(0);
  const hasSteps = (m?.steps.length ?? 0) > 0;
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!beside || !hasSteps || !el) {
      setPanelHeight(0);
      return;
    }
    // Anew for each layout and macro.
    let tallest = el.offsetHeight;
    setPanelHeight(tallest);
    const ro = new ResizeObserver(() => {
      tallest = Math.max(tallest, el.offsetHeight);
      setPanelHeight(tallest);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [beside, hasSteps, view, id]);

  if (err && !m) {
    return <p className="page-column text-sm text-destructive">{err}</p>;
  }
  if (!m) return <p className="page-column text-sm text-muted-foreground">Loading...</p>;

  /** `key` names what changed ("name", a step id) so typing into one field
   *  undoes as one step; see lib/history.ts. */
  const edit = (patch: Partial<Macro>, key?: string) => {
    setDeleted(null);
    setHist((h) => h && record(h, { ...h.present, ...patch }, performance.now(), key));
  };

  const setStep = (i: number, s: Step) => {
    const steps = [...m.steps];
    steps[i] = s;
    edit({ steps }, `step:${s.id}`);
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

  const moveStepTo = (i: number, edge: "top" | "bottom") => {
    flip.prepare(m.steps[i].id);
    edit({ steps: arrayMove(m.steps, i, edge === "top" ? 0 : m.steps.length - 1) });
  };

  const draggingIndex = m.steps.findIndex((s) => s.id === draggingStep);
  const aims = aimPoints(m.steps);
  const shuffled = m.steps.filter((s) => s.shuffle).length;
  const dropStep = ({ active, over }: DragEndEvent) => {
    setDraggingStep(null);
    if (!over || active.id === over.id) return;
    const from = m.steps.findIndex((s) => s.id === active.id);
    const to = m.steps.findIndex((s) => s.id === over.id);
    if (from < 0 || to < 0) return;
    edit({ steps: arrayMove(m.steps, from, to) });
  };

  /** A new step at `at` (the end by default), opened (or shown, in split
   *  view) so it can be filled in. */
  const add = (kind: NewStepKind, at = m.steps.length) => {
    const s = blankStep(kind);
    flip.prepare();
    setJustAdded(s.id);
    if (beside) setCurrent(s.id);
    else setOpen((o) => new Set(o).add(s.id));
    const steps = [...m.steps];
    steps.splice(at, 0, s);
    edit({ steps });
  };

  const setView = (v: StepView) => {
    if (v === view) return;
    flip.prepare();
    setViewState(v);
    setBulkOpen(false);
    writePrefs({ stepView: v });
    // Split view shows one step: the open one, or the first.
    if (besideView(v) && !m.steps.some((s) => s.id === current)) {
      setCurrent(m.steps.find((s) => open.has(s.id))?.id ?? m.steps[0]?.id ?? null);
    }
  };

  const fold = (key: string) => ({
    open: !folded.includes(key),
    onOpenChange: (o: boolean) => {
      const next = o ? folded.filter((k) => k !== key) : [...folded, key];
      setFolded(next);
      writePrefs({ folded: next });
    },
  });

  function startSelecting(ids: string[] = []) {
    setSelecting(true);
    setPicked(new Set(ids));
    anchor.current = ids[ids.length - 1] ?? null;
  }

  function stopSelecting() {
    setSelecting(false);
    setPicked(new Set());
    setBulkOpen(false);
    anchor.current = null;
  }

  function selectAll() {
    if (!m) return;
    startSelecting(m.steps.map((s) => s.id));
  }

  /** Tick or untick one step; with `range`, every step from the last one
   *  ticked (Shift+click). */
  const tick = (id: string, on: boolean, range: boolean) => {
    setPicked((p) => {
      if (range && anchor.current) return selectRange(m.steps, prune(m.steps, p), anchor.current, id, on);
      const next = new Set(p);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
    anchor.current = id;
  };

  const selectKind = (kind: ColorKind) => {
    setPicked((p) => toggleKind(m.steps, selecting ? prune(m.steps, p) : new Set(), kind));
    setSelecting(true);
  };

  function deleteSelected() {
    if (!m || selected.size === 0) return;
    const gone = m.steps.filter((s) => selected.has(s.id));
    flip.prepare();
    edit({ steps: removeSelected(m.steps, selected) });
    setDeleted(gone.length === 1 ? `Deleted "${summarize(gone[0])}".` : `Deleted ${gone.length} steps.`);
  }

  const duplicateSelection = () => {
    const { steps, copies } = duplicateSelected(m.steps, selected, newId);
    flip.prepare(copies[0]);
    edit({ steps });
    // The copies are what you will want to move or change next.
    setPicked(new Set(copies));
    anchor.current = copies[copies.length - 1] ?? null;
  };

  async function save() {
    if (!m) return;
    try {
      await saveMacro(m);
      // Tell the app now, not in an effect a render later: navigating away
      // right after Save asked "Discard unsaved changes?" for nothing.
      onDirtyChange(false);
      // Saving from the editor counts as checking an imported macro (the
      // backend clears `review`); say so here too, not only after a reload.
      const now = m.review ? { ...m, review: false } : m;
      if (now !== m) setHist((h) => h && { ...h, present: now });
      setSaved(JSON.stringify(now));
      setSaves((n) => n + 1);
      setErr(null);
    } catch (e) {
      setErr(String(e));
    }
  }

  function runTest(dry = false) {
    if (!m || m.steps.length === 0) return;
    onRun(`${m.name} (${dry ? "dry run" : "test"})`);
    testSteps(m.steps, m.name, { id: m.id, guard: m.guard, dry }).catch((e) => setErr(String(e)));
  }

  const toggleRecording = async () => {
    setErr(null);
    setRecorded(null);
    try {
      if (recordingRef.current) {
        await stopRecording(); // the steps arrive through onRecordingDone
      } else {
        await startRecording(true);
        recordingRef.current = true;
        setRecordingMode(true);
      }
    } catch (e) {
      setErr(String(e));
    }
  };

  const t = m.trigger;
  const risky = t?.swallow && t.modifiers.length === 0 && COMMON.has(t.key.vk);
  const dense = view !== "cards";
  const shown = m.steps.find((s) => s.id === current) ?? null;
  const shownIndex = shown ? m.steps.indexOf(shown) : -1;
  const n = selected.size;

  const rows = m.steps.map((s, i) => (
    <SortableStepRow
      key={s.id}
      step={s}
      index={i}
      count={m.steps.length}
      aim={aims[i]}
      hasEarlierPoint={aims.slice(0, i).some((a) => a !== null)}
      shuffled={shuffled}
      running={runningStep === i}
      guard={m.guard}
      dense={dense}
      inline={!beside}
      square={view === "squares"}
      open={beside ? current === s.id : open.has(s.id)}
      onOpenChange={(o) => {
        if (beside) setCurrent(s.id);
        else
          setOpen((prev) => {
            const next = new Set(prev);
            if (o) next.add(s.id);
            else next.delete(s.id);
            return next;
          });
      }}
      revealOnMount={s.id === justAdded}
      selecting={selecting}
      selected={selected.has(s.id)}
      onSelect={(on, range) => tick(s.id, on, range)}
      onStartSelect={() => startSelecting([s.id])}
      onSelectKind={() => selectKind(colorKind(s))}
      onChange={(ns) => setStep(i, ns)}
      onDelete={() => {
        flip.prepare();
        edit({ steps: m.steps.filter((_, j) => j !== i) });
        setDeleted(`Deleted "${summarize(s)}".`);
      }}
      onDuplicate={() => {
        const steps = [...m.steps];
        steps.splice(i + 1, 0, { ...s, id: newId() } as Step);
        flip.prepare();
        edit({ steps });
      }}
      onMove={(d) => moveStep(i, d)}
      onMoveTo={(edge) => moveStepTo(i, edge)}
      onInsert={(kind, where) => add(kind, where === "above" ? i : i + 1)}
    />
  ));

  const list = (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={(e) => setDraggingStep(String(e.active.id))}
      onDragEnd={dropStep}
      onDragCancel={() => setDraggingStep(null)}
    >
      <SortableContext
        items={m.steps.map((s) => s.id)}
        strategy={view === "squares" ? rectSortingStrategy : verticalListSortingStrategy}
      >
        <div
          ref={flip.ref}
          data-step-view={view}
          className={cn(
            view === "squares"
              ? "grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-2"
              : dense
                ? "flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-card/40"
                : "flex flex-col gap-2",
          )}
        >
          {rows}
        </div>
      </SortableContext>
      <FloatingOverlay>
        {draggingIndex >= 0 && (
          <StepFace step={m.steps[draggingIndex]} index={draggingIndex} dense={dense} square={view === "squares"} />
        )}
      </FloatingOverlay>
    </DndContext>
  );

  return (
    <div className="page-column flex flex-col gap-8">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={m.name}
          onChange={(e) => edit({ name: e.target.value }, "name")}
          aria-label="Macro name"
          className="h-10 min-w-48 flex-1 font-display text-lg font-semibold"
        />
        <div className="flex items-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-lg" aria-label="Undo" disabled={!hist?.past.length} onClick={() => step(undo)}>
                <Undo2 />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{withKeys("Undo", "Ctrl+Z")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-lg" aria-label="Redo" disabled={!hist?.future.length} onClick={() => step(redo)}>
                <Redo2 />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{withKeys("Redo", "Ctrl+Y")}</TooltipContent>
          </Tooltip>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="lg" disabled={m.steps.length === 0} onClick={() => runTest()}>
              <Play />
              Test
            </Button>
          </TooltipTrigger>
          <TooltipContent>{withKeys("Runs these steps after a 3 second countdown", "Ctrl+Enter")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="lg" disabled={m.steps.length === 0} onClick={() => runTest(true)}>
              <Route />
              Dry run
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            After a 3 second countdown, moves the mouse to each click and move point in turn, without clicking
            or typing
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button onClick={save} disabled={!dirty} variant={dirty ? "default" : "outline"} size="lg" className="min-w-28">
              {dirty ? <Save /> : <Check key={saves} className={saves > 0 ? "animate-pop" : undefined} />}
              {dirty ? "Save" : "Saved"}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{withKeys("Save", "Ctrl+S")}</TooltipContent>
        </Tooltip>
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

      {m.review && (
        <Notice>
          Imported from a file, so someone else wrote it. Check every step below before you use it; saving it
          marks it as checked.
        </Notice>
      )}

      {/* Side by side on a wide window; one above the other otherwise. */}
      <div className="grid items-start gap-8 xl:grid-cols-2">
        <Section title="Trigger" fold={{ ...fold("trigger"), summary: triggerSummary(m) }}>
          <Field
            label="Hotkey"
            help="Press Record, then the key or combination. The macro runs whenever you press it, in any app, even inside a game."
          >
            <KeyCapture
              clashFor={{ macroId: m.id, guard: m.guard?.process || null }}
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

        <Section title="When it runs" fold={{ ...fold("runs"), summary: runSummary(m) }}>
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
            label="Stop after a while"
            help="A safety limit: the run ends on its own after this long, whatever its repeat or hotkey mode. It ends normally, so the mouse still moves back if that is on."
            hint={m.stop_after_ms === null && (m.repeat.kind === "forever" || t?.mode === "hold_repeat" || t?.mode === "toggle") ? "Useful here: this macro can run until stopped." : undefined}
            checked={m.stop_after_ms !== null}
            onChange={(on) => edit({ stop_after_ms: on ? 10 * 60_000 : null })}
          >
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Stop after</span>
              <Input
                type="number"
                min={1}
                aria-label="Minutes"
                className="w-24 tabular-nums"
                value={m.stop_after_ms === null ? 10 : Math.max(1, Math.round(m.stop_after_ms / 60_000))}
                onChange={(e) => edit({ stop_after_ms: Math.max(1, Math.round(+e.target.value || 1)) * 60_000 }, "stop_after")}
              />
              <span className="text-muted-foreground">minutes</span>
            </div>
          </ToggleRow>
          <ToggleRow
            label="Move mouse back to where it started"
            help="When the macro ends, the cursor jumps back to where it was when the macro started. Also after releasing a hold-to-repeat key or pressing a toggle hotkey again, but not after Panic or Stop."
            checked={m.return_to_start}
            onChange={(return_to_start) => edit({ return_to_start })}
          />
          <FeelRows feel={m.feel} onChange={(feel, key) => edit({ feel }, key && `feel:${key}`)} />
        </Section>
      </div>

      <Section
        title="Steps"
        bare
        meta={
          m.steps.length > 0 && (
            <>
              {m.steps.length} step{m.steps.length === 1 ? "" : "s"}, takes {fmtRange(est)}
              {m.repeat.kind === "count" ? `, ${m.repeat.n} times` : ""}
              {shuffled > 1 ? `, ${shuffled} steps shuffled` : ""}
            </>
          )
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            {!beside && open.size > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label="Close every step" onClick={() => setOpen(new Set())}>
                    <ChevronsDownUp />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Close every step</TooltipContent>
              </Tooltip>
            )}
            {m.steps.length > 0 && (
              <>
                <div role="group" aria-label="Step layout" className="inline-flex rounded-md border border-input p-0.5">
                  {VIEWS.map(({ value, label, Icon }) => (
                    <Tooltip key={value}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label={label}
                          aria-pressed={view === value}
                          onClick={() => setView(value)}
                          className={cn(
                            "inline-flex size-7 items-center justify-center rounded-[5px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            view === value ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          <Icon className="size-4" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{label}</TooltipContent>
                    </Tooltip>
                  ))}
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      aria-pressed={selecting}
                      className={cn(selecting && "bg-accent")}
                      onClick={() => (selecting ? stopSelecting() : startSelecting())}
                    >
                      <SquareCheck />
                      Select
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {withKeys("Tick steps to change, duplicate or delete them together", "Ctrl+A selects all")}
                  </TooltipContent>
                </Tooltip>
              </>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant={recording ? "destructive" : "outline"} size="sm" onClick={toggleRecording}>
                  {recording ? <Square className="fill-current" /> : <CircleDot className="text-destructive" />}
                  {recording ? "Stop recording" : "Record steps"}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {recording
                  ? `Or press ${panicKey}`
                  : "Records what you do in any app (clicks, keys held and pressed, wheel turns, the way the mouse moves) as steps that replay it exactly"}
              </TooltipContent>
            </Tooltip>
          </div>
        }
      >
        {recording && (
          <div
            role="status"
            className="sticky top-0 z-20 flex animate-in items-center gap-3 rounded-md border border-destructive/50 bg-[color-mix(in_oklab,var(--destructive)_12%,var(--background))] px-3 py-2.5 text-sm shadow-sm fade-in-0 motion-reduce:animate-none"
          >
            <span className="relative flex size-2.5 shrink-0">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-destructive opacity-60" />
              <span className="relative inline-flex size-2.5 rounded-full bg-destructive" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="font-medium">Recording.</span> Click, type and scroll in any app; clicks in this
              window are left out. Press {panicKey} or Stop recording when you are done.
            </span>
          </div>
        )}
        {selecting && m.steps.length > 0 && (
          <div
            role="toolbar"
            aria-label="Selected steps"
            className="sticky top-0 z-20 flex animate-in flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-primary/40 bg-[color-mix(in_oklab,var(--primary)_10%,var(--background))] py-2 pr-2 pl-3 text-sm shadow-sm fade-in-0 motion-reduce:animate-none"
          >
            <Checkbox
              aria-label="Select every step"
              checked={allState(m.steps, selected)}
              onCheckedChange={(c) => (c === true ? selectAll() : setPicked(new Set()))}
            />
            <span className="font-medium tabular-nums" aria-live="polite">
              {n} of {m.steps.length} selected
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <ListChecks />
                  Select by kind
                  <ChevronDown className="opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                {kindCounts(m.steps).map(({ kind, count }) => {
                  const state = kindState(m.steps, selected, kind);
                  return (
                    <DropdownMenuCheckboxItem
                      key={kind}
                      checked={state === "some" ? "indeterminate" : state}
                      // Stays open, to tick several kinds.
                      onSelect={(e) => e.preventDefault()}
                      onCheckedChange={() => selectKind(kind)}
                    >
                      <KindChip kind={kind} color={colors[kind]} small />
                      <span className="flex-1">{KIND_LABELS[kind]}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
                    </DropdownMenuCheckboxItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {!beside && (
                <Button size="sm" disabled={n === 0} onClick={() => setBulkOpen(true)}>
                  <SlidersHorizontal />
                  Edit {n === 1 ? "1 step" : `${n} steps`}
                </Button>
              )}
              <Button variant="outline" size="sm" disabled={n === 0} onClick={duplicateSelection}>
                <Copy />
                Duplicate
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={n === 0}
                    onClick={deleteSelected}
                    className="hover:text-destructive"
                  >
                    <Trash2 />
                    Delete
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{withKeys("Delete the selected steps", "Delete")}</TooltipContent>
              </Tooltip>
              <Button variant="ghost" size="sm" onClick={stopSelecting}>
                Done
              </Button>
            </div>
          </div>
        )}
        {recorded && !recording && (
          <UndoLine
            text={recorded}
            onUndo={recorded.startsWith("Recorded") ? () => (setRecorded(null), step(undo)) : undefined}
          />
        )}
        {deleted && <UndoLine text={deleted} onUndo={() => step(undo)} />}
        {m.steps.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No steps yet. Add one below, or press Record steps and do it once yourself.
          </div>
        ) : beside ? (
          <div
            className="grid grid-cols-[minmax(0,20rem)_minmax(0,1fr)] items-start gap-4 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]"
            style={{ minHeight: panelHeight || undefined }}
          >
            {list}
            <aside
              ref={panelRef}
              aria-label={selecting ? "Selected steps' settings" : "Step settings"}
              data-testid="step-detail"
              className="sticky top-4 max-h-[calc(100vh-7rem)] overflow-y-auto rounded-lg border border-border bg-card p-4"
            >
              {selecting ? (
                <BulkEdit steps={m.steps} selected={selected} onChange={(steps, key) => edit({ steps }, key)} />
              ) : shown ? (
                <div key={shown.id} className="flex animate-in flex-col gap-4 fade-in-0 motion-reduce:animate-none">
                  <div className="flex min-w-0 items-center gap-2.5 border-b border-border pb-3">
                    <KindChip kind={colorKind(shown)} color={colors[colorKind(shown)]} />
                    <div className="flex min-w-0 flex-col">
                      <span className="text-xs text-muted-foreground tabular-nums">
                        Step {shownIndex + 1} of {m.steps.length}
                      </span>
                      <span className="truncate text-sm font-medium">{summarize(shown)}</span>
                    </div>
                  </div>
                  <StepFields
                    step={shown}
                    onChange={(ns) => setStep(shownIndex, ns)}
                    aim={aims[shownIndex]}
                    hasEarlierPoint={aims.slice(0, shownIndex).some((a) => a !== null)}
                    shuffled={shuffled}
                    guard={m.guard}
                  />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Choose a step on the left to see its settings.</p>
              )}
            </aside>
          </div>
        ) : (
          list
        )}

        <div role="group" aria-label="Add a step" className="flex flex-wrap items-center gap-2 pt-1">
          <span className="mr-1 text-sm text-muted-foreground">Add</span>
          {ADD.map(({ kind, label, Icon, hint }) => (
            <Button key={kind} variant="outline" size="sm" onClick={() => add(kind)} title={hint}>
              <Icon style={{ color: tone(colors[kind])?.icon }} />
              {label}
            </Button>
          ))}
        </div>
      </Section>

      <Dialog open={bulkOpen && !beside && n > 0} onOpenChange={setBulkOpen}>
        <DialogContent
          className="flex max-h-[85vh] flex-col sm:max-w-2xl"
          // Start in the first box, not on a "?" (its tooltip would cover the
          // fields).
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).querySelector<HTMLElement>("input")?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Edit {n === 1 ? "1 step" : `${n} steps`}</DialogTitle>
            <DialogDescription>
              A change here applies to every selected step at once. Mixed means they differ; leave it alone and
              each keeps its own.
            </DialogDescription>
          </DialogHeader>
          <div className="-mr-2 min-h-0 flex-1 overflow-y-auto pr-2">
            <BulkEdit steps={m.steps} selected={selected} onChange={(steps, key) => edit({ steps }, key)} />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button>Done</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
