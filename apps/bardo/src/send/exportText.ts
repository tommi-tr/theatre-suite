import { runText, type ExportDoc, type Run } from "./exportModel";

/*
 * Plain text (.txt), UTF-8. Readable anywhere and easy to import again:
 * a character's name in capitals on its own line, then the speech;
 * stage directions between parentheses.
 */

const text = (runs: Run[]) => runs.map(runText).join("");

function wrap(s: string, width: number, indent: string): string {
  const out: string[] = [];
  for (const para of s.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (line && (line + " " + word).length > width) {
        out.push(indent + line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    out.push(indent + line);
  }
  return out.join("\n");
}

export function exportText(d: ExportDoc): Uint8Array {
  const lines: string[] = [];
  const W = 72;
  const center = (s: string) => " ".repeat(Math.max(0, Math.floor((W - s.length) / 2))) + s;
  for (const b of d.blocks) {
    if ("pageBefore" in b && b.pageBefore) lines.push("", "");
    if (b.kind === "speech") {
      lines.push(b.name.toLocaleUpperCase(), wrap(text(b.runs), W - 4, "    "), "");
      continue;
    }
    if (b.kind === "table") {
      lines.push([b.corner, ...b.columns].join("\t"));
      for (const r of b.rows) lines.push([r.name, ...r.cells.map((c) => (c ? "x" : ""))].join("\t"));
      lines.push("");
      continue;
    }
    const t = text(b.runs).replace(/\t/g, "  ");
    switch (b.style) {
      case "title":
        lines.push(center(t.toLocaleUpperCase()), "");
        break;
      case "subtitle":
      case "credits":
        lines.push(center(t));
        break;
      case "act":
      case "tableau":
        lines.push("", center(t.toLocaleUpperCase()), "");
        break;
      case "scene":
        lines.push("", center(t.toLocaleUpperCase()));
        break;
      case "place":
        lines.push(center(t), "");
        break;
      case "section":
        lines.push("", t.toLocaleUpperCase(), "");
        break;
      case "direction":
        lines.push(wrap(`(${t.replace(/^\(|\)$/g, "")})`, W - 8, "        "), "");
        break;
      case "list":
        lines.push((b.indent ? "    " : "") + t);
        break;
      default:
        lines.push(wrap(t, W, ""), "");
    }
  }
  const out = lines.join("\r\n").replace(/(\r\n){4,}/g, "\r\n\r\n\r\n").trim() + "\r\n";
  return new TextEncoder().encode(out);
}
