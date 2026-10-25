import { useId, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { Collapse } from "./Collapse";
import { HelpTip } from "./HelpTip";

/** A titled group: a heading, then one faintly filled panel whose rows are
 *  divided by hairlines. Every direct child is a row (a Field, a ToggleRow,
 *  any block), so put rows in directly rather than wrapping them. `bare`
 *  drops the panel for content that brings its own cards (the step list).
 *  `fold` lets the heading fold the panel away, leaving `summary` in its
 *  place: what the panel would say, in one line. */
export function Section({
  title,
  help,
  meta,
  action,
  fold,
  children,
  className,
  bare = false,
}: {
  title: string;
  /** Explanation behind a "?" after the title. */
  help?: ReactNode;
  /** A short fact beside the title, like a count. */
  meta?: ReactNode;
  action?: ReactNode;
  fold?: { open: boolean; onOpenChange: (open: boolean) => void; summary: ReactNode };
  children: ReactNode;
  className?: string;
  bare?: boolean;
}) {
  const panel = bare ? (
    children
  ) : (
    <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card/40 [&>*]:px-4 [&>*]:py-3.5">
      {children}
    </div>
  );
  return (
    <section className={cn("flex flex-col gap-2.5", className)}>
      <div className="flex min-h-8 flex-wrap items-end justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <h3 className="flex shrink-0 items-center gap-1 text-sm font-semibold text-foreground">
            {fold ? (
              <button
                type="button"
                aria-expanded={fold.open}
                onClick={() => fold.onOpenChange(!fold.open)}
                className="-ml-1.5 inline-flex items-center gap-1 rounded-md py-0.5 pr-1.5 pl-1 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronRight
                  aria-hidden
                  className={cn(
                    "size-4 text-muted-foreground transition-transform duration-200 ease-smooth",
                    fold.open && "rotate-90",
                  )}
                />
                {title}
              </button>
            ) : (
              title
            )}
            {help && <HelpTip about={title}>{help}</HelpTip>}
          </h3>
          {meta && <span className="ml-1.5 shrink-0 text-xs text-muted-foreground tabular-nums">{meta}</span>}
          {fold && !fold.open && (
            <span className="ml-1.5 min-w-0 animate-in truncate text-sm text-muted-foreground fade-in-0">
              {fold.summary}
            </span>
          )}
        </div>
        {action}
      </div>
      {fold ? <Collapse open={fold.open}>{panel}</Collapse> : panel}
    </section>
  );
}

/** Label column + control column, so stacked fields line up. */
export function Field({
  label,
  hint,
  help,
  children,
  className,
}: {
  label: string;
  /** A short line under the control: live values or a warning, not an
   *  explanation (that goes in `help`). */
  hint?: ReactNode;
  /** Explanation behind a "?" after the label. */
  help?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-[8rem_minmax(0,1fr)] items-start gap-x-4 gap-y-1.5", className)}>
      <span className="flex h-9 items-center gap-1 text-sm text-muted-foreground">
        {label}
        {help && <HelpTip about={label}>{help}</HelpTip>}
      </span>
      <div className="flex min-h-9 min-w-0 flex-wrap items-center gap-2">{children}</div>
      {hint && <p className="col-start-2 max-w-prose text-xs leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** A whole-row toggle: title + hint on the left, switch on the right. Meant
 *  to sit in a Section as its own row. */
export function ToggleRow({
  label,
  hint,
  help,
  checked,
  onChange,
  disabled,
  children,
}: {
  label: string;
  /** A short line under the title: why it is disabled, or a warning. */
  hint?: ReactNode;
  /** Explanation behind a "?" after the title. */
  help?: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** Extra controls shown under the row while it is on. */
  children?: ReactNode;
}) {
  // The labels point at the switch by id. Wrapping the row in one <label>
  // would make it label its first control, which is the "?" when there is
  // help: the switch would lose its name and clicking the title would open
  // the help instead of flipping the switch.
  const id = useId();
  return (
    <div>
      <div className={cn("flex items-start justify-between gap-6 text-sm", disabled && "opacity-60")}>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="flex items-center gap-1">
            <label
              htmlFor={id}
              className={cn("font-medium text-foreground", disabled ? "cursor-not-allowed" : "cursor-pointer")}
            >
              {label}
            </label>
            {help && <HelpTip about={label}>{help}</HelpTip>}
          </span>
          {hint && (
            <label htmlFor={id} className="max-w-prose text-xs leading-relaxed text-muted-foreground">
              {hint}
            </label>
          )}
        </div>
        <Switch
          id={id}
          checked={checked && !disabled}
          onCheckedChange={onChange}
          disabled={disabled}
          className="mt-0.5 shrink-0"
        />
      </div>
      <Collapse open={checked && !disabled && !!children}>
        <div className="flex flex-col gap-2 pt-3">{children}</div>
      </Collapse>
    </div>
  );
}

/** A few mutually exclusive choices in one bordered strip. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  /** Names the group for screen readers. */
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex flex-wrap rounded-md border border-input p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={cn(
            "rounded-[5px] px-2.5 py-1 text-sm transition-colors",
            value === o.value ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** One keycap. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-6 min-w-6 items-center justify-center rounded-[5px] border border-b-2 border-border bg-muted px-1.5 text-xs font-semibold leading-none text-foreground",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/** "Ctrl+Shift+F12" rendered as keycaps. */
export function KeyCombo({ combo, className }: { combo: string; className?: string }) {
  const parts = combo.split("+");
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {parts.map((p, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {i > 0 && <span className="text-xs text-muted-foreground">+</span>}
          <Kbd>{p}</Kbd>
        </span>
      ))}
    </span>
  );
}

/** Amber notice for choices with a real downside. */
export function Notice({ children, tone = "warning" }: { children: ReactNode; tone?: "warning" | "danger" }) {
  return (
    <p
      className={cn(
        "rounded-md border p-2.5 text-xs leading-snug",
        tone === "warning"
          ? "border-warning/50 bg-warning/10 text-warning"
          : "border-destructive/50 bg-destructive/10 text-destructive",
      )}
    >
      {children}
    </p>
  );
}
