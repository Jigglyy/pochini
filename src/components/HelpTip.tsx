import { useRef, useState, type ReactNode } from "react";
import { CircleHelp } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** The "?" after a label. Hovering shows the explanation; clicking (or Enter
 *  on the focused icon) pins it open until a click elsewhere or Escape. Keeps
 *  the screen to short labels, with the why one hover away. */
export function HelpTip({ about, children, className }: { about: string; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  // Hover opens after the same 200 ms as tooltips and closes a moment after
  // the pointer leaves, so it can travel from the icon onto the text.
  const hover = (on: boolean) => {
    if (pinned) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(on), on ? 200 : 120);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setOpen(false);
          setPinned(false);
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`About ${about}`}
          onPointerEnter={() => hover(true)}
          onPointerLeave={() => hover(false)}
          onClick={(e) => {
            // Ours, not Radix's toggle (which would close a hover-opened tip),
            // and never the surrounding label's (which would flip a switch).
            e.preventDefault();
            e.stopPropagation();
            window.clearTimeout(timer.current);
            setPinned(!pinned);
            setOpen(!pinned);
          }}
          className={cn(
            "inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
            open && "text-foreground",
            className,
          )}
        >
          <CircleHelp className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="w-80 p-3 text-xs leading-relaxed text-popover-foreground"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onPointerEnter={() => hover(true)}
        onPointerLeave={() => hover(false)}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
