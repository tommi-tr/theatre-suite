/**
 * Reading a company address book from vCard (.vcf) or CSV files (phone exports,
 * Google Contacts, Outlook, a spreadsheet). Pure functions, no guessing beyond the
 * column names: what is not understood is simply left empty.
 */
import { newPerson, nameKey, phoneKey } from "./defaults";
import type { Person } from "./types";

export interface ImportedContact {
  name: string;
  phone: string;
  email: string;
  aliases: string[];
  roles: string[];
  notes: string;
}

/* ------------------------------------------------------------------ */
/* vCard                                                                */
/* ------------------------------------------------------------------ */

function decodeQuotedPrintable(s: string): string {
  const bytes: number[] = [];
  const text = s.replace(/=\r?\n/g, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "=" && /^[0-9A-F]{2}$/i.test(text.slice(i + 1, i + 3))) {
      bytes.push(parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      for (const b of new TextEncoder().encode(c)) bytes.push(b);
    }
  }
  return new TextDecoder("utf-8").decode(new Uint8Array(bytes));
}

function unescapeValue(s: string): string {
  return s.replace(/\\([\;,nN])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));
}

/** Splits on `sep` not preceded by a backslash. */
function splitEscaped(s: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && i + 1 < s.length) {
      cur += s[i] + s[i + 1];
      i++;
    } else if (s[i] === sep) {
      out.push(cur);
      cur = "";
    } else cur += s[i];
  }
  out.push(cur);
  return out;
}

interface VLine {
  name: string;
  params: string[];
  value: string;
}

function parseVLine(line: string): VLine | null {
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const head = line.slice(0, colon).split(";");
  let name = head[0].toUpperCase();
  // "item1.TEL" (Apple) → "TEL"
  if (name.includes(".")) name = name.slice(name.lastIndexOf(".") + 1);
  const params = head.slice(1).map((p) => p.toUpperCase());
  let value = line.slice(colon + 1);
  if (params.some((p) => p === "ENCODING=QUOTED-PRINTABLE" || p === "QUOTED-PRINTABLE")) value = decodeQuotedPrintable(value);
  return { name, params, value };
}

export function parseVCard(text: string): ImportedContact[] {
  // Quoted-printable soft breaks end with "=" and continue on the next line: join them first.
  const raw = text.replace(/\r\n/g, "\n").replace(/=\n/g, "=\u0000");
  // Folded lines (RFC 6350): a line starting with a space or tab continues the previous one.
  const lines = raw.replace(/\n[ \t]/g, "").split("\n").map((l) => l.replace(/=\u0000/g, "=\n"));
  const out: ImportedContact[] = [];
  let cur: { fn: string; n: string; tel: string[]; email: string[]; nick: string[]; note: string; org: string; title: string } | null = null;
  for (const line of lines) {
    const l = line.trim();
    if (/^BEGIN:VCARD$/i.test(l)) {
      cur = { fn: "", n: "", tel: [], email: [], nick: [], note: "", org: "", title: "" };
      continue;
    }
    if (/^END:VCARD$/i.test(l)) {
      if (cur) {
        let name = cur.fn.trim();
        if (!name && cur.n) {
          const [family = "", given = "", additional = "", prefix = "", suffix = ""] = splitEscaped(cur.n, ";").map(unescapeValue);
          name = [prefix, given, additional, family, suffix].map((x) => x.trim()).filter(Boolean).join(" ");
        }
        if (!name) name = cur.org.trim();
        if (name) {
          const tel = cur.tel.map((t) => t.replace(/^tel:/i, "").trim()).filter(Boolean);
          out.push({
            name,
            phone: tel[0] ?? "",
            email: cur.email[0]?.trim() ?? "",
            aliases: [...cur.nick, ...tel.slice(1)].filter(Boolean),
            roles: cur.title ? [cur.title] : [],
            notes: cur.note.trim(),
          });
        }
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const v = parseVLine(l);
    if (!v) continue;
    switch (v.name) {
      case "FN":
        cur.fn = unescapeValue(v.value);
        break;
      case "N":
        cur.n = v.value;
        break;
      case "TEL":
        cur.tel.push(unescapeValue(v.value));
        break;
      case "EMAIL":
        cur.email.push(unescapeValue(v.value));
        break;
      case "NICKNAME":
        cur.nick.push(...splitEscaped(v.value, ",").map(unescapeValue).map((s) => s.trim()).filter(Boolean));
        break;
      case "NOTE":
        cur.note = unescapeValue(v.value);
        break;
      case "ORG":
        cur.org = splitEscaped(v.value, ";").map(unescapeValue)[0] ?? "";
        break;
      case "TITLE":
      case "ROLE":
        cur.title = unescapeValue(v.value).trim();
        break;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* CSV                                                                  */
/* ------------------------------------------------------------------ */

/** Splits CSV text into rows of cells (quotes, doubled quotes, line breaks inside quotes). */
export function parseCsvRows(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function detectSeparator(firstLine: string): string {
  const counts = [";", ",", "\t"].map((sep) => ({ sep, n: firstLine.split(sep).length - 1 }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0].n > 0 ? counts[0].sep : ",";
}

type Column = "name" | "given" | "family" | "phone" | "email" | "alias" | "role" | "notes";

/** Column names understood (Italian and English; Google Contacts and Outlook exports). */
function columnOf(header: string): Column | null {
  const h = nameKey(header);
  if (/^(nome e cognome|nome completo|full name|display name|name|nominativo|contatto|persona)$/.test(h)) return "name";
  if (/^(nome|first name|given name)$/.test(h)) return "given";
  if (/^(cognome|last name|family name|surname)$/.test(h)) return "family";
  if (/^(telefono|tel|cellulare|cell|mobile|mobile phone|phone|phone number|numero|primary phone)( \d+)?( value)?$/.test(h)) return "phone";
  if (/^(e ?mail|email address|posta elettronica)( \d+)?( value)?( address)?$/.test(h)) return "email";
  if (/^(alias|soprannome|nickname|nome breve)$/.test(h)) return "alias";
  if (/^(ruolo|ruoli|role|roles|personaggio|reparto|mansione|job title)$/.test(h)) return "role";
  if (/^(note|notes|nota)$/.test(h)) return "notes";
  return null;
}

export function parseCsv(text: string): ImportedContact[] {
  const first = text.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "";
  const rows = parseCsvRows(text, detectSeparator(first));
  if (rows.length === 0) return [];
  const cols = rows[0].map(columnOf);
  const hasHeader = cols.some((c) => c !== null);
  // Without a recognised header: first column = name, then phone, then email.
  const map: (Column | null)[] = hasHeader ? cols : ["name", "phone", "email"];
  const body = hasHeader ? rows.slice(1) : rows;
  const out: ImportedContact[] = [];
  for (const r of body) {
    const get = (c: Column) =>
      r
        .map((v, i) => (map[i] === c ? v.trim() : ""))
        .filter(Boolean);
    const given = get("given")[0] ?? "";
    const family = get("family")[0] ?? "";
    const name = get("name")[0] || [given, family].filter(Boolean).join(" ");
    if (!name) continue;
    const phones = get("phone").flatMap((p) => p.split(/\s*:::\s*/)).filter(Boolean);
    out.push({
      name,
      phone: phones[0] ?? "",
      email: (get("email")[0] ?? "").split(/\s*:::\s*/)[0] ?? "",
      aliases: [...get("alias").flatMap((a) => a.split(/\s*,\s*/)), ...phones.slice(1)].filter(Boolean),
      roles: get("role").flatMap((a) => a.split(/\s*[,/]\s*/)).filter(Boolean),
      notes: get("notes").join("\n"),
    });
  }
  return out;
}

/** vCard or CSV, by content. */
export function parseContacts(text: string): ImportedContact[] {
  return /BEGIN:VCARD/i.test(text) ? parseVCard(text) : parseCsv(text);
}

/* ------------------------------------------------------------------ */
/* Into the address book                                                */
/* ------------------------------------------------------------------ */

/** Index of the person already in the address book (same name or same phone), or -1. */
export function findExisting(people: Person[], c: ImportedContact): number {
  const n = nameKey(c.name);
  const p = phoneKey(c.phone);
  return people.findIndex((x) => (n && nameKey(x.name) === n) || (p.length >= 6 && phoneKey(x.phone) === p));
}

/** Italian role words of an export ("attore", "tecnico"…) become the preset keys. */
export function roleKey(role: string): string {
  const k = nameKey(role);
  if (/^(attore|attrice|attori|interprete|actor|actress|cast)$/.test(k)) return "actor";
  if (/^(regia|regista|aiuto regia|director|assistant director)$/.test(k)) return "director";
  if (/^(tecnico|tecnica|tecnici|maestranze|crew|technician|fonico|luci|macchinista)$/.test(k)) return "crew";
  if (/^(produzione|organizzazione|producer|production|amministrazione)$/.test(k)) return "production";
  return role.trim();
}

export function contactToPerson(c: ImportedContact): Person {
  return {
    ...newPerson(c.name.trim()),
    phone: c.phone.trim(),
    email: c.email.trim(),
    aliases: [...new Set(c.aliases.map((a) => a.trim()).filter(Boolean))],
    roles: [...new Set(c.roles.map(roleKey).filter(Boolean))],
    notes: c.notes,
  };
}
