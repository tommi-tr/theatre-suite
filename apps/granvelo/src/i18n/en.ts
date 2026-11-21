import type { Dict } from "@theatre-suite/core";

/**
 * English needs no dictionary (keys are the English texts), except for keys that carry a context to tell
 * two meanings apart: "Show (mode)" is the name of the mode (it stays "Show" in Italian too), while "Show"
 * alone would be the verb ("Mostra"); "None (desk)" is the choice "no desk" under the Show ("No" in Italian).
 */
export const en: Dict = {
  "Show (mode)": "Show",
  "None (desk)": "None",
};
