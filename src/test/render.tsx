import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";

// A tiny stand-in for Testing Library: render into jsdom, find by text or
// role, click, and let promises settle. Cleaned up after every test
// (src/test/setup.ts).

const roots: Root[] = [];

export function render(ui: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  // As in main.tsx: every Tooltip needs its provider.
  const wrap = (node: ReactNode) => <TooltipProvider delayDuration={0}>{node}</TooltipProvider>;
  act(() => root.render(wrap(ui)));
  roots.push(root);
  return {
    host,
    rerender: (next: ReactNode) => act(() => root.render(wrap(next))),
    unmount: () => act(() => root.unmount()),
  };
}

export function cleanup() {
  while (roots.length) {
    const r = roots.pop()!;
    act(() => r.unmount());
  }
  document.body.innerHTML = "";
}

/** Let pending promises (mocked IPC calls) resolve and React re-render. */
export async function settle() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

/** Everything the user can read in the page, portals included. */
export const text = () => document.body.textContent ?? "";

export function button(name: string | RegExp): HTMLButtonElement {
  const all = [...document.querySelectorAll("button")];
  const found = all.find((b) => {
    const label = b.getAttribute("aria-label") ?? b.textContent ?? "";
    return typeof name === "string" ? label.trim() === name : name.test(label);
  });
  if (!found) throw new Error(`no button "${name}" in: ${all.map((b) => b.getAttribute("aria-label") ?? b.textContent).join(" | ")}`);
  return found;
}

export const hasButton = (name: string | RegExp) => {
  try {
    button(name);
    return true;
  } catch {
    return false;
  }
};

export function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}
