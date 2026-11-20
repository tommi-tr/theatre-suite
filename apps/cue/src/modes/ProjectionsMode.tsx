import { useT } from "@theatre-suite/core";
import { ComingSoon } from "../common/ComingSoon";

/** Proiezioni: sequence, output preview and retouch (0.5). */
export function ProjectionsMode() {
  const t = useT();
  return (
    <div className="cue-mode">
      <div className="cue-mode__inner">
        <ComingSoon
          icon="image"
          version="0.5"
          title={t("Projections")}
          about={[
            t("The sequence of images and videos on the left, with the transition written between one and the next."),
            t("In the centre the preview of what is on the output screen and of what comes next."),
            t("On the right the retouch: transition, brightness, contrast, temperature, saturation."),
            t("Blank image (black or your own) and PowerPoint, imported or driven live."),
          ]}
        >
          {t("Meanwhile keep images and videos in the show folder: videos stay outside the file, linked by their path.")}
        </ComingSoon>
      </div>
    </div>
  );
}
