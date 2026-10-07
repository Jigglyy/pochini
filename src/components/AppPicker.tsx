import { useEffect, useState } from "react";
import { AppWindow as AppIcon, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listApps } from "@/lib/ipc";
import type { AppWindow, Guard } from "@/types";

/** Pick the application an "App only" macro is restricted to, from the apps
 *  that currently have a window open. The choice is stored by executable name,
 *  so it keeps working after the app restarts. */
export function AppPicker({ value, onChange }: { value: Guard | null; onChange: (g: Guard) => void }) {
  const [apps, setApps] = useState<AppWindow[] | null>(null);

  const refresh = () => {
    listApps()
      .then(setApps)
      .catch(() => setApps([]));
  };
  useEffect(refresh, []);

  // Keep the saved choice selectable even when that app is not running now.
  const options: AppWindow[] = [...(apps ?? [])];
  if (value && !options.some((a) => a.process.toLowerCase() === value.process.toLowerCase())) {
    options.unshift({ process: value.process, title: value.label ? `${value.label} (not running)` : "not running" });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={value?.process ?? ""}
        onValueChange={(process) => {
          const a = options.find((o) => o.process === process);
          onChange({ process, label: a?.title.replace(/ \(not running\)$/, "") ?? "" });
        }}
      >
        <SelectTrigger className="w-96 max-w-full">
          <SelectValue placeholder={apps === null ? "Loading apps..." : "Choose an app"} />
        </SelectTrigger>
        <SelectContent>
          {options.map((a) => (
            <SelectItem key={a.process} value={a.process}>
              <AppIcon className="text-muted-foreground" />
              <span className="font-medium">{a.process}</span>
              <span className="max-w-56 truncate text-muted-foreground">{a.title}</span>
            </SelectItem>
          ))}
          {options.length === 0 && apps !== null && (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">No app windows found</div>
          )}
        </SelectContent>
      </Select>
      <Button variant="ghost" onClick={refresh} title="Look for newly opened apps">
        <RefreshCw />
        Refresh
      </Button>
    </div>
  );
}
