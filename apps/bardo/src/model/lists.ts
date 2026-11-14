import type { DocIndex, Occurrence, SceneInfo } from "./derive";
import { charactersByEntry } from "./derive";
import { roman, shortRef } from "./numbering";
import { CHARACTER_CAT, type DocData, type ListConfig } from "./types";

/** Neutral description of an automatic list, drawn on screen and exported to Word/text. */
export type ListBlock =
  | { type: "title"; text: string }
  | { type: "group"; text: string }
  | { type: "entry"; name: string; character: boolean; desc: string; refs: string; present: string }
  | { type: "table"; corner: string; columns: string[]; rows: { name: string; character: boolean; cells: boolean[] }[] }
  | { type: "empty"; text: string };

/** Page number (1-based) of a position, when pages are known. */
export type PageOf = (pos: number) => number | null;

interface Entry {
  id: string;
  name: string;
  character: boolean;
  desc: string;
  occ: Occurrence[];
  /** Scene indexes where it appears. */
  scenes: number[];
  firstPos: number;
}

function sceneRef(s: SceneInfo): string {
  return shortRef(s.act, s.number);
}

function entriesFor(cat: string, data: DocData, index: DocIndex): Entry[] {
  if (cat === CHARACTER_CAT) {
    return data.characters.map((c) => {
      const scenes = index.scenes.map((s, k) => (s.present.includes(c.id) ? k : -1)).filter((k) => k >= 0);
      const occ: Occurrence[] = scenes.map((k) => ({ pos: index.scenes[k].pos, block: index.scenes[k].idx, scene: k, act: index.scenes[k].actIndex }));
      const first = index.speakers.get(c.id)?.firstPos ?? index.occurrences.get(c.id)?.[0]?.pos ?? Infinity;
      return { id: c.id, name: c.name, character: true, desc: c.short, occ, scenes, firstPos: first };
    });
  }
  return data.items
    .filter((i) => i.cat === cat)
    .map((i) => {
      const occ = index.occurrences.get(i.id) ?? [];
      const scenes = [...new Set(occ.map((o) => o.scene).filter((s) => s >= 0))];
      return { id: i.id, name: i.name, character: false, desc: i.description, occ, scenes, firstPos: occ[0]?.pos ?? Infinity };
    })
    // An entry that is no longer in the text disappears from the list.
    .filter((e) => e.occ.length > 0);
}

function pageLabel(n: number, lang: string): string {
  return `${lang === "it" ? "pag." : "p."} ${n}`;
}

function refsText(e: Entry, cfg: ListConfig, index: DocIndex, pageOf: PageOf, lang: string): string {
  if (cfg.where === "none" && !cfg.pages) return "";
  let occ = e.occ;
  if (e.character) {
    // For characters, one reference per scene.
  } else {
    // One reference per scene is enough to find it.
    const seen = new Set<number>();
    occ = occ.filter((o) => (seen.has(o.scene) ? false : (seen.add(o.scene), true)));
  }
  if (cfg.where === "first") occ = occ.slice(0, 1);
  else if (cfg.where === "firstLast" && occ.length > 2) occ = [occ[0], occ[occ.length - 1]];
  else if (cfg.where === "none") occ = occ.slice(0, 1);
  const parts = occ.map((o) => {
    const s = o.scene >= 0 ? index.scenes[o.scene] : null;
    const ref = cfg.where !== "none" && s ? sceneRef(s) : "";
    const page = cfg.pages ? pageOf(o.pos) : null;
    return [ref, page !== null ? pageLabel(page, lang) : ""].filter(Boolean).join(" · ");
  });
  return parts.filter(Boolean).join(cfg.where === "firstLast" ? " … " : ", ");
}

function sortEntries(list: Entry[], cfg: ListConfig, lang: string): Entry[] {
  if (cfg.order === "alpha") return [...list].sort((a, b) => a.name.localeCompare(b.name, lang, { sensitivity: "base" }));
  return [...list].sort((a, b) => a.firstPos - b.firstPos);
}

export function buildList(cfg: ListConfig, data: DocData, index: DocIndex, pageOf: PageOf): ListBlock[] {
  const it = data.lang === "it";
  const out: ListBlock[] = [];
  if (cfg.title) out.push({ type: "title", text: cfg.title });
  const nameOf = (id: string) => data.characters.find((c) => c.id === id)?.name ?? "";

  // Table of contents: acts and scenes.
  if (cfg.what.includes("scenes")) {
    let lastAct = -2;
    for (const s of index.scenes) {
      if (cfg.group !== "none" && s.actIndex !== lastAct && s.actIndex >= 0) {
        const a = index.acts[s.actIndex];
        out.push({ type: "group", text: a.title ? `${a.label} — ${a.title}` : a.label });
        lastAct = s.actIndex;
      }
      const page = cfg.pages ? pageOf(s.pos) : null;
      out.push({
        type: "entry",
        name: (cfg.group === "none" && s.act ? `${a11yAct(s.act, it)} · ` : "") + (s.title ? `${s.label} — ${s.title}` : s.label),
        character: false,
        desc: cfg.description ? s.desc || s.place : "",
        refs: page !== null ? pageLabel(page, data.lang) : "",
        present: cfg.present ? s.present.map(nameOf).filter(Boolean).join(", ") : "",
      });
    }
    if (!index.scenes.length) out.push({ type: "empty", text: it ? "Il copione non ha ancora scene." : "The script has no scenes yet." });
    return out;
  }

  const cats = cfg.what.filter((w) => data.categories.some((c) => c.id === w));
  if (!cats.length) {
    out.push({ type: "empty", text: it ? "Scegli cosa elencare." : "Choose what to list." });
    return out;
  }

  if (cfg.form === "table") {
    const cols = cfg.columns === "act" ? index.acts.map((a) => roman(a.number)) : index.scenes.map(sceneRef);
    const rows: { name: string; character: boolean; cells: boolean[] }[] = [];
    for (const cat of cats) {
      for (const e of sortEntries(entriesFor(cat, data, index), cfg, data.lang)) {
        const cells =
          cfg.columns === "act"
            ? index.acts.map((_, k) => e.scenes.some((s) => index.scenes[s].actIndex === k) || e.occ.some((o) => o.act === k))
            : index.scenes.map((_, k) => e.scenes.includes(k));
        rows.push({ name: e.name, character: e.character, cells });
      }
    }
    if (!rows.length) out.push({ type: "empty", text: it ? "Niente da mostrare: segna le parole nel testo." : "Nothing to show yet: mark words in the text." });
    else out.push({ type: "table", corner: "", columns: cols, rows });
    return out;
  }

  const multi = cats.length > 1;
  for (const cat of cats) {
    const catName = data.categories.find((c) => c.id === cat)?.name ?? cat;
    const entries = sortEntries(entriesFor(cat, data, index), cfg, data.lang);
    if (multi) out.push({ type: "group", text: catName });
    if (cfg.group === "none") {
      for (const e of entries) {
        out.push({ type: "entry", name: e.name, character: e.character, desc: cfg.description ? e.desc : "", refs: refsText(e, cfg, index, pageOf, data.lang), present: "" });
      }
    } else {
      // Grouped by act or scene: each group lists what appears in it.
      const groups = cfg.group === "act" ? index.acts.map((a, k) => ({ label: a.label, match: (e: Entry) => e.scenes.some((s) => index.scenes[s].actIndex === k) || e.occ.some((o) => o.act === k) })) : index.scenes.map((s, k) => ({ label: `${sceneRef(s)} — ${s.title || s.label}`, match: (e: Entry) => e.scenes.includes(k) }));
      for (const g of groups) {
        const inGroup = entries.filter(g.match);
        if (!inGroup.length) continue;
        out.push({ type: "group", text: g.label });
        for (const e of inGroup) out.push({ type: "entry", name: e.name, character: e.character, desc: cfg.description ? e.desc : "", refs: "", present: "" });
      }
    }
    if (!entries.length) out.push({ type: "empty", text: it ? `Nessun elemento «${catName}» nel testo.` : `No “${catName}” in the text yet.` });
  }
  return out;
}

function a11yAct(n: number, it: boolean): string {
  return `${it ? "Atto" : "Act"} ${roman(n)}`;
}

/** Characters in the order chosen for the "Personaggi" block. */
export function orderedCharacters(data: DocData, index: DocIndex, order: "manual" | "alpha" | "entry") {
  if (order === "alpha") return [...data.characters].sort((a, b) => a.name.localeCompare(b.name, data.lang, { sensitivity: "base" }));
  if (order === "entry") {
    const ids = charactersByEntry(index, data.characters.map((c) => c.id));
    return ids.map((id) => data.characters.find((c) => c.id === id)!).filter(Boolean);
  }
  return data.characters;
}
