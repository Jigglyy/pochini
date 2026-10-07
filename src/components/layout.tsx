import type { ReactNode } from "react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/** A titled panel: small uppercase heading over a bordered, faintly filled
 *  box. The same primitive Kanbini's settings screen is built from. */
export function Section({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-3", className)}>
      <div className="flex min-h-7 items-center justify-between gap-3">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        {action}
      </div>
      <div className="flex flex-col gap-4 rounded-md border border-border bg-card/40 p-4">
        {children}
      </div>
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
    <div className={cn("grid grid-cols-[7.5rem_1fr] items-start gap-x-4 gap-y-1.5", className)}>
      <span className="pt-2 text-sm text-muted-foreground">{label}</span>
      <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
      {hint && <p className="col-start-2 text-xs leading-snug text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** A whole-row toggle: title + hint on the left, switch on the right. */
export function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-md border border-border p-3 text-sm transition-colors hover:bg-accent">
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="font-medium text-foreground">{label}</span>
        {hint && <span className="text-xs leading-snug text-muted-foreground">{hint}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} className="mt-0.5" />
    </label>
  );
}

/** One keycap. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-border bg-muted px-1.5 font-mono text-xs font-medium text-foreground shadow-[inset_0_-1px_0_var(--border)]",
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
