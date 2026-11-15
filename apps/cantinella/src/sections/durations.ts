import { durationLabel } from "../model/rehearsals";

const COMMON = [30, 45, 60, 90, 120, 150, 180, 210, 240, 300, 360];

/** Lengths to choose from; a length written in the file that is not in the list is kept. */
export function durationOptions(current: number): Array<{ minutes: number; label: string }> {
  const all = COMMON.includes(current) ? COMMON : [...COMMON, current].sort((a, b) => a - b);
  return all.map((minutes) => ({ minutes, label: durationLabel(minutes) }));
}
