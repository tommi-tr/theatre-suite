import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@theatre-suite/ui/theme.css";
import "./app.css";
import { App } from "./App";

// Block the browser context menu and accidental page reloads: this is an app, not a web page.
window.addEventListener("contextmenu", (e) => {
  const el = e.target as HTMLElement;
  if (!el.closest("input, textarea")) e.preventDefault();
});
window.addEventListener("keydown", (e) => {
  if (e.key === "F5" || (e.ctrlKey && e.key.toLowerCase() === "r") || (e.ctrlKey && e.key.toLowerCase() === "p")) e.preventDefault();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
