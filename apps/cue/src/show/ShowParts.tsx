import { useEffect, useState } from "react";
import { useLang, useT } from "@theatre-suite/core";
import { AlertBand, Button, HoldButton, Icon, Kbd, KeyCommand, KeyCommandBar, OutputPill, type OutputPillState } from "@theatre-suite/ui";
import { mainGoCount, numberGos, sortGos } from "../model/gos";
import type { KeyAction } from "../model/keys";
import { actionKeyText } from "./keys";
import { dmxLinkText } from "../lib/dmx";
import { useDoc } from "../store/doc";
import { useOutputs } from "../store/outputs";
import { useSettings } from "../store/settings";
import { useUi } from "../store/ui";
import { FACTOR_STEP, useAutoScroll } from "../script/follow";
import { scriptLive } from "../script/view";
import {
  clockText,
  goName,
  runBlackout,
  runBlank,
  runEmergencyPress,
  runFadeToBlack,
  runLeaveEmergency,
  runningMs,
  runPause,
  runPreset,
  setLocked,
  useRun,
} from "./run";
import "./show.css";

/** A button of the Show that never keeps the keyboard focus (Space is GO: it must not "click" it again). */
const noFocus = (e: React.MouseEvent) => e.preventDefault();

function useKeymap() {
  return useSettings((s) => s.settings.keymap);
}

function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** Bottom bar of the Show: running time and "GO n di N" on the left, the safety commands with their keys on the right. */
export function ShowStatusLine() {
  const t = useT();
  const lang = useLang();
  const gos = useDoc((s) => s.show?.gos ?? []);
  const ftbSeconds = useDoc((s) => s.show?.settings.ftbSeconds ?? 3);
  const run = useRun();
  const keymap = useKeymap();
  const now = useNow(500);
  const pb = run.playback;
  const total = mainGoCount(gos);
  const last = pb.lastGoId ? numberGos(gos).find((n) => n.id === pb.lastGoId) : null;
  const k = (id: KeyAction) => actionKeyText(keymap, id, t("Space")) || undefined;
  const em = pb.emergency;
  return (
    <>
      <span className="cue-showbar__where">
        {run.startedAt !== null ? (
          <>
            {t("Running time")} <span className="mono">{clockText(runningMs(run, now))}</span>
            {run.pausedAt !== null ? <span className="cue-showbar__paused"> · {t("paused")}</span> : null}
          </>
        ) : (
          <span className="ts-muted">{t("Running time starts at the first GO")}</span>
        )}
        <span className="ts-muted"> · </span>
        {last ? (
          <>
            GO <span className="mono">{last.text}</span> {t("of")} <span className="mono">{total}</span>
          </>
        ) : (
          <>
            <span className="mono">{total}</span> GO
          </>
        )}
      </span>
      <OutputPills />
      <span className="ts-spacer" />
      <KeyCommandBar className="cue-showbar__cmds">
        <KeyCommand keys={k("pause")} active={pb.paused} onMouseDown={noFocus} onClick={() => runPause(t)} title={t("Stops light fades and sounds where they are; again to go on")}>
          {pb.paused ? t("Paused") : t("Pause")}
        </KeyCommand>
        <KeyCommand keys={k("preset")} active={run.preset} disabled={em} onMouseDown={noFocus} onClick={() => runPreset(t)} title={t("The preset memory chosen in the settings; again to go back")}>
          {t("Preset")}
        </KeyCommand>
        <KeyCommand keys={k("blank")} active={run.blank} onMouseDown={noFocus} onClick={() => runBlank(t)} title={t("Blank image on the projections (Cue 0.5)")}>
          {t("Blank")}
        </KeyCommand>
        <KeyCommand keys={k("blackout")} active={pb.blackout} disabled={em} onMouseDown={noFocus} onClick={() => runBlackout(t)} title={t("Everything dark at once; press again to bring it back")}>
          {pb.blackout ? t("Blackout on") : "Blackout"}
        </KeyCommand>
        <KeyCommand
          keys={k("fadeToBlack")}
          active={pb.ftb}
          disabled={em}
          onMouseDown={noFocus}
          onClick={() => runFadeToBlack(t)}
          title={t("Down to dark in {s} s; press again to come back", { s: ftbSeconds.toLocaleString(lang === "it" ? "it-IT" : "en-GB") })}
        >
          {pb.ftb ? t("Dark") : "Fade to black"}
        </KeyCommand>
        <KeyCommand
          variant="danger"
          keys={k("emergency")}
          active={em}
          armed={run.emergencyArmedAt !== null}
          onMouseDown={noFocus}
          onClick={() => (em ? runLeaveEmergency(t) : runEmergencyPress(t))}
          title={em ? t("Back to the show") : t("Press twice within a second: emergency lights, every sound out, projections blank")}
        >
          {em ? t("Emergency on") : run.emergencyArmedAt !== null ? t("Press E again") : t("Emergency")}
        </KeyCommand>
      </KeyCommandBar>
    </>
  );
}

/** Luci DMX and Audio: what each output is doing (real or simulated); a click opens Settings → Outputs. */
export function OutputPills() {
  const t = useT();
  const dmx = useOutputs((s) => s.dmx);
  const audio = useOutputs((s) => s.audio);
  const audioSim = useOutputs((s) => s.audioSimulated);
  const open = () => useUi.getState().openSettings("outputs");
  const link = dmx?.link ?? { state: "idle" as const };
  const dmxState: OutputPillState = link.state === "connected" ? "ok" : link.state === "connecting" ? "warn" : link.state === "lost" || link.state === "error" ? "stop" : "idle";
  const audioState: OutputPillState = !audio ? "idle" : audio.engine.error ? "stop" : audio.engine.ready ? (audioSim ? "idle" : "ok") : "warn";
  const audioText = !audio ? t("Not connected") : audio.engine.error ? t("Audio output not available") : audioSim ? t("Simulated output") : audio.engine.device || t("Default output");
  return (
    <span className="cue-showbar__pills">
      <OutputPill state={dmxState} busy={link.state === "connecting"} label={t("DMX lights")} detail={dmxLinkText(t, link)} onClick={open} chevron={false} title={t("Lights output (Settings → Outputs)")} />
      <OutputPill state={audioState} label={t("Audio")} detail={audioText} onClick={open} chevron={false} title={t("Sound output (Settings → Outputs)")} />
    </span>
  );
}

/** Bands over the Show: emergency (red), DMX cable unplugged (red), Blackout / Fade to black holding the stage dark (amber). */
export function ShowBands() {
  const t = useT();
  const pb = useRun((s) => s.playback);
  const lost = useOutputs((s) => s.dmx?.link.state === "lost");
  return (
    <>
      {pb.emergency ? (
        <div className="cue-showband cue-showband--stop" role="alert">
          <Icon name="emergency" size={16} />
          <strong>{t("EMERGENCY")}</strong>
          <span className="ts-ellipsis">{t("Emergency lights on, every sound out. GO, Back, Blackout and Fade to black wait.")}</span>
          <span className="ts-spacer" />
          <Button variant="sm" icon="reset" onMouseDown={noFocus} onClick={() => runLeaveEmergency(t)}>
            {t("Back to the show")}
          </Button>
        </div>
      ) : null}
      {lost ? (
        <AlertBand tone="stop" title={t("DMX cable unplugged.")}>
          {t("The lights stay as they are. Plug the cable back in: Cue reconnects by itself.")}
        </AlertBand>
      ) : null}
      {!pb.emergency && (pb.blackout || pb.ftb) ? (
        <div className="cue-showband cue-showband--warn" role="status">
          <Icon name={pb.blackout ? "blackout" : "ftb"} size={16} />
          <strong>{pb.blackout ? "BLACKOUT" : "FADE TO BLACK"}</strong>
          <span className="ts-ellipsis">{pb.blackout ? t("The stage is dark. GO still works underneath. Press B to bring the lights back.") : t("The stage goes dark. Press F to bring the lights back.")}</span>
        </div>
      ) : null}
    </>
  );
}

/** Lock: a veil over the app that stops clicks; the show keys still work; unlock by holding (or Ctrl L). */
export function LockVeil() {
  const t = useT();
  const locked = useRun((s) => s.locked);
  const keymap = useKeymap();
  if (!locked) return null;
  const ids: KeyAction[] = ["go", "back", "pause", "preset", "blackout", "fadeToBlack", "emergency", "stopAudio"];
  return (
    <div
      className="cue-lockveil"
      onWheel={(e) => scriptLive.scrollBy(e.deltaMode === 1 ? e.deltaY * 18 : e.deltaY)}
      onContextMenu={(e) => e.preventDefault()}
      role="dialog"
      aria-label={t("Locked")}
    >
      <div className="cue-lockcard">
        <Icon name="lock" size={16} />
        <div className="cue-lockcard__text">
          <b>{t("Locked")}</b>
          <span>
            {t("Only the keys of the show work:")}{" "}
            {ids
              .map((id) => actionKeyText(keymap, id, t("Space")))
              .filter(Boolean)
              .map((k, i) => (
                <Kbd key={i}>{k}</Kbd>
              ))}
          </span>
        </div>
        <HoldButton className="ts-btn ts-btn--primary cue-lockcard__hold" onHold={() => setLocked(false)} ariaLabel={t("Hold to unlock")}>
          <Icon name="unlock" size={15} />
          {t("Hold to unlock")}
        </HoldButton>
      </div>
    </div>
  );
}

/** The lock in the title bar (Show only): Lock · Ctrl L. */
export function LockButton() {
  const t = useT();
  const keymap = useKeymap();
  const key = actionKeyText(keymap, "lock");
  return (
    <Button
      variant="ghost"
      iconOnly
      icon="lock"
      aria-label={t("Lock")}
      title={`${t("Lock: only the keys of the show work, clicks are blocked")}${key ? ` · ${key}` : ""}`}
      onClick={() => setLocked(true)}
    />
  );
}

/** Auto scroll on the script (Show): on/off, speed −/+, and "Segui" after scrolling by hand. */
export function AutoScrollPill() {
  const t = useT();
  const lang = useLang();
  const a = useAutoScroll();
  const fmt = (n: number) => n.toLocaleString(lang === "it" ? "it-IT" : "en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (!a.on)
    return (
      <div className="cue-autopill">
        <Button variant="ghost" icon="scroll" onMouseDown={noFocus} onClick={() => a.setOn(true)} title={t("The script scrolls by itself at the speed of the show (speed zones included)")}>
          {t("Auto scroll")}
        </Button>
      </div>
    );
  return (
    <div className="cue-autopill cue-autopill--on" role="group" aria-label={t("Auto scroll")}>
      <Button variant="ghost" iconOnly icon="pauseF" aria-label={t("Stop the auto scroll")} title={t("Stop the auto scroll")} onMouseDown={noFocus} onClick={() => a.setOn(false)} />
      <Button variant="ghost" iconOnly icon="minus" aria-label={t("Slower")} title={t("Slower")} onMouseDown={noFocus} onClick={() => a.setFactor(a.factor - FACTOR_STEP)} />
      <span className="cue-autopill__value mono" title={a.zone !== 1 ? t("Speed zone {z}×", { z: fmt(a.zone) }) : undefined}>
        {fmt(a.factor)}×{a.zone !== 1 ? <span className="cue-autopill__zone"> · {fmt(a.zone)}×</span> : null}
      </span>
      <Button variant="ghost" iconOnly icon="plus" aria-label={t("Faster")} title={t("Faster")} onMouseDown={noFocus} onClick={() => a.setFactor(a.factor + FACTOR_STEP)} />
      {a.suspended ? (
        <Button
          variant="primary"
          icon="playF"
          className="cue-autopill__follow"
          onMouseDown={noFocus}
          onClick={() => a.resume()}
          title={t("Scrolled by hand: the auto scroll waits. Follow goes on from here.")}
        >
          {t("Follow")}
        </Button>
      ) : null}
    </div>
  );
}

/** The peek band's target: "to go back to GO n" (the standby). */
export function usePeekTarget(): string | undefined {
  const t = useT();
  const gos = useDoc((s) => s.show?.gos ?? []);
  const id = useRun((s) => s.playback.standbyId);
  const name = goName(sortGos(gos), id);
  return name ? t("to GO {n}", { n: name }) : undefined;
}
