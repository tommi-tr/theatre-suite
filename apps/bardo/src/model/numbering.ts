import type { DocLang, Numbering } from "./types";

const IT_UNITS = ["", "uno", "due", "tre", "quattro", "cinque", "sei", "sette", "otto", "nove"];
const IT_TEENS = ["dieci", "undici", "dodici", "tredici", "quattordici", "quindici", "sedici", "diciassette", "diciotto", "diciannove"];
const IT_TENS = ["", "", "venti", "trenta", "quaranta", "cinquanta", "sessanta", "settanta", "ottanta", "novanta"];
const IT_FIRST = ["", "primo", "secondo", "terzo", "quarto", "quinto", "sesto", "settimo", "ottavo", "nono", "decimo"];

/** Italian cardinal number in words (1–99). */
export function itCardinal(n: number): string {
  if (n < 10) return IT_UNITS[n];
  if (n < 20) return IT_TEENS[n - 10];
  const t = Math.floor(n / 10);
  const u = n % 10;
  let tens = IT_TENS[t];
  if (u === 1 || u === 8) tens = tens.slice(0, -1); // ventuno, ventotto
  return tens + (u === 3 ? "tre" : IT_UNITS[u]);
}

/** Italian ordinal (masculine): primo, secondo… undicesimo, ventitreesimo. */
export function itOrdinal(n: number): string {
  if (n >= 1 && n <= 10) return IT_FIRST[n];
  if (n < 1 || n > 99) return String(n);
  const c = itCardinal(n);
  if (c.endsWith("tre")) return `${c}esimo`;
  if (c.endsWith("sei")) return `${c}esimo`;
  return `${c.slice(0, -1)}esimo`;
}

const EN_UNITS = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
const EN_TEENS = ["Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const EN_TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

/** English cardinal in words, capitalised (1–99): "One", "Twenty-One". */
export function enCardinal(n: number): string {
  if (n < 1 || n > 99) return String(n);
  if (n < 10) return EN_UNITS[n];
  if (n < 20) return EN_TEENS[n - 10];
  const t = Math.floor(n / 10);
  const u = n % 10;
  return u ? `${EN_TENS[t]}-${EN_UNITS[u]}` : EN_TENS[t];
}

export function roman(n: number): string {
  if (n < 1 || n > 3999) return String(n);
  const table: [number, string][] = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
    [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let out = "";
  let rest = n;
  for (const [v, s] of table) {
    while (rest >= v) {
      out += s;
      rest -= v;
    }
  }
  return out;
}

export type PartKind = "act" | "tableau" | "scene";

const WORDS: Record<DocLang, Record<PartKind, string>> = {
  it: { act: "Atto", tableau: "Quadro", scene: "Scena" },
  en: { act: "Act", tableau: "Tableau", scene: "Scene" },
};

/** The word for a partition in the script language ("Atto", "Scene"). */
export function partWord(kind: PartKind, lang: DocLang): string {
  return WORDS[lang][kind];
}

/** The number as written in a heading: "primo"/"prima", "I", "1", "One". */
export function partNumber(kind: PartKind, n: number, numbering: Numbering, lang: DocLang): string {
  if (numbering === "roman") return roman(n);
  if (numbering === "arabic") return String(n);
  if (lang === "en") return enCardinal(n);
  const o = itOrdinal(n);
  // "Scena" is feminine: prima, seconda, undicesima.
  return kind === "scene" && /o$/.test(o) ? `${o.slice(0, -1)}a` : o;
}

/** Full heading label: "Atto primo", "Scena terza", "Act One", "Scene II". */
export function partLabel(kind: PartKind, n: number, numbering: Numbering, lang: DocLang): string {
  return `${partWord(kind, lang)} ${partNumber(kind, n, numbering, lang)}`;
}

/** Short reference used in indexes: "I.2", "III.4". */
export function shortRef(act: number, scene: number | null): string {
  const a = act > 0 ? roman(act) : "";
  if (scene === null) return a || "—";
  return a ? `${a}.${scene}` : String(scene);
}
