import type { ComponentType, ReactNode } from "react";
import {
  ArrowUpDown,
  ChevronDown,
  Crosshair,
  Keyboard,
  MousePointerClick,
  Move,
  RotateCcw,
  Timer,
  Type,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  accentValue,
  COLOR_CHOICES,
  DEFAULT_COLORS,
  KIND_LABELS,
  KINDS,
  resetStepColor,
  setStepColor,
  tone,
  useStepColors,
  type ColorKind,
  type StepColor,
} from "@/lib/colors";
import { cn } from "@/lib/utils";

export const KIND_ICONS: Record<ColorKind, LucideIcon> = {
  click: MousePointerClick,
  click_here: Crosshair,
  move: Move,
  key: Keyboard,
  text: Type,
  wait: Timer,
  scroll: ArrowUpDown,
};

export const colorName = (c: StepColor) => (c === "none" ? "No color" : c[0].toUpperCase() + c.slice(1));

/** A colour dot. "none" is a dashed ring. */
export function Swatch({ color, selected, className }: { color: StepColor; selected?: boolean; className?: string }) {
  const v = accentValue(color);
  return (
    <span
      aria-hidden
      className={cn(
        "block size-5 shrink-0 rounded-full",
        !v && "border border-dashed border-muted-foreground",
        selected && "ring-2 ring-ring ring-offset-2 ring-offset-popover",
        className,
      )}
      style={v ? { backgroundColor: v } : undefined}
    />
  );
}

/** The palette as menu items: pass the menu's own Item (ContextMenuItem,
 *  DropdownMenuItem) so keyboard navigation and close-on-pick work. */
export function SwatchGrid({
  value,
  onPick,
  Item,
}: {
  value: StepColor;
  onPick: (c: StepColor) => void;
  Item: ComponentType<{
    onSelect: () => void;
    className?: string;
    title?: string;
    "aria-label"?: string;
    children: ReactNode;
  }>;
}) {
  return (
    <div className="grid grid-cols-5 justify-items-center gap-1 p-1.5">
      {COLOR_CHOICES.map((c) => (
        <Item
          key={c}
          onSelect={() => onPick(c)}
          aria-label={colorName(c)}
          title={colorName(c)}
          className="size-7 justify-center rounded-full p-0 focus:bg-accent"
        >
          <Swatch color={c} selected={value === c} />
        </Item>
      ))}
    </div>
  );
}

/** The step-type icon in its coloured chip, as on the step cards. */
export function KindChip({ kind, color }: { kind: ColorKind; color: StepColor }) {
  const Icon = KIND_ICONS[kind];
  const t = tone(color);
  return (
    <span
      className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
      style={t ? { backgroundColor: t.chip, color: t.icon } : undefined}
    >
      <Icon className="size-4" />
    </span>
  );
}

/** Settings > Step colors: every kind with its current color; the palette
 *  opens from the color button, like the right-click menu in the editor. */
export function StepColorSettings() {
  const colors = useStepColors();
  return (
    <div className="grid grid-cols-1 gap-x-10 gap-y-2 sm:grid-cols-2">
      {KINDS.map((k) => (
        <div key={k} className="flex items-center gap-3">
          <KindChip kind={k} color={colors[k]} />
          <span className="min-w-0 flex-1 truncate text-sm">{KIND_LABELS[k]}</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="w-32 justify-start"
                aria-label={`${KIND_LABELS[k]} color: ${colorName(colors[k])}`}
              >
                <Swatch color={colors[k]} className="size-3.5" />
                {colorName(colors[k])}
                <ChevronDown className="ml-auto opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <SwatchGrid value={colors[k]} onPick={(c) => setStepColor(k, c)} Item={DropdownMenuItem} />
              {colors[k] !== DEFAULT_COLORS[k] && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => resetStepColor(k)}>
                    <RotateCcw />
                    Reset to {colorName(DEFAULT_COLORS[k]).toLowerCase()}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ))}
    </div>
  );
}
