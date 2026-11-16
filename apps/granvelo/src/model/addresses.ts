import { UNIVERSE_SIZE, type Fixture, type GranveloDoc, type Id } from "./types";

/**
 * DMX addresses, as they are set on the lights (the keypad behind a PAR).
 *
 * Rules:
 * - a light with address A and N channels occupies channels A … A+N−1;
 * - channels beyond 512 do not exist: a light that does not fit is "out of range" (a problem, like a conflict);
 * - two **used** lights that share at least one channel are in **conflict**. A light "not used in this
 *   production" keeps its address (so it is reserved: the next free address skips it, and the map shows it)
 *   but is not connected, so it is never in conflict;
 * - nothing here ever changes the address of a light that was not asked for: removing a light never
 *   renumbers the others.
 */

/** Channels a light occupies (1-based, only those within the universe), in order. Empty without an address. */
export function occupiedChannels(f: Pick<Fixture, "address" | "channels">): number[] {
  if (f.address === null) return [];
  const out: number[] = [];
  for (let i = 0; i < f.channels.length; i++) {
    const ch = f.address + i;
    if (ch > UNIVERSE_SIZE) break;
    out.push(ch);
  }
  return out;
}

/** Last channel the light would need (may be beyond 512); null without an address. */
export function lastChannel(f: Pick<Fixture, "address" | "channels">): number | null {
  return f.address === null ? null : f.address + Math.max(1, f.channels.length) - 1;
}

/** Does a light of `count` channels fit at `address`? */
export function fits(address: number, count: number): boolean {
  return Number.isInteger(address) && address >= 1 && address + Math.max(1, count) - 1 <= UNIVERSE_SIZE;
}

/** One cell of the 512-channel map. */
export interface MapCell {
  channel: number;
  /** Used lights on this channel (more than one = conflict). */
  lights: Id[];
  /** Lights not used in this production that keep this channel reserved. */
  reserved: Id[];
  conflict: boolean;
}

/** The 512-cell map: who occupies what, and where the conflicts are. Index = channel − 1. */
export function addressMap(doc: Pick<GranveloDoc, "fixtures">): MapCell[] {
  const cells: MapCell[] = Array.from({ length: UNIVERSE_SIZE }, (_, i) => ({ channel: i + 1, lights: [], reserved: [], conflict: false }));
  for (const f of doc.fixtures) {
    for (const ch of occupiedChannels(f)) (f.unused ? cells[ch - 1].reserved : cells[ch - 1].lights).push(f.id);
  }
  for (const c of cells) c.conflict = c.lights.length > 1;
  return cells;
}

export interface AddressProblems {
  /** For every used light in conflict: the other lights it shares channels with. */
  conflicts: Map<Id, Id[]>;
  /** Lights whose last channel would be beyond 512. */
  outOfRange: Set<Id>;
}

/** Conflicts and lights that do not fit, light by light. */
export function addressProblems(doc: Pick<GranveloDoc, "fixtures">): AddressProblems {
  const conflicts = new Map<Id, Id[]>();
  const outOfRange = new Set<Id>();
  for (const cell of addressMap(doc)) {
    if (!cell.conflict) continue;
    for (const id of cell.lights) {
      const others = conflicts.get(id) ?? [];
      for (const o of cell.lights) if (o !== id && !others.includes(o)) others.push(o);
      conflicts.set(id, others);
    }
  }
  for (const f of doc.fixtures) {
    const last = lastChannel(f);
    if (!f.unused && last !== null && last > UNIVERSE_SIZE) outOfRange.add(f.id);
  }
  return { conflicts, outOfRange };
}

/** Number of distinct channels occupied by lights (used or reserved by an unused light): the "channels used of 512". */
export function channelsInUse(doc: Pick<GranveloDoc, "fixtures">): number {
  return addressMap(doc).filter((c) => c.lights.length > 0 || c.reserved.length > 0).length;
}

/**
 * First address from `from` where `count` consecutive channels are free of every light (reserved channels of
 * unused lights count as taken). `ignore` = lights not to count (the one being re-addressed). Null if none.
 */
export function nextFreeAddress(doc: Pick<GranveloDoc, "fixtures">, count: number, from = 1, ignore: Id[] = []): number | null {
  const taken = new Array<boolean>(UNIVERSE_SIZE + 1).fill(false);
  for (const f of doc.fixtures) if (!ignore.includes(f.id)) for (const ch of occupiedChannels(f)) taken[ch] = true;
  const n = Math.max(1, count);
  for (let a = Math.max(1, Math.floor(from)); a + n - 1 <= UNIVERSE_SIZE; a++) {
    let ok = true;
    for (let k = 0; k < n; k++)
      if (taken[a + k]) {
        ok = false;
        a += k; // jump past the taken channel
        break;
      }
    if (ok) return a;
  }
  return null;
}

export interface ClickNumbering {
  /** New address of each light, in the order they were clicked. */
  addresses: Map<Id, number>;
  /** Lights that did not fit before channel 512: their address is left as it was. */
  notFitting: Id[];
}

/**
 * Automatic numbering "a clic": the lights clicked in order get consecutive addresses, starting at `start`,
 * each one right after the channels of the previous one. With `skipTaken`, channels of other lights (not in
 * the list) are jumped over instead of creating conflicts. Lights not in the list are never changed.
 */
export function numberByClicks(doc: Pick<GranveloDoc, "fixtures">, orderedIds: Id[], start = 1, opts: { skipTaken?: boolean } = {}): ClickNumbering {
  const byId = new Map(doc.fixtures.map((f) => [f.id, f]));
  const ids = orderedIds.filter((id, i) => byId.has(id) && orderedIds.indexOf(id) === i);
  const others = { fixtures: doc.fixtures.filter((f) => !ids.includes(f.id)) };
  const addresses = new Map<Id, number>();
  const notFitting: Id[] = [];
  let next = Math.max(1, Math.floor(start));
  const placed: Fixture[] = [];
  for (const id of ids) {
    const f = byId.get(id)!;
    const n = Math.max(1, f.channels.length);
    let a: number | null = next;
    if (opts.skipTaken) a = nextFreeAddress({ fixtures: [...others.fixtures, ...placed] }, n, next);
    if (a === null || !fits(a, n)) {
      notFitting.push(id);
      continue;
    }
    addresses.set(id, a);
    placed.push({ ...f, address: a });
    next = a + n;
  }
  return { addresses, notFitting };
}

/** Applies new addresses (from `numberByClicks` or typed by hand) and nothing else. */
export function applyAddresses<D extends Pick<GranveloDoc, "fixtures">>(doc: D, addresses: Map<Id, number | null>): D {
  if (addresses.size === 0) return doc;
  return { ...doc, fixtures: doc.fixtures.map((f) => (addresses.has(f.id) ? { ...f, address: addresses.get(f.id)! } : f)) };
}
