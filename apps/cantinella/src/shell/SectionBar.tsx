import { useT } from "@theatre-suite/core";
import { Segmented } from "@theatre-suite/ui";
import type { SectionId } from "../model/types";
import { useUi } from "../store/ui";
import { SECTIONS } from "./sections";
import { PartActions } from "./PartView";

/** The five sections in the middle (simbolo + etichetta), the actions of the open part on the right. */
export function SectionBar() {
  const t = useT();
  const section = useUi((s) => s.section);
  return (
    <div className="cn-sectionbar">
      <div className="cn-sectionbar__side" />
      <Segmented<SectionId | "">
        ariaLabel={t("Sections")}
        value={section ?? ""}
        onChange={(v) => v && useUi.getState().go(v)}
        options={SECTIONS.map((s) => ({ value: s.id, label: t(s.label), icon: s.icon }))}
      />
      <div className="cn-sectionbar__side cn-sectionbar__side--end">{section ? <PartActions section={section} /> : null}</div>
    </div>
  );
}
