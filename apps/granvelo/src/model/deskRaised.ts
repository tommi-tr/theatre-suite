import type { FixtureValues, GranveloDoc } from "./types";

/**
 * Does the desk hold something that loading a memory would throw away? True when a light that is used in this production
 * has a fader above zero (a position or a colour counts as much as an intensity). Lights not used send nothing and are ignored.
 */
export function hasRaisedFaders(doc: Pick<GranveloDoc, "fixtures">, values: FixtureValues): boolean {
  return doc.fixtures.some((f) => !f.unused && (values[f.id] ?? []).some((v) => v > 0));
}
