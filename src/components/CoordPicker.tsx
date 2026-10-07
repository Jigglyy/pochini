import { useEffect, useRef, useState } from "react";
import { Crosshair, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cursorPos, previewPoint } from "@/lib/ipc";

const PICK_SECONDS = 3;

/** Coordinate capture: arm it, move the real cursor over the target anywhere
 *  on screen (including over a fullscreen game an overlay could not cover),
 *  and the position is read when the countdown ends. */
export function CoordPicker({
  x,
  y,
  onChange,
}: {
  x: number;
  y: number;
  onChange: (x: number, y: number) => void;
}) {
  const [left, setLeft] = useState<number | null>(null);
  const [live, setLive] = useState<[number, number] | null>(null);
  const tick = useRef<number | null>(null);

  useEffect(() => {
    if (left === null) return;
    const poll = window.setInterval(() => {
      cursorPos().then(setLive).catch(() => {});
    }, 60);
    tick.current = window.setTimeout(async () => {
      if (left > 1) {
        setLeft(left - 1);
        return;
      }
      window.clearInterval(poll);
      try {
        const [cx, cy] = await cursorPos();
        onChange(cx, cy);
      } catch {
        /* leave the value alone */
      }
      setLeft(null);
      setLive(null);
    }, 1000);
    return () => {
      window.clearInterval(poll);
      if (tick.current) window.clearTimeout(tick.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">X</span>
        <Input
          type="number"
          className="w-24 tabular-nums"
          value={x}
          onChange={(e) => onChange(+e.target.value || 0, y)}
          aria-label="X"
        />
        <span className="ml-1 text-xs text-muted-foreground">Y</span>
        <Input
          type="number"
          className="w-24 tabular-nums"
          value={y}
          onChange={(e) => onChange(x, +e.target.value || 0)}
          aria-label="Y"
        />
      </div>
      <Button variant="outline" onClick={() => setLeft(PICK_SECONDS)} disabled={left !== null}>
        <Crosshair />
        {left === null ? "Pick" : `Picking in ${left}...`}
      </Button>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" onClick={() => previewPoint(x, y)} aria-label="Show me">
            <Eye />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Move the cursor here to check the point</TooltipContent>
      </Tooltip>
      {live && (
        <span className="text-xs tabular-nums text-muted-foreground">
          cursor at ({live[0]}, {live[1]})
        </span>
      )}
    </div>
  );
}
