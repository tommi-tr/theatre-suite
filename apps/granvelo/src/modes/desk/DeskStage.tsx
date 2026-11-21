import { useMemo, useState } from "react";
import { useT } from "@theatre-suite/core";
import { shownUniverse } from "../../model/desk";
import { useDesk } from "../../store/desk";
import { useDoc } from "../../store/doc";
import { useStageDetail } from "../../store/previewDetail";
import { useUi } from "../../store/ui";
import { StageView, StageView2D, type OnStagePress } from "../../stage";
import { selectLight } from "./DeskFaders";
import { scrollCardIntoView } from "./parts";

/**
 * The stage seen from the audience, fed with the desk (pools and lens colours follow the faders, groups and Grand Master).
 * In Blind it shows the memory being edited with a blue border ("only you see it") and, in a small green inset, what is
 * really on stage. A click on a light selects it and brings its card into view (Shift adds).
 */
export function DeskStage() {
  const t = useT();
  const doc = useDoc((s) => s.doc)!;
  const values = useDesk((s) => s.values);
  const blind = useDesk((s) => s.blind);
  const gm = useDesk((s) => s.grandMaster);
  const selection = useUi((s) => s.selection);
  const detail = useStageDetail();
  const [, setNo3D] = useState(false);
  const shown = useMemo(() => shownUniverse(doc, blind ? blind.values : values, gm), [doc.fixtures, doc.groups, blind ? blind.values : values, gm]);
  const real = useMemo(() => (blind ? shownUniverse(doc, values, gm) : null), [doc.fixtures, doc.groups, values, gm, !!blind]);
  const live = useDesk((s) => s.liveMemoryId);
  const liveMemory = doc.memories.find((m) => m.id === live);
  const blindMemory = blind ? doc.memories.find((m) => m.id === blind.memoryId) : null;
  const onPress: OnStagePress = (hit, info) => {
    if (hit.kind === "light") {
      selectLight(hit.id, info.shift || info.ctrl ? "add" : "one");
      scrollCardIntoView(hit.id);
    }
    return null;
  };
  const stageDoc = useMemo(() => ({ stage: doc.stage, trusses: doc.trusses, fixtures: doc.fixtures, scenery: doc.scenery }), [doc.stage, doc.trusses, doc.fixtures, doc.scenery]);
  return (
    <div className="gv-dstage" data-blind={blind ? "" : undefined}>
      <StageView
        doc={stageDoc}
        camera="front"
        margin={0.3}
        values={shown}
        selected={selection}
        scenery={(blindMemory ?? liveMemory)?.scenery ?? "all"}
        detail={detail}
        pick={{ lights: true }}
        onPress={onPress}
        onNo3D={() => setNo3D(true)}
        className="gv-dstage__view"
        label={t("Stage seen from the audience")}
      />
      {blind && real ? (
        <>
          <span className="gv-dstage__badge">{t("BLIND · only you can see this")}</span>
          <div className="gv-dstage__inset" aria-label={t("What is really on stage")}>
            <StageView2D doc={stageDoc} view="front" margin={0.3} values={real} scenery={liveMemory?.scenery ?? "all"} compact />
            <span className="gv-dstage__insetlabel">{t("On stage")}</span>
          </div>
        </>
      ) : null}
    </div>
  );
}
