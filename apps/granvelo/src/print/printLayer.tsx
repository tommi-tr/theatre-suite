import type { ReactElement } from "react";

/**
 * Prints the sheets with the system print dialog (on Windows "Microsoft Print to PDF" makes a PDF), as Cantinella does:
 * the sheets are put in a layer that only the printer sees (print.css), and removed afterwards. No PDF library.
 */
export async function printSheets(sheets: ReactElement): Promise<void> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  document.getElementById("gv-print")?.remove();
  const el = document.createElement("div");
  el.id = "gv-print";
  el.innerHTML = renderToStaticMarkup(sheets);
  document.body.appendChild(el);
  const done = () => {
    el.remove();
    window.removeEventListener("afterprint", done);
  };
  window.addEventListener("afterprint", done);
  setTimeout(() => window.print(), 30);
}
