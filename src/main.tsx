import React from "react";
import ReactDOM from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Magnifier } from "@/components/Magnifier";
import App from "./App";
import "./index.css";

// The same page also serves the magnifier window (magnifier.rs).
const view = new URLSearchParams(window.location.search).get("view");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  view === "magnifier" ? (
    <Magnifier />
  ) : (
  <React.StrictMode>
    {/* 200 ms: quick enough to feel responsive, slow enough not to flash
        when the pointer grazes past (the Kanbini tooltip timing). */}
    <TooltipProvider delayDuration={200}>
      <App />
    </TooltipProvider>
  </React.StrictMode>
  ),
);
