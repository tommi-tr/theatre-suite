import type { Lang, TFunc } from "@theatre-suite/core";
import { fixtureType, type SymbolKind } from "../model/fixtureTypes";
import { lastChannel } from "../model/addresses";
import { listGroups, trussOrdinal, type PlaceKey } from "../model/ops";
import type { Fixture, GranveloDoc, Id } from "../model/types";
import { fmtAddress, fmtNum } from "../lib/format";
import { facing, lightPosition, sceneryOutline, viewBounds, type Box2 } from "../stage";
import { symbolOffset } from "../stage/scene";

/**
 * What the electricians' prints say, as plain data (pure, tested): the plan seen from above and the list of lights.
 * The sheets (PrintSheets.tsx) only draw it, on white paper.
 */

export type PrintKind = "plan" | "list";

/** "La locandiera · 16 novembre 2026": the title line of every sheet. */
export function sheetTitle(showTitle: string, what: string, date: Date, lang: Lang): string {
  const when = new Intl.DateTimeFormat(lang === "it" ? "it-IT" : "en-GB", { dateStyle: "long" }).format(date);
  return `${showTitle.trim() || "—"} · ${what} · ${when}`;
}

/** Name of a truss: the user's, or the automatic one from its order front to back. */
export function printTrussName(t: TFunc, doc: Pick<GranveloDoc, "trusses">, trussId: Id): string {
  const tr = doc.trusses.find((x) => x.id === trussId);
  return tr?.name || t("Truss {n}", { n: trussOrdinal(doc, trussId) });
}

function placeName(t: TFunc, doc: Pick<GranveloDoc, "trusses">, key: PlaceKey): string {
  switch (key.kind) {
    case "house":
      return t("In the house");
    case "truss":
      return printTrussName(t, doc, key.trussId);
    case "floatingStage":
      return t("Floating over the stage");
    default:
      return t("On the floor");
  }
}

/** "021" or "021–023"; "—" for a light with no address. */
export function addressRange(f: Pick<Fixture, "address" | "channels">): string {
  if (f.address === null) return "—";
  const last = lastChannel(f)!;
  return last === f.address ? fmtAddress(f.address) : `${fmtAddress(f.address)}–${fmtAddress(last)}`;
}

/* ------------------------------------------------------------------ */
/* The list                                                             */
/* ------------------------------------------------------------------ */

export interface ListRow {
  id: Id;
  number: number;
  name: string;
  type: string;
  channels: number;
  /** First DMX address ("021") or "—". */
  address: string;
  /** "021–023". */
  range: string;
  /** Where on its bar, or where in the room: "X 1,5 m" for a light on a bar; "X · Y · Z" otherwise. */
  position: string;
  unused: boolean;
}

export interface ListGroup {
  key: string;
  title: string;
  /** More about the place ("2,5 m from the front, 4 m high") or "". */
  detail: string;
  rows: ListRow[];
}

export interface ListData {
  groups: ListGroup[];
  lights: number;
  unused: number;
}

/** The list of lights grouped by position, like the one on screen (house, bars front to back, floating, floor). */
export function listData(doc: GranveloDoc, t: TFunc, lang: Lang): ListData {
  const n = (v: number) => fmtNum(v, lang, 2);
  const groups: ListGroup[] = [];
  let total = 0;
  let unused = 0;
  for (const g of listGroups(doc)) {
    if (g.fixtures.length === 0) continue;
    const truss = g.key.kind === "truss" ? doc.trusses.find((x) => x.id === (g.key as { trussId: Id }).trussId) : undefined;
    const rows: ListRow[] = g.fixtures.map((f) => {
      const p = lightPosition(f, doc);
      total++;
      if (f.unused) unused++;
      return {
        id: f.id,
        number: f.number,
        name: f.name || t(fixtureType(f.typeId).name),
        type: t(fixtureType(f.typeId).name),
        channels: f.channels.length,
        address: f.address === null ? "—" : fmtAddress(f.address),
        range: addressRange(f),
        position: f.mount.kind === "truss" && truss ? `X ${n(p.x)} m` : `X ${n(p.x)} · Y ${n(p.y)} · Z ${n(p.z)} m`,
        unused: f.unused,
      };
    });
    groups.push({
      key: g.key.kind === "truss" ? `truss:${g.key.trussId}` : g.key.kind,
      title: placeName(t, doc, g.key),
      detail: truss ? t("{y} m from the front edge, {z} m high", { y: n(truss.y), z: n(truss.z) }) : "",
      rows,
    });
  }
  return { groups, lights: total, unused };
}

/* ------------------------------------------------------------------ */
/* The plan                                                             */
/* ------------------------------------------------------------------ */

export interface PlanLight {
  id: Id;
  number: number;
  /** First address, "021", or "" when it has none. */
  address: string;
  x: number;
  /** Screen y of the plan (−depth). */
  y: number;
  symbol: SymbolKind;
  /** Degrees, the symbol faces where the light points. */
  rotate: number;
  unused: boolean;
}

export interface PlanTruss {
  id: Id;
  name: string;
  /** Screen y of the bar. */
  y: number;
  detail: string;
}

export interface PlanPiece {
  id: Id;
  name: string;
  color: string;
  points: string;
}

export interface PlanData {
  /** The paper view, in metres: the stage, the lights, and room at the right for the names of the bars. */
  box: Box2;
  stage: { width: number; depth: number };
  /** Size of a symbol in metres, so that numbers and symbols read the same on every stage size. */
  symbol: number;
  /** Where the names of the bars start (x, metres). */
  nameX: number;
  trusses: PlanTruss[];
  lights: PlanLight[];
  pieces: PlanPiece[];
  /** Types used, for the legend (in the order of the list). */
  legend: { typeId: Fixture["typeId"]; name: string; symbol: SymbolKind; count: number }[];
}

/** Everything the plan needs to be drawn on paper (metres; the sheet scales it). */
export function planData(doc: GranveloDoc, t: TFunc, lang: Lang): PlanData {
  const n = (v: number) => fmtNum(v, lang, 2);
  const b = viewBounds(doc, "plan", 0.9);
  const span = Math.max(b.maxX - b.minX, b.maxY - b.minY);
  const symbol = Math.min(0.7, Math.max(0.34, span * 0.04));
  // The names of the bars go at the right of everything that hangs or stands beside the stage; the measures below and at the left.
  const half = doc.stage.width / 2;
  const right = Math.max(half + 0.3, ...doc.fixtures.map((f) => lightPosition(f, doc).x + symbol / 2));
  const nameX = right + 0.3;
  const box: Box2 = { minX: b.minX - 0.6, minY: b.minY, maxX: doc.trusses.length ? Math.max(b.maxX, nameX) + 3.4 : b.maxX, maxY: b.maxY + 1.1 };
  const lights: PlanLight[] = [...doc.fixtures]
    .sort((a, c) => a.number - c.number)
    .map((f) => {
      const p = lightPosition(f, doc);
      return {
        id: f.id,
        number: f.number,
        address: f.address === null ? "" : fmtAddress(f.address),
        x: p.x,
        y: -p.y,
        symbol: fixtureType(f.typeId).symbol,
        rotate: facing(p, f.aim, "plan", 0) + symbolOffset(fixtureType(f.typeId).symbol),
        unused: f.unused,
      };
    });
  const trusses = [...doc.trusses]
    .sort((a, c) => a.y - c.y)
    .map((tr) => ({ id: tr.id, name: printTrussName(t, doc, tr.id), y: -tr.y, detail: t("{y} m from the front edge, {z} m high", { y: n(tr.y), z: n(tr.z) }) }));
  const pieces = doc.scenery.map((s) => ({ id: s.id, name: s.name, color: s.color, points: sceneryOutline(s, "plan").map((q) => `${q.x},${q.y}`).join(" ") }));
  const legend: PlanData["legend"] = [];
  for (const f of doc.fixtures) {
    const e = legend.find((x) => x.typeId === f.typeId);
    if (e) e.count++;
    else legend.push({ typeId: f.typeId, name: t(fixtureType(f.typeId).name), symbol: fixtureType(f.typeId).symbol, count: 1 });
  }
  return { box, stage: { width: doc.stage.width, depth: doc.stage.depth }, symbol, nameX, trusses, lights, pieces, legend };
}
