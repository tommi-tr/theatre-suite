import { useT } from "@theatre-suite/core";
import { Kbd } from "@theatre-suite/ui";
import type { SectionId } from "../model/types";
import { useUi } from "../store/ui";
import { ComingSoon } from "../sections/ComingSoon";
import { People, PeopleActions, PeopleStatus } from "../sections/People";
import { partDef } from "./sections";

/** The open part of a section. */
export function PartView({ section }: { section: SectionId }) {
  const partId = useUi((s) => s.parts[section]);
  const part = partDef(section, partId);
  if (part.id === "people") return <People />;
  return <ComingSoon section={section} part={part} />;
}

/** Actions of the open part, on the right of the section bar. */
export function PartActions({ section }: { section: SectionId }) {
  const partId = useUi((s) => s.parts[section]);
  if (partDef(section, partId).id === "people") return <PeopleActions />;
  return null;
}

/** Summary of the open part and its main shortcut, in the status bar. */
export function PartStatus() {
  const t = useT();
  const section = useUi((s) => s.section);
  const partId = useUi((s) => (s.section ? s.parts[s.section] : null));
  if (!section || !partId) {
    return (
      <>
        <span>{t("New file: choose where to start")}</span>
        <span className="ts-spacer" />
        <span>
          <Kbd>Ctrl O</Kbd> {t("open a file")}
        </span>
      </>
    );
  }
  const part = partDef(section, partId);
  if (part.id === "people") return <PeopleStatus />;
  return (
    <>
      <span>{t("{part}: coming in Cantinella {v}", { part: t(part.label), v: part.arrives ?? "" })}</span>
      <span className="ts-spacer" />
      <span>
        <Kbd>Ctrl 1–5</Kbd> {t("sections")}
      </span>
    </>
  );
}
