import { useEffect, useState, type CSSProperties, type PointerEvent, type Ref } from "react";
import { closestCenter, DndContext, DragOverlay, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import {
  AppWindow,
  ArrowDown,
  ArrowUp,
  Copy,
  GripVertical,
  ListOrdered,
  MoreHorizontal,
  Palette,
  Pencil,
  Play,
  Plus,
  Star,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
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
import { Swatch, SwatchGrid } from "@/components/StepColors";
import { asColor, outlineStyle, tone, type StepColor } from "@/lib/colors";
import { comboLabel } from "@/components/KeyCapture";
import { DROP_ANIMATION, useDragSensors, useSortableItem, type DragHandle } from "@/components/sortable";
import {
  createMacro,
  deleteMacro,
  duplicateMacro,
  listMacros,
  reorderMacros,
  runMacro,
  setMacroColor,
  setMacroEnabled,
  setMacroFavorite,
} from "@/lib/ipc";
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
import type { MacroSummary, Settings } from "@/types";

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
  const [pendingDelete, setPendingDelete] = useState<MacroSummary | null>(null);
  const [sort, setSortState] = useState<SortMode>(loadSortMode);
  const setSort = (m: SortMode) => {
    setSortState(m);
    saveSortMode(m);
  };

  const reload = () =>
    listMacros()
      .then((r) => {
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
    setRows((rs) => rs?.map((x) => (x.id === r.id ? { ...x, enabled } : x)) ?? rs);
    try {
      await setMacroEnabled(r.id, enabled);
    } catch (e) {
      setErr(String(e));
      reload();
    }
  };

  const favorite = async (r: MacroSummary, favorite: boolean) => {
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

  /** `group`: the new order of one group (or of everything, in Custom order). */
  const reorder = async (group: MacroSummary[]) => {
    setRows((rs) => rs && applyGroupOrder(rs, group));
    try {
      await reorderMacros(group.map((r) => r.id));
    } catch (e) {
      setErr(String(e));
      reload();
    }
  };

  const actions: RowActions = {
    onOpen,
    onToggle: toggleRow,
    onFavorite: favorite,
    onColor: recolor,
    onRun: (r) => {
      onRun(r.name);
      runMacro(r.id).catch((e) => setErr(String(e)));
    },
    onDuplicate: (r) =>
      duplicateMacro(r.id)
        .then(reload)
        .catch((e) => setErr(String(e))),
    onDelete: setPendingDelete,
  };

  const off = settings ? !settings.enabled : false;
  const draggable = DRAGGABLE.has(sort);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      {off && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
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
          <Button onClick={create}>
            <Plus />
            New macro
          </Button>
        </div>
      </div>

      {err && (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 p-2.5 text-sm text-destructive">
          {err}
        </p>
      )}

      {rows &&
        rows.length > 0 &&
        groupMacros(rows, sort).map((g) => (
          <MacroGroup
            key={`${sort}-${g.key}`}
            title={g.title}
            rows={g.rows}
            draggable={draggable}
            onReorder={reorder}
            actions={actions}
          />
        ))}

      {rows && rows.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card/40 p-12 text-center">
          <p className="text-sm text-muted-foreground">
            No macros yet. Create one, add a few clicks, and bind it to a key.
          </p>
          <Button onClick={create}>
            <Plus />
            Create your first macro
          </Button>
        </div>
      )}

      {settings && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>Panic stop</span>
          <Kbd>{settings.panic_key.label}</Kbd>
          <span>stops a running macro at once.</span>
        </p>
      )}

      <AlertDialog open={pendingDelete !== null} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{pendingDelete?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Its steps and hotkey are removed. The previous version of your macro file is kept as
              macros.bak, but there is no undo here.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                if (!pendingDelete) return;
                await deleteMacro(pendingDelete.id);
                setPendingDelete(null);
                reload();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
  onReorder: (rows: MacroSummary[]) => void;
  actions: RowActions;
}) {
  const sensors = useDragSensors();
  const [dragging, setDragging] = useState<string | null>(null);

  const move = (i: number, d: number) =>
    draggable && i + d >= 0 && i + d < rows.length ? () => onReorder(arrayMove(rows, i, i + d)) : undefined;

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
        <h3 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
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
          <DragOverlay dropAnimation={DROP_ANIMATION}>
            {lifted && (
              <ul>
                <MacroRow r={lifted} actions={actions} lifted />
              </ul>
            )}
          </DragOverlay>
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
  const color = asColor(r.color);
  const t = tone(color);
  const row = (
    <li
      ref={itemRef}
      // A colored row is outlined in its color, Kanbini style. A switched-off
      // macro keeps only the colored edge (no outline, no wash), so "off"
      // still reads as off. Inline colors also beat the hover border.
      style={{ ...style, ...outlineStyle(t, r.enabled), backgroundColor: r.enabled ? t?.wash : undefined }}
      data-macro-id={lifted ? undefined : r.id}
      {...handle}
      className={cn(
        "group flex items-center gap-3 rounded-lg border border-l-[3px] border-border bg-card py-2.5 pr-3 pl-2 transition-colors hover:border-primary/40",
        !r.enabled && "bg-card/50",
        lifted && "cursor-grabbing border-primary/40 bg-card shadow-xl",
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
              onClick={() => actions.onFavorite(r, !r.favorite)}
              aria-pressed={r.favorite}
              aria-label={r.favorite ? `Remove ${r.name} from favorites` : `Add ${r.name} to favorites`}
              className={cn(
                "inline-flex size-7 shrink-0 items-center justify-center rounded-md outline-none transition-opacity hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                r.favorite
                  ? "text-warning"
                  : "text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
              )}
            >
              <Star className={cn("size-4", r.favorite && "fill-current")} />
            </button>
          </TooltipTrigger>
          <TooltipContent>{r.favorite ? "Remove from favorites" : "Add to favorites"}</TooltipContent>
        </Tooltip>
      </div>

      <button
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
          {r.conflict && (
            <span className="inline-flex items-center gap-1 text-warning">
              <TriangleAlert className="size-3.5 shrink-0" />
              Hotkey clash
            </span>
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
            <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${r.name}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
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
      <ContextMenuContent className="w-56">
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
