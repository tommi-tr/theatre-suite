import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@theatre-suite/ui/theme.css";
import "./app.css";
import "./parts.css";
import { App } from "./App";

// This is an app, not a web page: no browser menu, no accidental reloads.
window.addEventListener("keydown", (e) => {
  if (e.key === "F5" || (e.ctrlKey && e.key.toLowerCase() === "r")) e.preventDefault();
});
window.addEventListener("contextmenu", (e) => {
  const el = e.target as HTMLElement;
  if (!el.closest("input, textarea")) e.preventDefault();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
