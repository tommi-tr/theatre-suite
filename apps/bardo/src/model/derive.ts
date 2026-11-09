import type { Node as PMNode } from "prosemirror-model";
import { getData } from "./defaults";
import { partLabel, type PartKind } from "./numbering";
import { CHARACTER_CAT } from "./types";

export interface PartInfo {
  kind: PartKind;
  id: string;
  pos: number;
  /** Index of the block among the top-level blocks. */
  idx: number;
  number: number;
  label: string;
  title: string;
}

export interface ActInfo extends PartInfo {
  /** Indexes into `scenes`. */
  scenes: number[];
}

export interface SceneInfo extends PartInfo {
  /** Number of the act it belongs to (0 when there are no acts before it). */
  act: number;
  /** Index into `acts` (-1 when none). */
  actIndex: number;
  tableau: number | null;
  place: string;
  desc: string;
  /** Last block of the scene (exclusive). */
  endIdx: number;
  /** Characters who speak, in order of first line. */
  speakers: string[];
  /** Speakers + characters named in stage directions + silent presences. */
  present: string[];
  silent: string[];
  /** Category id → item ids mentioned in the scene. */
  items: Record<string, string[]>;
  speeches: number;
  words: number;
  spokenWords: number;
}

export interface Occurrence {
  pos: number;
  block: number;
  scene: number;
  act: number;
}

export interface SpeakerStats {
  speeches: number;
  words: number;
  scenes: number[];
  firstPos: number;
}

export interface AutoInfo {
  id: string;
  kind: string;
  pos: number;
  idx: number;
}

export interface DocIndex {
  blockPos: number[];
  blockScene: number[];
  blockAct: number[];
  parts: PartInfo[];
  acts: ActInfo[];
  tableaux: PartInfo[];
  scenes: SceneInfo[];
  autos: AutoInfo[];
  /** Item id (or character id) → where it is mentioned. */
  occurrences: Map<string, Occurrence[]>;
  speakers: Map<string, SpeakerStats>;
  /** Position of each speech → its number (1-based, whole script). */
  speechNumber: Map<number, number>;
  totals: { words: number; spokenWords: number; speeches: number; directions: number; minutes: number };
}

/** Spoken words per minute used for the estimated duration (pauses included). */
export const WORDS_PER_MINUTE = 140;

export function countWords(text: string): number {
  const m = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return m ? m.length : 0;
}

/** Builds the index of the script: structure, numbering, presences, mentions, totals. */
export function deriveIndex(doc: PMNode): DocIndex {
  const data = getData(doc);
  const numbering = data.format.partition.numbering;
  const resetPerAct = data.format.partition.sceneResetPerAct;
  const lang = data.lang;
  const idx: DocIndex = {
    blockPos: [],
    blockScene: [],
    blockAct: [],
    parts: [],
    acts: [],
    tableaux: [],
    scenes: [],
    autos: [],
    occurrences: new Map(),
    speakers: new Map(),
    speechNumber: new Map(),
    totals: { words: 0, spokenWords: 0, speeches: 0, directions: 0, minutes: 0 },
  };
  let actN = 0;
  let tabN = 0;
  let sceneN = 0;
  let curScene = -1;
  let curAct = -1;
  let speechN = 0;
  const addOcc = (key: string, o: Occurrence) => {
    const list = idx.occurrences.get(key);
    if (list) list.push(o);
    else idx.occurrences.set(key, [o]);
  };
  const lastEnd = new Map<string, number>();
  const scenePresent = new Map<number, Set<string>>();
  const sceneItems = new Map<number, Map<string, Set<string>>>();

  doc.forEach((node, offset, i) => {
    idx.blockPos.push(offset);
    const name = node.type.name;
    if (name === "act") {
      actN += 1;
      tabN = 0;
      if (resetPerAct) sceneN = 0;
      const info: ActInfo = { kind: "act", id: node.attrs.id, pos: offset, idx: i, number: actN, label: partLabel("act", actN, numbering, lang), title: node.attrs.title ?? "", scenes: [] };
      idx.acts.push(info);
      idx.parts.push(info);
      curAct = idx.acts.length - 1;
      curScene = -1;
    } else if (name === "tableau") {
      tabN += 1;
      const info: PartInfo = { kind: "tableau", id: node.attrs.id, pos: offset, idx: i, number: tabN, label: partLabel("tableau", tabN, numbering, lang), title: node.attrs.title ?? "" };
      idx.tableaux.push(info);
      idx.parts.push(info);
    } else if (name === "scene") {
      sceneN += 1;
      if (curScene >= 0) idx.scenes[curScene].endIdx = i;
      const silent: string[] = Array.isArray(node.attrs.silent) ? node.attrs.silent : [];
      const info: SceneInfo = {
        kind: "scene",
        id: node.attrs.id,
        pos: offset,
        idx: i,
        number: sceneN,
        label: partLabel("scene", sceneN, numbering, lang),
        title: node.attrs.title ?? "",
        place: node.attrs.place ?? "",
        desc: node.attrs.desc ?? "",
        act: curAct >= 0 ? idx.acts[curAct].number : 0,
        actIndex: curAct,
        tableau: tabN > 0 ? tabN : null,
        endIdx: doc.childCount,
        speakers: [],
        present: [],
        silent,
        items: {},
        speeches: 0,
        words: 0,
        spokenWords: 0,
      };
      idx.scenes.push(info);
      idx.parts.push(info);
      curScene = idx.scenes.length - 1;
      if (curAct >= 0) idx.acts[curAct].scenes.push(curScene);
      scenePresent.set(curScene, new Set(silent));
      sceneItems.set(curScene, new Map());
    } else if (name === "auto") {
      idx.autos.push({ id: node.attrs.id, kind: node.attrs.kind, pos: offset, idx: i });
    }
    // A new act closes the running scene.
    if (name === "act" && idx.scenes.length && idx.scenes[idx.scenes.length - 1].endIdx === doc.childCount) {
      const last = idx.scenes[idx.scenes.length - 1];
      if (last.idx < i) last.endIdx = i;
    }
    idx.blockScene.push(curScene);
    idx.blockAct.push(curAct);

    if (node.isTextblock) {
      const words = countWords(node.textContent);
      idx.totals.words += words;
      const scene = curScene >= 0 ? idx.scenes[curScene] : null;
      if (scene) scene.words += words;
      if (name === "speech") {
        speechN += 1;
        idx.speechNumber.set(offset, speechN);
        idx.totals.speeches += 1;
        idx.totals.spokenWords += words;
        const who = node.attrs.speaker as string;
        if (who) {
          const s = idx.speakers.get(who) ?? { speeches: 0, words: 0, scenes: [], firstPos: offset };
          s.speeches += 1;
          s.words += words;
          if (curScene >= 0 && !s.scenes.includes(curScene)) s.scenes.push(curScene);
          idx.speakers.set(who, s);
          if (scene) {
            if (!scene.speakers.includes(who)) scene.speakers.push(who);
            scenePresent.get(curScene)?.add(who);
          }
        }
        if (scene) {
          scene.speeches += 1;
          scene.spokenWords += words;
        }
      } else if (name === "direction") {
        idx.totals.directions += 1;
      }
      node.descendants((child, p) => {
        if (!child.isText) return;
        for (const m of child.marks) {
          if (m.type.name !== "cat" || !m.attrs.item) continue;
          const start = offset + 1 + p;
          // A marked word split in several text pieces counts once.
          if (lastEnd.get(m.attrs.item) !== start) addOcc(m.attrs.item, { pos: start, block: i, scene: curScene, act: curAct });
          lastEnd.set(m.attrs.item, start + child.nodeSize);
          if (curScene >= 0) {
            if (m.attrs.cat === CHARACTER_CAT) {
              if (name === "direction") scenePresent.get(curScene)?.add(m.attrs.item);
            } else {
              const map = sceneItems.get(curScene)!;
              const set = map.get(m.attrs.cat) ?? new Set<string>();
              set.add(m.attrs.item);
              map.set(m.attrs.cat, set);
            }
          }
        }
      });
    }
  });

  idx.scenes.forEach((s, k) => {
    const present = scenePresent.get(k) ?? new Set<string>();
    // Keep the order of the characters list.
    const order = data.characters.map((c) => c.id);
    s.present = [...present].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const items = sceneItems.get(k);
    if (items) for (const [cat, set] of items) s.items[cat] = [...set];
  });
  idx.totals.minutes = idx.totals.spokenWords / WORDS_PER_MINUTE;
  return idx;
}

/** Index of the top-level block that contains `pos`. */
export function blockAt(index: DocIndex, pos: number): number {
  const a = index.blockPos;
  let lo = 0;
  let hi = a.length - 1;
  let found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] <= pos) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** Characters in the order of their first line. */
export function charactersByEntry(index: DocIndex, ids: string[]): string[] {
  return [...ids].sort((a, b) => (index.speakers.get(a)?.firstPos ?? Infinity) - (index.speakers.get(b)?.firstPos ?? Infinity));
}

/** "3 h 50 min", "45 min". */
export function formatMinutes(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}
