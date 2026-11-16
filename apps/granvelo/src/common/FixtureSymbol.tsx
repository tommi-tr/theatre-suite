import type { CSSProperties } from "react";
import type { SymbolKind } from "../model/fixtureTypes";
import { lensColor } from "../model/universe";
import type { Fixture } from "../model/types";
import { useOutput } from "../store/output";

/**
 * Flat line symbols of the lights (10_granvelo.md, "Simboli delle luci"): the same drawing on the stage, the
 * plan, the lists and the electricians' prints. 24×24 box, stroke 1.6, round caps. Granvelo only, so it lives
 * in the app (move it to packages/ui if another app needs it).
 *
 * States: `normal` (neutral stroke), `selected` (rounded box in the accent around the symbol), `conflict`
 * (amber stroke: address conflict), `unused` (dashed and faded: not used in this production).
 * Coloured lights (PAR LED, moving heads, LED bar) show in the lens the colour they are making (`lens`).
 */

export type SymbolState = "normal" | "selected" | "conflict" | "unused";

const PATHS: Record<SymbolKind, string> = {
  par: "M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0M8 12a4 4 0 1 0 8 0a4 4 0 1 0 -8 0",
  pc: "M8 8h8v8H8zM8 8L5 4h14l-3 4M16 8l4-3v14l-4-3M16 16l3 4H5l3-4M8 16l-4 3V5l4 3",
  profile: "M3 9h12v6H3zM15 8l5-2v12l-5-2M7 15v3",
  wash: "M5 18h14v3H5zM7 18V9M17 18V9M7 11h2M15 11h2M11 5h2a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z",
  spot: "M5 18h14v3H5zM7 18V9M17 18V9M7 11h2M15 11h2M11 5h2a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z",
  bar: "M2 9h20v6H2z",
  strobe: "M3 7h18v10H3zM13 8l-3 4h4l-3 4",
  smoke: "M2 9h10v7H2zM12 12h2M16 10a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M18.5 14a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M15 15a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0",
};

/** The spot's narrow lens (drawn over the wash geometry). */
const SPOT_LENS = "M12 9.5a1.6 1.6 0 1 0 0.01 0";
/** The cells of the LED bar. */
const BAR_CELLS = "M6 12h.01M10 12h.01M14 12h.01M18 12h.01";

export interface FixtureSymbolProps {
  kind: SymbolKind;
  state?: SymbolState;
  /** Colour the light is making (`#rrggbb`), shown in the lens of coloured lights; null/undefined = lens dark. */
  lens?: string | null;
  /**
   * The light this symbol stands for: the lens then shows, live, the colour the output store says it is making now
   * (the symbol re-renders only when that colour changes, not at every update of the output). `lens` wins if given.
   */
  fixture?: Pick<Fixture, "channels" | "typeId" | "address" | "unused">;
  size?: number;
  /** Degrees: the symbol faces where the light points (hung lights are upside down: 180). */
  rotate?: number;
  title?: string;
  className?: string;
  style?: CSSProperties;
}

/** The colour a light is making now, subscribed narrowly: a string, so the component re-renders only when it changes. */
function useLiveLens(f: FixtureSymbolProps["fixture"]): string | null {
  return useOutput((s) => (f ? lensColor(f, s.output) : null));
}

export function FixtureSymbol({ kind, state = "normal", lens: lensProp, fixture, size = 24, rotate = 0, title, className, style }: FixtureSymbolProps) {
  const live = useLiveLens(fixture);
  const lens = lensProp !== undefined ? lensProp : live;
  const stroke = state === "conflict" ? "var(--sb)" : "var(--gv-symbol-stroke)";
  const dash = state === "unused" ? "2.2 2" : undefined;
  const lensFill = lens ?? "transparent";
  const lensStyle = state === "unused" ? undefined : lens ? { fill: lensFill } : undefined;
  return (
    <svg
      width={size}
      height={size}
      viewBox="-2 -2 28 28"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={className ? `gv-symbol ${className}` : "gv-symbol"}
      data-state={state}
      style={{ flex: "none", opacity: state === "unused" ? 0.45 : 1, ...style }}
    >
      {title ? <title>{title}</title> : null}
      {state === "selected" ? <rect x="-1.4" y="-1.4" width="26.8" height="26.8" rx="5" fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth="1.4" /> : null}
      <g transform={rotate ? `rotate(${rotate} 12 12)` : undefined} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dash}>
        {kind === "par" ? <circle cx="12" cy="12" r="3.2" stroke="none" fill="var(--gv-lens-off)" style={lensStyle} /> : null}
        {kind === "wash" ? <circle cx="12" cy="10.5" r="2.2" stroke="none" fill="var(--gv-lens-off)" style={lensStyle} /> : null}
        <path d={PATHS[kind]} />
        {kind === "spot" ? <path d={SPOT_LENS} fill="var(--gv-lens-off)" style={lensStyle} /> : null}
        {kind === "bar" ? <path d={BAR_CELLS} stroke={state !== "unused" && lens ? lensFill : stroke} strokeWidth="2.4" strokeDasharray={undefined} /> : null}
      </g>
    </svg>
  );
}
