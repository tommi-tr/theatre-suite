import { AppLogo } from "@theatre-suite/ui";
import { appDef } from "../lib/apps";

/** Icon tile of an app, in the colours of that app. */
export function AppIcon({ id, size = 28 }: { id: string; size?: number }) {
  const def = appDef(id);
  if (!def) return <span className="ln-appicon" style={{ width: size, height: size }} aria-hidden="true" />;
  return (
    <span style={{ display: "inline-flex", ["--logo-a" as string]: def.logo.accentColor }}>
      <AppLogo accentPath={def.logo.a} inkPath={def.logo.b} size={size} label={def.name} />
    </span>
  );
}

/** The launcher's own mark: four short strokes, one per app. */
export function LauncherMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="Theatre Suite" style={{ flex: "none" }}>
      <rect x="1" y="1" width="98" height="98" rx="23" fill="var(--tile)" stroke="var(--tile-border)" strokeWidth="2" />
      <g strokeWidth="7.5" strokeLinecap="round" fill="none">
        <path d="M24 36H44" stroke="#6b5bef" />
        <path d="M56 36H76" stroke="#c8642c" />
        <path d="M24 64H44" stroke="#55627e" />
        <path d="M56 64H76" stroke="#0f9fa8" />
      </g>
    </svg>
  );
}
