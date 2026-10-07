import { useEffect, useState } from "react";

// Renderer-only preferences live in localStorage as one JSON blob (the
// Kanbini pattern). index.html reads the same key before first paint so the
// window never flashes the wrong theme.

export type ThemePref = "system" | "light" | "dark";
const KEY = "pochini.settings";

type UiPrefs = { theme?: ThemePref };

function read(): UiPrefs {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") as UiPrefs;
  } catch {
    return {};
  }
}

function write(p: UiPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* private mode / storage blocked: the choice just won't persist */
  }
}

const media = () => window.matchMedia("(prefers-color-scheme: dark)");

export function applyTheme(pref: ThemePref): void {
  const dark = pref === "dark" || (pref === "system" && media().matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export function useTheme(): [ThemePref, (t: ThemePref) => void] {
  const [pref, setPref] = useState<ThemePref>(() => read().theme ?? "system");

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
    write({ ...read(), theme: t });
    setPref(t);
  };
  return [pref, set];
}
