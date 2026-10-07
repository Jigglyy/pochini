import type { ReactNode } from "react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/** A titled group: a heading, then one faintly filled panel whose rows are
 *  divided by hairlines. Every direct child is a row (a Field, a ToggleRow,
 *  any block), so put rows in directly rather than wrapping them. `bare`
 *  drops the panel for content that brings its own cards (the step list). */
export function Section({
  title,
  action,
  children,
  className,
  bare = false,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bare?: boolean;
}) {
  return (
    <section className={cn("flex flex-col gap-2.5", className)}>
      <div className="flex min-h-8 items-end justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {action}
      </div>
      {bare ? (
        children
      ) : (
        <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card/40 [&>*]:px-4 [&>*]:py-3.5">
          {children}
        </div>
      )}
    </section>
  );
}

/** Label column + control column, so stacked fields line up. */
export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-[8rem_minmax(0,1fr)] items-start gap-x-4 gap-y-1.5", className)}>
      <span className="flex h-9 items-center text-sm text-muted-foreground">{label}</span>
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
  checked,
  onChange,
  disabled,
  children,
}: {
  label: string;
  hint?: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** Extra controls shown under the row while it is on. */
  children?: ReactNode;
}) {
  return (
    <div>
      <label
        className={cn(
          "flex items-start justify-between gap-6 text-sm",
          disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
        )}
      >
        <span className="flex min-w-0 flex-col gap-1">
          <span className="font-medium text-foreground">{label}</span>
          {hint && <span className="max-w-prose text-xs leading-relaxed text-muted-foreground">{hint}</span>}
        </span>
        <Switch
          checked={checked && !disabled}
          onCheckedChange={onChange}
          disabled={disabled}
          className="mt-0.5 shrink-0"
        />
      </label>
      {checked && !disabled && children && <div className="mt-3 flex flex-col gap-2">{children}</div>}
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
