import { useEffect, useState } from "react";
import { readPrefs, writePrefs, type ThemePref } from "./prefs";

export type { ThemePref };

const media = () => window.matchMedia("(prefers-color-scheme: dark)");

export function applyTheme(pref: ThemePref): void {
  const dark = pref === "dark" || (pref === "system" && media().matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export function useTheme(): [ThemePref, (t: ThemePref) => void] {
  const [pref, setPref] = useState<ThemePref>(() => readPrefs().theme ?? "system");

  useEffect(() => {
    applyTheme(pref);
    if (pref !== "system") return;
    // Follow the OS while on "system".
    const m = media();
    const onChange = () => applyTheme("system");
    m.addEventListener("change", onChange);
    return () => m.removeEventListener("change", onChange);
  }, [pref]);

  const set = (t: ThemePref) => {
    writePrefs({ theme: t });
    setPref(t);
  };
  return [pref, set];
}
