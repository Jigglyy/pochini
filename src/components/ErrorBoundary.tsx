import { Component, type ErrorInfo, type ReactNode } from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Catches a screen that crashes while drawing, so the window does not go
 *  blank while hotkeys keep running behind it: the header, the master switch
 *  and the run pill stay usable, and the screen can be tried again. Wraps the
 *  routed screen in App.tsx, keyed by route, so moving away also recovers.
 *  Kanbini's error boundary, on Pochini's tokens. */
export class ErrorBoundary extends Component<{ children: ReactNode; onHome: () => void }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Pochini screen crashed:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" className="mx-auto flex w-full max-w-4xl flex-col gap-4">
        <h2 className="flex items-center gap-2 font-display text-xl font-semibold tracking-tight text-destructive">
          <TriangleAlert className="size-5" />
          This screen ran into a problem
        </h2>
        <p className="text-sm text-muted-foreground">
          Your macros are safe, and hotkeys and the panic key still work. Try again, or go back to the
          macro list. If it keeps happening, please report it with the details below.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => this.setState({ error: null })}>
            <RotateCcw />
            Try again
          </Button>
          <Button variant="outline" onClick={this.props.onHome}>
            Back to macros
          </Button>
        </div>
        <details className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
          <summary className="cursor-pointer text-destructive">{error.message || String(error)}</summary>
          <pre className="mt-2 overflow-auto whitespace-pre-wrap font-mono text-muted-foreground select-text">
            {error.stack}
          </pre>
        </details>
      </div>
    );
  }
}
