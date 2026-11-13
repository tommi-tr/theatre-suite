import type { TFunc } from "@theatre-suite/core";

/** "1 document" / "3 documents": two dictionary entries, one with {n}. */
export function plural(t: TFunc, n: number, one: string, many: string): string {
  return n === 1 ? t(one) : t(many, { n });
}

/**
 * Native errors are plain English text, a few with a code before a colon
 * (NOT_INSTALLED:Diaframma, MISSING:Audio/x.diaframma). This turns them into a sentence the person can act on.
 */
export function explain(t: TFunc, e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.startsWith("NOT_INSTALLED:")) return t("{name} is not installed on this computer. See “Theatre Suite”.", { name: msg.slice(14) });
  if (msg.startsWith("MISSING:")) return t("The file {file} cannot be found. It may have been moved or deleted.", { file: msg.slice(8) });
  if (msg === "NOT_FOUND") return t("The list of versions cannot be found right now. Try again later.");
  if (msg.startsWith("Cannot reach the server")) return t("No connection: check the internet and try again.");
  // Plain sentences from the native side are translated when the dictionary knows them.
  return t(msg);
}
