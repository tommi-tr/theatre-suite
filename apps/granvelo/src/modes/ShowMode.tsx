import { useEffect } from "react";
import { useT } from "@theatre-suite/core";
import { useDesk } from "../store/desk";
import { useSettings } from "../store/settings";
import { useShow } from "../store/show";
import { useUi } from "../store/ui";
import { BlindBand } from "./desk/BlindButton";
import { DeskFaders } from "./desk/DeskFaders";
import { exitBlindAsk } from "./desk/actions";
import { isTyping, questionOpen } from "./desk/parts";
import { Nastro } from "./show/Nastro";
import { DeskBar, GoBar, ShowBands, ShowFooter } from "./show/ShowBars";
import { back, blackout, emergency, fadeToBlack, go, pause, showBlind, toggleLock } from "./show/actions";
import "./desk/desk.css";
import "./show/show.css";

/**
 * Show: the evening, memory after memory. The strip ("Nastro") on top, GO / Indietro / Pausa, the desk (No · Mini ·
 * Compatto · Esteso) and the bottom bar with Blackout, Fade to black and Emergenza. The logic is in `model/show.ts`
 * (pure) and `store/show.ts`; the keys are listed in docs/granvelo/README.md ("Shortcuts").
 */
export function ShowMode() {
  const t = useT();
  const blind = useDesk((s) => !!s.blind);
  const density = useSettings((s) => s.settings.showDesk);
  const locked = useShow((s) => s.locked);
  const emergencyOn = useShow((s) => !!s.show.emergency);

  // The desk owns the faders here too; if the Banco put a memory of the sequence on stage, the Show carries on from it.
  useEffect(() => {
    useDesk.getState().activate();
    const live = useDesk.getState().liveMemoryId;
    if (live) useShow.getState().dispatch({ type: "onStage", id: live });
  }, []);

  useShowKeys();

  return (
    <div className="gv-show" data-blind={blind ? "" : undefined} data-locked={locked ? "" : undefined}>
      <BlindBand />
      <ShowBands />
      <Nastro />
      <GoBar />
      <DeskBar />
      {density !== "none" ? (
        <div className="gv-show__desk">
          <DeskFaders density={density} disabled={locked || emergencyOn} />
        </div>
      ) : (
        <div className="gv-show__nodesk">
          <p className="gv-empty">{t("The desk is hidden: choose Mini, Compact or Extended to see the faders.")}</p>
        </div>
      )}
      <ShowFooter />
    </div>
  );
}

/**
 * The keys of the Show (capture phase, so a focused control never sees them): Space GO, Backspace Indietro, P Pausa,
 * B Blackout, F Fade to black, E E Emergenza, Ctrl B Blind, Ctrl L Lock (exactly: Ctrl Shift L is "back to the
 * launcher"), Esc leaves Blind. Nothing fires while typing in a field, with a dialog or a question open, or held down.
 */
function useShowKeys() {
  const t = useT();
  useEffect(() => {
    const ours = (e: KeyboardEvent) => !useUi.getState().dialog && !questionOpen() && !isTyping(e.target);
    const plain = (e: KeyboardEvent) => !e.ctrlKey && !e.metaKey && !e.altKey;
    const onKey = (e: KeyboardEvent) => {
      if (!ours(e)) return;
      const k = e.code;
      if (plain(e) && (k === "Space" || e.key === " ")) {
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) go(t);
        return;
      }
      if (plain(e) && !e.shiftKey && e.key === "Backspace") {
        e.preventDefault();
        if (!e.repeat) back(t);
        return;
      }
      if (plain(e) && !e.shiftKey && (k === "KeyP" || k === "KeyB" || k === "KeyF" || k === "KeyE")) {
        e.preventDefault();
        if (e.repeat) return;
        if (k === "KeyP") pause(t);
        else if (k === "KeyB") blackout(t);
        else if (k === "KeyF") fadeToBlack(t);
        else emergency(t);
        return;
      }
      const ctrl = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey;
      if (ctrl && k === "KeyL") {
        e.preventDefault();
        if (!e.repeat) toggleLock();
        return;
      }
      if (ctrl && k === "KeyB") {
        e.preventDefault();
        if (!e.repeat) void showBlind(t);
        return;
      }
      if (e.key === "Escape" && useDesk.getState().blind) {
        e.preventDefault();
        void exitBlindAsk(t);
      }
    };
    // A focused button must not be "clicked" by the Space bar (that would be a second GO).
    const onKeyUp = (e: KeyboardEvent) => {
      if (ours(e) && (e.code === "Space" || e.key === " ")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKeyUp, true);
    };
  }, [t]);
}
