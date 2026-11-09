import { strToU8, zipSync } from "fflate";
import { PAGE_SIZES, STYLE_KEYS, type Align, type FormatModel, type HeaderField, type StyleKey, type TextStyle } from "../format/model";
import { nameColumn } from "../format/css";
import { HIGHLIGHT, type ExportDoc, type Run, type XBlock } from "./exportModel";
import { OFFICE_FONTS } from "./exportDocx";

/*
 * LibreOffice (.odt, OpenDocument). Like the Word file, every element of
 * the script is a named paragraph style that can be changed in Writer.
 */

const NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" office:version="1.3"';

/** CSS line height (× font size) as a percentage of the font's single line. */
export const lineHeightPercent = (lh: number) => Math.round((lh / 1.17) * 100);

const x = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Escaped text with runs of spaces and tabs written the OpenDocument way. */
function textXml(s: string): string {
  return x(s)
    .replace(/\t/g, "<text:tab/>")
    .replace(/ {2,}/g, (m) => ` <text:s text:c="${m.length - 1}"/>`)
    .replace(/^ /, '<text:s text:c="1"/>');
}

const sName = (k: StyleKey) => `Bardo_${k}`;

function align(a: Align) {
  return a === "center" ? "center" : a === "right" ? "end" : a === "justify" ? "justify" : "start";
}

function textProps(s: TextStyle): string {
  const font = OFFICE_FONTS[s.font];
  return `<style:text-properties style:font-name="${x(font)}" fo:font-family="'${x(font)}'" fo:font-size="${s.size}pt" fo:font-weight="${s.bold ? "bold" : "normal"}" fo:font-style="${s.italic ? "italic" : "normal"}" fo:font-variant="${s.caps === "small" ? "small-caps" : "normal"}" fo:text-transform="${s.caps === "upper" ? "uppercase" : "none"}" fo:color="${s.color}" fo:letter-spacing="${((s.tracking / 1000) * s.size).toFixed(2)}pt"/>`;
}

const STYLE_LABELS: Record<"it" | "en", Record<StyleKey, string>> = {
  it: { title: "Titolo", subtitle: "Sottotitolo", credits: "Crediti", section: "Titolo sezione", body: "Testo", act: "Atto", tableau: "Quadro", scene: "Scena", place: "Luogo e tempo", speaker: "Personaggio", speech: "Battuta", inline: "Didascalia in battuta", direction: "Didascalia", number: "Numero", header: "Intestazione", list: "Elenco" },
  en: { title: "Title", subtitle: "Subtitle", credits: "Credits", section: "Section title", body: "Text", act: "Act", tableau: "Tableau", scene: "Scene", place: "Place and time", speaker: "Character", speech: "Speech", inline: "Direction in a speech", direction: "Stage direction", number: "Number", header: "Header", list: "List" },
};

function namedStyles(f: FormatModel, lang: "it" | "en"): string {
  return STYLE_KEYS.map((k) => {
    const s = f.styles[k];
    const keep = ["act", "tableau", "scene", "place", "section", "title", "subtitle"].includes(k);
    return `<style:style style:name="${sName(k)}" style:display-name="Bardo · ${x(STYLE_LABELS[lang][k])}" style:family="paragraph" style:class="text"><style:paragraph-properties fo:text-align="${align(s.align)}" fo:margin-top="${s.before}pt" fo:margin-bottom="${s.after}pt" fo:line-height="${lineHeightPercent(s.lineHeight)}%"${keep ? ' fo:keep-with-next="always"' : ""}${f.options.widows ? ' fo:widows="2" fo:orphans="2"' : ""}/>${textProps(s)}</style:style>`;
  }).join("");
}

/** Collects automatic styles while the body is written. */
class AutoStyles {
  private text = new Map<string, string>();
  private para = new Map<string, string>();
  xml: string[] = [];

  span(r: Run): string | null {
    const props: string[] = [];
    if (r.bold) props.push('fo:font-weight="bold"');
    if (r.italic) props.push('fo:font-style="italic"');
    if (r.underline) props.push('style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"');
    if (r.caps === "small") props.push('fo:font-variant="small-caps"');
    if (r.caps === "upper") props.push('fo:text-transform="uppercase"');
    if (r.caps === "lower") props.push('fo:text-transform="lowercase"');
    if (r.color) props.push(`fo:color="${r.color}"`);
    if (r.size) props.push(`fo:font-size="${r.size}pt"`);
    if (r.font) props.push(`style:font-name="${x(OFFICE_FONTS[r.font])}"`);
    if (r.highlight) props.push(`fo:background-color="${r.highlight}"`);
    if (!props.length) return null;
    const key = props.join(" ");
    let name = this.text.get(key);
    if (!name) {
      name = `T${this.text.size + 1}`;
      this.text.set(key, name);
      this.xml.push(`<style:style style:name="${name}" style:family="text"><style:text-properties ${key}/></style:style>`);
    }
    return name;
  }

  /** A paragraph style derived from a named one (page break, indents, tabs, shading). */
  paragraph(parent: StyleKey, props: string, inner = ""): string {
    if (!props && !inner) return sName(parent);
    const key = `${parent}|${props}|${inner}`;
    let name = this.para.get(key);
    if (!name) {
      name = `P${this.para.size + 1}`;
      this.para.set(key, name);
      this.xml.push(`<style:style style:name="${name}" style:family="paragraph" style:parent-style-name="${sName(parent)}"><style:paragraph-properties ${props}>${inner}</style:paragraph-properties></style:style>`);
    }
    return name;
  }
}

function runsXml(runs: Run[], auto: AutoStyles): string {
  return runs
    .map((r) => {
      if (r.br) return "<text:line-break/>";
      const t = textXml(r.text);
      const st = auto.span(r);
      return st ? `<text:span text:style-name="${st}">${t}</text:span>` : t;
    })
    .join("");
}

let tableCount = 0;

function blockXml(b: XBlock, d: ExportDoc, auto: AutoStyles, col: number, gap: number, widthMm: number): string {
  const f = d.format;
  const brk = (on?: boolean) => (on ? 'fo:break-before="page" ' : "");
  if (b.kind === "table") {
    const n = b.columns.length + 1;
    const cell = (s: string) => `<table:table-cell office:value-type="string"><text:p text:style-name="${sName("list")}">${x(s)}</text:p></table:table-cell>`;
    return `<table:table table:name="Table${++tableCount}"><table:table-column table:number-columns-repeated="${n}"/><table:table-header-rows><table:table-row>${cell(b.corner)}${b.columns.map(cell).join("")}</table:table-row></table:table-header-rows>${b.rows
      .map((r) => `<table:table-row>${cell(r.name)}${r.cells.map((c) => cell(c ? "●" : "")).join("")}</table:table-row>`)
      .join("")}</table:table>`;
  }
  if (b.kind === "speech") {
    const nameSpan = `<text:span text:style-name="${auto.span({ text: "", bold: f.styles.speaker.bold, italic: f.styles.speaker.italic, caps: f.styles.speaker.caps === "normal" ? undefined : f.styles.speaker.caps, size: f.styles.speaker.size, font: f.styles.speaker.font, color: f.styles.speaker.color }) ?? ""}">${x(b.name)}</text:span>`;
    const num = b.num ? `<text:span text:style-name="${auto.span({ text: "", size: f.styles.number.size, color: f.styles.number.color })}">${b.num}</text:span><text:s text:c="2"/>` : "";
    const shade = b.highlight ? `fo:background-color="${HIGHLIGHT}" ` : "";
    const body = runsXml(b.runs, auto);
    const pos = f.speech.namePos;
    if (pos === "above") {
      return `<text:p text:style-name="${auto.paragraph("speech", `${brk(b.pageBefore)}fo:margin-bottom="0pt" fo:keep-with-next="always"`)}">${num}${nameSpan}</text:p><text:p text:style-name="${auto.paragraph("speech", shade)}">${body}</text:p>`;
    }
    if (pos === "inline") return `<text:p text:style-name="${auto.paragraph("speech", `${brk(b.pageBefore)}${shade}`)}">${num}${nameSpan}. ${body}</text:p>`;
    const ind = col + gap;
    const st = auto.paragraph("speech", `${brk(b.pageBefore)}${shade}fo:margin-left="${ind}mm" fo:text-indent="-${ind}mm"`, `<style:tab-stops><style:tab-stop style:position="0mm"/></style:tab-stops>`);
    return `<text:p text:style-name="${st}">${num}${nameSpan}<text:tab/>${body}</text:p>`;
  }
  let props = brk(b.pageBefore);
  let inner = "";
  if (b.align) props += `fo:text-align="${align(b.align)}" `;
  if (b.style === "direction") {
    const dir = f.speech.namePos === "left" ? col + gap : f.speech.namePos === "above" ? 12 : 8;
    props += `fo:margin-left="${dir}mm" `;
  } else if (b.indent) props += `fo:margin-left="${b.indent * 10}mm" `;
  if (b.tabRight) inner = `<style:tab-stops><style:tab-stop style:position="${widthMm}mm" style:type="right" style:leader-style="dotted" style:leader-text="."/></style:tab-stops>`;
  const st = auto.paragraph(b.style, props.trim(), inner);
  const bullet = b.list === "bullet" ? "• " : "";
  return `<text:p text:style-name="${st}">${bullet}${runsXml(b.runs, auto)}</text:p>`;
}

function hfXml(hf: { left: HeaderField; center: HeaderField; right: HeaderField }, d: ExportDoc, extra = ""): string {
  const w = d.data.lang === "it" ? { of: " di ", version: "Versione" } : { of: " of ", version: "Version" };
  const field = (f: HeaderField) => {
    switch (f) {
      case "title":
        return x(d.title);
      case "page":
        return '<text:page-number text:select-page="current">1</text:page-number>';
      case "pageOfTotal":
        return `<text:page-number text:select-page="current">1</text:page-number>${w.of}<text:page-count>1</text:page-count>`;
      case "version":
        return x(`${w.version} ${d.data.version}`);
      default:
        return "";
    }
  };
  return `<text:p text:style-name="BardoHF">${field(hf.left)}<text:tab/>${field(hf.center)}${extra}<text:tab/>${field(hf.right)}</text:p>`;
}

/** Builds the .odt file. */
export function exportOdt(d: ExportDoc): Uint8Array {
  const f = d.format;
  const lang = d.data.lang;
  const size = PAGE_SIZES[f.page.size] ?? PAGE_SIZES.A4;
  const m = f.page.script;
  const widthMm = size.w - m.inner - m.outer;
  const { col, gap } = nameColumn(f, d.data);
  const auto = new AutoStyles();
  tableCount = 0;
  const body = d.blocks.map((b) => blockXml(b, d, auto, col, gap, widthMm)).join("") || `<text:p text:style-name="${sName("body")}"/>`;
  const fonts = Object.values(OFFICE_FONTS)
    .map((n) => `<style:font-face style:name="${x(n)}" svg:font-family="'${x(n)}'"/>`)
    .join("");
  const wm = d.options.watermark?.trim() ? `<text:s text:c="2"/><text:span text:style-name="BardoWM">${x(d.options.watermark.trim())}</text:span><text:s text:c="2"/>` : "";
  const hfStyle = `<style:style style:name="BardoHF" style:family="paragraph" style:parent-style-name="${sName("header")}"><style:paragraph-properties><style:tab-stops><style:tab-stop style:position="${widthMm / 2}mm" style:type="center"/><style:tab-stop style:position="${widthMm}mm" style:type="right"/></style:tab-stops></style:paragraph-properties></style:style><style:style style:name="BardoWM" style:family="text"><style:text-properties fo:font-weight="bold" fo:color="#a9501f" fo:font-style="normal"/></style:style>`;
  const marginHF = (v: number) => Math.max(4, v * 0.45);
  const styles = `<?xml version="1.0" encoding="UTF-8"?><office:document-styles ${NS}><office:font-face-decls>${fonts}</office:font-face-decls><office:styles><style:default-style style:family="paragraph"><style:paragraph-properties fo:hyphenation-ladder-count="no-limit"/><style:text-properties style:font-name="${x(OFFICE_FONTS[f.styles.speech.font])}" fo:font-size="${f.styles.speech.size}pt" fo:language="${lang}" fo:country="${lang === "it" ? "IT" : "GB"}" fo:hyphenate="${f.options.hyphenate}"/></style:default-style>${namedStyles(f, lang)}${hfStyle}</office:styles><office:automatic-styles><style:page-layout style:name="PL"><style:page-layout-properties fo:page-width="${size.w}mm" fo:page-height="${size.h}mm" fo:margin-top="${marginHF(m.top)}mm" fo:margin-bottom="${marginHF(m.bottom)}mm" fo:margin-left="${m.inner}mm" fo:margin-right="${m.outer}mm"${f.page.mirror ? ' style:page-usage="mirrored"' : ""}/><style:header-style><style:header-footer-properties fo:min-height="0mm" fo:margin-bottom="${Math.max(2, m.top - marginHF(m.top) - 5)}mm"/></style:header-style><style:footer-style><style:header-footer-properties fo:min-height="0mm" fo:margin-top="${Math.max(2, m.bottom - marginHF(m.bottom) - 5)}mm"/></style:footer-style></style:page-layout></office:automatic-styles><office:master-styles><style:master-page style:name="Standard" style:page-layout-name="PL"><style:header>${hfXml(f.header, d, wm)}</style:header>${
    f.footer.onFirstPage ? "" : `<style:header-first>${wm ? hfXml({ left: "none", center: "none", right: "none" }, d, wm) : "<text:p/>"}</style:header-first>`
  }<style:footer>${hfXml(f.footer, d)}</style:footer>${f.footer.onFirstPage ? "" : "<style:footer-first><text:p/></style:footer-first>"}</style:master-page></office:master-styles></office:document-styles>`;
  const content = `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${NS}><office:font-face-decls>${fonts}</office:font-face-decls><office:automatic-styles>${auto.xml.join("")}</office:automatic-styles><office:body><office:text>${body}</office:text></office:body></office:document-content>`;
  const meta = `<?xml version="1.0" encoding="UTF-8"?><office:document-meta ${NS}><office:meta><meta:generator>Bardo</meta:generator>${d.title ? `<dc:title>${x(d.title)}</dc:title>` : ""}</office:meta></office:document-meta>`;
  const manifest = `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/></manifest:manifest>`;
  // "mimetype" must be the first entry and stored without compression.
  return zipSync({
    mimetype: [strToU8("application/vnd.oasis.opendocument.text"), { level: 0 }],
    "META-INF/manifest.xml": strToU8(manifest),
    "styles.xml": strToU8(styles),
    "content.xml": strToU8(content),
    "meta.xml": strToU8(meta),
  });
}
