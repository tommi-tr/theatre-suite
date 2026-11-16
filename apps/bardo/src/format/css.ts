import type { DocData } from "../model/types";
import { PAGE_SIZES, type FormatModel, type TextStyle, type FontKey, type CatStyle } from "./model";

export const FONT_STACKS: Record<FontKey, string> = {
  serif: "'Source Serif 4', 'Source Serif Pro', Georgia, 'Times New Roman', serif",
  sans: "'Geist Sans', 'Segoe UI', system-ui, sans-serif",
  mono: "'Courier Prime', 'Courier New', monospace",
};

export const FONT_LABELS: Record<FontKey, string> = { serif: "Source Serif 4", sans: "Geist", mono: "Courier Prime" };

/** CSS declarations of a text style. */
export function styleDecl(s: TextStyle, opts: { margins?: boolean } = {}): string {
  const parts = [
    `font-family:${FONT_STACKS[s.font]}`,
    `font-size:${s.size}pt`,
    `font-weight:${s.bold ? 600 : 400}`,
    `font-style:${s.italic ? "italic" : "normal"}`,
    `font-variant-caps:${s.caps === "small" ? "small-caps" : "normal"}`,
    `text-transform:${s.caps === "upper" ? "uppercase" : "none"}`,
    `letter-spacing:${(s.tracking / 1000).toFixed(3)}em`,
    `text-align:${s.align}`,
    `line-height:${s.lineHeight}`,
    `color:${s.color}`,
  ];
  if (opts.margins !== false) parts.push(`margin-top:${s.before}pt`, `margin-bottom:${s.after}pt`);
  return parts.join(";");
}

function catDecl(c: CatStyle): string {
  return [
    `font-variant-caps:${c.caps === "small" ? "small-caps" : "normal"}`,
    `text-transform:${c.caps === "upper" ? "uppercase" : "none"}`,
    c.caps === "upper" ? "letter-spacing:0.04em;font-size:0.92em" : "",
    c.italic ? "font-style:italic" : "",
    c.bold ? "font-weight:600" : "",
  ]
    .filter(Boolean)
    .join(";");
}

let measureCanvas: HTMLCanvasElement | null = null;

/** Width (mm) of the longest character name in the speaker style. */
export function longestNameMm(f: FormatModel, data: DocData): number {
  if (typeof document === "undefined") return 0;
  measureCanvas ??= document.createElement("canvas");
  const ctx = measureCanvas.getContext("2d");
  if (!ctx) return 0;
  const s = f.styles.speaker;
  const fam = FONT_STACKS[s.font];
  ctx.font = `${s.italic ? "italic " : ""}${s.bold ? 600 : 400} ${s.size}pt ${fam}`;
  let max = 0;
  for (const c of data.characters) {
    // Small capitals are about as wide as capitals at 80 %.
    const text = s.caps === "normal" ? c.name : c.name.toLocaleUpperCase();
    const w = ctx.measureText(text).width * (s.caps === "small" ? 0.82 : 1) * (1 + s.tracking / 1000);
    max = Math.max(max, w);
  }
  return max / (96 / 25.4);
}

/** Name column width and the gap after it (mm). */
export function nameColumn(f: FormatModel, data: DocData): { col: number; gap: number } {
  const gap = Number.isFinite(f.speech.gap) ? f.speech.gap : 3;
  let col = Math.max(10, f.speech.indent - gap);
  if (f.speech.autoIndent) col = Math.max(col, Math.ceil(longestNameMm(f, data) + 1));
  return { col, gap };
}

/** The stylesheet of the script: applied to the page on screen and to the print view. */
export function formatCss(f: FormatModel, data: DocData): string {
  const st = f.styles;
  const { col, gap } = nameColumn(f, data);
  const size = PAGE_SIZES[f.page.size] ?? PAGE_SIZES.A4;
  const docContentH = size.h - f.page.doc.top - f.page.doc.bottom;
  const extraL = Math.max(0, f.page.doc.inner - f.page.script.inner);
  const extraR = Math.max(0, f.page.doc.outer - f.page.script.outer);
  const pos = f.speech.namePos;
  const indent = pos === "left" ? col + gap : pos === "above" ? 0 : 0;
  const dirIndent = f.speech.dirIndent ?? (pos === "left" ? col + gap : pos === "above" ? 12 : 8);
  const rules: string[] = [];
  const r = (sel: string, decl: string) => rules.push(`${sel}{${decl}}`);

  r(".b-doc", `${styleDecl(st.speech, { margins: false })};--name-col:${col}mm;--name-gap:${gap}mm;--doc-content-h:${docContentH}mm;hyphens:${f.options.hyphenate ? "auto" : "manual"};-webkit-hyphens:${f.options.hyphenate ? "auto" : "manual"}`);
  r(".b-doc .b-par", styleDecl(st.body));
  r(".b-doc .b-section", styleDecl(st.section));
  r(".b-doc > .b-par, .b-doc > .b-section, .b-doc > .b-auto, .b-pp-docz", `margin-left:${extraL}mm;margin-right:${extraR}mm`);

  // Partitions.
  r(".b-doc .b-act", `margin-top:${st.act.before}pt;margin-bottom:${st.act.after}pt`);
  r(".b-doc .b-act-h", styleDecl(st.act, { margins: false }));
  r(".b-doc .b-tableau", `margin-top:${st.tableau.before}pt;margin-bottom:${st.tableau.after}pt`);
  r(".b-doc .b-tableau-h", styleDecl(st.tableau, { margins: false }));
  r(".b-doc .b-part-title", `${styleDecl(st.place, { margins: false })};text-align:${st.act.align}`);
  r(".b-doc .b-scene", `margin-top:${st.scene.before}pt;margin-bottom:${st.place.after}pt`);
  r(".b-doc .b-scene-h", `${styleDecl(st.scene, { margins: false })};margin-bottom:${st.scene.after}pt`);
  r(".b-doc .b-place", styleDecl(st.place, { margins: false }));

  // Speeches.
  r(".b-doc .b-speech", `position:relative;margin-top:${st.speech.before}pt;margin-bottom:${st.speech.after}pt;${pos === "left" ? `display:grid;grid-template-columns:${col}mm minmax(0,1fr);column-gap:${gap}mm` : "display:block"}`);
  r(".b-doc .b-speaker", `${styleDecl(st.speaker, { margins: pos === "above" })};${pos === "above" ? "display:block;" : pos === "inline" ? "display:inline;" : ""}overflow-wrap:anywhere`);
  if (pos === "inline") r(".b-doc .b-speaker::after", "content:'. '");
  r(".b-doc .b-speech-text", `${pos === "inline" ? "display:inline" : `padding-left:${pos === "above" ? 0 : 0}mm`}`);
  r(".b-doc .b-inl", styleDecl(st.inline, { margins: false }).replace(/font-size:[^;]+;/, "").replace(/line-height:[^;]+;?/, ""));
  r(".b-doc .b-dir", `${styleDecl(st.direction)};margin-left:${dirIndent}mm`);
  r(".b-doc .b-speech[data-num]::before", `content:attr(data-num);position:absolute;left:-14mm;top:0.15em;width:10mm;text-align:right;${styleDecl(st.number, { margins: false }).replace(/line-height:[^;]+/, "line-height:1.6")};font-variant-numeric:oldstyle-nums`);
  r(".b-doc .b-cont", `position:absolute;${pos === "left" ? `top:100%;left:calc(-1 * (var(--name-col) + var(--name-gap)));width:var(--name-col)` : "bottom:0;left:0"};${styleDecl(st.speaker, { margins: false })}`);
  r(".b-doc .b-cont-tag", "font-variant-caps:normal;text-transform:none;font-weight:400;font-style:italic;letter-spacing:0");
  if (pos !== "left") r(".b-doc .b-speech-text", `margin-left:${indent}mm`);

  // Categories as printed.
  for (const [id, c] of Object.entries(f.cats)) r(`.b-doc .b-cat[data-cat="${id}"]`, catDecl(c));
  r(".b-doc .b-char", catDecl(f.cats.personaggio ?? { caps: "small", italic: false, bold: false }));

  // Automatic blocks.
  r(".b-doc .b-auto--title", `min-height:calc(var(--doc-content-h) * 0.6);padding-top:calc(var(--doc-content-h) * 0.24);box-sizing:border-box`);
  r(".b-doc .b-t-title", styleDecl(st.title));
  r(".b-doc .b-t-subtitle", styleDecl(st.subtitle));
  r(".b-doc .b-t-credits", styleDecl(st.credits));
  r(".b-doc .b-auto-h", styleDecl(st.section));
  r(".b-doc .b-auto-g", `${styleDecl(st.list, { margins: false })};font-weight:600;margin:10pt 0 3pt`);
  r(".b-doc .b-li", `${styleDecl(st.list, { margins: false })};margin:0`);
  r(".b-doc .b-li-sub", `${styleDecl(st.list, { margins: false })};margin:0 0 2pt 6mm;font-size:${Math.max(8, st.list.size - 1.5)}pt;font-style:italic;color:#4a4e58`);
  r(".b-doc .b-li-long", `${styleDecl(st.body, { margins: false })};margin:0 0 6pt 6mm;font-size:${Math.max(8, st.body.size - 1)}pt`);
  r(".b-doc .b-li-table", `font-family:${FONT_STACKS[st.list.font]};font-size:${Math.max(7, st.list.size - 2)}pt`);
  return rules.join("\n");
}

/** Text for a header or footer field. */
export interface HeaderContext {
  title: string;
  actScene: string;
  page: number;
  pages: number;
  version: string;
  characters: string;
  lang: "it" | "en";
}

export function headerText(field: string, c: HeaderContext): string {
  switch (field) {
    case "title":
      return c.title;
    case "actScene":
      return c.actScene;
    case "page":
      return String(c.page);
    case "pageOfTotal":
      return c.lang === "it" ? `${c.page} di ${c.pages}` : `${c.page} of ${c.pages}`;
    case "version":
      return c.version;
    case "characters":
      return c.characters;
    default:
      return "";
  }
}
