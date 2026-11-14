import { useT } from "@theatre-suite/core";
import type { SectionId } from "../model/types";
import { useDoc } from "../store/doc";
import { useUi } from "../store/ui";
import { sectionDef } from "./sections";

/** The parts of the open section, in a narrow column on the left. */
export function PartsNav({ section }: { section: SectionId }) {
  const t = useT();
  const def = sectionDef(section);
  const current = useUi((s) => s.parts[section]);
  const people = useDoc((s) => s.data.people.length);
  return (
    <nav className="cn-parts" aria-label={t("Parts of {section}", { section: t(def.label) })}>
      <div className="cn-parts__title">{t(def.label)}</div>
      {def.parts.map((p) => (
        <button
          key={p.id}
          type="button"
          className="cn-parts__item"
          aria-current={p.id === current ? "page" : undefined}
          onClick={() => useUi.getState().go(section, p.id)}
        >
          <span className="ts-ellipsis">{t(p.label)}</span>
          {p.id === "people" && people > 0 ? <span className="cn-parts__count">{people}</span> : null}
          {p.arrives ? <span className="cn-parts__soon">{p.arrives}</span> : null}
        </button>
      ))}
    </nav>
  );
}
