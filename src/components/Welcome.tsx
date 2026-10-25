import { useRef } from "react";
import { Hand, Keyboard, MousePointerClick, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Kbd, KeyCombo } from "@/components/layout";
import { comboLabel } from "@/components/KeyCapture";
import type { Settings } from "@/types";

/** The first-run welcome: the few things worth knowing before a macro ever
 *  moves the mouse. Shown until it is closed once (Settings.welcomed). */
export function Welcome({ settings, onDone }: { settings: Settings; onDone: () => void }) {
  // "Got it" also closes the dialog, which reports it too: once is enough.
  const closed = useRef(false);
  const done = () => {
    if (closed.current) return;
    closed.current = true;
    onDone();
  };
  const points = [
    {
      Icon: MousePointerClick,
      title: "Macros move your real mouse and keyboard",
      body: "A running macro clicks and types wherever it is aimed, in any app, so try new ones with Test first.",
    },
    {
      Icon: Hand,
      title: (
        <>
          <Kbd>{settings.panic_key.label}</Kbd> stops a running macro at once
        </>
      ),
      body: settings.toggle_hotkey ? (
        <>
          The switch at the top turns every hotkey off, and <KeyCombo combo={comboLabel(settings.toggle_hotkey)} /> does
          the same from inside any app or game.
        </>
      ) : (
        "The switch at the top turns every hotkey off."
      ),
    },
    {
      Icon: ShieldCheck,
      title: "The keyboard hook keeps nothing",
      body: "Pochini watches keys only to spot your hotkeys and lets every key go: nothing is logged or sent, and it never goes online. Only while you record a macro do your clicks and keys become its steps.",
    },
    {
      Icon: Keyboard,
      title: "Apps running as administrator",
      body: "Windows lets only programs that also run as administrator send them input. For those, start Pochini as administrator too.",
    },
  ];

  return (
    <Dialog open onOpenChange={(o) => !o && done()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Welcome to Pochini</DialogTitle>
          <DialogDescription>Click and keyboard macros on a hotkey. Four things worth knowing:</DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-4">
          {points.map(({ Icon, title, body }, i) => (
            <li key={i} className="flex gap-3">
              <Icon className="mt-0.5 size-5 shrink-0 text-primary" />
              <div className="flex flex-col gap-1">
                <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">{title}</p>
                <p className="text-sm text-muted-foreground">{body}</p>
              </div>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button onClick={done}>Got it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
