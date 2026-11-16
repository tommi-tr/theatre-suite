import { useLang, useT } from "@theatre-suite/core";
import { Button, HoldButton, Icon, Kbd, Segmented } from "@theatre-suite/ui";
import { fmtNum } from "../../lib/format";
import { sequenceMemories } from "../../model/sequence";
import { useDesk } from "../../store/desk";
import { useDoc } from "../../store/doc";
import { isSending, useOutput } from "../../store/output";
import { useSettings, type ShowDesk } from "../../store/settings";
import { useShow } from "../../store/show";
import { useUi } from "../../store/ui";
import { clock, useNow } from "./Nastro";
import { back, blackout, emergency, fadeToBlack, go, leaveEmergency, lockedSays, pause, showBlind, toggleLock } from "./actions";

/** A button of the Show that never keeps the keyboard focus (Space is GO, it must not "click" it again). */
const noFocus = (e: React.MouseEvent) => e.preventDefault();

/** GO, Indietro, Pausa and the key reminder; on the right, what the output is doing. */
export function GoBar() {
  const t = useT();
  const st = useShow((s) => s.show);
  const status = useOutput((s) => s.status);
  const browser = useOutput((s) => s.browser);
  const empty = useDoc((s) => !s.doc || sequenceMemories(s.doc).length === 0);
  const paused = st.fade?.pausedAt != null;
  const sending = isSending(status);
  const lost = status.link.state === "lost";
  return (
    <div className="gv-gobar">
      <button type="button" className="gv-go" onMouseDown={noFocus} disabled={empty || !!st.emergency} onClick={() => go(t)} title={`GO · ${t("Space")}`}>
        <span className="gv-go__label">GO</span>
        <span className="gv-go__key">{t("Space")}</span>
      </button>
      <div className="gv-gobar__side">
        <Button icon="prevF" onMouseDown={noFocus} disabled={empty || !!st.emergency} onClick={() => back(t)} title={`${t("Back to the memory before")} · Backspace`}>
          {t("Back")}
        </Button>
        <Button icon={paused ? "playF" : "pauseF"} on={paused} onMouseDown={noFocus} disabled={!st.fade} onClick={() => pause(t)} title={`${paused ? t("Go on with the transition") : t("Stop the transition where it is")} · P`}>
          {paused ? t("Go on") : t("Pause")}
        </Button>
      </div>
      <span className="gv-keys gv-gobar__keys">
        <Kbd>{t("Space")}</Kbd> GO · <Kbd>Backspace</Kbd> {t("Back")} · <Kbd>P</Kbd> {t("Pause")}
      </span>
      <span className="ts-spacer" />
      {!sending ? (
        <span className="gv-gobar__out gv-gobar__out--warn" role="status">
          <Icon name="alert" size={14} />
          {lost ? t("The cable is unplugged: the lights do not change. Granvelo keeps trying to reconnect.") : t("The output is not connected: GO works, but the lights do not change. Press “Connect” at the top left.")}
        </span>
      ) : status.link.state === "simulated" ? (
        <span className="gv-gobar__out" role="status">
          <Icon name="monitor" size={14} />
          {browser ? t("Simulated output: nothing goes to real lights.") : t("Simulated output: no cable is used.")}
        </span>
      ) : null}
    </div>
  );
}

/** The selector of the desk under the Show, on its own row (it never covers the faders). */
export function DeskBar() {
  const t = useT();
  const value = useSettings((s) => s.settings.showDesk);
  const hint: Record<ShowDesk, string> = {
    none: t("The desk is hidden."),
    mini: t("Groups and Grand Master only."),
    compact: t("One fader per light (its intensity)."),
    extended: t("Every channel of every light."),
  };
  return (
    <div className="gv-deskbar">
      <span className="gv-deskbar__label">{t("Desk")}</span>
      <Segmented<ShowDesk>
        ariaLabel={t("Desk")}
        value={value}
        onChange={(showDesk) => useSettings.getState().update({ showDesk })}
        options={[
          { value: "none", label: t("None (desk)") },
          { value: "mini", label: t("Mini") },
          { value: "compact", label: t("Compact") },
          { value: "extended", label: t("Extended") },
        ]}
      />
      <span className="gv-deskbar__hint ts-ellipsis">{hint[value]}</span>
    </div>
  );
}

/**
 * Red band while the emergency is on, amber while Blackout or Fade to black hold the stage dark. Also in Banco
 * (`where="desk"`), where B and F do nothing: there the band says where the darkness comes from and gives a button.
 */
export function ShowBands({ where = "show" }: { where?: "show" | "desk" }) {
  const t = useT();
  const lang = useLang();
  const st = useShow((s) => s.show);
  const ftbSeconds = useSettings((s) => s.settings.ftbSeconds);
  if (st.emergency)
    return (
      <div className="gv-showband gv-showband--stop" role="alert">
        <Icon name="emergency" size={16} />
        <strong>{t("EMERGENCY")}</strong>
        <span className="ts-ellipsis">{t("The emergency lights are on. GO, Back, Blackout and Fade to black wait.")}</span>
        <span className="ts-spacer" />
        <Button variant="sm" icon="reset" onMouseDown={noFocus} onClick={() => leaveEmergency(t)}>
          {t("Back to the show")}
        </Button>
      </div>
    );
  if (st.blackout || st.ftb)
    return (
      <div className="gv-showband gv-showband--warn" role="status">
        <Icon name={st.blackout ? "blackout" : "ftb"} size={16} />
        <strong>{st.blackout ? "BLACKOUT" : "FADE TO BLACK"}</strong>
        <span className="ts-ellipsis">
          {where === "desk"
            ? t("The stage is dark because of the Show: the faders change the lights underneath, but nothing is seen.")
            : st.blackout
              ? t("The stage is dark. GO still works underneath. Press B to bring the lights back.")
              : t("The stage goes dark in {s} s. Press F to bring the lights back.", { s: fmtNum(ftbSeconds, lang, 1) })}
        </span>
        <span className="ts-spacer" />
        <Button variant="sm" icon="bulb" onMouseDown={noFocus} onClick={() => (st.blackout ? blackout(t) : fadeToBlack(t))}>
          {t("Bring the lights back")}
        </Button>
      </div>
    );
  return null;
}

/** Bottom bar: where we are in the sequence, how long the evening has run, and the three commands always in the same place. */
export function ShowFooter() {
  const t = useT();
  const lang = useLang();
  const doc = useDoc((s) => s.doc)!;
  const st = useShow((s) => s.show);
  const ftbSeconds = useSettings((s) => s.settings.ftbSeconds);
  const now = useNow(500);
  const seq = sequenceMemories(doc);
  const i = st.liveId ? seq.findIndex((m) => m.id === st.liveId) : -1;
  const armed = st.armedAt !== null;
  return (
    <div className="gv-showfoot">
      <span className="gv-showfoot__where">{i >= 0 ? t("Memory {n} of {m}", { n: i + 1, m: seq.length }) : seq.length ? t("{m} memories in the sequence", { m: seq.length }) : t("The sequence is empty.")}</span>
      <span className="gv-showfoot__time">
        <Icon name="history" size={13} />
        {st.startedAt !== null ? t("Evening {time}", { time: clock(now - st.startedAt) }) : t("The evening starts at the first GO")}
      </span>
      <span className="ts-spacer" />
      <button type="button" className="gv-cmd" data-on={st.blackout ? "" : undefined} onMouseDown={noFocus} onClick={() => blackout(t)} disabled={!!st.emergency} title={t("Everything dark at once; press again to bring it back")}>
        <Icon name="blackout" size={14} />
        {st.blackout ? t("Blackout on") : "Blackout"}
        <Kbd>B</Kbd>
      </button>
      <button type="button" className="gv-cmd" data-on={st.ftb ? "" : undefined} onMouseDown={noFocus} onClick={() => fadeToBlack(t)} disabled={!!st.emergency} title={t("Down to dark in the time shown; press again to come back (time in the Settings → Memories)")}>
        <Icon name="ftb" size={14} />
        {st.ftb ? t("Dark") : "Fade to black"} · {fmtNum(ftbSeconds, lang, 1)} s
        <Kbd>F</Kbd>
      </button>
      <button
        type="button"
        className="gv-cmd gv-cmd--stop"
        data-armed={armed ? "" : undefined}
        data-on={st.emergency ? "" : undefined}
        onMouseDown={noFocus}
        onClick={() => (st.emergency ? leaveEmergency(t) : emergency(t))}
        title={st.emergency ? t("Back to the show") : t("Press twice: all the lights white at full (or the memory chosen in the Settings)")}
      >
        <Icon name="emergency" size={14} />
        {st.emergency ? t("Emergency on") : armed ? t("Press E again") : t("Emergency")}
        <Kbd>E E</Kbd>
      </button>
    </div>
  );
}

/** The commands of the Show in the top bar: sequence, light check, Blind, Lock (Lock last). */
export function ShowTools() {
  const t = useT();
  const locked = useShow((s) => s.locked);
  const blind = useDesk((s) => !!s.blind);
  const empty = useDoc((s) => !s.doc?.memories.length);
  return (
    <>
      {/* Locked, the hold-to-unlock button needs the room: the blocked commands become icons. */}
      <Button variant="ghost" icon="listNum" disabled={locked} aria-label={t("Sequence")} title={t("Order of the memories and their transitions")} onClick={() => !lockedSays(t) && useUi.getState().openSequence()}>
        {locked ? null : <span className="gv-bl">{t("Sequence")}</span>}
      </Button>
      <Button
        variant="ghost"
        iconOnly
        icon="bulb"
        disabled={locked}
        aria-label={t("Light check")}
        title={t("Light check: turn on the lights one at a time and note the ones that do not work")}
        onClick={() => !lockedSays(t) && useUi.getState().openDialog("check")}
      />
      <Button
        variant="ghost"
        icon="eyeOff"
        on={blind}
        className="gv-blindbtn"
        aria-pressed={blind}
        disabled={locked || (empty && !blind)}
        title={`${t("Blind: change a memory without touching the stage")} · Ctrl B`}
        aria-label={t("Blind")}
        onClick={() => void showBlind(t)}
      >
        {locked ? null : <span className="gv-bl">{t("Blind")}</span>}
      </Button>
      {locked ? (
        <HoldButton className="ts-btn ts-btn--primary gv-lockbtn" onHold={toggleLock} ariaLabel={t("Hold to unlock")}>
          <Icon name="lock" size={15} />
          {t("Locked")}
          <span className="gv-lockbtn__hint">· {t("hold to unlock")}</span>
        </HoldButton>
      ) : (
        <Button icon="unlock" onClick={toggleLock} title={`${t("Lock: only GO, Back, Pause, Blackout, Fade to black and Emergency work")} · Ctrl L`}>
          {t("Lock")}
        </Button>
      )}
    </>
  );
}
