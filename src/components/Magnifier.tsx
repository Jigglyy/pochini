import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

/** What magnifier.rs sends each frame: the cursor and the 11 x 11 pixels
 *  around it, row by row, as 0xRRGGBB. */
type Frame = { x: number; y: number; px: number[] };

const SIDE = 11;
const CELL = 12;
const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;

/** The magnifier window's page (index.html?view=magnifier): the pixels
 *  around the cursor, zoomed, while click-to-pick waits for its click. */
export function Magnifier() {
  const [f, setF] = useState<Frame | null>(null);

  useEffect(() => {
    const un = listen<Frame>("magnify", (e) => setF(e.payload));
    return () => {
      void un.then((stop) => stop());
    };
  }, []);

  const px = f?.px.length === SIDE * SIDE ? f.px : Array<number>(SIDE * SIDE).fill(0);
  const center = px[(SIDE * SIDE - 1) / 2];
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-1.5 overflow-hidden border border-border bg-popover p-2 text-popover-foreground select-none">
      <div className="grid border border-border" style={{ gridTemplateColumns: `repeat(${SIDE}, ${CELL}px)` }}>
        {px.map((c, i) => (
          <div
            key={i}
            style={{ width: CELL, height: CELL, background: hex(c) }}
            className={i === (SIDE * SIDE - 1) / 2 ? "relative z-10 outline-2 -outline-offset-1 outline-primary" : undefined}
          />
        ))}
      </div>
      <div className="flex items-center gap-1.5 font-mono text-xs tabular-nums">
        <span>{f ? `${f.x}, ${f.y}` : "..."}</span>
        <span className="inline-block size-3 rounded-sm border border-border" style={{ background: hex(center) }} />
        <span>{hex(center)}</span>
      </div>
      <div className="text-[11px] text-muted-foreground">Click to pick, Esc cancels</div>
    </div>
  );
}
