import { useState } from "react";
import { useT } from "@theatre-suite/core";
import { Button, Dialog } from "@theatre-suite/ui";
import { createDoc } from "../lib/files";
import { DEFAULT_STAGE, type Stage } from "../model/types";
import { useUi } from "../store/ui";
import { StageSizeFields } from "./StageSizeFields";

/** "New show": the title and the size of the stage (they can be changed later). */
export function NewShowDialog() {
  const t = useT();
  const [title, setTitle] = useState("");
  const [stage, setStage] = useState<Stage>({ ...DEFAULT_STAGE });
  const close = () => useUi.getState().closeDialog();
  const create = () => {
    createDoc(title, stage);
    close();
  };
  return (
    <Dialog
      title={t("New show")}
      icon="fileAdd"
      width={520}
      onClose={close}
      closeLabel={t("Close")}
      description={t("How big is the stage? Measure the floor where the actors play and the height of the trusses. You can change it later.")}
      footer={
        <>
          <span className="ts-spacer" />
          <Button variant="ghost" onClick={close}>
            {t("Cancel")}
          </Button>
          <Button variant="primary" icon="check" onClick={create}>
            {t("Create the show")}
          </Button>
        </>
      }
    >
      <div className="gv-form">
        <label className="ts-field">
          <span className="ts-label">{t("Title of the show")}</span>
          <input className="ts-input" value={title} maxLength={200} placeholder={t("For example: La locandiera")} onChange={(e) => setTitle(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
        </label>
        <div className="ts-field">
          <span className="ts-label">{t("Stage (metres)")}</span>
          <StageSizeFields stage={stage} onChange={setStage} />
          <span className="ts-field__hint">{t("Width from left to right seen from the audience, depth from the front edge to the back wall, height up to the trusses.")}</span>
        </div>
      </div>
    </Dialog>
  );
}
