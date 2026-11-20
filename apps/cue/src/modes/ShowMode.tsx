import { useEffect } from "react";
import { ScriptStage } from "../script/ScriptStage";
import { ShowBands } from "../show/ShowParts";
import { useShowKeys } from "../show/useShowKeys";
import { ensureDmx } from "../store/outputs";
import { followStandby } from "../script/follow";
import { useScriptView } from "../script/view";

/**
 * Show: the one screen to look at during the performance. Bands (emergency, cable unplugged, Blackout), the script
 * with the timeline, the link panel (0.4). The keys of the evening work here (show/useShowKeys.ts); the bottom bar is
 * the Shell's status bar (show/ShowParts.tsx `ShowStatusLine`).
 */
export function ShowMode() {
  useShowKeys();
  useEffect(() => {
    void ensureDmx();
  }, []);
  // Entering the Show: the script goes to the standby GO as soon as the pages are laid out.
  const ready = useScriptView((s) => !!s.geometry);
  useEffect(() => {
    if (ready) requestAnimationFrame(() => followStandby(true));
  }, [ready]);
  return (
    <div className="cue-show">
      <ShowBands />
      <ScriptStage mode="show" />
    </div>
  );
}
