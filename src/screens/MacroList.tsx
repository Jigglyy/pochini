import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type Ref } from "react";
import { closestCenter, DndContext, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import {
  AppWindow,
  ArrowDown,
  ArrowUp,
  ClipboardCopy,
  ClipboardPaste,
  Copy,
  Download,
  GripVertical,
  ListOrdered,
  MoreHorizontal,
  Palette,
  Pencil,
  Play,
  Plus,
  Search,
  ShieldAlert,
  Star,
  Trash2,
  TriangleAlert,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { KeyCombo, Kbd } from "@/components/layout";
import { ImportReview, type ReviewThen } from "@/components/ImportReview";
import { Swatch, SwatchGrid } from "@/components/StepColors";
import { asColor, outlineStyle, tone, type StepColor } from "@/lib/colors";
import { refocusWithoutScroll, useFlip } from "@/lib/motion";
import { comboLabel } from "@/components/KeyCapture";
import { FloatingOverlay, useDragSensors, useSortableItem, type DragHandle } from "@/components/sortable";
import {
  copyMacroText,
  createMacro,
  deleteMacro,
  duplicateMacro,
  exportMacro,
  getMacro,
  importMacros,
  listMacros,
  markReviewed,
  pasteMacros,
  reorderMacros,
  restoreMacro,
  runMacro,
  setMacroColor,
  setMacroEnabled,
  setMacroFavorite,
} from "@/lib/ipc";
import { useShortcut, withKeys } from "@/lib/shortcuts";
import {
  applyGroupOrder,
  DRAGGABLE,
  groupMacros,
  loadSortMode,
  saveSortMode,
  SORT_LABELS,
  type SortMode,
} from "@/lib/order";
import { fmtRange } from "@/lib/steps";
import { cn } from "@/lib/utils";
import type { Macro, MacroSummary, Settings } from "@/types";

/** The search box appears once the list is long enough to need it. */
const FILTER_FROM = 5;

/** Does a row match the search? Name, hotkey and app, ignoring case. */
export const rowMatches = (r: MacroSummary, q: string) => {
  const s = q.trim().toLowerCase();
  return !s || [r.name, r.hotkey ?? "", r.app ?? ""].some((f) => f.toLowerCase().includes(s));
};

/** A one-line confirmation, optionally with Undo. */
type Note = { text: string; undo?: () => void };

export function MacroList({
  settings,
  onOpen,
  onRun,
}: {
  settings: Settings | null;
  onOpen: (id: string) => void;
  onRun: (label: string) => void;
}) {
  const [rows, setRows] = useState<MacroSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);
  /** An imported macro being switched on or run for the first time. */
  const [reviewing, setReviewing] = useState<{ row: MacroSummary; then: ReviewThen } | null>(null);
  // Rows glide when sorting, starring, menus, duplicates, imports or deletes
  // move them; new rows fade in. Drag drops are animated by dnd-kit.
  const flip = useFlip<HTMLDivElement>();
  /** A one-line confirmation after an export, import, copy or delete. */
  const [note, setNoteState] = useState<Note | null>(null);
  const setNote = (n: string | Note | null) => setNoteState(typeof n === "string" ? { text: n } : n);
  const [sort, setSortState] = useState<SortMode>(loadSortMode);
  const setSort = (m: SortMode) => {
    flip.prepare();
    setSortState(m);
    saveSortMode(m);
  };

  /** `animated`: rows glide into place, new ones fade in, removed ones out. */
  const reload = (animated = false) =>
    listMacros()
      .then((r) => {
        if (animated) flip.prepare();
        setRows(r);
        setErr(null);
      })
      .catch((e) => setErr(String(e)));

  useEffect(() => {
    reload();
  }, []);

  const create = async () => {
    try {
      const m = await createMacro("New macro");
      onOpen(m.id);
    } catch (e) {
      setErr(String(e));
    }
  };

  const toggleRow = async (r: MacroSummary, enabled: boolean) => {
    if (enabled && r.review) {
      setReviewing({ row: r, then: "enable" });
      return;
    }
    setRows((rs) => rs?.map((x) => (x.id === r.id ? { ...x, enabled } : x)) ?? rs);
    try {
      await setMacroEnabled(r.id, enabled);
    } catch (e) {
      setErr(String(e));
      reload();
    }
  };

  const favorite = async (r: MacroSummary, favorite: boolean) => {
    // In "Favorites first" the row glides to its new group.
    flip.prepare();
    setRows((rs) => rs?.map((x) => (x.id === r.id ? { ...x, favorite } : x)) ?? rs);
    try {
      await setMacroFavorite(r.id, favorite);
    } catch (e) {
      setErr(String(e));
      reload();
    }
  };

  const recolor = async (r: MacroSummary, c: StepColor) => {
    const color = c === "none" ? null : c;
    setRows((rs) => rs?.map((x) => (x.id === r.id ? { ...x, color } : x)) ?? rs);
    try {
      await setMacroColor(r.id, color);
    } catch (e) {
      setErr(String(e));
      reload();
    }
  };

  /** `group`: the new order of one group (or of everything, in Custom order).
   *  `animated` for Move up / down from a menu; a drag drop is already
   *  animated by dnd-kit. */
  const reorder = async (group: MacroSummary[], animated = false) => {
    if (animated) flip.prepare();
    setRows((rs) => rs && applyGroupOrder(rs, group));
    try {
      await reorderMacros(group.map((r) => r.id));
    } catch (e) {
      setErr(String(e));
      reload();
    }
  };

  const imported = async (names: string[]) => {
    if (names.length === 0) return; // cancelled
    await reload(true);
    setErr(null);
    setNote(
      names.length === 1
        ? `Imported "${names[0]}". Its hotkey is off: you'll see its steps before you turn it on or run it.`
        : `Imported ${names.length} macros. Their hotkeys are off: you'll see each one's steps before you turn it on or run it.`,
    );
  };
  const importFile = () =>
    importMacros()
      .then(imported)
      .catch((e) => {
        setNote(null);
        setErr(String(e));
      });
  const paste = () =>
    pasteMacros()
      .then(imported)
      .catch((e) => {
        setNote(null);
        setErr(String(e));
      });

  /** Delete at once, with Undo: the whole macro is kept until the next note. */
  const remove = async (r: MacroSummary) => {
    try {
      const full: Macro = await getMacro(r.id);
      const index = rows?.findIndex((x) => x.id === r.id) ?? -1;
      await deleteMacro(r.id);
      await reload(true);
      setErr(null);
      setNote({
        text: `Deleted "${r.name}".`,
        undo: async () => {
          try {
            await restoreMacro(full, Math.max(0, index));
            setNote(null);
            await reload(true);
          } catch (e) {
            setErr(String(e));
          }
        },
      });
    } catch (e) {
      setErr(String(e));
    }
  };

  useShortcut("Ctrl+N", () => void create());
  useShortcut("Ctrl+F", () => search.current?.focus());
  useShortcut("Ctrl+V", () => void paste());
  useShortcut("Ctrl+Z", () => note?.undo?.(), { enabled: !!note?.undo });

  const run = (r: MacroSummary) => {
    onRun(r.name);
    runMacro(r.id).catch((e) => setErr(String(e)));
  };

  /** "Looks good" in the import review: mark it, then do what was asked. */
  const reviewed = async (id: string) => {
    const job = reviewing;
    setReviewing(null);
    if (!job) return;
    try {
      await markReviewed(id);
      const row = { ...job.row, review: false };
      setRows((rs) => rs?.map((x) => (x.id === id ? row : x)) ?? rs);
      if (job.then === "run") run(row);
      else await toggleRow(row, true);
    } catch (e) {
      setErr(String(e));
    }
  };

  const actions: RowActions = {
    onOpen,
    onToggle: toggleRow,
    onFavorite: favorite,
    onColor: recolor,
    onRun: (r) => (r.review ? setReviewing({ row: r, then: "run" }) : run(r)),
    onDuplicate: (r) =>
      duplicateMacro(r.id)
        .then(() => reload(true))
        .catch((e) => setErr(String(e))),
    onDelete: (r) => void remove(r),
    onCopy: (r) =>
      copyMacroText(r.id)
        .then(() => {
          setErr(null);
          setNote(`Copied "${r.name}" as text. Paste it in a chat; anyone can paste it into Pochini with Ctrl+V.`);
        })
        .catch((e) => setErr(String(e))),
    onExport: async (r) => {
      try {
        const path = await exportMacro(r.id);
        if (path) {
          setErr(null);
          setNote(`Exported "${r.name}" to ${path}`);
        }
      } catch (e) {
        setErr(String(e));
      }
    },
  };

  const off = settings ? !settings.enabled : false;
  const filtering = query.trim() !== "";
  // Dragging a filtered list would reorder rows you cannot see.
  const draggable = DRAGGABLE.has(sort) && !filtering;
  const shown = rows?.filter((r) => rowMatches(r, query)) ?? null;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      {off && (
        <div className="flex animate-in flex-wrap items-center gap-2 rounded-md border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground fade-in-0 slide-in-from-top-1">
          <span className="font-medium text-foreground">Macros are off.</span>
          <span>Hotkeys are ignored. Turn them back on with the switch in the top right</span>
          {settings?.toggle_hotkey ? (
            <>
              <span>or press</span>
              <KeyCombo combo={comboLabel(settings.toggle_hotkey)} />
            </>
          ) : (
            <span>.</span>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-xl font-semibold tracking-tight">Your macros</h2>
        <div className="flex items-center gap-3">
          {rows && rows.length > 1 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="hidden sm:inline">Sort</span>
              <Select value={sort} onValueChange={(v) => setSort(v as SortMode)}>
                <SelectTrigger className="w-44" aria-label="Sort macros">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  {(Object.keys(SORT_LABELS) as SortMode[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {SORT_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <Button variant="outline" onClick={importFile}>
            <Upload />
            Import
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon" aria-label="Paste a copied macro" onClick={paste}>
                <ClipboardPaste />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{withKeys("Paste a macro copied as text", "Ctrl+V")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button onClick={create}>
                <Plus />
                New macro
              </Button>
            </TooltipTrigger>
            <TooltipContent>{withKeys("New macro", "Ctrl+N")}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {rows && rows.length >= FILTER_FROM && (
        <div className="relative -mt-2">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={search}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQuery("")}
            placeholder="Find a macro by name, hotkey or app (Ctrl+F)"
            aria-label="Find a macro"
            className="pl-9"
          />
        </div>
      )}

      {/* Sticky, so a confirmation or error shows even while scrolled down
          the list (Export... from a row near the bottom). Opaque tints, as
          rows scroll underneath. */}
      {(note || err) && (
        <div className="sticky top-0 z-20 flex flex-col gap-2">
          {note && (
            <div
              role="status"
              className="flex animate-in items-start gap-3 rounded-md border border-success/40 bg-[color-mix(in_oklab,var(--success)_12%,var(--background))] px-3 py-2.5 text-sm shadow-sm fade-in-0 slide-in-from-top-1 motion-reduce:animate-none"
            >
              <span className="min-w-0 flex-1 break-words">{note.text}</span>
              {note.undo && (
                <Button variant="outline" size="sm" className="-my-1" onClick={note.undo}>
                  <Undo2 />
                  Undo
                </Button>
              )}
              <button
                type="button"
                onClick={() => setNote(null)}
                aria-label="Dismiss"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
          )}
          {err && (
            <p className="animate-in rounded-md border border-destructive/50 bg-[color-mix(in_oklab,var(--destructive)_12%,var(--background))] p-2.5 text-sm text-destructive shadow-sm fade-in-0">
              {err}
            </p>
          )}
        </div>
      )}

      {shown && shown.length > 0 && (
        <div ref={flip.ref} className="flex flex-col gap-6">
          {groupMacros(shown, sort).map((g) => (
            <MacroGroup
              key={`${sort}-${g.key}`}
              title={g.title}
              rows={g.rows}
              draggable={draggable}
              onReorder={reorder}
              actions={actions}
            />
          ))}
        </div>
      )}

      {filtering && shown?.length === 0 && (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No macros match "{query.trim()}".
        </p>
      )}

      {rows && rows.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card/40 p-12 text-center">
          <p className="text-sm text-muted-foreground">
            No macros yet. Create one, add a few clicks, and bind it to a key.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={create}>
              <Plus />
              Create your first macro
            </Button>
            <Button variant="outline" onClick={importFile}>
              <Upload />
              Import a macro
            </Button>
          </div>
        </div>
      )}

      {settings && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>Panic stop</span>
          <Kbd>{settings.panic_key.label}</Kbd>
          <span>stops a running macro at once.</span>
        </p>
      )}

      <ImportReview
        id={reviewing?.row.id ?? null}
        then={reviewing?.then ?? "enable"}
        onConfirm={reviewed}
        onEdit={(id) => {
          setReviewing(null);
          onOpen(id);
        }}
        onClose={() => setReviewing(null)}
      />

    </div>
  );
}

type RowActions = {
  onOpen: (id: string) => void;
  onToggle: (r: MacroSummary, enabled: boolean) => void;
  onFavorite: (r: MacroSummary, favorite: boolean) => void;
  onColor: (r: MacroSummary, color: StepColor) => void;
  onRun: (r: MacroSummary) => void;
  onDuplicate: (r: MacroSummary) => void;
  onDelete: (r: MacroSummary) => void;
  onCopy: (r: MacroSummary) => void;
  onExport: (r: MacroSummary) => void;
};

/** One list of rows: the whole list, or the Favorites / Other macros group in
 *  "Favorites first". Each group has its own drag context, so a drag can never
 *  move a macro across groups (starring is what moves it). */
function MacroGroup({
  title,
  rows,
  draggable,
  onReorder,
  actions,
}: {
  title?: string;
  rows: MacroSummary[];
  draggable: boolean;
  onReorder: (rows: MacroSummary[], animated?: boolean) => void;
  actions: RowActions;
}) {
  const sensors = useDragSensors();
  const [dragging, setDragging] = useState<string | null>(null);

  const move = (i: number, d: number) =>
    draggable && i + d >= 0 && i + d < rows.length ? () => onReorder(arrayMove(rows, i, i + d), true) : undefined;

  const drop = ({ active, over }: DragEndEvent) => {
    setDragging(null);
    if (!over || active.id === over.id) return;
    const from = rows.findIndex((r) => r.id === active.id);
    const to = rows.findIndex((r) => r.id === over.id);
    if (from >= 0 && to >= 0) onReorder(arrayMove(rows, from, to));
  };

  const list = (
    <ul className="flex flex-col gap-2">
      {rows.map((r, i) => {
        const props = { r, actions, onMoveUp: move(i, -1), onMoveDown: move(i, 1) };
        return draggable ? <SortableMacroRow key={r.id} {...props} /> : <MacroRow key={r.id} {...props} />;
      })}
    </ul>
  );
  const lifted = rows.find((r) => r.id === dragging);

  return (
    <section className="flex flex-col gap-2">
      {title && (
        <h3 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          {title === "Favorites" && <Star className="size-3.5 fill-current text-warning" />}
          {title}
        </h3>
      )}
      {draggable ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={(e) => setDragging(String(e.active.id))}
          onDragEnd={drop}
          onDragCancel={() => setDragging(null)}
        >
          <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
            {list}
          </SortableContext>
          <FloatingOverlay>
            {lifted && (
              <ul>
                <MacroRow r={lifted} actions={actions} lifted />
              </ul>
            )}
          </FloatingOverlay>
        </DndContext>
      ) : (
        list
      )}
    </section>
  );
}

type RowProps = {
  r: MacroSummary;
  actions: RowActions;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
};

function SortableMacroRow(props: RowProps) {
  const s = useSortableItem(props.r.id);
  return <MacroRow {...props} itemRef={s.ref} style={s.style} handle={s.handle} />;
}

/** Keeps a press on a control (star, switch, Run, menu) from starting a drag. */
const noDrag = { onPointerDown: (e: PointerEvent) => e.stopPropagation() };

function MacroRow({
  r,
  actions,
  onMoveUp,
  onMoveDown,
  itemRef,
  style,
  handle,
  lifted = false,
}: RowProps & {
  itemRef?: Ref<HTMLLIElement>;
  style?: CSSProperties;
  /** Set when the row can be dragged: the whole row is the handle. */
  handle?: DragHandle;
  /** The copy that follows the pointer during a drag. */
  lifted?: boolean;
}) {
  const grip = handle !== undefined || lifted;
  const [pop, setPop] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const nameButton = useRef<HTMLButtonElement>(null);
  const color = asColor(r.color);
  const t = tone(color);
  const row = (
    <li
      ref={itemRef}
      // A colored row is outlined in its color with a faint wash, Kanbini
      // style, whether or not its hotkey is on (the switch and the dimmed
      // name already say "off"). Inline colors also beat the hover border.
      style={{
        ...style,
        ...outlineStyle(t),
        backgroundColor: t?.wash,
      }}
      data-flip={lifted ? undefined : r.id}
      data-macro-id={lifted ? undefined : r.id}
      {...handle}
      className={cn(
        "group flex items-center gap-3 rounded-lg border border-l-[3px] border-border bg-card py-2.5 pr-3 pl-2 transition-[border-color,background-color,box-shadow] duration-200 ease-smooth hover:border-primary/40",
        !r.enabled && "bg-card/50",
        lifted && "cursor-grabbing border-primary/40 bg-card",
      )}
    >
      {/* Same width with or without the grip, so names line up in every sort. */}
      <div className="flex w-12 shrink-0 items-center justify-end gap-0.5">
        {grip && (
          <GripVertical
            aria-hidden
            className="size-4 shrink-0 cursor-grab text-muted-foreground/40 transition-colors group-hover:text-muted-foreground"
          />
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              {...noDrag}
              onClick={() => {
                if (!r.favorite) setPop(true);
                actions.onFavorite(r, !r.favorite);
              }}
              aria-pressed={r.favorite}
              aria-label={r.favorite ? `Remove ${r.name} from favorites` : `Add ${r.name} to favorites`}
              className={cn(
                "inline-flex size-7 shrink-0 items-center justify-center rounded-md outline-none transition-opacity hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                r.favorite
                  ? "text-warning"
                  : "text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
              )}
            >
              <Star
                className={cn("size-4", r.favorite && "fill-current", pop && "animate-pop")}
                onAnimationEnd={() => setPop(false)}
              />
            </button>
          </TooltipTrigger>
          <TooltipContent>{r.favorite ? "Remove from favorites" : "Add to favorites"}</TooltipContent>
        </Tooltip>
      </div>

      <button
        ref={nameButton}
        type="button"
        onClick={() => actions.onOpen(r.id)}
        className="flex min-w-0 flex-1 flex-col items-start gap-1 text-left outline-none focus-visible:underline"
      >
        <span className={cn("max-w-full truncate font-medium", !r.enabled && "text-muted-foreground")}>
          {r.name}
        </span>
        {/* What the macro is, under its name; the right side stays columns. */}
        <span className="flex max-w-full flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span className="tabular-nums">
            {r.step_count} step{r.step_count === 1 ? "" : "s"}, {fmtRange(r.duration_ms)}
          </span>
          {r.app && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <AppWindow className="size-3.5 shrink-0" />
              <span className="truncate">Only in {r.app}</span>
            </span>
          )}
          {r.queue && (
            <span className="inline-flex items-center gap-1">
              <ListOrdered className="size-3.5 shrink-0" />
              Queues presses
            </span>
          )}
          {r.review && (
            <span className="inline-flex items-center gap-1 text-warning">
              <ShieldAlert className="size-3.5 shrink-0" />
              Imported, check it before use
            </span>
          )}
          {r.conflict && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center gap-1 text-warning">
                  <TriangleAlert className="size-3.5 shrink-0" />
                  Hotkey clash
                </span>
              </TooltipTrigger>
              <TooltipContent>{r.conflict}</TooltipContent>
            </Tooltip>
          )}
        </span>
      </button>

      <div className={cn("hidden min-w-28 justify-end sm:flex", !r.enabled && "opacity-50")}>
        {r.hotkey ? (
          <KeyCombo combo={r.hotkey} />
        ) : (
          <span className="text-xs text-muted-foreground">No hotkey</span>
        )}
      </div>

      <div className="flex items-center gap-4" {...noDrag}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <Switch
                checked={r.enabled}
                onCheckedChange={(c) => actions.onToggle(r, c)}
                aria-label={`${r.name} hotkey ${r.enabled ? "on" : "off"}`}
              />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {r.enabled ? "Hotkey on. Click to ignore it." : "Hotkey off. Click to listen for it."}
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="sm" onClick={() => actions.onRun(r)}>
              <Play />
              Run
            </Button>
          </TooltipTrigger>
          <TooltipContent>Starts after a 3 second countdown</TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button ref={menuButton} variant="ghost" size="icon-sm" aria-label={`More actions for ${r.name}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onCloseAutoFocus={refocusWithoutScroll(menuButton)}>
            <DropdownMenuItem onSelect={() => actions.onOpen(r.id)}>
              <Pencil />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => actions.onFavorite(r, !r.favorite)}>
              <Star />
              {r.favorite ? "Remove from favorites" : "Add to favorites"}
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Palette />
                Color
                <Swatch color={color} className="ml-auto size-3" />
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-48">
                <SwatchGrid value={color} onPick={(c) => actions.onColor(r, c)} Item={DropdownMenuItem} />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onSelect={() => actions.onDuplicate(r)}>
              <Copy />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => actions.onCopy(r)}>
              <ClipboardCopy />
              Copy as text
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => actions.onExport(r)}>
              <Download />
              Export...
            </DropdownMenuItem>
            {(onMoveUp || onMoveDown) && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={!onMoveUp} onSelect={onMoveUp}>
                  <ArrowUp />
                  Move up
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!onMoveDown} onSelect={onMoveDown}>
                  <ArrowDown />
                  Move down
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => actions.onDelete(r)}>
              <Trash2 />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
  if (lifted) return row;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent className="w-56" onCloseAutoFocus={refocusWithoutScroll(nameButton)}>
        <ContextMenuLabel className="text-xs font-medium text-muted-foreground">Color</ContextMenuLabel>
        <SwatchGrid value={color} onPick={(c) => actions.onColor(r, c)} Item={ContextMenuItem} />
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => actions.onOpen(r.id)}>
          <Pencil />
          Edit
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => actions.onFavorite(r, !r.favorite)}>
          <Star />
          {r.favorite ? "Remove from favorites" : "Add to favorites"}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => actions.onDuplicate(r)}>
          <Copy />
          Duplicate
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => actions.onCopy(r)}>
          <ClipboardCopy />
          Copy as text
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => actions.onExport(r)}>
          <Download />
          Export...
        </ContextMenuItem>
        {(onMoveUp || onMoveDown) && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem disabled={!onMoveUp} onSelect={onMoveUp}>
              <ArrowUp />
              Move up
            </ContextMenuItem>
            <ContextMenuItem disabled={!onMoveDown} onSelect={onMoveDown}>
              <ArrowDown />
              Move down
            </ContextMenuItem>
          </>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={() => actions.onDelete(r)}>
          <Trash2 />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
