import { useEffect } from "react";
import { chordFromEvent, matchAction } from "../model/keys";
import { GoPanel } from "../prepare/GoPanel";
import { LibraryPanel, placeHere } from "../prepare/LibraryPanel";
import { ScriptStage } from "../script/ScriptStage";
import { isTyping } from "../show/useShowKeys";
import { useSettings } from "../store/settings";
import { useUi } from "../store/ui";

/**
 * Prepara: libraries on the left, the script with its notes and the timeline of the GOs in the centre, the selected
 * GO on the right. Same layout as Show. N ("Nuovo GO qui") places the selected library item, or an empty GO, at the
 * reading point.
 */
export function PrepareMode() {
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (useUi.getState().dialog || isTyping(e.target) || e.repeat) return;
      const chord = chordFromEvent(e);
      if (!chord || matchAction(useSettings.getState().settings.keymap, chord, "prepare") !== "newGo") return;
      e.preventDefault();
      void placeHere();
    };
    window.addEventListener("keydown", onDown);
    return () => window.removeEventListener("keydown", onDown);
  }, []);
  return <ScriptStage mode="prepare" left={<LibraryPanel />} right={<GoPanel />} />;
}
