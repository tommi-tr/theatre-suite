import { uid } from "@theatre-suite/core";
import type { BardoLink, Character, Person, PlanItem, Rehearsals, Scene } from "./types";

/* ---------------- Reading (format 1) ---------------- */

const str = (v: unknown, max = 200): string => (typeof v === "string" ? v.slice(0, max) : "");
const ids = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 100))] : []);
const int = (v: unknown, min: number, max: number, def: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : def;

export const MAX_WEIGHT = 20;

/** Scenes, characters and plan of a rehearsals block. References to missing things are dropped. */
export function normalizeScenes(r: Record<string, unknown>, out: Rehearsals, people: Person[]): void {
  const personIds = new Set(people.map((p) => p.id));
  const seen = new Set<string>();
  const fresh = (id: string) => {
    const v = id && !seen.has(id) ? id : uid();
    seen.add(v);
    return v;
  };
  for (const raw of Array.isArray(r.characters) ? r.characters : []) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as Record<string, unknown>;
    const name = str(c.name).trim();
    if (!name) continue;
    out.characters.push({ id: fresh(str(c.id, 100)), name, actorIds: ids(c.actorIds).filter((i) => personIds.has(i)), bardoId: str(c.bardoId, 100) });
  }
  const charIds = new Set(out.characters.map((c) => c.id));
  for (const raw of Array.isArray(r.scenes) ? r.scenes : []) {
    if (!raw || typeof raw !== "object") continue;
    const s = raw as Record<string, unknown>;
    const name = str(s.name).trim();
    if (!name) continue;
    out.scenes.push({
      id: fresh(str(s.id, 100)),
      name,
      act: str(s.act, 100).trim(),
      characterIds: ids(s.characterIds).filter((i) => charIds.has(i)),
      optional: ids(s.optional).filter((i) => personIds.has(i)),
      weight: int(s.weight, 1, MAX_WEIGHT, 2),
      minutes: int(s.minutes, 5, 600, 30),
      bardoId: str(s.bardoId, 100),
    });
  }
  const sceneIds = new Set(out.scenes.map((s) => s.id));
  const dateIds = new Set(out.dates.map((d) => d.id));
  const pairs = new Set<string>();
  for (const raw of Array.isArray(r.plan) ? r.plan : []) {
    if (!raw || typeof raw !== "object") continue;
    const p = raw as Record<string, unknown>;
    const dateId = str(p.dateId, 100);
    const sceneId = str(p.sceneId, 100);
    if (!dateIds.has(dateId) || !sceneIds.has(sceneId) || pairs.has(`${dateId}|${sceneId}`)) continue;
    pairs.add(`${dateId}|${sceneId}`);
    out.plan.push({ id: fresh(str(p.id, 100)), dateId, sceneId, locked: p.locked === true });
  }
  out.allowMaybe = r.allowMaybe === true;
  const b = r.bardo as Record<string, unknown> | null | undefined;
  out.bardo = b && typeof b === "object" && str(b.path, 2000) ? { path: str(b.path, 2000), title: str(b.title), hash: str(b.hash, 40), readAt: str(b.readAt, 40) } : null;
}

/* ---------------- New things ---------------- */

export function newScene(partial: Partial<Scene> = {}): Scene {
  return { id: uid(), name: "", act: "", characterIds: [], optional: [], weight: 2, minutes: 30, bardoId: "", ...partial };
}

export function newCharacter(partial: Partial<Character> = {}): Character {
  return { id: uid(), name: "", actorIds: [], bardoId: "", ...partial };
}

/** Removes a character everywhere (scenes keep the others). */
export function deleteCharacter(r: Rehearsals, id: string): Rehearsals {
  return { ...r, characters: r.characters.filter((c) => c.id !== id), scenes: r.scenes.map((s) => (s.characterIds.includes(id) ? { ...s, characterIds: s.characterIds.filter((x) => x !== id) } : s)) };
}

/** Removes a scene and its places in the plan. */
export function deleteScene(r: Rehearsals, id: string): Rehearsals {
  return { ...r, scenes: r.scenes.filter((s) => s.id !== id), plan: r.plan.filter((p) => p.sceneId !== id) };
}

/** Removes a person from casts and optional lists (when the person is deleted from the contacts). */
export function forgetPerson(r: Rehearsals, personId: string): Rehearsals {
  return {
    ...r,
    characters: r.characters.map((c) => (c.actorIds.includes(personId) ? { ...c, actorIds: c.actorIds.filter((x) => x !== personId) } : c)),
    scenes: r.scenes.map((s) => (s.optional.includes(personId) ? { ...s, optional: s.optional.filter((x) => x !== personId) } : s)),
  };
}

/* ---------------- Who is needed ---------------- */

export interface SceneNeed {
  /** Person ids required (the first actor of every character), without duplicates. */
  required: string[];
  /** Person ids welcome but not required. */
  optional: string[];
  /** Characters with nobody assigned. */
  uncast: Character[];
}

export function sceneNeed(scene: Scene, characters: Character[]): SceneNeed {
  const byId = new Map(characters.map((c) => [c.id, c]));
  const required: string[] = [];
  const uncast: Character[] = [];
  for (const cid of scene.characterIds) {
    const c = byId.get(cid);
    if (!c) continue;
    const actor = c.actorIds[0];
    if (!actor) uncast.push(c);
    else if (!required.includes(actor) && !scene.optional.includes(actor)) required.push(actor);
  }
  const optional = scene.optional.filter((p) => !required.includes(p));
  // An actor of a character may be marked optional: keep it in the optional list.
  for (const cid of scene.characterIds) {
    const a = byId.get(cid)?.actorIds[0];
    if (a && scene.optional.includes(a) && !optional.includes(a)) optional.push(a);
  }
  return { required, optional, uncast };
}

/** Names that can be told apart: first names, the full name when two people share a first name. */
export function shortNames(people: Person[]): Map<string, string> {
  const first = (n: string) => n.trim().split(/\s+/)[0] ?? n;
  const count = new Map<string, number>();
  for (const p of people) count.set(first(p.name).toLowerCase(), (count.get(first(p.name).toLowerCase()) ?? 0) + 1);
  return new Map(people.map((p) => [p.id, (count.get(first(p.name).toLowerCase()) ?? 0) > 1 ? p.name.trim() : first(p.name)]));
}

/* ---------------- Bardo (read only) ---------------- */

/** A short fingerprint of a text (FNV-1a, 32 bit, hex): enough to notice that a file has changed. */
export function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0") + text.length.toString(16);
}

export interface BardoScene {
  bardoId: string;
  name: string;
  act: string;
  characterIds: string[];
  words: number;
}

export interface BardoScript {
  title: string;
  characters: Array<{ bardoId: string; name: string; actor: string }>;
  scenes: BardoScene[];
}

export class BardoReadError extends Error {
  constructor(public problem: "not-bardo" | "newer" | "no-scenes") {
    super(problem);
  }
}

const ROMAN: Array<[number, string]> = [
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
];
function roman(n: number): string {
  let out = "";
  for (const [v, s] of ROMAN) while (n >= v) {
    out += s;
    n -= v;
  }
  return out;
}

function textOf(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { text?: unknown; content?: unknown };
  if (typeof n.text === "string") return n.text;
  return Array.isArray(n.content) ? n.content.map(textOf).join(" ") : "";
}

/**
 * Reads acts, scenes and characters from a `.bardo` file (format 1). Only reads: the script is
 * never changed. A scene's cast is whoever speaks in it plus the silent characters on stage.
 */
export function readBardo(text: string): BardoScript {
  let f: unknown;
  try {
    f = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    throw new BardoReadError("not-bardo");
  }
  if (!f || typeof f !== "object" || (f as { format?: unknown }).format !== "bardo") throw new BardoReadError("not-bardo");
  const file = f as { formatVersion?: unknown; data?: unknown; content?: unknown };
  if (typeof file.formatVersion === "number" && file.formatVersion > 1) throw new BardoReadError("newer");
  const data = (file.data && typeof file.data === "object" ? file.data : {}) as Record<string, unknown>;
  const meta = (data.meta && typeof data.meta === "object" ? data.meta : {}) as Record<string, unknown>;
  const characters: BardoScript["characters"] = [];
  for (const c of Array.isArray(data.characters) ? data.characters : []) {
    if (!c || typeof c !== "object") continue;
    const x = c as Record<string, unknown>;
    if (typeof x.id === "string" && x.id && typeof x.name === "string" && x.name.trim()) characters.push({ bardoId: x.id, name: x.name.trim(), actor: str(x.actor).trim() });
  }
  const known = new Set(characters.map((c) => c.bardoId));
  const scenes: BardoScene[] = [];
  let actN = 0;
  let sceneN = 0;
  let act = "";
  let cur: BardoScene | null = null;
  const add = (id: unknown) => {
    if (cur && typeof id === "string" && known.has(id) && !cur.characterIds.includes(id)) cur.characterIds.push(id);
  };
  for (const node of Array.isArray(file.content) ? file.content : []) {
    if (!node || typeof node !== "object") continue;
    const n = node as { type?: unknown; attrs?: Record<string, unknown> };
    const attrs = n.attrs ?? {};
    if (n.type === "act") {
      actN += 1;
      const title = str(attrs.title).trim();
      act = `Atto ${roman(actN)}${title ? ` · ${title}` : ""}`;
      cur = null;
    } else if (n.type === "scene") {
      sceneN += 1;
      const title = str(attrs.title).trim();
      cur = { bardoId: str(attrs.id, 100) || `scene-${sceneN}`, name: title ? `Scena ${sceneN} · ${title}` : `Scena ${sceneN}`, act, characterIds: [], words: 0 };
      scenes.push(cur);
      for (const id of Array.isArray(attrs.silent) ? attrs.silent : []) add(id);
    } else if (cur) {
      if (n.type === "speech") add(attrs.speaker);
      const t = textOf(node).trim();
      if (t) cur.words += t.split(/\s+/).length;
    }
  }
  if (scenes.length === 0 && characters.length === 0) throw new BardoReadError("no-scenes");
  return { title: str(meta.title).trim(), characters, scenes };
}

/** Rehearsal time from the length of the text: about three times the reading time, at least 15 minutes. */
export function rehearsalMinutes(words: number): number {
  const reading = words / 140;
  return Math.max(15, Math.min(180, Math.round((reading * 3) / 5) * 5));
}

export interface BardoMerge {
  rehearsals: Rehearsals;
  added: { scenes: number; characters: number };
  updated: number;
  /** Scenes that are no longer in the script: kept, now as if entered by hand. */
  detached: number;
}

/**
 * Brings the scenes and characters of a script into the rehearsals. Linked by Bardo id, not by
 * name: renaming a scene in Bardo keeps weights, times and the cast. Scenes added by hand stay.
 */
export function mergeBardo(r: Rehearsals, script: BardoScript, link: BardoLink, people: Person[]): BardoMerge {
  const characters = [...r.characters];
  const charByBardo = new Map(characters.filter((c) => c.bardoId).map((c) => [c.bardoId, c]));
  let addedC = 0;
  const findPerson = (name: string): string | null => {
    const n = name.trim().toLowerCase();
    if (!n) return null;
    const hits = people.filter((p) => p.name.trim().toLowerCase() === n || p.aliases.some((a) => a.toLowerCase() === n));
    return hits.length === 1 ? hits[0].id : null;
  };
  for (const bc of script.characters) {
    const have = charByBardo.get(bc.bardoId);
    if (have) {
      const i = characters.indexOf(have);
      const actor = have.actorIds.length ? null : findPerson(bc.actor);
      characters[i] = { ...have, name: bc.name, actorIds: actor ? [actor] : have.actorIds };
      charByBardo.set(bc.bardoId, characters[i]);
    } else {
      const actor = findPerson(bc.actor);
      const c = newCharacter({ name: bc.name, bardoId: bc.bardoId, actorIds: actor ? [actor] : [] });
      characters.push(c);
      charByBardo.set(bc.bardoId, c);
      addedC += 1;
    }
  }
  const inScript = new Set(script.scenes.map((s) => s.bardoId));
  let detached = 0;
  let updated = 0;
  const scenes: Scene[] = r.scenes.map((s) => {
    if (s.bardoId && !inScript.has(s.bardoId)) {
      detached += 1;
      return { ...s, bardoId: "" };
    }
    return s;
  });
  let addedS = 0;
  for (const bs of script.scenes) {
    const characterIds = bs.characterIds.map((id) => charByBardo.get(id)?.id).filter((x): x is string => !!x);
    const i = scenes.findIndex((s) => s.bardoId === bs.bardoId);
    if (i >= 0) {
      const s = scenes[i];
      if (s.name !== bs.name || s.act !== bs.act || s.characterIds.join() !== characterIds.join()) updated += 1;
      scenes[i] = { ...s, name: bs.name, act: bs.act, characterIds };
    } else {
      scenes.push(newScene({ name: bs.name, act: bs.act, characterIds, bardoId: bs.bardoId, minutes: rehearsalMinutes(bs.words) }));
      addedS += 1;
    }
  }
  return { rehearsals: { ...r, characters, scenes, bardo: link }, added: { scenes: addedS, characters: addedC }, updated, detached };
}

/** Removes the link to the script: scenes and characters stay, as if entered by hand. */
export function unlinkBardo(r: Rehearsals): Rehearsals {
  return { ...r, bardo: null, scenes: r.scenes.map((s) => ({ ...s, bardoId: "" })), characters: r.characters.map((c) => ({ ...c, bardoId: "" })) };
}

export type { PlanItem };
