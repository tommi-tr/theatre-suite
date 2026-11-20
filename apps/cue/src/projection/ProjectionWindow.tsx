import { useEffect, useState } from "react";
import { BLACK_OUT, type OutState } from "../model/projection";
import { emitEvent, onEvent } from "../lib/api";
import { ProjectionScreen } from "./ProjectionScreen";

/** The content of the output window (`index.html?projection=1`): it draws the state Cue sends and nothing else. */
export function ProjectionWindow() {
  const [state, setState] = useState<OutState>(BLACK_OUT);
  useEffect(() => {
    document.documentElement.classList.add("proj-window");
    document.title = "Cue · Uscita";
    let off: (() => void) | undefined;
    let gone = false;
    void onEvent<OutState>("proj:state", setState).then((u) => {
      if (gone) u();
      else {
        off = u;
        void emitEvent("proj:ready");
      }
    });
    // A window that was resized (a preview window): the test pattern shows its size again.
    const onResize = () => setState((s) => ({ ...s }));
    window.addEventListener("resize", onResize);
    return () => {
      gone = true;
      off?.();
      window.removeEventListener("resize", onResize);
    };
  }, []);
  return <ProjectionScreen state={state} />;
}
