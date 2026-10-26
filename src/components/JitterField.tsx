import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { Jitter } from "@/types";
import { Field } from "./layout";

/** A duration with optional randomness: a number, a "random extra" switch,
 *  and, when on, the most it can add. The resulting range is spelled out so
 *  "adds" is never ambiguous. */
export function JitterField({
  label,
  help,
  value,
  onChange,
}: {
  label: string;
  help?: string;
  value: Jitter;
  onChange: (j: Jitter) => void;
}) {
  const on = value.jitter > 0;
  return (
    <Field label={label} help={help} hint={on ? `A random ${value.base} to ${value.base + value.jitter} ms each time.` : undefined}>
      <div className="relative">
        <Input
          type="number"
          min={0}
          aria-label={label}
          className="w-28 pr-9 tabular-nums"
          value={value.base}
          onChange={(e) => onChange({ ...value, base: Math.max(0, +e.target.value || 0) })}
        />
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
          ms
        </span>
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
        <Switch
          checked={on}
          onCheckedChange={(c) => onChange({ ...value, jitter: c ? Math.max(25, Math.round(value.base / 2)) : 0 })}
        />
        Random extra
      </label>
      {on && (
        <div className="relative">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            up to +
          </span>
          <Input
            type="number"
            min={1}
            aria-label={`${label} random extra`}
            className="w-36 pl-14 pr-9 tabular-nums"
            value={value.jitter}
            onChange={(e) => onChange({ ...value, jitter: Math.max(1, +e.target.value || 1) })}
          />
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            ms
          </span>
        </div>
      )}
    </Field>
  );
}
