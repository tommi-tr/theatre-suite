import type { TFunc } from "@theatre-suite/core";
import { PRESET_ROLES, type PresetRole } from "../model/types";

const LABELS: Record<PresetRole, string> = {
  actor: "Actor",
  director: "Direction",
  crew: "Crew",
  production: "Production",
};

const PLURALS: Record<PresetRole, string> = {
  actor: "Actors",
  director: "Direction",
  crew: "Crew members",
  production: "Production",
};

export const isPreset = (r: string): r is PresetRole => (PRESET_ROLES as readonly string[]).includes(r);

/** Label of a role: preset keys are translated, free text is shown as written. */
export function roleLabel(t: TFunc, role: string): string {
  return isPreset(role) ? t(LABELS[role]) : role;
}

export function rolePlural(t: TFunc, role: PresetRole): string {
  return t(PLURALS[role]);
}
