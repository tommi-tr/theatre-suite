/**
 * The keys of Cue (13_cue.md, "Tasti"). In 0.1 they are only listed (Settings → Tasti); from 0.3 they work and
 * can be changed, with a check for conflicts. `label` is an English key of the dictionary; `keys` are the
 * keys as written on the keyboard (several = alternatives, "+" = together, "held" = while held down).
 */
export type KeyGroup = "show" | "script" | "prepare";

export interface KeyInfo {
  id: string;
  group: KeyGroup;
  label: string;
  keys: string[][];
  held?: boolean;
  /** Red in the interface (Emergenza). */
  danger?: boolean;
}

export const KEYS: KeyInfo[] = [
  { id: "go", group: "show", label: "GO", keys: [["Space"], ["F13"]] },
  { id: "back", group: "show", label: "Back (previous GO)", keys: [["Backspace"]] },
  { id: "pause", group: "show", label: "Pause", keys: [["P"]] },
  { id: "preset", group: "show", label: "Preset (house lights)", keys: [["Q"]] },
  { id: "blank", group: "show", label: "Blank image", keys: [["T"]] },
  { id: "blackout", group: "show", label: "Blackout", keys: [["B"]] },
  { id: "ftb", group: "show", label: "Fade to black", keys: [["F"]] },
  { id: "emergency", group: "show", label: "Emergency", keys: [["E", "E"]], danger: true },
  { id: "stopAudio", group: "show", label: "Stop audio", keys: [["Esc"]] },
  { id: "reserve", group: "show", label: "Reserve the GO", keys: [["C"]], held: true },
  { id: "lock", group: "show", label: "Lock", keys: [["Ctrl", "L"]] },
  { id: "peek", group: "script", label: "Peek at the script", keys: [["Ctrl"]], held: true },
  { id: "scroll", group: "script", label: "Scroll the script", keys: [["↑", "↓"], ["W", "S"]] },
  { id: "zoom", group: "script", label: "Zoom or change page", keys: [["←", "→"], ["A", "D"]] },
  { id: "newGo", group: "prepare", label: "New GO here", keys: [["N"]] },
  { id: "note", group: "prepare", label: "Note", keys: [["K"]] },
];
