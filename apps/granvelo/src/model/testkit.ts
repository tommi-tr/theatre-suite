import { defaultChannels } from "./fixtureTypes";
import { newDocument } from "./file";
import type { Fixture, FixtureTypeId, GranveloDoc } from "./types";

/** Small helpers for the tests of the model (not used by the app). */
export function light(id: string, typeId: FixtureTypeId, address: number | null, extra: Partial<Fixture> = {}): Fixture {
  return {
    id,
    number: Number(id.replace(/\D/g, "")) || 1,
    name: id,
    typeId,
    universe: 1,
    address,
    channels: defaultChannels(typeId),
    mount: { kind: "floating" },
    position: { x: 0, y: 2, z: 4 },
    beam: { angle: 25 },
    aim: { x: 0, y: 2, z: 0 },
    unused: false,
    broken: false,
    ...extra,
  };
}

export function docWith(fixtures: Fixture[], extra: Partial<GranveloDoc> = {}): GranveloDoc {
  return { ...newDocument({ title: "Test" }), id: "doc-test", fixtures, ...extra };
}
