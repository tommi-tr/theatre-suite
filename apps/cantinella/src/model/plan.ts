import { uid } from "@theatre-suite/core";
import { currentAnswers, dateLine, dayLabel, joinNames, sortDates, stateOf, todayKey } from "./rehearsals";
import { sceneNeed, shortNames } from "./scenes";
import type { IcsEvent } from "./ics";
import type { Answer, Character, Person, PlanItem, RehearsalDate, Rehearsals, Scene } from "./types";

/* The rehearsal plan: deterministic (same data, same plan) and explained. */

export interface Fit {
  /** Can the scene be rehearsed on the date with everyone required? */
  ok: boolean;
  /** Required people who answered "maybe" (only when maybes are allowed). */
  maybe: string[];
  /** Required people who are not available (no, no reply, or maybe when not allowed). */
  missing: string[];
  /** Characters covered by an understudy: [characterId, personId]. */
  subs: Array<[string, string]>;
}

/** Can `scene` be rehearsed on `dateId`? Understudies cover a character when its actor cannot come. */
export function fitOn(scene: Scene, dateId: string, characters: Character[], map: Map<string, Answer>, allowMaybe: boolean): Fit {
  const fit: Fit = { ok: true, maybe: [], missing: [], subs: [] };
  const byId = new Map(characters.map((c) => [c.id, c]));
  const seen = new Set<string>();
  for (const cid of scene.characterIds) {
    const c = byId.get(cid);
    const main = c?.actorIds[0];
    if (!c || !main || scene.optional.includes(main)) continue;
    const s = stateOf(map, main, dateId);
    if (s === "yes") continue;
    const sub = c.actorIds.slice(1).find((p) => stateOf(map, p, dateId) === "yes");
    if (sub) {
      fit.subs.push([c.id, sub]);
      continue;
    }
    if (seen.has(main)) continue;
    seen.add(main);
    if (s === "maybe" && allowMaybe) fit.maybe.push(main);
    else fit.missing.push(main);
  }
  fit.ok = fit.missing.length === 0;
  return fit;
}

export interface PlanContext {
  dates: RehearsalDate[];
  map: Map<string, Answer>;
  today: string;
}

export function planContext(r: Rehearsals, today = todayKey()): PlanContext {
  return { dates: sortDates(r.dates), map: currentAnswers(r.answers), today };
}

const minutesOf = (scenes: Map<string, Scene>, items: PlanItem[]) => items.reduce((n, i) => n + (scenes.get(i.sceneId)?.minutes ?? 0), 0);

/**
 * Proposes the plan. Past dates and locked scenes stay as they are; every other future slot is
 * filled again: for every date, in order, the scene that is furthest behind its wanted number of
 * rehearsals, among those everyone can attend and that fit in the time left. Ties go to the scene
 * with fewer possible dates left, then to the order of the list.
 */
export function proposePlan(r: Rehearsals, today = todayKey()): PlanItem[] {
  const { dates, map } = planContext(r, today);
  const scenes = new Map(r.scenes.map((s) => [s.id, s]));
  const pastIds = new Set(dates.filter((d) => d.day < today).map((d) => d.id));
  const keep = r.plan.filter((p) => pastIds.has(p.dateId) || p.locked);
  const count = new Map<string, number>();
  for (const p of keep) count.set(p.sceneId, (count.get(p.sceneId) ?? 0) + 1);
  const future = dates.filter((d) => d.day >= today);
  const fits = new Map<string, boolean>();
  for (const d of future) for (const s of r.scenes) fits.set(`${s.id}|${d.id}`, fitOn(s, d.id, r.characters, map, r.allowMaybe).ok);
  const out = [...keep];
  future.forEach((d, di) => {
    const here = out.filter((p) => p.dateId === d.id);
    let used = minutesOf(scenes, here);
    const on = new Set(here.map((p) => p.sceneId));
    for (;;) {
      let best: { s: Scene; need: number; left: number; idx: number } | null = null;
      r.scenes.forEach((s, idx) => {
        if (on.has(s.id) || !fits.get(`${s.id}|${d.id}`) || used + s.minutes > d.minutes) return;
        const need = s.weight - (count.get(s.id) ?? 0);
        if (need <= 0) return;
        let left = 0;
        for (let k = di + 1; k < future.length; k++) if (fits.get(`${s.id}|${future[k].id}`)) left += 1;
        if (!best || need > best.need || (need === best.need && (left < best.left || (left === best.left && idx < best.idx)))) best = { s, need, left, idx };
      });
      if (!best) break;
      const pick: Scene = (best as { s: Scene }).s;
      out.push({ id: uid(), dateId: d.id, sceneId: pick.id, locked: false });
      on.add(pick.id);
      used += pick.minutes;
      count.set(pick.id, (count.get(pick.id) ?? 0) + 1);
    }
  });
  return out;
}

/* ---------------- Warnings ---------------- */

export type WarningLevel = "stop" | "warn";

export interface PlanWarning {
  level: WarningLevel;
  /** English text with {placeholders}, translated by the interface. */
  text: string;
  vars: Record<string, string | number>;
  sceneId?: string;
  dateId?: string;
}

export interface SceneProgress {
  scene: Scene;
  /** Rehearsals on past dates. */
  done: number;
  /** Rehearsals on dates to come. */
  planned: number;
}

export function sceneProgress(r: Rehearsals, today = todayKey()): SceneProgress[] {
  const dayOf = new Map(r.dates.map((d) => [d.id, d.day]));
  return r.scenes.map((scene) => {
    let done = 0;
    let planned = 0;
    for (const p of r.plan) {
      if (p.sceneId !== scene.id) continue;
      const day = dayOf.get(p.dateId);
      if (!day) continue;
      if (day < today) done += 1;
      else planned += 1;
    }
    return { scene, done, planned };
  });
}

export function planWarnings(r: Rehearsals, people: Person[], today = todayKey()): PlanWarning[] {
  const { dates, map } = planContext(r, today);
  const names = shortNames(people);
  const name = (id: string) => names.get(id) ?? "?";
  const scenes = new Map(r.scenes.map((s) => [s.id, s]));
  const future = dates.filter((d) => d.day >= today);
  const out: PlanWarning[] = [];
  // Convened people who cannot come.
  for (const d of future) {
    const items = r.plan.filter((p) => p.dateId === d.id);
    for (const p of items) {
      const s = scenes.get(p.sceneId);
      if (!s) continue;
      for (const pid of sceneNeed(s, r.characters).required) {
        const st = stateOf(map, pid, d.id);
        if (st === "yes") continue;
        const fit = fitOn(s, d.id, r.characters, map, r.allowMaybe);
        if (!fit.missing.includes(pid) && !fit.maybe.includes(pid)) continue; // covered by an understudy
        if (st === "maybe" && r.allowMaybe) continue;
        out.push({
          level: st === "no" ? "stop" : "warn",
          text: st === "no" ? "{who} said no on {day} but is convened for {scene}" : st === "maybe" ? "{who} said maybe on {day} ({scene})" : "{who} has not answered for {day} ({scene})",
          vars: { who: name(pid), day: dayLabel(d.day), scene: s.name },
          sceneId: s.id,
          dateId: d.id,
        });
      }
    }
    const used = minutesOf(scenes, items);
    if (used > d.minutes) out.push({ level: "warn", text: "{day}: the scenes need {used} min, the rehearsal lasts {max}", vars: { day: dayLabel(d.day), used, max: d.minutes }, dateId: d.id });
  }
  // Scenes behind.
  for (const { scene, done, planned } of sceneProgress(r, today)) {
    const total = done + planned;
    if (total >= scene.weight) continue;
    if (total === 0) {
      const why = whyNot(scene, r, future, map, name);
      out.push({ level: "stop", text: why.text, vars: { scene: scene.name, who: why.who ?? "" }, sceneId: scene.id });
    } else out.push({ level: "warn", text: "{scene}: {n} rehearsals of {w}", vars: { scene: scene.name, n: total, w: scene.weight }, sceneId: scene.id });
  }
  // Characters without an actor.
  for (const c of r.characters) {
    if (c.actorIds.length) continue;
    if (!r.scenes.some((s) => s.characterIds.includes(c.id))) continue;
    out.push({ level: "warn", text: "{character} has no actor", vars: { character: c.name } });
  }
  return out;
}

/** Why a scene cannot be planned: who is missing on every date, or that it never fits. */
function whyNot(scene: Scene, r: Rehearsals, future: RehearsalDate[], map: Map<string, Answer>, name: (id: string) => string): { text: string; who?: string } {
  if (!future.length) return { text: "{scene} is never in the plan: there are no dates to come" };
  const fits = future.map((d) => fitOn(scene, d.id, r.characters, map, r.allowMaybe));
  if (fits.some((f) => f.ok)) {
    return future.some((d, i) => fits[i].ok && scene.minutes <= d.minutes)
      ? { text: "{scene} is never in the plan: the rehearsals it fits in are full" }
      : { text: "{scene} is never in the plan: it is longer than the rehearsals" };
  }
  const always = sceneNeed(scene, r.characters).required.filter((p) => fits.every((f) => f.missing.includes(p)));
  if (always.length) return { text: always.length === 1 ? "{scene} is never in the plan: {who} is missing on every date" : "{scene} is never in the plan: {who} are missing on every date", who: joinNames(always.map(name)) };
  return { text: "{scene} is never in the plan: the cast is never complete on the same date" };
}

/* ---------------- Messages ---------------- */

function sceneList(items: PlanItem[], scenes: Map<string, Scene>): Scene[] {
  return items.map((p) => scenes.get(p.sceneId)).filter((s): s is Scene => !!s);
}

/** People convened on a date (required first, then optional), without duplicates. */
export function convened(items: PlanItem[], r: Rehearsals): { required: string[]; optional: string[] } {
  const scenes = new Map(r.scenes.map((s) => [s.id, s]));
  const map = currentAnswers(r.answers);
  const required: string[] = [];
  const optional: string[] = [];
  for (const s of sceneList(items, scenes)) {
    const need = sceneNeed(s, r.characters);
    const subs = items[0] ? fitOn(s, items[0].dateId, r.characters, map, r.allowMaybe).subs : [];
    // An understudy who covers a character takes the place of the actor.
    const byId = new Map(r.characters.map((c) => [c.id, c]));
    const replaced = new Set(subs.map(([cid]) => byId.get(cid)?.actorIds[0]));
    const stillNeeded = new Set(s.characterIds.filter((cid) => !subs.some(([x]) => x === cid)).map((cid) => byId.get(cid)?.actorIds[0]));
    const people = need.required.filter((p) => !replaced.has(p) || stillNeeded.has(p));
    for (const [, sub] of subs) if (!people.includes(sub)) people.push(sub);
    for (const p of people) if (!required.includes(p)) required.push(p);
    for (const p of need.optional) if (!optional.includes(p)) optional.push(p);
  }
  return { required, optional: optional.filter((p) => !required.includes(p)) };
}

export const PLAN_INTRO = "Piano prove:";

/** "Lunedì 4 novembre ore 16:00 — Scena 8, Scena 3 · convocati: Giovanni, Enrico, Stefania". Always in Italian. */
export function planMessage(r: Rehearsals, people: Person[], today = todayKey()): string {
  const names = shortNames(people);
  const scenes = new Map(r.scenes.map((s) => [s.id, s]));
  const lines: string[] = [];
  for (const d of sortDates(r.dates)) {
    if (d.day < today) continue;
    const items = r.plan.filter((p) => p.dateId === d.id);
    if (!items.length) continue;
    const who = convened(items, r);
    const list = sceneList(items, scenes).map((s) => s.name).join(", ");
    const opt = who.optional.length ? ` (facoltativi: ${who.optional.map((p) => names.get(p)).join(", ")})` : "";
    lines.push(`${dateLine(d)}${d.place ? `, ${d.place}` : ""} — ${list} · convocati: ${who.required.map((p) => names.get(p)).join(", ") || "–"}${opt}`);
  }
  return lines.length ? [PLAN_INTRO, ...lines].join("\n") : "";
}

/** The rehearsals of one person: only the dates where they are convened. */
export function actorMessage(r: Rehearsals, people: Person[], personId: string, today = todayKey()): string {
  const person = people.find((p) => p.id === personId);
  if (!person) return "";
  const scenes = new Map(r.scenes.map((s) => [s.id, s]));
  const lines: string[] = [];
  for (const d of sortDates(r.dates)) {
    if (d.day < today) continue;
    const items = r.plan.filter((p) => p.dateId === d.id);
    const mine = items.filter((p) => {
      const s = scenes.get(p.sceneId);
      if (!s) return false;
      const c = convened([p], r);
      return c.required.includes(personId) || c.optional.includes(personId);
    });
    if (!mine.length) continue;
    const parts = mine.map((p) => {
      const s = scenes.get(p.sceneId)!;
      const c = convened([p], r);
      return c.required.includes(personId) ? s.name : `${s.name} (facoltativa)`;
    });
    lines.push(`${dateLine(d)}${d.place ? `, ${d.place}` : ""} — ${parts.join(", ")}`);
  }
  const first = person.name.trim().split(/\s+/)[0];
  return lines.length ? [`${first}, ecco le tue prove:`, ...lines].join("\n") : "";
}

/** Calendar events of the plan (all, or only one person's). */
export function planEvents(r: Rehearsals, people: Person[], personId: string | null, title: string): IcsEvent[] {
  const names = shortNames(people);
  const scenes = new Map(r.scenes.map((s) => [s.id, s]));
  const out: IcsEvent[] = [];
  for (const d of sortDates(r.dates)) {
    const items = r.plan.filter((p) => p.dateId === d.id);
    if (!items.length) continue;
    const who = convened(items, r);
    if (personId && !who.required.includes(personId) && !who.optional.includes(personId)) continue;
    const list = sceneList(items, scenes).map((s) => s.name);
    out.push({
      uid: `${d.id}${personId ? `-${personId}` : ""}`,
      day: d.day,
      time: d.time,
      minutes: d.minutes,
      title: `${title ? `${title} · ` : ""}Prova: ${list.join(", ")}`,
      place: d.place,
      description: `Convocati: ${who.required.map((p) => names.get(p)).join(", ")}`,
    });
  }
  return out;
}
