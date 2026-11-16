import { useEffect, useState } from "react";
import { useLang, useT } from "@theatre-suite/core";
import { Button } from "@theatre-suite/ui";
import { StageSizeFields } from "../common/StageSizeFields";
import { setStage } from "../model/ops";
import { fmtNum } from "../lib/format";
import { useDoc } from "../store/doc";
import { useUi } from "../store/ui";
import { AddDialog } from "./setup/AddDialog";
import { AddressMap } from "./setup/AddressMap";
import { LightsList } from "./setup/LightsList";
import { NumberingBar } from "./setup/NumberingBar";
import { Properties } from "./setup/Properties";
import { useSelectedIds } from "./setup/common";
import { numberClick } from "./setup/LightsList";
import { useSetup } from "./setup/store";
import "./setup/setup.css";

export { trussName } from "./setup/common";

/**
 * Allestimento: the list of lights (left), the address map (centre, until the 3D stage arrives) and the properties
 * of the selection (right). Everything edits the document through the store (undo/redo, "changed" mark).
 */
export function SetupMode() {
  const t = useT();
  const doc = useDoc((s) => s.doc)!;
  const selected = useSelectedIds();
  const addOpen = useSetup((s) => s.addOpen);
  const numbering = useSetup((s) => s.numbering);

  // Leaving Allestimento (or opening another show) ends what was in progress.
  useEffect(
    () => () => {
      const s = useSetup.getState();
      s.setNumbering(null);
      s.setNumberingAsk(false);
      s.setAddOpen(false);
      s.setRenaming(null);
    },
    [],
  );

  return (
    <div className="gv-setup gv-su">
      <LightsList />
      <main className="gv-su-centre">
        <StageLine />
        <AddressMap
          doc={doc}
          selected={selected}
          onSelect={(id, e) => {
            if (numbering) return numberClick(t, id);
            const ui = useUi.getState();
            if (e.ctrlKey || e.metaKey) ui.setSelection(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id], id, id);
            else ui.setSelection([id], id, id);
          }}
        />
        <p className="gv-su-centre__note">{t("The stage in 3D arrives with the next version. Until then, the map shows which channels each light uses.")}</p>
        <NumberingBar />
      </main>
      <Properties />
      {addOpen ? <AddDialog /> : null}
    </div>
  );
}

/** The size of the stage, with a discreet way to change it after creation. */
function StageLine() {
  const t = useT();
  const lang = useLang();
  const doc = useDoc((s) => s.doc)!;
  const [open, setOpen] = useState(false);
  const n = (v: number) => fmtNum(v, lang);
  return (
    <section className="gv-su-stage" aria-label={t("Stage")}>
      <div className="gv-su-stage__row">
        <span className="ts-label">{t("Stage")}</span>
        <span className="gv-su-stage__size" title={t("width × depth × height")}>
          {n(doc.stage.width)} × {n(doc.stage.depth)} × {n(doc.stage.height)} m
        </span>
        <span className="gv-su-stage__count">
          <span className="ts-label">{t("Trusses")}</span> {doc.trusses.length}
        </span>
        <span className="gv-su-stage__count" title={doc.scenery.map((x) => x.name || t("Piece")).join(" · ") || undefined}>
          <span className="ts-label">{t("Scenery")}</span> {doc.scenery.length || t("None yet")}
        </span>
        <span className="ts-spacer" />
        <Button variant="ghost" icon="pencil" on={open} aria-expanded={open} title={t("Change size")} onClick={() => setOpen(!open)}>
          <span className="gv-su-stage__btn">{t("Change size")}</span>
        </Button>
      </div>
      {open ? (
        <div className="gv-su-stage__edit">
          <StageSizeFields stage={doc.stage} onChange={(s) => useDoc.getState().change((d) => setStage(d, s), "stage")} />
          <p className="ts-field__hint">{t("The lights stay where they are: check their positions after changing the size.")}</p>
        </div>
      ) : null}
    </section>
  );
}
