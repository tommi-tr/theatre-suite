import { create } from "zustand";
import { History } from "@theatre-suite/core";
import { applyColor, deskUniverse, emptyValues, memoryValues, reconcileValues, saveMemoryValues, saveNewMemory, valuesDiffer, withChannel, withIntensity } from "../model/desk";
import { intensityMask } from "../model/enginePayload";
import { valuesOf } from "../model/universe";
import { DMX_MAX, type FixtureValues, type GranveloDoc, type Id } from "../model/types";
import { useDoc } from "./doc";
import { useOutput } from "./output";

/**
 * The live desk: the values "on the faders" of every light, the memory on stage, Blind and the Grand Master. Banco uses
 * it now; Show will show the same desk (Esteso / Compatto / Mini) from this same store.
 *
 * - **Values** are per light id and channel position (`FixtureValues`), not saved in the document: only "Salva" writes
 *   them into a memory (through `useDoc.change`). When the patch changes they are kept by light id (`reconcile`).
 * - **Output**: every change goes through `useOutput.setUniverse` (`deskUniverse`: patch → **groups applied here**).
 *   The **Grand Master** is applied by the engine (`setGrandMaster` + intensity mask), never here — not twice.
 *   Nothing is sent before `activate()` (Banco calls it when it opens), nor while Blind is on.
 * - **Modified**: the faders differ from the memory on stage (`valuesDiffer`). A plain desk (no memory) is never "modified".
 * - **Blind**: edits the values of another memory (`blind`) without touching the output nor the live values.
 * - **Undo / redo**: the desk has its own small history of snapshots (values + memory on stage + blind values), with
 *   moves of the same fader coalesced in one step. It is cleared when a show is loaded and when Blind starts or ends.
 *   `undo()` / `redo()` act on it first; when it is empty they fall through to the document's history (so in Banco
 *   Ctrl Z also takes back a rename or a group). The two histories are not interleaved: a "Salva" is not a desk step.
 */

interface Snapshot {
  values: FixtureValues;
  liveMemoryId: Id | null;
  blindValues: FixtureValues | null;
}

export interface BlindState {
  memoryId: Id;
  values: FixtureValues;
  modified: boolean;
}

interface DeskStore {
  /** The desk owns the output (set by `activate`). */
  active: boolean;
  values: FixtureValues;
  liveMemoryId: Id | null;
  /** The faders differ from the memory on stage (not saved). */
  modified: boolean;
  /** Grand Master 0–255 (session state, starts at 100 %). */
  grandMaster: number;
  blind: BlindState | null;
  /** Memory selected in the list (the one Blind would edit); not necessarily on stage. */
  cursorId: Id | null;
  canUndo: boolean;
  canRedo: boolean;
  activate: () => void;
  /** Moves one channel of a light (on the live faders, or on the memory being edited in Blind). */
  setChannel: (fixtureId: Id, index: number, value: number) => void;
  /** Sets the level of a light with one fader ("compact" density). */
  setIntensity: (fixtureId: Id, level: number) => void;
  /** The colour picker: sets R, G, B (W, A) of the colour lights among `ids`. */
  setColor: (ids: readonly Id[], hex: string) => void;
  setGrandMaster: (level: number) => void;
  setCursor: (id: Id | null) => void;
  /** Puts a memory on stage at once (no fade, no question: the interface asks first if there are unsaved changes). */
  loadMemory: (id: Id) => void;
  /** Reloads the values of the memory on stage ("Ripristina"). */
  restore: () => void;
  /** "Salva": overwrites the memory on stage (or the one in Blind) with the faders. False when there is nothing to save to. */
  save: () => boolean;
  /** "Salva come nuova": false when the number is taken or not a positive integer. */
  saveAsNew: (number: number, label: string) => boolean;
  /** Starts Blind on a memory: "same" when it is the one on stage, "missing" if it does not exist. */
  startBlind: (id: Id) => "ok" | "same" | "missing";
  /** Leaves Blind (changes not saved are lost: the interface asks first). */
  exitBlind: () => void;
  /**
   * Show called a memory (GO, Indietro): the faders take its values and it becomes the memory on stage, **without
   * sending** (the Show sends the fade). So the desk — in Show and later in Banco — always starts from what is on stage.
   * The desk history is cleared: undoing to the faders before a GO would jump the stage.
   */
  followShow: (memoryId: Id) => void;
  undo: () => void;
  redo: () => void;
}

const COALESCE_MS = 1200;
const history = new History<Snapshot>(300);
let lastKey: string | null = null;
let lastAt = 0;

const report = (e: unknown) => console.error("[desk]", e);

const snap = (s: DeskStore): Snapshot => ({ values: s.values, liveMemoryId: s.liveMemoryId, blindValues: s.blind?.values ?? null });

function record(key?: string) {
  const now = Date.now();
  if (!(key && key === lastKey && now - lastAt < COALESCE_MS)) history.record(snap(useDesk.getState()));
  lastKey = key ?? null;
  lastAt = now;
}

function clearHistory() {
  history.clear();
  lastKey = null;
}

/** Sends the live values to the lights (groups applied; the engine applies the Grand Master). */
function push() {
  const s = useDesk.getState();
  const doc = useDoc.getState().doc;
  if (!s.active || s.blind || !doc) return;
  useOutput.getState().setUniverse(deskUniverse(doc, s.values))?.catch?.(report);
}

/** A transition is running in the engine (also paused): sending the faders now would cut it. */
const fading = () => useOutput.getState().live.fade.active;

/** Sends the live values unless a transition is running (that one already brings the stage where the faders are). */
function pushIfSteady() {
  if (!fading()) push();
}

/** Tells the engine the Grand Master and which channels it scales. */
function pushMaster() {
  const s = useDesk.getState();
  const doc = useDoc.getState().doc;
  if (!s.active || !doc) return;
  useOutput.getState().setGrandMaster(s.grandMaster, intensityMask(doc))?.catch?.(report);
}

const flags = () => ({ canUndo: history.canUndo, canRedo: history.canRedo });

/** `modified` of the live desk and of Blind, from the values and the document. */
function modifiedFlags(doc: GranveloDoc | null, values: FixtureValues, liveId: Id | null, blind: BlindState | null) {
  const live = doc && liveId ? doc.memories.find((m) => m.id === liveId) : undefined;
  const bm = doc && blind ? doc.memories.find((m) => m.id === blind.memoryId) : undefined;
  return {
    modified: !!(doc && live && valuesDiffer(doc, values, live)),
    blind: blind ? { ...blind, modified: !!(doc && bm && valuesDiffer(doc, blind.values, bm)) } : null,
  };
}

const INITIAL = { active: false, values: {} as FixtureValues, liveMemoryId: null, modified: false, grandMaster: DMX_MAX, blind: null, cursorId: null, canUndo: false, canRedo: false };

export const useDesk = create<DeskStore>((set, get) => {
  /** Changes the values being edited (live or blind), records the step, updates the flags and the output. */
  const edit = (change: (doc: GranveloDoc, values: FixtureValues) => FixtureValues, key?: string) => {
    const doc = useDoc.getState().doc;
    if (!doc) return;
    const s = get();
    const cur = s.blind ? s.blind.values : s.values;
    const next = change(doc, cur);
    if (next === cur) return;
    record(key);
    if (s.blind) {
      const blind = { ...s.blind, values: next };
      set({ blind: modifiedFlags(doc, s.values, s.liveMemoryId, blind).blind, ...flags() });
    } else {
      set({ values: next, modified: modifiedFlags(doc, next, s.liveMemoryId, null).modified, ...flags() });
      push();
    }
  };

  return {
    ...INITIAL,
    activate: () => {
      const doc = useDoc.getState().doc;
      set((s) => ({ active: true, values: doc ? reconcileValues(doc, s.values) : s.values }));
      pushMaster();
      // After a GO of the Show the faders already hold the memory coming on stage: a running fade is left to finish.
      pushIfSteady();
    },
    setChannel: (fixtureId, index, value) =>
      edit((doc, values) => {
        const f = doc.fixtures.find((x) => x.id === fixtureId);
        return f ? withChannel(values, f, index, value) : values;
      }, `ch:${fixtureId}:${index}`),
    setIntensity: (fixtureId, level) =>
      edit((doc, values) => {
        const f = doc.fixtures.find((x) => x.id === fixtureId);
        if (!f) return values;
        const row = withIntensity(f, valuesOf(f, values), level);
        return row.every((v, i) => v === values[fixtureId]?.[i]) ? values : { ...values, [fixtureId]: row };
      }, `in:${fixtureId}`),
    setColor: (ids, hex) => edit((doc, values) => applyColor(doc, values, ids, hex), "color"),
    setGrandMaster: (level) => {
      if (get().blind) return;
      const v = Math.min(DMX_MAX, Math.max(0, Math.round(level)));
      if (v === get().grandMaster) return;
      set({ grandMaster: v });
      pushMaster();
    },
    setCursor: (cursorId) => set({ cursorId }),
    loadMemory: (id) => {
      const doc = useDoc.getState().doc;
      const m = doc?.memories.find((x) => x.id === id);
      if (!doc || !m || get().blind) return;
      record();
      const values = memoryValues(doc, m);
      set({ values, liveMemoryId: id, cursorId: id, modified: false, ...flags() });
      push();
    },
    restore: () => {
      const doc = useDoc.getState().doc;
      const s = get();
      const id = s.blind ? s.blind.memoryId : s.liveMemoryId;
      const m = doc?.memories.find((x) => x.id === id);
      if (!doc || !m) return;
      const values = memoryValues(doc, m);
      record();
      if (s.blind) set({ blind: { ...s.blind, values, modified: false }, ...flags() });
      else {
        set({ values, modified: false, ...flags() });
        push();
      }
    },
    save: () => {
      const s = get();
      const id = s.blind ? s.blind.memoryId : s.liveMemoryId;
      const values = s.blind ? s.blind.values : s.values;
      if (!id || !useDoc.getState().doc?.memories.some((m) => m.id === id)) return false;
      useDoc.getState().change((d) => saveMemoryValues(d, id, values));
      return true;
    },
    saveAsNew: (number, label) => {
      const s = get();
      if (s.blind) return false;
      let newId: Id | null = null;
      useDoc.getState().change((d) => {
        const r = saveNewMemory(d, s.values, number, label, d.memories.find((m) => m.id === s.liveMemoryId)?.scenery ?? []);
        if (!r) return d;
        newId = r.id;
        return r.doc;
      });
      if (!newId) return false;
      set({ liveMemoryId: newId, cursorId: newId });
      const doc = useDoc.getState().doc;
      set({ modified: modifiedFlags(doc, get().values, newId, null).modified });
      return true;
    },
    startBlind: (id) => {
      const doc = useDoc.getState().doc;
      const m = doc?.memories.find((x) => x.id === id);
      if (!doc || !m) return "missing";
      if (id === get().liveMemoryId) return "same";
      clearHistory();
      set({ blind: { memoryId: id, values: memoryValues(doc, m), modified: false }, cursorId: id, ...flags() });
      return "ok";
    },
    exitBlind: () => {
      if (!get().blind) return;
      clearHistory();
      set({ blind: null, ...flags() });
      pushIfSteady();
    },
    followShow: (memoryId) => {
      const doc = useDoc.getState().doc;
      const m = doc?.memories.find((x) => x.id === memoryId);
      if (!doc || !m) return;
      clearHistory();
      set({ values: memoryValues(doc, m), liveMemoryId: memoryId, modified: false, ...flags() });
    },
    undo: () => {
      const prev = history.undo(snap(get()));
      lastKey = null;
      if (!prev) {
        useDoc.getState().undo();
        return;
      }
      restoreSnapshot(prev);
    },
    redo: () => {
      const next = history.redo(snap(get()));
      lastKey = null;
      if (!next) {
        useDoc.getState().redo();
        return;
      }
      restoreSnapshot(next);
    },
  };
});

function restoreSnapshot(sn: Snapshot) {
  const doc = useDoc.getState().doc;
  const s = useDesk.getState();
  if (!doc) return;
  const values = reconcileValues(doc, sn.values);
  const liveMemoryId = sn.liveMemoryId && doc.memories.some((m) => m.id === sn.liveMemoryId) ? sn.liveMemoryId : null;
  const blind = s.blind && sn.blindValues ? { ...s.blind, values: reconcileValues(doc, sn.blindValues) } : s.blind;
  const f = modifiedFlags(doc, values, liveMemoryId, blind);
  useDesk.setState({ values, liveMemoryId, modified: f.modified, blind: f.blind, ...flags() });
  push();
}

/** Starts from zero for a document just loaded (or closed). */
function resetFor(doc: GranveloDoc | null) {
  clearHistory();
  useDesk.setState({ ...INITIAL, active: useDesk.getState().active, values: doc ? emptyValues(doc) : {} });
  if (doc) {
    pushMaster();
    push();
  }
}

// Follow the document: a new show resets the desk; any other change keeps the values by light id, drops what is gone and
// resends (the patch, the groups or the Grand Master mask may have changed).
let lastDoc: GranveloDoc | null = null;
let lastRev = -1;
useDoc.subscribe((s) => {
  if (s.doc === lastDoc && s.loadRev === lastRev) return;
  const loaded = s.loadRev !== lastRev;
  const fixturesChanged = s.doc?.fixtures !== lastDoc?.fixtures;
  const groupsChanged = s.doc?.groups !== lastDoc?.groups;
  lastDoc = s.doc;
  lastRev = s.loadRev;
  if (loaded) return resetFor(s.doc);
  const doc = s.doc;
  if (!doc) return;
  const d = useDesk.getState();
  const values = reconcileValues(doc, d.values);
  const liveMemoryId = d.liveMemoryId && doc.memories.some((m) => m.id === d.liveMemoryId) ? d.liveMemoryId : null;
  const blindGone = d.blind && !doc.memories.some((m) => m.id === d.blind!.memoryId);
  const blind = blindGone ? null : d.blind ? { ...d.blind, values: reconcileValues(doc, d.blind.values) } : null;
  const cursorId = d.cursorId && doc.memories.some((m) => m.id === d.cursorId) ? d.cursorId : null;
  const f = modifiedFlags(doc, values, liveMemoryId, blind);
  useDesk.setState({ values, liveMemoryId, modified: f.modified, blind: f.blind, cursorId });
  if (blindGone) clearHistory();
  if (fixturesChanged) pushMaster();
  // Only what changes the universe is resent: editing a transition or the order in the Show must not cut a fade.
  if (fixturesChanged || groupsChanged) push();
});
