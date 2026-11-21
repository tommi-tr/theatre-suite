import { useState } from "react";
import { useT } from "@theatre-suite/core";
import { Button, confirmYesNo, Icon, NumberField, Segmented, Switch } from "@theatre-suite/ui";
import { actionDept, numberGos, type Action, type AudioAction, type AudioStopAction, type Dept, type GivenBy, type Go, type LightAction } from "../model/gos";
import type { Library } from "../model/sources";
import { useDoc } from "../store/doc";
import { useLibrary } from "../store/library";
import { useSettings } from "../store/settings";
import { useUi } from "../store/ui";
import { addStop, changeAuto, changeGivenBy, changeGoLabel, changeGoNote, changeGoSpeed, changeLevel, changeTimes, deleteAction, deleteGo, goSpeed, gosOf } from "./actions";
import { fmtDb, fmtSec, fmtSpeed } from "./format";
import "./prepare.css";

/** The panel on the right of Prepara: the selected GO (point in the script, actions, who gives it, speed, note, delete). */
export function GoPanel() {
  const t = useT();
  const selectedId = useUi((s) => s.selectedGoId);
  const show = useDoc((s) => s.show);
  const library = useLibrary((s) => s.library);
  const go = show && selectedId ? gosOf(show).find((g) => g.id === selectedId) : undefined;
  if (!show || !go) {
    return (
      <aside className="cue-panel cue-gop" aria-label={t("Selected GO")}>
        <div className="cue-panel__head">{t("Selected GO")}</div>
        <p className="ts-muted">{t("No GO selected.")}</p>
        <p className="ts-muted">{t("Click a GO on the script, or drag a memory or a track from the library onto it.")}</p>
        <div className="cue-panel__spacer" />
        <p className="cue-panel__hint">{show ? (show.gos.length === 1 ? t("1 GO") : t("{n} GO", { n: show.gos.length })) : ""}</p>
      </aside>
    );
  }
  return <GoDetails key={go.id} go={go} library={library} />;
}

function GoDetails({ go, library }: { go: Go; library: Library }) {
  const t = useT();
  const gos = useDoc((s) => (s.show ? gosOf(s.show) : []));
  const speed = useDoc((s) => (s.show ? goSpeed(s.show, go.id) : null));
  const lang = useSettings((s) => s.settings.language);
  const num = numberGos(gos).find((n) => n.id === go.id);
  const [stopping, setStopping] = useState(false);
  const quote = go.anchor.quote.trim();
  const soundsLeft = library.audio;

  const remove = async () => {
    const yes = await confirmYesNo({
      title: t("Delete the GO?"),
      message: t("GO {n} and its actions are removed from the script. You can undo with Ctrl Z.", { n: num?.text ?? "" }),
      cancel: t("Cancel"),
      confirm: t("Delete the GO"),
      danger: true,
      close: t("Close"),
    });
    if (yes) deleteGo(go.id);
  };

  return (
    <aside className="cue-panel cue-gop" aria-label={t("Selected GO")}>
      <div className="cue-gop__title">
        <span className="cue-panel__head">{t("GO {n}", { n: num?.number ?? "" })}</span>
        {go.auto ? <span className="ts-pill">{t("by itself")}</span> : null}
      </div>
      <input
        className="ts-input cue-gop__label"
        value={go.label ?? ""}
        placeholder={t("Name (optional)")}
        aria-label={t("Name on the button")}
        maxLength={16}
        onChange={(e) => changeGoLabel(go.id, e.currentTarget.value)}
      />
      <p className="cue-gop__where">
        {t("Page {n}", { n: go.anchor.page })}
        {quote ? ` · “…${quote.length > 60 ? `${quote.slice(0, 60)}…` : quote}…”` : ""}
      </p>

      <div className="ts-label">{t("Actions")}</div>
      {go.actions.length === 0 ? <p className="cue-gop__none">{t("No actions yet: drag a memory or a track onto this GO.")}</p> : null}
      <div className="cue-gop__actions">
        {go.actions.map((a) => (
          <ActionCard key={a.id} go={go} action={a} library={library} lang={lang} />
        ))}
      </div>
      {stopping ? (
        <select
          className="ts-select cue-gop__stoppick"
          aria-label={t("Which sound to stop")}
          autoFocus
          defaultValue=""
          onBlur={() => setStopping(false)}
          onChange={(e) => {
            const v = e.currentTarget.value;
            if (v === "") return;
            if (v === "*") addStop(go.id);
            else {
              const [sourceId, itemId] = v.split("\u0000");
              addStop(go.id, { sourceId, itemId });
            }
            setStopping(false);
          }}
        >
          <option value="" disabled>
            {t("Which sound to stop")}
          </option>
          <option value="*">{t("Every sound")}</option>
          {soundsLeft.map((s) => (
            <option key={`${s.key.sourceId}\u0000${s.key.itemId}`} value={`${s.key.sourceId}\u0000${s.key.itemId}`}>
              {s.name}
            </option>
          ))}
        </select>
      ) : (
        <Button variant="sm" icon="stopPlay" onClick={() => setStopping(true)}>
          {t("Stop a sound…")}
        </Button>
      )}

      <div className="ts-label">{t("Who gives it")}</div>
      <Segmented<GivenBy>
        small
        ariaLabel={t("Who gives it")}
        value={go.givenBy}
        onChange={(by) => changeGivenBy(go.id, by)}
        options={[
          { value: "both", label: t("Both") },
          { value: "primary", label: t("Primary") },
          { value: "secondary", label: t("Secondary") },
        ]}
      />

      <div className="cue-gop__row" title={t("It starts when the actions of the GO before it have finished")}>
        <span>{t("Starts by itself")}</span>
        <Switch checked={!!go.auto} onChange={(v) => changeAuto(go.id, v)} label={t("Starts by itself")} />
      </div>

      <div className="ts-label">{t("Speed zone")}</div>
      <div className="cue-gop__row">
        <span>{t("From here: speed")}</span>
        <span className="cue-gop__val">
          <NumberField
            value={speed}
            text={speed === null ? t("none") : fmtSpeed(speed, lang)}
            min={0.1}
            max={5}
            label={t("Speed of the automatic scroll from this GO")}
            className={speed === null ? "cue-gop__none-field" : ""}
            onCommit={(v) => changeGoSpeed(go.id, Math.round(v * 100) / 100)}
          />
          {speed !== null ? (
            <button type="button" className="cue-gop__reset" title={t("No speed change from here")} aria-label={t("No speed change from here")} onClick={() => changeGoSpeed(go.id, null)}>
              <Icon name="x" size={11} />
            </button>
          ) : null}
        </span>
      </div>

      <div className="ts-label">{t("Note")}</div>
      <textarea
        className="ts-input cue-gop__note"
        rows={3}
        value={go.note ?? ""}
        placeholder={t("A reminder for this GO")}
        aria-label={t("Note of the GO")}
        onChange={(e) => changeGoNote(go.id, e.currentTarget.value)}
      />

      <div className="cue-panel__spacer" />
      <Button variant="danger" icon="trash" onClick={() => void remove()}>
        {t("Delete the GO")}
      </Button>
    </aside>
  );
}

/** What an action is called in the panel. */
function ActionTitle({ action, library }: { action: Action; library: Library }) {
  const t = useT();
  if (action.kind === "light") {
    const m = library.light(action.ref);
    const src = library.source(action.ref.sourceId);
    return m ? (
      <>
        <b className="ts-ellipsis">{m.name || t("(no name)")}</b>
        <span className="cue-act__src">
          {t("Memory {n}", { n: m.number })} · {src?.title ?? "Granvelo"}
        </span>
      </>
    ) : (
      <Missing what={t("Memory")} />
    );
  }
  if (action.kind === "audio" || action.kind === "audioStop") {
    if (action.kind === "audioStop" && !action.ref)
      return (
        <>
          <b>{t("Stops every sound")}</b>
        </>
      );
    const tr = action.ref ? library.track(action.ref) : null;
    const src = action.ref ? library.source(action.ref.sourceId) : undefined;
    return tr ? (
      <>
        <b className="ts-ellipsis">{action.kind === "audioStop" ? t("Stops {name}", { name: tr.name }) : tr.name}</b>
        <span className="cue-act__src">{src?.title ?? "Diaframma"}</span>
      </>
    ) : (
      <Missing what={t("Track")} />
    );
  }
  return <b>{t("Image or video")}</b>;
}

function Missing({ what }: { what: string }) {
  const t = useT();
  return (
    <>
      <b className="cue-act__missing">{t("{what} not found", { what })}</b>
      <span className="cue-act__src">{t("Its file is missing or changed: the action is skipped at the GO.")}</span>
    </>
  );
}

const DEPT_CLASS: Record<Dept, string> = { lights: "cue-act--lights", audio: "cue-act--audio", video: "cue-act--video" };

function ActionCard({ go, action, library, lang }: { go: Go; action: Action; library: Library; lang: "it" | "en" }) {
  const t = useT();
  return (
    <div className={`cue-act ${DEPT_CLASS[actionDept(action)]}`}>
      <div className="cue-act__head">
        <div className="cue-act__title">
          <ActionTitle action={action} library={library} />
        </div>
        <button type="button" className="cue-act__remove" title={t("Remove the action")} aria-label={t("Remove the action")} onClick={() => deleteAction(go.id, action.id)}>
          <Icon name="x" size={12} />
        </button>
      </div>
      {action.kind === "light" ? <LightTimes go={go} action={action} library={library} lang={lang} /> : null}
      {action.kind === "audio" ? <AudioTimes go={go} action={action} library={library} lang={lang} /> : null}
      {action.kind === "audioStop" ? <StopTimes go={go} action={action} lang={lang} /> : null}
    </div>
  );
}

interface FieldProps {
  label: string;
  /** What the action overrides; undefined = the value of the source file. */
  value: number | undefined;
  /** The value of the source file (null = none). */
  base: number | null;
  text: (n: number) => string;
  min: number;
  max: number;
  onSet: (v: number) => void;
  onReset: () => void;
  /** Shown when there is neither an override nor a value in the file. */
  empty?: string;
}

/** One time or level of an action: the file's value, or the one set here (amber, with a way back). */
function TimeField({ label, value, base, text, min, max, onSet, onReset, empty }: FieldProps) {
  const t = useT();
  const over = value !== undefined;
  const shown = over ? value : base;
  return (
    <div className="cue-time">
      <span className="cue-time__label">{label}</span>
      <span className={`cue-time__val${over ? " cue-time__val--over" : ""}`}>
        <NumberField value={shown} text={shown === null ? (empty ?? "—") : text(shown)} min={min} max={max} label={label} onCommit={onSet} />
        {over ? (
          <button
            type="button"
            className="cue-time__reset"
            title={base !== null ? t("Back to {value}, the value in the file", { value: text(base) }) : t("Back to the value in the file")}
            aria-label={`${t("Back to the value in the file")}: ${label}`}
            onClick={onReset}
          >
            <Icon name="reset" size={11} />
          </button>
        ) : null}
      </span>
    </div>
  );
}

function LightTimes({ go, action, library, lang }: { go: Go; action: LightAction; library: Library; lang: "it" | "en" }) {
  const t = useT();
  const m = library.light(action.ref);
  const tm = action.times ?? {};
  const set = (key: "fadeIn" | "fadeOut" | "delay") => (v: number) => changeTimes(go.id, action.id, key === "delay" ? { delay: v } : { fade: undefined, fadeIn: tm.fadeIn ?? tm.fade, fadeOut: tm.fadeOut ?? tm.fade, [key]: v });
  const reset = (key: "fadeIn" | "fadeOut" | "delay") => () =>
    changeTimes(go.id, action.id, key === "delay" ? { delay: undefined } : { fade: undefined, fadeIn: key === "fadeIn" ? undefined : (tm.fadeIn ?? tm.fade), fadeOut: key === "fadeOut" ? undefined : (tm.fadeOut ?? tm.fade) });
  const fmt = (n: number) => fmtSec(n, lang);
  return (
    <div className="cue-act__times">
      <TimeField label={t("In")} value={tm.fadeIn ?? tm.fade} base={m?.times.fadeIn ?? null} text={fmt} min={0} max={600} onSet={set("fadeIn")} onReset={reset("fadeIn")} />
      <TimeField label={t("Out")} value={tm.fadeOut ?? tm.fade} base={m?.times.fadeOut ?? null} text={fmt} min={0} max={600} onSet={set("fadeOut")} onReset={reset("fadeOut")} />
      <TimeField label={t("Delay")} value={tm.delay} base={m?.times.delay ?? null} text={fmt} min={0} max={600} onSet={set("delay")} onReset={reset("delay")} />
    </div>
  );
}

function AudioTimes({ go, action, library, lang }: { go: Go; action: AudioAction; library: Library; lang: "it" | "en" }) {
  const t = useT();
  const tr = library.track(action.ref);
  const tm = action.times ?? {};
  return (
    <div className="cue-act__times">
      <TimeField
        label={t("Volume")}
        value={action.levelDb}
        base={0}
        text={(n) => fmtDb(n, lang)}
        min={-40}
        max={12}
        onSet={(v) => changeLevel(go.id, action.id, v)}
        onReset={() => changeLevel(go.id, action.id, undefined)}
      />
      <TimeField
        label={t("Fade in")}
        value={tm.fade}
        base={tr?.fadeInSec ?? null}
        text={(n) => fmtSec(n, lang)}
        min={0}
        max={600}
        onSet={(v) => changeTimes(go.id, action.id, { fade: v })}
        onReset={() => changeTimes(go.id, action.id, { fade: undefined })}
      />
      <TimeField
        label={t("Delay")}
        value={tm.delay}
        base={0}
        text={(n) => fmtSec(n, lang)}
        min={0}
        max={600}
        onSet={(v) => changeTimes(go.id, action.id, { delay: v })}
        onReset={() => changeTimes(go.id, action.id, { delay: undefined })}
      />
    </div>
  );
}

function StopTimes({ go, action, lang }: { go: Go; action: AudioStopAction; lang: "it" | "en" }) {
  const t = useT();
  return (
    <div className="cue-act__times">
      <TimeField
        label={t("Fade out")}
        value={action.times?.fade}
        base={null}
        empty={t("standard")}
        text={(n) => fmtSec(n, lang)}
        min={0}
        max={600}
        onSet={(v) => changeTimes(go.id, action.id, { fade: v })}
        onReset={() => changeTimes(go.id, action.id, { fade: undefined })}
      />
    </div>
  );
}
