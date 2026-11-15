import { uid } from "@theatre-suite/core";
import { newBudget } from "./budget";
import type { CantinellaData, Person, Rehearsals } from "./types";

/** First line of the message with the dates. Messages for the company are always in Italian. */
export const DEFAULT_INTRO = "Ecco le date delle prove. Scrivete accanto a ogni data sì, no o forse:";

export function newRehearsals(): Rehearsals {
  return { dates: [], answers: [], words: { yes: [], maybe: [], no: [] }, intro: DEFAULT_INTRO, characters: [], scenes: [], plan: [], allowMaybe: false, bardo: null };
}

export function newData(title = ""): CantinellaData {
  return { id: uid(), title, people: [], rehearsals: newRehearsals(), budget: newBudget(), extra: {} };
}

export function newPerson(name = ""): Person {
  return { id: uid(), name, aliases: [], phone: "", email: "", roles: [], notes: "" };
}

/** Is the document still empty (nothing entered in any section)? */
export function isEmpty(data: CantinellaData): boolean {
  const b = data.budget;
  return (
    data.people.length === 0 &&
    data.rehearsals.dates.length === 0 &&
    data.rehearsals.scenes.length === 0 &&
    data.rehearsals.characters.length === 0 &&
    b.costs.length === 0 &&
    b.sectors.length === 0 &&
    b.performances.length === 0 &&
    Object.keys(data.extra).length === 0
  );
}

/** Letters and digits only, lower case, no accents: for comparing names. */
export function nameKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Digits of a phone number without the Italian prefix: "+39 347 555 0192" → "3475550192". */
export function phoneKey(s: string): string {
  let d = s.replace(/\D+/g, "");
  if (d.startsWith("0039")) d = d.slice(4);
  else if (d.startsWith("39") && d.length >= 11) d = d.slice(2);
  return d;
}
