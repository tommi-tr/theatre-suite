import { AppLogo, DIAFRAMMA_LOGO, GRANVELO_LOGO } from "@theatre-suite/ui";
import type { SourceApp } from "../model/sources";

/** The icon of the app a linked file belongs to (Granvelo, Diaframma), in that app's colours. */
export function SourceLogo({ app, size = 18 }: { app: SourceApp; size?: number }) {
  if (app === "granvelo")
    return (
      <span className="cue-srclogo" style={{ ["--logo-a" as string]: GRANVELO_LOGO.color }}>
        <AppLogo accentPath={GRANVELO_LOGO.accent} inkPath={GRANVELO_LOGO.ink} label="Granvelo" size={size} strokeWidth={GRANVELO_LOGO.stroke(size)} />
      </span>
    );
  if (app === "diaframma")
    return (
      <span className="cue-srclogo" style={{ ["--logo-a" as string]: DIAFRAMMA_LOGO.color }}>
        <AppLogo accentPath={DIAFRAMMA_LOGO.accent} inkPath={DIAFRAMMA_LOGO.ink} label="Diaframma" size={size} />
      </span>
    );
  return null;
}
