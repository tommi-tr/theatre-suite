import type { ReactNode } from "react";
import { useT } from "@theatre-suite/core";
import { Icon, type IconName } from "@theatre-suite/ui";

/** "Coming with Cue x.y" (a small dashed pill), as in 02_design.md "Parte non ancora disponibile". */
export function SoonPill({ version }: { version: string }) {
  const t = useT();
  return <span className="cue-soonpill">{t("Coming with Cue {v}", { v: version })}</span>;
}

/**
 * "Part not yet available" (02_design.md): what this part will do, with the version that brings it, and what
 * can be done meanwhile. `title`, `about` and `children` come already translated.
 */
export function ComingSoon({ icon, version, title, about, children, compact }: { icon: IconName; version: string; title: string; about: string[]; children?: ReactNode; compact?: boolean }) {
  return (
    <section className={`cue-soon${compact ? " cue-soon--compact" : ""}`}>
      <div className="cue-soon__head">
        <span className="cue-soon__icon">
          <Icon name={icon} size={compact ? 18 : 22} />
        </span>
        <SoonPill version={version} />
      </div>
      <h2>{title}</h2>
      <ul>
        {about.map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ul>
      {children ? <div className="cue-soon__now">{children}</div> : null}
    </section>
  );
}
