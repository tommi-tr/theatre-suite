import { useT } from "@theatre-suite/core";
import type { Stage } from "../model/types";
import { DecimalInput } from "./DecimalInput";

/** Width × depth × height of the stage, in metres (new show; later also in Allestimento). */
export function StageSizeFields({ stage, onChange }: { stage: Stage; onChange: (s: Stage) => void }) {
  const t = useT();
  return (
    <div className="gv-stagesize">
      <label className="gv-stagesize__f">
        <span className="ts-label">{t("Width")}</span>
        <DecimalInput value={stage.width} min={1} max={200} label={t("Width of the stage")} unit="m" onChange={(width) => onChange({ ...stage, width })} />
      </label>
      <span className="gv-stagesize__x" aria-hidden="true">
        ×
      </span>
      <label className="gv-stagesize__f">
        <span className="ts-label">{t("Depth")}</span>
        <DecimalInput value={stage.depth} min={1} max={200} label={t("Depth of the stage")} unit="m" onChange={(depth) => onChange({ ...stage, depth })} />
      </label>
      <span className="gv-stagesize__x" aria-hidden="true">
        ×
      </span>
      <label className="gv-stagesize__f">
        <span className="ts-label">{t("Height")}</span>
        <DecimalInput value={stage.height} min={1} max={100} label={t("Height of the stage")} unit="m" onChange={(height) => onChange({ ...stage, height })} />
      </label>
    </div>
  );
}
