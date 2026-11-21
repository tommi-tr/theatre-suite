import { useEffect } from "react";
import { useT } from "@theatre-suite/core";
import { useDesk } from "../store/desk";
import { BlindBand } from "./desk/BlindButton";
import { ColorPicker } from "./desk/ColorPicker";
import { DeskFaders } from "./desk/DeskFaders";
import { DeskStage } from "./desk/DeskStage";
import { MemoryList, OnStageBox } from "./desk/MemoryPanel";
import { exitBlindAsk, toggleBlind } from "./desk/actions";
import { isTyping, questionOpen } from "./desk/parts";
import { ShowBands } from "./show/ShowBars";
import "./desk/desk.css";
import "./show/show.css";

/**
 * Banco, the virtual desk: the stage from the front (top), a card per light with a fader per channel, groups and
 * Grand Master (bottom), and on the right the memory on stage, the colour picker and the memory list.
 * The state lives in `store/desk.ts`; the output is sent from there. Blind: Ctrl B; Esc leaves it.
 */
export function DeskMode() {
  const t = useT();
  const blind = useDesk((s) => !!s.blind);

  // The desk owns the output while the show is open: from now on the faders are what the lights do.
  useEffect(() => {
    useDesk.getState().activate();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (questionOpen()) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        void toggleBlind(t);
      } else if (e.key === "Escape" && !isTyping(e.target) && useDesk.getState().blind) {
        e.preventDefault();
        void exitBlindAsk(t);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [t]);

  return (
    <div className="gv-desk" data-blind={blind ? "" : undefined}>
      <main className="gv-desk__main">
        <BlindBand />
        <ShowBands where="desk" />
        <DeskStage />
        <DeskFaders density="extended" editable />
      </main>
      <aside className="gv-desk__side" aria-label={t("Memories")}>
        <OnStageBox />
        <ColorPicker />
        <MemoryList />
      </aside>
    </div>
  );
}
