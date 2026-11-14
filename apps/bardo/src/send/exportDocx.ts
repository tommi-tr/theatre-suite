import {
  AlignmentType,
  Document,
  Footer,
  Header,
  LineRuleType,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TabStopType,
  TextRun,
  WidthType,
  type IParagraphStyleOptions,
  type IRunOptions,
  type ParagraphChild,
} from "docx";
import { PAGE_SIZES, STYLE_KEYS, type Align, type FontKey, type FormatModel, type HeaderField, type StyleKey, type TextStyle } from "../format/model";
import { nameColumn } from "../format/css";
import { HIGHLIGHT, type ExportDoc, type Run, type XBlock } from "./exportModel";

/*
 * Word (.docx). Every element of the script is a named paragraph style
 * ("Bardo · Battuta", "Bardo · Didascalia"…), so the file can still be
 * changed coherently in Word. Bardo's own fonts are not installed in
 * Word, so common system fonts with the same character are used.
 */

/** Fonts available on Windows and macOS with Word or LibreOffice. */
export const OFFICE_FONTS: Record<FontKey, string> = { serif: "Georgia", sans: "Arial", mono: "Courier New" };

const TWIP_PER_MM = 1440 / 25.4;
const tw = (mm: number) => Math.round(mm * TWIP_PER_MM);
const hex = (c: string) => c.replace("#", "").toUpperCase();

const STYLE_NAMES: Record<"it" | "en", Record<StyleKey, string>> = {
  it: { title: "Titolo", subtitle: "Sottotitolo", credits: "Crediti", section: "Titolo sezione", body: "Testo", act: "Atto", tableau: "Quadro", scene: "Scena", place: "Luogo e tempo", speaker: "Personaggio", speech: "Battuta", inline: "Didascalia in battuta", direction: "Didascalia", number: "Numero", header: "Intestazione", list: "Elenco" },
  en: { title: "Title", subtitle: "Subtitle", credits: "Credits", section: "Section title", body: "Text", act: "Act", tableau: "Tableau", scene: "Scene", place: "Place and time", speaker: "Character", speech: "Speech", inline: "Direction in a speech", direction: "Stage direction", number: "Number", header: "Header", list: "List" },
};

function alignment(a: Align) {
  return a === "center" ? AlignmentType.CENTER : a === "right" ? AlignmentType.RIGHT : a === "justify" ? AlignmentType.JUSTIFIED : AlignmentType.LEFT;
}

function runStyle(s: TextStyle) {
  return {
    font: OFFICE_FONTS[s.font],
    size: Math.round(s.size * 2),
    bold: s.bold,
    italics: s.italic,
    smallCaps: s.caps === "small",
    allCaps: s.caps === "upper",
    color: hex(s.color),
    characterSpacing: Math.round((s.tracking / 1000) * s.size * 20),
  };
}

function paragraphStyle(key: StyleKey, f: FormatModel, lang: "it" | "en"): IParagraphStyleOptions {
  const s = f.styles[key];
  return {
    id: `Bardo${key[0].toUpperCase()}${key.slice(1)}`,
    name: `Bardo · ${STYLE_NAMES[lang][key]}`,
    basedOn: "Normal",
    next: key === "speech" || key === "direction" ? `Bardo${key[0].toUpperCase()}${key.slice(1)}` : "BardoBody",
    quickFormat: true,
    run: runStyle(s),
    paragraph: {
      alignment: alignment(s.align),
      spacing: { before: Math.round(s.before * 20), after: Math.round(s.after * 20), line: Math.round((s.lineHeight / 1.17) * 240), lineRule: LineRuleType.AUTO },
      keepNext: key === "act" || key === "tableau" || key === "scene" || key === "place" || key === "section" || key === "title" || key === "subtitle",
    },
  };
}

const styleId = (key: StyleKey) => `Bardo${key[0].toUpperCase()}${key.slice(1)}`;

function textRun(r: Run): TextRun {
  if (r.br) return new TextRun({ break: 1 });
  const o: IRunOptions = {
    text: r.caps === "lower" ? r.text.toLocaleLowerCase() : r.text,
    ...(r.bold ? { bold: true } : {}),
    ...(r.italic ? { italics: true } : {}),
    ...(r.underline ? { underline: {} } : {}),
    ...(r.caps === "small" ? { smallCaps: true } : {}),
    ...(r.caps === "upper" ? { allCaps: true } : {}),
    ...(r.color ? { color: hex(r.color) } : {}),
    ...(r.size ? { size: Math.round(r.size * 2) } : {}),
    ...(r.font ? { font: OFFICE_FONTS[r.font] } : {}),
    ...(r.highlight ? { shading: { type: ShadingType.CLEAR, color: "auto", fill: hex(r.highlight) } } : {}),
  };
  return new TextRun(o);
}

function speechParagraphs(b: Extract<XBlock, { kind: "speech" }>, x: ExportDoc, col: number, gap: number): Paragraph[] {
  const f = x.format;
  const sp = f.styles.speaker;
  const nameRun = new TextRun({ text: b.name, ...runStyle(sp) });
  const shading = b.highlight ? { type: ShadingType.CLEAR, color: "auto", fill: hex(HIGHLIGHT) } : undefined;
  const children: ParagraphChild[] = b.runs.map(textRun);
  const num = b.num ? [new TextRun({ text: `${b.num}  `, ...runStyle(f.styles.number) })] : [];
  const pos = f.speech.namePos;
  if (pos === "above") {
    return [
      new Paragraph({ style: styleId("speech"), children: [...num, nameRun], keepNext: true, pageBreakBefore: b.pageBefore, spacing: { after: 0 } }),
      new Paragraph({ style: styleId("speech"), children, shading }),
    ];
  }
  if (pos === "inline") {
    return [new Paragraph({ style: styleId("speech"), children: [...num, nameRun, new TextRun({ text: ". " }), ...children], pageBreakBefore: b.pageBefore, shading })];
  }
  const indent = tw(col + gap);
  return [
    new Paragraph({
      style: styleId("speech"),
      children: [...num, nameRun, new TextRun({ text: "\t" }), ...children],
      indent: { left: indent, hanging: indent },
      tabStops: [{ type: TabStopType.LEFT, position: indent }],
      pageBreakBefore: b.pageBefore,
      shading,
    }),
  ];
}

function table(b: Extract<XBlock, { kind: "table" }>, f: FormatModel): Table {
  const s = f.styles.list;
  const small = { font: OFFICE_FONTS[s.font], size: Math.round(Math.max(7, s.size - 2) * 2) };
  const cell = (text: string, bold = false) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, bold, ...small })], alignment: text === "●" || text === "" ? AlignmentType.CENTER : AlignmentType.LEFT })] });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ tableHeader: true, children: [cell(b.corner, true), ...b.columns.map((c) => cell(c, true))] }),
      ...b.rows.map((r) => new TableRow({ children: [cell(r.name), ...r.cells.map((on) => cell(on ? "●" : ""))] })),
    ],
  });
}

function hfChildren(field: HeaderField, x: ExportDoc): ParagraphChild[] {
  const w = x.data.lang === "it" ? { of: " di ", version: "Versione" } : { of: " of ", version: "Version" };
  switch (field) {
    case "title":
      return [new TextRun({ text: x.title })];
    case "page":
      return [new TextRun({ children: [PageNumber.CURRENT] })];
    case "pageOfTotal":
      return [new TextRun({ children: [PageNumber.CURRENT, w.of, PageNumber.TOTAL_PAGES] })];
    case "version":
      return [new TextRun({ text: `${w.version} ${x.data.version}` })];
    default:
      // Act/scene and characters change on every page: Word cannot compute them.
      return [];
  }
}

function hfParagraph(hf: { left: HeaderField; center: HeaderField; right: HeaderField }, x: ExportDoc, widthMm: number, extra: ParagraphChild[] = []): Paragraph {
  const hs = x.format.styles.header;
  return new Paragraph({
    style: styleId("header"),
    tabStops: [
      { type: TabStopType.CENTER, position: tw(widthMm / 2) },
      { type: TabStopType.RIGHT, position: tw(widthMm) },
    ],
    children: [...hfChildren(hf.left, x), new TextRun({ text: "\t" }), ...hfChildren(hf.center, x), ...extra, new TextRun({ text: "\t" }), ...hfChildren(hf.right, x)],
    run: { font: OFFICE_FONTS[hs.font] },
  });
}

/** Builds the .docx file. */
export async function exportDocx(x: ExportDoc): Promise<Uint8Array> {
  const f = x.format;
  const lang = x.data.lang;
  const size = PAGE_SIZES[f.page.size] ?? PAGE_SIZES.A4;
  const m = f.page.script;
  const widthMm = size.w - m.inner - m.outer;
  const { col, gap } = nameColumn(f, x.data);
  const children: (Paragraph | Table)[] = [];
  for (const b of x.blocks) {
    if (b.kind === "speech") children.push(...speechParagraphs(b, x, col, gap));
    else if (b.kind === "table") children.push(table(b, f));
    else {
      const style = b.style;
      const extraIndent = b.indent ? tw(b.indent * 10) : 0;
      const isDir = style === "direction";
      const dirIndent = f.speech.namePos === "left" ? tw(col + gap) : f.speech.namePos === "above" ? tw(12) : tw(8);
      children.push(
        new Paragraph({
          style: styleId(style),
          children: b.runs.map(textRun),
          ...(b.align ? { alignment: alignment(b.align) } : {}),
          ...(isDir ? { indent: { left: dirIndent } } : extraIndent ? { indent: { left: extraIndent } } : {}),
          ...(b.tabRight ? { tabStops: [{ type: TabStopType.RIGHT, position: tw(widthMm), leader: "dot" as const }] } : {}),
          ...(b.list === "bullet" ? { bullet: { level: 0 } } : {}),
          pageBreakBefore: b.pageBefore,
        }),
      );
    }
  }
  if (!children.length) children.push(new Paragraph({ children: [] }));
  const watermark = x.options.watermark?.trim();
  const wm: ParagraphChild[] = watermark ? [new TextRun({ text: `  ${watermark}  `, bold: true, color: "A9501F" })] : [];
  const doc = new Document({
    creator: "Bardo",
    title: x.title || undefined,
    styles: {
      default: { document: { run: { font: OFFICE_FONTS[f.styles.speech.font], size: Math.round(f.styles.speech.size * 2) } } },
      paragraphStyles: STYLE_KEYS.map((k) => paragraphStyle(k, f, lang)),
    },
    sections: [
      {
        properties: {
          titlePage: !f.footer.onFirstPage,
          page: {
            size: { width: tw(size.w), height: tw(size.h) },
            margin: { top: tw(m.top), bottom: tw(m.bottom), left: tw(m.inner), right: tw(m.outer), header: tw(Math.max(6, m.top * 0.45)), footer: tw(Math.max(6, m.bottom * 0.4)) },
          },
        },
        headers: {
          default: new Header({ children: [hfParagraph(f.header, x, widthMm, wm)] }),
          first: new Header({ children: [wm.length ? hfParagraph({ left: "none", center: "none", right: "none" }, x, widthMm, wm) : new Paragraph({ children: [] })] }),
        },
        footers: {
          default: new Footer({ children: [hfParagraph(f.footer, x, widthMm)] }),
          first: new Footer({ children: [new Paragraph({ children: [] })] }),
        },
        children,
      },
    ],
  });
  const buf = await Packer.toArrayBuffer(doc);
  return new Uint8Array(buf);
}
