import { useT } from "@theatre-suite/core";
import { Button } from "@theatre-suite/ui";
import { useDesk } from "../../store/desk";
import { useDoc } from "../../store/doc";
import { toggleBlind, exitBlindAsk } from "./actions";
import "./desk.css";

/** The Blind button of the top bar (Banco only): blue while Blind is on. */
export function BlindButton() {
  const t = useT();
  const on = useDesk((s) => !!s.blind);
  const empty = useDoc((s) => !s.doc?.memories.length);
  return (
    <Button
      variant="ghost"
      icon="eyeOff"
      on={on}
      className="gv-blindbtn"
      aria-pressed={on}
      disabled={empty && !on}
      title={empty && !on ? t("Blind needs a memory to change") : `${t("Blind: change a memory without touching the stage")} · Ctrl B`}
      onClick={() => void (on ? exitBlindAsk(t) : toggleBlind(t))}
    >
      <span className="gv-bl">{t("Blind")}</span>
    </Button>
  );
}

/** The band shown while Blind is on. */
export function BlindBand() {
  const t = useT();
  const doc = useDoc((s) => s.doc)!;
  const blind = useDesk((s) => s.blind);
  const liveId = useDesk((s) => s.liveMemoryId);
  if (!blind) return null;
  const mem = doc.memories.find((m) => m.id === blind.memoryId);
  const live = doc.memories.find((m) => m.id === liveId);
  return (
    <div className="gv-blindband" role="status">
      <strong>BLIND</strong>
      <span className="gv-blindband__text ts-ellipsis">
        {live
          ? t("You are changing memory {n}. The stage does not change: memory {m} stays on stage.", { n: mem?.number ?? "", m: live.number })
          : t("You are changing memory {n}. The stage does not change: the lights stay as they are.", { n: mem?.number ?? "" })}
      </span>
      <span className="ts-spacer" />
      <Button variant="sm" icon="x" onClick={() => void exitBlindAsk(t)}>
        {t("Leave Blind")} · Esc
      </Button>
    </div>
  );
}
