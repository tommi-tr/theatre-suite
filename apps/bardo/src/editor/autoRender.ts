import type { DocIndex } from "../model/derive";
import { buildList, orderedCharacters, type ListBlock, type PageOf } from "../model/lists";
import type { CastConfig, CharactersConfig, DocData, ListConfig, TitleConfig } from "../model/types";
import { DEFAULT_CAST_CONFIG, DEFAULT_CHARACTERS_CONFIG, DEFAULT_TITLE_CONFIG, defaultListConfig } from "../model/defaults";

/** Words printed in the script (in the script language, not the interface language). */
export const DOC_WORDS = {
  it: { basedOn: "liberamente ispirato a", by: "di", actors: "Interpreti", version: "Versione", untitled: "Titolo dell’opera", continued: "(segue)", noCharacters: "Aggiungi i personaggi dalla scheda, oppure scrivi un nome a inizio riga e premi Tab." },
  en: { basedOn: "freely based on", by: "by", actors: "Cast", version: "Version", untitled: "Title of the play", continued: "(cont’d)", noCharacters: "Add characters from their sheet, or type a name at the start of a line and press Tab." },
};

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function titleHTML(cfg: TitleConfig, data: DocData, screen: boolean): string {
  const w = DOC_WORDS[data.lang];
  const m = data.meta;
  const parts: string[] = [];
  parts.push(m.title ? `<div class="b-t-title">${esc(m.title)}</div>` : screen ? `<div class="b-t-title b-ph">${esc(w.untitled)}</div>` : "");
  if (cfg.showSubtitle && m.subtitle) parts.push(`<div class="b-t-subtitle">${esc(m.subtitle)}</div>`);
  if (cfg.showBasedOn && m.basedOn) parts.push(`<div class="b-t-credits">${esc(w.basedOn)} ${esc(m.basedOn)}</div>`);
  if (cfg.showAuthors && m.authors) parts.push(`<div class="b-t-credits">${esc(w.by)} ${esc(m.authors)}</div>`);
  if (cfg.showTranslation && m.translation) parts.push(`<div class="b-t-credits b-t-transl">${esc(m.translation)}</div>`);
  if (cfg.showVersion) parts.push(`<div class="b-t-credits b-t-version">${esc(w.version)} ${esc(data.version)}${data.versionLabel ? ` · ${esc(data.versionLabel)}` : ""}</div>`);
  return `<div class="b-auto-title">${parts.join("")}</div>`;
}

function charactersHTML(cfg: CharactersConfig, data: DocData, index: DocIndex, screen: boolean): string {
  const list = orderedCharacters(data, index, cfg.order);
  const rows = list.map((c) => {
    const name = `<span class="b-li-name b-char">${esc(c.name)}</span>`;
    if (cfg.show === "name" || (!c.short && !c.long)) return `<p class="b-li">${name}</p>`;
    if (cfg.show === "short" || !c.long) return `<p class="b-li">${name}${c.short ? `<span class="b-li-desc">, ${esc(c.short)}</span>` : ""}</p>`;
    return `<p class="b-li b-li--long">${name}${c.short ? `<span class="b-li-desc">, ${esc(c.short)}</span>` : ""}</p><p class="b-li-long">${esc(c.long)}</p>`;
  });
  const empty = !list.length && screen ? `<p class="b-li b-ph">${esc(DOC_WORDS[data.lang].noCharacters)}</p>` : "";
  return `<div class="b-auto-list b-auto-chars">${cfg.title ? `<h2 class="b-auto-h">${esc(cfg.title)}</h2>` : ""}${rows.join("")}${empty}</div>`;
}

function castHTML(cfg: CastConfig, data: DocData): string {
  const roles = data.cast
    .filter((r) => r.role.trim())
    .map((r) => `<p class="b-li b-li--cast"><span class="b-li-role">${esc(r.role)}</span><span class="b-li-people">${esc(r.people)}</span></p>`);
  const actors = cfg.showActors
    ? data.characters.filter((c) => c.actor.trim()).map((c) => `<p class="b-li b-li--cast"><span class="b-li-role b-char">${esc(c.name)}</span><span class="b-li-people">${esc(c.actor)}</span></p>`)
    : [];
  return `<div class="b-auto-list b-auto-cast">${cfg.title ? `<h2 class="b-auto-h">${esc(cfg.title)}</h2>` : ""}${roles.join("")}${actors.length ? `<h3 class="b-auto-g">${esc(DOC_WORDS[data.lang].actors)}</h3>${actors.join("")}` : ""}</div>`;
}

export function listBlocksHTML(blocks: ListBlock[]): string {
  return blocks
    .map((b) => {
      switch (b.type) {
        case "title":
          return `<h2 class="b-auto-h">${esc(b.text)}</h2>`;
        case "group":
          return `<h3 class="b-auto-g">${esc(b.text)}</h3>`;
        case "empty":
          return `<p class="b-li b-ph">${esc(b.text)}</p>`;
        case "entry":
          return `<p class="b-li b-li--entry"><span class="b-li-name${b.character ? " b-char" : ""}">${esc(b.name)}</span>${b.refs ? `<span class="b-li-dots"></span><span class="b-li-refs">${esc(b.refs)}</span>` : ""}</p>${b.desc ? `<p class="b-li-sub">${esc(b.desc)}</p>` : ""}${b.present ? `<p class="b-li-sub b-li-present">${esc(b.present)}</p>` : ""}`;
        case "table":
          return `<table class="b-li-table"><thead><tr><th></th>${b.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${b.rows
            .map((r) => `<tr><th class="${r.character ? "b-char" : ""}">${esc(r.name)}</th>${r.cells.map((c) => `<td>${c ? "●" : ""}</td>`).join("")}</tr>`)
            .join("")}</tbody></table>`;
      }
      return "";
    })
    .join("");
}

/** HTML of an automatic block ("macro"): what Bardo writes by itself. */
export function renderAuto(kind: string, config: unknown, data: DocData, index: DocIndex, pageOf: PageOf, screen: boolean): string {
  const cfg = (config && typeof config === "object" ? config : {}) as Record<string, unknown>;
  switch (kind) {
    case "title":
      return titleHTML({ ...DEFAULT_TITLE_CONFIG, ...(cfg as Partial<TitleConfig>) }, data, screen);
    case "characters":
      return charactersHTML({ ...DEFAULT_CHARACTERS_CONFIG(data.lang), ...(cfg as Partial<CharactersConfig>) }, data, index, screen);
    case "cast":
      return castHTML({ ...DEFAULT_CAST_CONFIG(data.lang), ...(cfg as Partial<CastConfig>) }, data);
    default: {
      const list: ListConfig = { ...defaultListConfig(data.lang), ...(cfg as Partial<ListConfig>) };
      return `<div class="b-auto-list">${listBlocksHTML(buildList(list, data, index, pageOf))}</div>`;
    }
  }
}
