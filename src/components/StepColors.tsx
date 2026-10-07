import {
  ArrowUpDown,
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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

/** Settings > Step colors: every kind with its palette. */
export function StepColorSettings() {
  const colors = useStepColors();
  return (
    <div className="flex flex-col gap-3">
      {KINDS.map((k) => (
        <div key={k} className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="flex w-40 items-center gap-2.5 text-sm">
            <KindChip kind={k} color={colors[k]} />
            {KIND_LABELS[k]}
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {COLOR_CHOICES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setStepColor(k, c)}
                aria-pressed={colors[k] === c}
                aria-label={`${KIND_LABELS[k]} steps: ${colorName(c)}`}
                title={colorName(c)}
                className="rounded-full p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Swatch color={c} selected={colors[k] === c} className="ring-offset-card" />
              </button>
            ))}
          </div>
          {colors[k] !== DEFAULT_COLORS[k] && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground"
                  aria-label={`Reset ${KIND_LABELS[k]} to ${colorName(DEFAULT_COLORS[k])}`}
                  onClick={() => resetStepColor(k)}
                >
                  <RotateCcw />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Reset to {colorName(DEFAULT_COLORS[k]).toLowerCase()}</TooltipContent>
            </Tooltip>
          )}
        </div>
      ))}
    </div>
  );
}
