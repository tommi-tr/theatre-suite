import { useT } from "@theatre-suite/core";
import { ComingSoon } from "../common/ComingSoon";

/** Show: the one screen to look at during the performance (0.3; primary and secondary 0.4). */
export function ShowMode() {
  const t = useT();
  return (
    <div className="cue-mode">
      <div className="cue-mode__inner cue-mode__inner--two">
        <ComingSoon
          icon="curtain"
          version="0.3"
          title={t("The show")}
          about={[
            t("The script on the left, a dot for every GO and a line to its button."),
            t("Grey GOs are done, green is the last one given, amber is the standby: the next GO starts it."),
            t("The columns Lights, Audio and Video scroll with the script and show what is on stage."),
            t("GO with Space or the pedal; Pause, Blackout, Fade to black and Emergency always at hand."),
          ]}
        />
        <ComingSoon
          icon="users"
          version="0.4"
          compact
          title={t("Two computers, one show")}
          about={[
            t("A secondary computer leads the same show as an equal, over a direct cable."),
            t("The link state is always on screen: a coloured border and panel, with words."),
          ]}
        />
      </div>
    </div>
  );
}
