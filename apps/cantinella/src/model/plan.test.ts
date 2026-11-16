import { describe, expect, it } from "vitest";
import { newPerson, newRehearsals } from "./defaults";
import { icsCalendar } from "./ics";
import { actorMessage, fitOn, planMessage, planWarnings, proposePlan, sceneProgress } from "./plan";
import { currentAnswers } from "./rehearsals";
import { BardoReadError, fingerprint, mergeBardo, readBardo, rehearsalMinutes, sceneNeed, shortNames } from "./scenes";
import type { Answer, AnswerState, Person, Rehearsals } from "./types";

const TODAY = "2026-11-10";
const people: Person[] = ["Giulia Ferri", "Enrico Sala", "Giovanni Rota", "Giovanni Bassi", "Luca Fadda"].map((n, i) => ({ ...newPerson(n), id: `p${i + 1}`, roles: ["actor"] }));

let n = 0;
const ans = (personId: string, dateId: string, state: AnswerState): Answer => ({ id: `a${++n}`, personId, dateId, state, note: "", at: "", source: "paste" });

/** y/m/n/- per date, one string per person p1… */
function setup(rows: string[], extra: Partial<Rehearsals> = {}): Rehearsals {
  const r = newRehearsals();
  r.dates = [
    { id: "d0", day: "2026-11-05", time: "18:00", minutes: 120, place: "" },
    { id: "d1", day: "2026-11-11", time: "18:00", minutes: 120, place: "Sala" },
    { id: "d2", day: "2026-11-13", time: "18:00", minutes: 60, place: "" },
    { id: "d3", day: "2026-11-15", time: "16:00", minutes: 120, place: "" },
  ];
  const st: Record<string, AnswerState> = { y: "yes", m: "maybe", n: "no" };
  rows.forEach((row, i) => [...row].forEach((c, j) => c !== "-" && r.answers.push(ans(`p${i + 1}`, `d${j}`, st[c]))));
  r.characters = [
    { id: "c1", name: "Mirandolina", actorIds: ["p1"], bardoId: "" },
    { id: "c2", name: "Cavaliere", actorIds: ["p2"], bardoId: "" },
    { id: "c3", name: "Marchese", actorIds: ["p3", "p4"], bardoId: "" },
    { id: "c4", name: "Fabrizio", actorIds: ["p5"], bardoId: "" },
  ];
  r.scenes = [
    { id: "s1", name: "Scena 1", act: "", characterIds: ["c1", "c2"], optional: [], weight: 2, minutes: 60, bardoId: "" },
    { id: "s2", name: "Scena 2", act: "", characterIds: ["c1", "c3"], optional: [], weight: 1, minutes: 60, bardoId: "" },
    { id: "s3", name: "Scena 3", act: "", characterIds: ["c4"], optional: [], weight: 1, minutes: 30, bardoId: "" },
  ];
  return { ...r, ...extra };
}

const at = (r: Rehearsals, plan = r.plan) => plan.map((p) => `${p.dateId}:${p.sceneId}`).sort();

describe("who is needed", () => {
  it("takes the first actor of every character, without duplicates, and leaves out the optional ones", () => {
    const r = setup([]);
    const s = { ...r.scenes[0], characterIds: ["c1", "c2", "c1"], optional: ["p2"] };
    expect(sceneNeed(s, r.characters)).toEqual({ required: ["p1"], optional: ["p2"], uncast: [] });
  });

  it("an understudy covers a character when the actor cannot come", () => {
    const r = setup(["yyyy", "yyyy", "nnnn", "yyyy"]);
    const f = fitOn(r.scenes[1], "d1", r.characters, currentAnswers(r.answers), false);
    expect(f.ok).toBe(true);
    expect(f.subs).toEqual([["c3", "p4"]]);
  });

  it("a maybe counts only when maybes are allowed", () => {
    const r = setup(["ymyy", "yyyy"]);
    const map = currentAnswers(r.answers);
    expect(fitOn(r.scenes[0], "d1", r.characters, map, false)).toMatchObject({ ok: false, missing: ["p1"] });
    expect(fitOn(r.scenes[0], "d1", r.characters, map, true)).toMatchObject({ ok: true, maybe: ["p1"] });
  });

  it("short names use the full name when two people share a first name", () => {
    const m = shortNames(people);
    expect(m.get("p1")).toBe("Giulia");
    expect(m.get("p3")).toBe("Giovanni Rota");
  });
});

describe("proposed plan", () => {
  it("puts every scene where its cast is available, as many times as wanted, within the time", () => {
    const r = setup(["yyyy", "yyyy", "yyyy", "----", "yyyy"]);
    const plan = proposePlan(r, TODAY);
    // d1 (120 min): s1 (behind by 2) then s2 → full. d2 (60): s1 again. d3: s3.
    expect(at(r, plan)).toEqual(["d1:s1", "d1:s2", "d2:s1", "d3:s3"]);
  });

  it("is the same every time for the same data", () => {
    const r = setup(["yyyy", "yyyy", "yyyy", "----", "yyyy"]);
    expect(at(r, proposePlan(r, TODAY))).toEqual(at(r, proposePlan(r, TODAY)));
  });

  it("never convenes someone who said no", () => {
    const r = setup(["yyyy", "ynyy", "yyyy", "----", "yyyy"]);
    const plan = proposePlan(r, TODAY);
    expect(at(r, plan).filter((x) => x.startsWith("d1:"))).not.toContain("d1:s1");
  });

  it("keeps locked scenes and past dates, and counts them", () => {
    const r = setup(["yyyy", "yyyy", "yyyy", "----", "yyyy"], {
      plan: [
        { id: "x", dateId: "d0", sceneId: "s1", locked: false },
        { id: "y", dateId: "d3", sceneId: "s2", locked: true },
        { id: "z", dateId: "d1", sceneId: "s3", locked: false },
      ],
    });
    const plan = proposePlan(r, TODAY);
    expect(plan.find((p) => p.id === "x")).toBeTruthy();
    expect(plan.find((p) => p.id === "y")).toBeTruthy();
    expect(plan.find((p) => p.id === "z")).toBeFalsy();
    // s1 needs one more (one done on d0), s2 is covered by the locked one.
    expect(at(r, plan).filter((x) => x.endsWith(":s1"))).toHaveLength(2);
    expect(at(r, plan).filter((x) => x.endsWith(":s2"))).toHaveLength(1);
  });

  it("prefers the scene with fewer possible dates left when two are equally behind", () => {
    // s3 (Luca) is possible only on d1; s2 is possible everywhere. d1 has room for one 60 + 30.
    const r = setup(["yyyy", "nnnn", "yyyy", "----", "-ynn"]);
    const plan = proposePlan(r, TODAY);
    expect(at(r, plan)).toContain("d1:s3");
  });
});

describe("warnings", () => {
  it("says who is missing on every date when a scene can never be rehearsed", () => {
    const r = setup(["yyyy", "nnnn", "yyyy", "----", "yyyy"]);
    r.plan = proposePlan(r, TODAY);
    const w = planWarnings(r, people, TODAY);
    expect(w.find((x) => x.sceneId === "s1")).toMatchObject({ level: "stop", text: "{scene} is never in the plan: {who} is missing on every date", vars: { who: "Enrico" } });
  });

  it("flags a convened actor who said no, and a scene under its number of rehearsals", () => {
    const r = setup(["yyyy", "ynyy", "yyyy", "----", "yyyy"], { plan: [{ id: "x", dateId: "d1", sceneId: "s1", locked: true }] });
    const w = planWarnings(r, people, TODAY);
    expect(w.some((x) => x.level === "stop" && x.dateId === "d1" && x.vars.who === "Enrico")).toBe(true);
    expect(w.some((x) => x.level === "warn" && x.sceneId === "s1")).toBe(true);
  });

  it("counts done and planned rehearsals", () => {
    const r = setup([], { plan: [{ id: "x", dateId: "d0", sceneId: "s1", locked: false }, { id: "y", dateId: "d2", sceneId: "s1", locked: false }] });
    expect(sceneProgress(r, TODAY)[0]).toMatchObject({ done: 1, planned: 1 });
  });
});

describe("messages", () => {
  it("writes one line per date with the scenes and who is convened", () => {
    const r = setup(["yyyy", "yyyy", "yyyy", "----", "yyyy"]);
    r.plan = proposePlan(r, TODAY);
    const text = planMessage(r, people, TODAY);
    expect(text.split("\n")[0]).toBe("Piano prove:");
    expect(text).toContain("Mercoledì 11 novembre ore 18:00, Sala — Scena 1, Scena 2 · convocati: Giulia, Enrico, Giovanni Rota");
    expect(text).not.toContain(" 5 novembre");
  });

  it("writes only the rehearsals of one actor", () => {
    const r = setup(["yyyy", "yyyy", "yyyy", "----", "yyyy"]);
    r.plan = proposePlan(r, TODAY);
    const text = actorMessage(r, people, "p5", TODAY);
    expect(text).toBe("Luca, ecco le tue prove:\nDomenica 15 novembre ore 16:00 — Scena 3");
  });

  it("makes a calendar file", () => {
    const ics = icsCalendar("Prove", [{ uid: "a", day: "2026-11-11", time: "23:30", minutes: 60, title: "Prova: Scena 1, Scena 2", place: "Sala; 2" }], new Date("2026-11-10T10:00:00Z"));
    expect(ics).toContain("DTSTART:20261111T233000\r\nDTEND:20261112T003000");
    expect(ics).toContain("SUMMARY:Prova: Scena 1\\, Scena 2");
    expect(ics).toContain("LOCATION:Sala\\; 2");
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
  });
});

describe("Bardo script", () => {
  const bardo = {
    format: "bardo",
    formatVersion: 1,
    data: {
      meta: { title: "La locandiera" },
      characters: [
        { id: "k1", name: "Mirandolina", actor: "Giulia Ferri" },
        { id: "k2", name: "Cavaliere", actor: "" },
        { id: "k3", name: "Servitore", actor: "" },
      ],
    },
    content: [
      { type: "auto", attrs: { id: "t" } },
      { type: "act", attrs: { id: "a1", title: "" } },
      { type: "scene", attrs: { id: "sc1", title: "La locanda", silent: ["k3"] } },
      { type: "speech", attrs: { speaker: "k1" }, content: [{ type: "text", text: "Uno due tre quattro" }] },
      { type: "direction", content: [{ type: "text", text: "Entra il Cavaliere" }] },
      { type: "speech", attrs: { speaker: "k2" }, content: [{ type: "text", text: "cinque" }] },
      { type: "scene", attrs: { id: "sc2", title: "" } },
      { type: "speech", attrs: { speaker: "k1" }, content: [{ type: "text", text: "sei" }] },
      { type: "speech", attrs: { speaker: "ghost" }, content: [] },
    ],
  };

  it("reads acts, scenes, who speaks and who is on stage silent", () => {
    const s = readBardo(JSON.stringify(bardo));
    expect(s.title).toBe("La locandiera");
    expect(s.scenes).toEqual([
      { bardoId: "sc1", name: "Scena 1 · La locanda", act: "Atto I", characterIds: ["k3", "k1", "k2"], words: 8 },
      { bardoId: "sc2", name: "Scena 2", act: "Atto I", characterIds: ["k1"], words: 1 },
    ]);
  });

  it("refuses files that are not scripts", () => {
    expect(() => readBardo("{}")).toThrow(BardoReadError);
    expect(() => readBardo(JSON.stringify({ ...bardo, formatVersion: 9 }))).toThrow(BardoReadError);
  });

  it("merges by identifier: renames keep weights and cast, scenes added by hand stay", () => {
    const link = { path: "x.bardo", title: "La locandiera", hash: "h", readAt: "" };
    const r0 = newRehearsals();
    const first = mergeBardo(r0, readBardo(JSON.stringify(bardo)), link, people);
    expect(first.added).toEqual({ scenes: 2, characters: 3 });
    // The actor written in Bardo is found in the contacts.
    expect(first.rehearsals.characters[0].actorIds).toEqual(["p1"]);
    const tuned = {
      ...first.rehearsals,
      scenes: [...first.rehearsals.scenes.map((s) => ({ ...s, weight: 5 })), { id: "own", name: "Saluti", act: "", characterIds: [], optional: [], weight: 1, minutes: 10, bardoId: "" }],
    };
    const changed = JSON.parse(JSON.stringify(bardo));
    changed.content[2].attrs.title = "La locanda di Firenze";
    changed.content.splice(6, 3);
    const again = mergeBardo(tuned, readBardo(JSON.stringify(changed)), link, people);
    expect(again.added.scenes).toBe(0);
    expect(again.updated).toBe(1);
    expect(again.detached).toBe(1);
    expect(again.rehearsals.scenes.map((s) => [s.name, s.weight, s.bardoId])).toEqual([
      ["Scena 1 · La locanda di Firenze", 5, "sc1"],
      ["Scena 2", 5, ""],
      ["Saluti", 1, ""],
    ]);
  });

  it("estimates rehearsal time and notices changes", () => {
    expect(rehearsalMinutes(0)).toBe(15);
    expect(rehearsalMinutes(1400)).toBe(30);
    expect(fingerprint("a")).not.toBe(fingerprint("b"));
  });
});

describe("understudies in the call", () => {
  it("convenes the understudy instead of the actor who cannot come", async () => {
    const { convened } = await import("./plan");
    const r = setup(["yyyy", "yyyy", "nnnn", "yyyy"]);
    const c = convened([{ id: "x", dateId: "d1", sceneId: "s2", locked: false }], r);
    expect(c.required).toEqual(["p1", "p4"]);
  });
});
