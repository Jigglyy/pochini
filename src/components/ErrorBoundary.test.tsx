import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

let broken = true;
function Screen() {
  if (broken) throw new Error("the screen fell over");
  return <p>the screen</p>;
}

afterEach(() => {
  broken = true;
});

it("shows what went wrong instead of a blank window, and can try again", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const host = document.createElement("div");
  document.body.append(host);
  const onHome = vi.fn();
  const root = createRoot(host);
  act(() => root.render(<ErrorBoundary onHome={onHome}><Screen /></ErrorBoundary>));
  expect(host.textContent).toContain("This screen ran into a problem");
  expect(host.textContent).toContain("the screen fell over");

  const button = (name: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(name))!;
  act(() => button("Back to macros").click());
  expect(onHome).toHaveBeenCalledOnce();

  broken = false;
  act(() => button("Try again").click());
  expect(host.textContent).toBe("the screen");
  act(() => root.unmount());
});
