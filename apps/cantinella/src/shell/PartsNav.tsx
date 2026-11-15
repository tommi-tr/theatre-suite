import { useMemo } from "react";
import { useT } from "@theatre-suite/core";
import { dueTodos } from "../model/departments";
import { todayKey } from "../model/rehearsals";
import type { SectionId } from "../model/types";
import { useDoc } from "../store/doc";
import { useUi } from "../store/ui";
import { useAvailability } from "../sections/useAvailability";
import { sectionDef } from "./sections";

/** The parts of the open section, in a narrow column on the left. */
export function PartsNav({ section }: { section: SectionId }) {
  const t = useT();
  const def = sectionDef(section);
  const current = useUi((s) => s.parts[section]);
  const people = useDoc((s) => s.data.people.length);
  const dates = useDoc((s) => s.data.rehearsals.dates.length);
  const { miss } = useAvailability();
  const depts = useDoc((s) => s.data.departments);
  const due = useMemo(() => dueTodos(depts, todayKey()), [depts]);
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
          {p.id === "dates" && dates > 0 ? <span className="cn-parts__count">{dates}</span> : null}
          {p.id === "availability" && miss.people.length > 0 ? (
            <span className="cn-parts__count cn-parts__count--warn" title={t("{n} still to answer", { n: miss.people.length })}>
              {miss.people.length}
            </span>
          ) : null}
          {p.id === "departments" && due.overdue.length > 0 ? (
            <span className="cn-parts__count cn-parts__count--stop" title={t("{n} overdue", { n: due.overdue.length })}>
              {due.overdue.length}
            </span>
          ) : p.id === "departments" && due.week.length > 0 ? (
            <span className="cn-parts__count cn-parts__count--warn" title={t("{n} due soon", { n: due.week.length })}>
              {due.week.length}
            </span>
          ) : null}
          {p.arrives ? <span className="cn-parts__soon">{p.arrives}</span> : null}
        </button>
      ))}
      {section === "departments" && (due.overdue.length || due.week.length) ? (
        <div className="cn-parts__alerts">
          {due.overdue.length ? <span className="cx-tone--stop">{due.overdue.length === 1 ? t("1 overdue") : t("{n} overdue", { n: due.overdue.length })}</span> : null}
          {due.week.length ? <span className="cx-tone--warn">{t("{n} due soon", { n: due.week.length })}</span> : null}
        </div>
      ) : null}
    </nav>
  );
}
