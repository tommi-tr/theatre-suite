import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@theatre-suite/ui/theme.css";
import "./app.css";
import { App } from "./App";
import { ProjectionWindow } from "./projection/ProjectionWindow";

// This is an app, not a web page: no browser menu, no accidental reloads.
window.addEventListener("keydown", (e) => {
  if (e.key === "F5" || (e.ctrlKey && e.key.toLowerCase() === "r")) e.preventDefault();
});
// Ctrl + wheel never zooms the whole window (in Cue, Ctrl held is the peek on the script).
window.addEventListener(
  "wheel",
  (e) => {
    if (e.ctrlKey) e.preventDefault();
  },
  { passive: false },
);
window.addEventListener("contextmenu", (e) => {
  const el = e.target as HTMLElement;
  if (!el.closest("input, textarea")) e.preventDefault();
});

// The second window (label "projection") loads the same page with ?projection=1 and shows only the output.
const isOutput = new URLSearchParams(location.search).has("projection");

createRoot(document.getElementById("root")!).render(<StrictMode>{isOutput ? <ProjectionWindow /> : <App />}</StrictMode>);
