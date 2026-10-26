import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Bell, Curve, Feel, Hesitate, Peak, Tightness } from "@/types";
import { JitterField } from "./JitterField";
import { Field, ToggleRow } from "./layout";

// A macro's feel (model.rs Feel): bell-curve randomness, hesitation, curved
// paths. Three rows for the editor's "When it runs" section.

/** What each switch turns on with. */
const BELL: Bell = { tightness: "medium", peak: "middle" };
const HESITATE: Hesitate = { chance_pct: 10, ms: { base: 150, jitter: 350 } };
const CURVE: Curve = { bend_pct: 10, overshoot_pct: 0 };

const TIGHTNESS: { value: Tightness; label: string }[] = [
  { value: "loose", label: "Loose" },
  { value: "medium", label: "Medium" },
  { value: "tight", label: "Tight" },
];
const PEAKS: { value: Peak; label: string }[] = [
  { value: "early", label: "Early" },
  { value: "middle", label: "Middle" },
  { value: "late", label: "Late" },
];

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T)}>
      <SelectTrigger aria-label={label} className="w-32">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** A whole-number box with its unit after it ("% of clicks"). */
function Amount({
  label,
  unit,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <Input
        type="number"
        min={min}
        max={max}
        aria-label={label}
        className="w-20 tabular-nums"
        value={value}
        onChange={(e) => onChange(Math.min(max, Math.max(min, Math.round(+e.target.value || min))))}
      />
      <span className="text-muted-foreground">{unit}</span>
    </div>
  );
}

export function FeelRows({ feel, onChange }: { feel: Feel; onChange: (feel: Feel, key?: string) => void }) {
  const set = (patch: Partial<Feel>, key?: string) => onChange({ ...feel, ...patch }, key);
  // Drawn from the defaults while off, so the rows close with their controls.
  const bell = feel.bell ?? BELL;
  const h = feel.hesitate ?? HESITATE;
  const c = feel.curve ?? CURVE;
  const extra = h.ms.jitter > 0 ? `${h.ms.base} to ${h.ms.base + h.ms.jitter} ms` : `${h.ms.base} ms`;
  return (
    <>
      <ToggleRow
        label="Bell-curve randomness"
        help="Random amounts in this macro (waits, holds, settles, click spread) gather around a peak instead of spreading evenly, and never leave their range. Tightness is how strongly they gather; Peak is where (Early: mostly short, with the odd long one). Click spread uses the tightness only."
        checked={feel.bell !== null}
        onChange={(on) => set({ bell: on ? BELL : null })}
      >
        <Field label="Tightness">
          <Choice label="Tightness" value={bell.tightness} options={TIGHTNESS} onChange={(tightness) => set({ bell: { ...bell, tightness } })} />
        </Field>
        <Field label="Peak">
          <Choice label="Peak" value={bell.peak} options={PEAKS} onChange={(peak) => set({ bell: { ...bell, peak } })} />
        </Field>
      </ToggleRow>
      <ToggleRow
        label="Hesitate now and then"
        help="Some clicks wait a little longer before pressing, the way a person sometimes pauses on a button. Releases, and clicks that replay a recorded path, keep their own timing."
        hint={feel.hesitate ? `${h.chance_pct}% of clicks wait ${extra} longer.` : undefined}
        checked={feel.hesitate !== null}
        onChange={(on) => set({ hesitate: on ? HESITATE : null })}
      >
        <Field label="Chance">
          <Amount
            label="Hesitation chance"
            unit="% of clicks"
            value={h.chance_pct}
            min={1}
            max={100}
            onChange={(chance_pct) => set({ hesitate: { ...h, chance_pct } }, "hesitate_chance")}
          />
        </Field>
        <JitterField label="Extra wait" value={h.ms} onChange={(ms) => set({ hesitate: { ...h, ms } }, "hesitate_ms")} />
      </ToggleRow>
      <ToggleRow
        label="Curved mouse paths"
        help="Glides bend into a gentle arc and speed up and slow down like a hand. Only steps with a Travel time glide, and recorded paths replay as recorded. With overshoot, that share of glides goes a few pixels past the target and comes back."
        checked={feel.curve !== null}
        onChange={(on) => set({ curve: on ? CURVE : null })}
      >
        <Field label="Bend">
          <Amount
            label="Curve bend"
            unit="% of the distance"
            value={c.bend_pct}
            min={1}
            max={30}
            onChange={(bend_pct) => set({ curve: { ...c, bend_pct } }, "curve_bend")}
          />
        </Field>
        <Field label="Overshoot">
          <Amount
            label="Overshoot chance"
            unit="% of glides"
            value={c.overshoot_pct}
            min={0}
            max={100}
            onChange={(overshoot_pct) => set({ curve: { ...c, overshoot_pct } }, "curve_overshoot")}
          />
        </Field>
      </ToggleRow>
    </>
  );
}
