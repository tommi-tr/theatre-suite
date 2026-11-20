import { useT } from "@theatre-suite/core";
import { ComingSoon } from "../common/ComingSoon";

/** Controlli: one card per output and the checklist "Prima del sipario" (0.6). */
export function ControlsMode() {
  const t = useT();
  return (
    <div className="cue-mode">
      <div className="cue-mode__inner">
        <ComingSoon
          icon="trafficLight"
          version="0.6"
          title={t("Checks before the curtain")}
          about={[
            t("One card per output (audio, DMX lights, projector, secondary, PowerPoint, pedal) with its state in words and a test button."),
            t("On the right the checklist before the curtain, with suggested items and your own, saved in the file."),
            t("Every tick goes into the log of the evening."),
          ]}
        />
      </div>
    </div>
  );
}
