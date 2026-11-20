import type { ChecklistItem, CueShow } from "./show";
import type { Action, Go } from "./gos";
import { numberGos } from "./gos";

/**
 * The evening: the checklist before the curtain, the log of the evening (GOs, start, interval, end, changes, link
 * problems, chat, ticked checklist items), the dry run and the changes made during the show. Pure functions: the
 * store (store/evening.ts) keeps the state, the Controlli mode shows it.
 */

export type LogKind = "start" | "go" | "back" | "interval" | "resume" | "end" | "change" | "link" | "chat" | "check" | "safety";

export interface LogEntry {
  at: number;
  kind: LogKind;
  text: string;
  /** "primary" / "secondary" / "solo": which computer did it. */
  by?: string;
}

/** Marks a text for translation (read by the i18n test); translated when the checklist is built. */
const t = (s: string) => s;

/** Suggested checklist items (ids are stable so ticks survive a reload of the suggestions). */
export const SUGGESTED_CHECKS: readonly { id: string; text: string }[] = [
  { id: "sg-audio", text: t("Audio output tested (Controlli → Audio → Prova)") },
  { id: "sg-lights", text: t("Lights checked (Controlli → Luci DMX → Prova)") },
  { id: "sg-projector", text: t("Test pattern on the projector") },
  { id: "sg-secondary", text: t("Secondary computer connected") },
  { id: "sg-files", text: t("Files checked (dry run without problems)") },
  { id: "sg-dnd", text: t("Windows: Do not disturb on") },
  { id: "sg-power", text: t("Windows: power cable plugged in, no sleep") },
  { id: "sg-updates", text: t("Windows: updates paused") },
];

/** The checklist of a show: the suggested items (added if missing, keeping their tick) then the user's ones. */
export function withSuggestions(list: readonly ChecklistItem[], translate: (s: string) => string): ChecklistItem[] {
  const out: ChecklistItem[] = [];
  for (const s of SUGGESTED_CHECKS) {
    const have = list.find((c) => c.id === s.id);
    out.push(have ?? { id: s.id, text: translate(s.text), done: false, origin: "suggested" });
  }
  for (const c of list) if (!SUGGESTED_CHECKS.some((s) => s.id === c.id)) out.push(c);
  return out;
}

export const checklistCount = (list: readonly ChecklistItem[]) => ({ done: list.filter((c) => c.done).length, total: list.length });

export function addUserCheck(list: readonly ChecklistItem[], id: string, text: string): ChecklistItem[] {
  const clean = text.trim();
  if (!clean) return [...list];
  return [...list, { id, text: clean, done: false, origin: "user" }];
}

export const toggleCheck = (list: readonly ChecklistItem[], id: string): ChecklistItem[] => list.map((c) => (c.id === id ? { ...c, done: !c.done } : c));
export const removeCheck = (list: readonly ChecklistItem[], id: string): ChecklistItem[] => list.filter((c) => !(c.id === id && c.origin === "user"));
export const resetChecks = (list: readonly ChecklistItem[]): ChecklistItem[] => list.map((c) => ({ ...c, done: false }));

/** What the dry run found for one GO. */
export interface DryProblem {
  goId: string;
  number: string;
  text: string;
}

export interface DryRunReport {
  gos: number;
  actions: number;
  problems: DryProblem[];
}

/** What the dry run needs to know about the library and the projections, without touching any output. */
export interface DryRunWorld {
  hasLight: (sourceId: string, itemId: string) => boolean;
  hasAudio: (sourceId: string, itemId: string) => boolean;
  sourceProblem: (sourceId: string) => string | null;
  hasProjectionItem: (id: string) => boolean;
  /** Text for a missing item. */
  t: (s: string) => string;
}

/** Goes through every GO in order, in silence: each action must find its memory, track or image. */
export function dryRun(gos: readonly Go[], w: DryRunWorld): DryRunReport {
  const numbers = new Map(numberGos(gos).map((n) => [n.id, n.text]));
  const problems: DryProblem[] = [];
  let actions = 0;
  for (const g of gos) {
    const number = numbers.get(g.id) ?? "?";
    if (g.actions.length === 0) problems.push({ goId: g.id, number, text: w.t("This GO has no action") });
    for (const a of g.actions) {
      actions++;
      const p = actionProblem(a, w);
      if (p) problems.push({ goId: g.id, number, text: p });
    }
  }
  return { gos: gos.length, actions, problems };
}

function actionProblem(a: Action, w: DryRunWorld): string | null {
  if (a.kind === "light" || a.kind === "audio" || (a.kind === "audioStop" && a.ref)) {
    const ref = a.ref!;
    const src = w.sourceProblem(ref.sourceId);
    if (src) return src;
    const ok = a.kind === "light" ? w.hasLight(ref.sourceId, ref.itemId) : w.hasAudio(ref.sourceId, ref.itemId);
    if (!ok) return a.kind === "light" ? w.t("The memory is no longer in the lights file") : w.t("The track is no longer in the sound file");
  }
  if (a.kind === "projection" && a.projectionItemId && !w.hasProjectionItem(a.projectionItemId)) return w.t("The image or video is no longer in the projections");
  return null;
}

/** GOs whose actions changed since `baseline` (the show at the first GO of the evening): "modificato in serata". */
export function changedTonight(baseline: readonly Go[] | null, now: readonly Go[]): Go[] {
  if (!baseline) return [];
  const before = new Map(baseline.map((g) => [g.id, JSON.stringify(g.actions)]));
  return now.filter((g) => before.has(g.id) && before.get(g.id) !== JSON.stringify(g.actions));
}

/** Puts back the actions of the baseline in the GOs changed tonight ("Dimentica"). */
export function forgetTonight(baseline: readonly Go[], now: readonly Go[]): Go[] {
  const before = new Map(baseline.map((g) => [g.id, g]));
  return now.map((g) => {
    const b = before.get(g.id);
    return b && JSON.stringify(b.actions) !== JSON.stringify(g.actions) ? { ...g, actions: b.actions } : g;
  });
}

const two = (n: number) => String(n).padStart(2, "0");
export const clock = (ms: number) => {
  const d = new Date(ms);
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
};

/** The show report as plain text (to copy, save or print). */
export function reportText(show: Pick<CueShow, "title">, log: readonly LogEntry[], checklist: readonly ChecklistItem[], t: (s: string) => string, byName: (by?: string) => string): string {
  const lines: string[] = [];
  lines.push(`${t("Show report")} · ${show.title}`);
  const first = log[0];
  if (first) lines.push(new Date(first.at).toLocaleDateString());
  lines.push("");
  const c = checklistCount(checklist);
  lines.push(`${t("Checklist before the curtain")}: ${c.done} / ${c.total}`);
  for (const i of checklist) lines.push(`  [${i.done ? "x" : " "}] ${i.text}`);
  lines.push("");
  lines.push(t("Log of the evening"));
  for (const e of log) lines.push(`  ${clock(e.at)}  ${e.text}${e.by ? ` · ${byName(e.by)}` : ""}`);
  return lines.join("\n");
}
