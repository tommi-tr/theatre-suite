import { useT } from "@theatre-suite/core";
import { Button, Icon } from "@theatre-suite/ui";
import type { SectionId } from "../model/types";
import { useUi } from "../store/ui";
import { sectionDef, type PartDef } from "../shell/sections";

/** A part that arrives with a later version: what it will do, and what can be prepared now. */
export function ComingSoon({ section, part }: { section: SectionId; part: PartDef }) {
  const t = useT();
  const def = sectionDef(section);
  const usesPeople = section === "rehearsals" || section === "tour" || part.id === "departments" || part.id === "reports";
  return (
    <div className="cn-soonview">
      <div className="cn-soonview__card">
        <span className="cn-soonview__icon">
          <Icon name={def.icon} size={22} />
        </span>
        <span className="cn-soon">{t("Coming in Cantinella {v}", { v: part.arrives ?? "" })}</span>
        <h2>{t(part.label)}</h2>
        <ul>
          {part.about.map((a) => (
            <li key={a}>{t(a)}</li>
          ))}
        </ul>
        {usesPeople ? (
          <div className="cn-soonview__now">
            <p>
              {section === "rehearsals"
                ? t("Meanwhile you can prepare the contacts: names and short names will be used to recognise the replies.")
                : t("Meanwhile you can prepare the contacts of the company.")}
            </p>
            <Button variant="sm" icon="addressBook" onClick={() => useUi.getState().go("departments", "people")}>
              {t("Open the contacts")}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
