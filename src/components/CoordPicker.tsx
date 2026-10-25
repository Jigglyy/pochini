import { useState } from "react";
import { Crosshair, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { listMonitors, previewPoint } from "@/lib/ipc";
import { pickPoint } from "@/lib/pick";
import { cn } from "@/lib/utils";
import type { CaptureMeta } from "@/types";

/** Coordinate capture: press Pick, then click the point anywhere on screen
 *  (the click never reaches the app there; Esc cancels). A magnifier follows
 *  the cursor meanwhile. The point is saved with the monitor it is on
 *  (`capture`, for noticing a changed display layout later). Typing a number
 *  instead clears `capture`: the point was not picked there. */
export function CoordPicker({
  x,
  y,
  onChange,
}: {
  x: number;
  y: number;
  onChange: (x: number, y: number, capture: CaptureMeta | null) => void;
}) {
  const [picking, setPicking] = useState(false);
  /** Bumped on each pick, so the fields flash to say "got it". */
  const [picked, setPicked] = useState(0);

  const pick = async () => {
    setPicking(true);
    const at = await pickPoint();
    setPicking(false);
    if (!at) return;
    const [cx, cy] = at;
    const mon = (await listMonitors().catch(() => [])).find(
      (m) => cx >= m.rect[0] && cx < m.rect[2] && cy >= m.rect[1] && cy < m.rect[3],
    );
    onChange(cx, cy, mon ? { monitor: mon.device, monitor_rect: mon.rect, dpi: mon.dpi } : null);
    setPicked((n) => n + 1);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">X</span>
        <Input
          key={`x${picked}`}
          type="number"
          className={cn("w-24 tabular-nums", picked > 0 && "animate-flash")}
          value={x}
          onChange={(e) => onChange(+e.target.value || 0, y, null)}
          aria-label="X"
        />
        <span className="ml-1 text-xs text-muted-foreground">Y</span>
        <Input
          key={`y${picked}`}
          type="number"
          className={cn("w-24 tabular-nums", picked > 0 && "animate-flash")}
          value={y}
          onChange={(e) => onChange(x, +e.target.value || 0, null)}
          aria-label="Y"
        />
      </div>
      <Button variant="outline" onClick={pick} disabled={picking}>
        <Crosshair />
        {picking ? "Click the point... (Esc cancels)" : "Pick"}
      </Button>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" onClick={() => previewPoint(x, y)} aria-label="Show me">
            <Eye />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Move the cursor here to check the point</TooltipContent>
      </Tooltip>
    </div>
  );
}
