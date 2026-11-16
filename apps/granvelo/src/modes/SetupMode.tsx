import { useEffect, useState } from "react";
import { useLang, useT } from "@theatre-suite/core";
import { Button, Segmented } from "@theatre-suite/ui";
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
import { SceneryPanel } from "./setup/SceneryPanel";
import { StagePanel } from "./setup/StagePanel";
import { useSelectedIds } from "./setup/common";
import { numberClick } from "./setup/LightsList";
import { useSetup, type SetupCentre } from "./setup/store";
import "./setup/setup.css";

export { trussName } from "./setup/common";

/**
 * Allestimento: the list of lights (left), the stage with its tools or the map of the DMX addresses (centre) and the
 * properties of the selection, or of the scenery with the "Scenografia" tool (right). Everything edits the document through the store (undo/redo, "changed" mark).
 */
export function SetupMode() {
  const t = useT();
  const doc = useDoc((s) => s.doc)!;
  const selected = useSelectedIds();
  const addOpen = useSetup((s) => s.addOpen);
  const numbering = useSetup((s) => s.numbering);
  const centre = useSetup((s) => s.centre);
  const tool = useSetup((s) => s.tool);

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
      <main className={`gv-su-centre${centre === "stage" ? " gv-su-centre--stage" : ""}`}>
        <StageLine />
        {centre === "stage" ? (
          <StagePanel />
        ) : (
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
        )}
        <NumberingBar />
      </main>
      {centre === "stage" && tool === "scenery" ? <SceneryPanel /> : <Properties />}
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
  const centre = useSetup((s) => s.centre);
  const n = (v: number) => fmtNum(v, lang);
  return (
    <section className="gv-su-stage" aria-label={t("Stage")}>
      <div className="gv-su-stage__row">
        <Segmented<SetupCentre>
          ariaLabel={t("What the centre shows")}
          small
          value={centre}
          onChange={(v) => useSetup.getState().setCentre(v)}
          options={[
            { value: "stage", label: t("Stage") },
            { value: "map", label: t("Address map") },
          ]}
        />
        <span className="gv-su-stage__size" title={t("width × depth × height")}>
          {n(doc.stage.width)} × {n(doc.stage.depth)} × {n(doc.stage.height)} m
        </span>
        <span className="ts-spacer" />
        <Button variant="ghost" icon="printer" disabled={doc.fixtures.length === 0} title={t("Print the plan and the list of lights")} onClick={() => useUi.getState().openDialog("print")}>
          <span className="gv-su-stage__btn">{t("Print")}</span>
        </Button>
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
