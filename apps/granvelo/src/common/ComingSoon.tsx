import type { ReactNode } from "react";
import { useT } from "@theatre-suite/core";
import { Icon, type IconName } from "@theatre-suite/ui";

/**
 * "Part not yet available" (02_design.md): what this part will do, with the version that brings it, and
 * what can be done meanwhile. `title` and `about` come already translated.
 */
export function ComingSoon({ icon, version, title, about, children }: { icon: IconName; version: string; title: string; about: string[]; children?: ReactNode }) {
  const t = useT();
  return (
    <section className="gv-soon">
      <span className="gv-soon__icon">
        <Icon name={icon} size={22} />
      </span>
      <span className="gv-soonpill">{t("Coming with Granvelo {v}", { v: version })}</span>
      <h2>{title}</h2>
      <ul>
        {about.map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ul>
      {children ? <div className="gv-soon__now">{children}</div> : null}
    </section>
  );
}
