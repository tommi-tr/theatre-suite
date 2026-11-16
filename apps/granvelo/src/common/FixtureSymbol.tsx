import type { CSSProperties } from "react";
import type { SymbolKind } from "../model/fixtureTypes";
import { lensColor } from "../model/universe";
import type { Fixture } from "../model/types";
import { useOutput } from "../store/output";
import { SymbolGlyph, type SymbolState } from "./symbolGlyph";

/**
 * Flat line symbols of the lights (10_granvelo.md, "Simboli delle luci"): the same drawing on the stage, the
 * plan, the lists and the electricians' prints. 24×24 box, stroke 1.6, round caps. Granvelo only, so it lives
 * in the app (move it to packages/ui if another app needs it).
 *
 * States: `normal` (neutral stroke), `selected` (rounded box in the accent around the symbol), `conflict`
 * (amber stroke: address conflict), `unused` (dashed and faded: not used in this production).
 * Coloured lights (PAR LED, moving heads, LED bar) show in the lens the colour they are making (`lens`).
 */

export type { SymbolState };

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
      style={{ flex: "none", ...style }}
    >
      {title ? <title>{title}</title> : null}
      <SymbolGlyph kind={kind} state={state} lens={lens} rotate={rotate} />
    </svg>
  );
}
