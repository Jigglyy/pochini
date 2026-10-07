import type { ReactNode, SyntheticEvent } from "react";
import { CircleHelp } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Stop a click from doing anything: Radix closes a tooltip on press. */
const inert = (e: SyntheticEvent) => {
  e.preventDefault();
  e.stopPropagation();
};

/** The "?" after a label: hover it (or Tab to it) to read the explanation.
 *  Hover only; clicking does nothing. Keeps the screen to short labels, with
 *  the why one hover away. */
export function HelpTip({ about, children, className }: { about: string; children: ReactNode; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`About ${about}`}
          onPointerDown={inert}
          onClick={inert}
          className={cn(
            "inline-flex size-5 shrink-0 cursor-help items-center justify-center rounded-full text-muted-foreground/70 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
        >
          <CircleHelp className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" align="start" className="max-w-80 py-2 text-left leading-relaxed text-pretty">
        {children}
      </TooltipContent>
    </Tooltip>
  );
}
