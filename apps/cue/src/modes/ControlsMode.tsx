import { useEffect, useMemo, useState } from "react";
import { useLang, useT, type TFunc } from "@theatre-suite/core";
import { Button, confirmYesNo, Dialog, StatusLight, type IconName } from "@theatre-suite/ui";
import { api, isTauri } from "../lib/api";
import { dmxApi, dmxLinkText } from "../lib/dmx";
import { saveDoc, writeVersion } from "../lib/files";
import { openOutput, projErrorText, toggleTest, useProj } from "../lib/projection";
import { usePpt } from "../lib/ppt";
import { linkPanel } from "../model/link";
import {
  addUserCheck,
  changedTonight,
  checklistCount,
  clock,
  dryRun,
  forgetTonight,
  removeCheck,
  reportText,
  resetChecks,
  toggleCheck,
  withSuggestions,
  type DryRunReport,
} from "../model/evening";
import { usable } from "../model/sources";
import { numberGos } from "../model/gos";
import { sourceStatusText } from "../lib/sources";
import { useAudioStatus, useDmxStatus } from "../settings/outputStatus";
import { useDoc } from "../store/doc";
import { endInterval, logEvent, resetEvening, startInterval, useEvening } from "../store/evening";
import { useLibrary } from "../store/library";
import { useLink } from "../store/link";
import { useUi, type SettingsTab } from "../store/ui";
import "./controls.css";

type PillState = "ok" | "warn" | "stop" | "info" | "idle";

/** Controlli: one card per output with its state in words and a test, the checklist, the dry run and the evening. */
export function ControlsMode() {
  const t = useT();
  return (
    <div className="cue-ctl">
      <section className="cue-ctl__outputs" aria-label={t("Outputs")}>
        <h2 className="cue-ctl__h">{t("Outputs")}</h2>
        <div className="cue-ctl__grid">
          <AudioCard />
          <DmxCard />
          <ProjectorCard />
          <SecondaryCard />
          <PptCard />
          <Card icon="plug" title={t("Pedal")} state="idle" label={t("Coming soon")} text={t("A pedal that sends F13 already works as GO.")} />
        </div>
        <DryRun />
      </section>
      <aside className="cue-ctl__side">
        <Checklist />
        <Evening />
      </aside>
    </div>
  );
}

/**
 * One output (design "Controlli"): title with the settings gear, the state in words and colour (StatusLight, grey when
 * not in use), a line of detail, and the command to try it, full width at the bottom.
 */
function Card(p: { icon: IconName; title: string; state: PillState; label: string; text?: string; action?: { label: string; onClick: () => void; disabled?: boolean }; tab?: SettingsTab }) {
  const t = useT();
  return (
    <div className="cue-ctl__card">
      <div className="cue-ctl__cardhead">
        <strong>{p.title}</strong>
        {p.tab ? (
          <Button variant="ghost" iconOnly icon="settings" aria-label={t("Settings")} title={t("Settings")} onClick={() => useUi.getState().openSettings(p.tab)} />
        ) : null}
      </div>
      {p.state === "idle" ? (
        <span className="ts-light cue-ctl__idle">
          <span className="ts-light__dot" aria-hidden="true" />
          {p.label}
        </span>
      ) : (
        <StatusLight state={p.state} label={p.label} strong />
      )}
      {p.text ? <p className="cue-ctl__text">{p.text}</p> : null}
      {p.action ? (
        <Button className="cue-ctl__cmd" onClick={p.action.onClick} disabled={p.action.disabled}>
          {p.action.label}
        </Button>
      ) : null}
    </div>
  );
}

function AudioCard() {
  const t = useT();
  const { simulated, engine } = useAudioStatus();
  const s: [PillState, string] = engine?.error ? ["stop", t("Problem")] : simulated ? ["idle", t("Simulated output")] : engine?.ready ? ["ok", t("Ready")] : ["warn", t("Starting")];
  return (
    <Card
      icon="speaker"
      title={t("Audio")}
      state={s[0]}
      label={s[1]}
      text={engine?.device && String(engine.device) !== s[1] ? String(engine.device) : simulated ? t("No sound card here: Cue shows what it would play.") : undefined}
      action={{ label: t("Choose the sound card"), onClick: () => useUi.getState().openSettings("outputs") }}
      tab="outputs"
    />
  );
}

function DmxCard() {
  const t = useT();
  const { status } = useDmxStatus();
  const link = status?.link ?? { state: "idle" as const };
  const state: PillState = link.state === "connected" ? "ok" : link.state === "simulated" ? "idle" : link.state === "lost" || link.state === "error" ? "stop" : link.state === "connecting" ? "warn" : "idle";
  const [testing, setTesting] = useState(false);
  const test = async () => {
    const next = !testing;
    setTesting(next);
    try {
      await (await dmxApi()).testOutput(next);
    } catch (e) {
      setTesting(false);
      useUi.getState().showToast(String(e), "error");
    }
  };
  return (
    <Card
      icon="bench"
      title={t("DMX lights")}
      state={state}
      label={dmxLinkText(t, link)}
      text={testing ? t("Test on: every light at half. Press again to stop.") : undefined}
      action={
        link.state === "connected" || link.state === "simulated"
          ? { label: testing ? t("Stop the test") : t("Test the lights"), onClick: () => void test() }
          : { label: t("Connect the interface"), onClick: () => useUi.getState().openSettings("outputs") }
      }
      tab="outputs"
    />
  );
}

function ProjectorCard() {
  const t = useT();
  const open = useProj((s) => s.windowOpen);
  const testing = useProj((s) => s.testing);
  return (
    <Card
      icon="image"
      title={t("Projector")}
      state={open ? "ok" : "idle"}
      label={open ? t("Output open") : t("Output closed")}
      text={open ? undefined : t("The output opens on the second screen (the projector).")}
      action={
        open
          ? { label: testing ? t("Stop the test pattern") : t("Test pattern"), onClick: () => void toggleTest() }
          : { label: t("Turn the output on"), onClick: () => void openOutput().catch((e) => useUi.getState().showToast(projErrorText(t, e), "error")) }
      }
      tab="projections"
    />
  );
}

function SecondaryCard() {
  const t = useT();
  const info = useLink((s) => s.info);
  const lang = useLang();
  const p = linkPanel(info, t, lang, Date.now());
  const state: PillState = info.status === "stable" ? "ok" : info.status === "unstable" || info.status === "backup" ? "warn" : info.status === "lost" ? "stop" : info.status === "unavailable" ? "info" : "idle";
  const action = info.role === "none" || !info.pairedWith ? { label: t("Pair a computer"), onClick: () => useUi.getState().openSettings("link") } : undefined;
  return <Card icon="plug" title={t("Secondary")} state={state} label={p.title} text={p.detail || undefined} action={action} tab="link" />;
}

function PptCard() {
  const t = useT();
  const ppt = usePpt();
  const state: PillState = ppt.status === "on" ? "ok" : ppt.status === "error" ? "stop" : ppt.status === "connecting" ? "warn" : "idle";
  const label = ppt.status === "on" ? (ppt.name || t("Connected")) : ppt.status === "error" ? t("Problem") : t("Not connected");
  return (
    <Card
      icon="image"
      title="PowerPoint"
      state={state}
      label={label}
      text={ppt.error ?? (ppt.status === "on" ? undefined : t("Recommended: import the slides as images in Projections."))}
      action={{ label: t("Open Projections"), onClick: () => useUi.getState().setMode("projections") }}
      tab="projections"
    />
  );
}

/* ------------------------------------------------------------------ */

function Checklist() {
  const t = useT();
  const show = useDoc((s) => s.show);
  const list = useMemo(() => withSuggestions(show?.checklist ?? [], t), [show?.checklist, t]);
  const [text, setText] = useState("");
  const c = checklistCount(list);
  const set = (next: typeof list, key?: string) => useDoc.getState().change((s) => ({ ...s, checklist: next }), key);
  if (!show) return null;
  const toggle = (id: string) => {
    const item = list.find((i) => i.id === id);
    set(toggleCheck(list, id));
    if (item && !item.done) logEvent("check", `${t("Checked")}: ${item.text}`);
  };
  const add = () => {
    set(addUserCheck(list, `u-${Date.now().toString(36)}`, text));
    setText("");
  };
  return (
    <section className="cue-ctl__box">
      <div className="cue-ctl__boxhead">
        <h2 className="cue-ctl__h">{t("Before the curtain")}</h2>
        <span className={c.done === c.total ? "cue-ctl__count cue-ctl__count--ok" : "cue-ctl__count"}>{t("{done} of {total}", { done: c.done, total: c.total })}</span>
      </div>
      <ul className="cue-ctl__list">
        {list.map((i) => (
          <li key={i.id} className={i.done ? "cue-ctl__item cue-ctl__item--done" : "cue-ctl__item"}>
            <label>
              <input type="checkbox" checked={i.done} onChange={() => toggle(i.id)} />
              <span>{i.text}</span>
            </label>
            {i.origin === "user" ? (
              <>
                <span className="cue-ctl__yours">{t("yours")}</span>
                <Button variant="ghost" iconOnly icon="x" title={t("Remove")} aria-label={t("Remove")} onClick={() => set(removeCheck(list, i.id))} />
              </>
            ) : null}
          </li>
        ))}
      </ul>
      <form
        className="cue-ctl__add"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input className="ts-input" value={text} placeholder={t("Add your own item…")} onChange={(e) => setText(e.target.value)} />
        <Button variant="sm" icon="plus" type="submit" disabled={!text.trim()}>
          {t("Add")}
        </Button>
      </form>
      <Button variant="ghost" onClick={() => set(resetChecks(list))}>
        {t("Untick all")}
      </Button>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function DryRun() {
  const t = useT();
  const show = useDoc((s) => s.show);
  const library = useLibrary((s) => s.library);
  const [report, setReport] = useState<DryRunReport | null>(null);
  useEffect(() => setReport(null), [show?.gos, library]);
  if (!show) return null;
  const run = () => {
    const items = new Set(show.projection.items.map((i) => i.id));
    const r = dryRun(show.gos, {
      hasLight: (sourceId, itemId) => !!library.light({ sourceId, itemId }),
      hasAudio: (sourceId, itemId) => !!library.track({ sourceId, itemId }),
      sourceProblem: (id) => {
        const s = library.source(id);
        if (!s) return t("The linked file is missing from the show");
        return usable(s) ? null : sourceStatusText(t, s);
      },
      hasProjectionItem: (id) => items.has(id),
      t,
    });
    setReport(r);
    logEvent("check", r.problems.length ? t("Dry run: {n} problems", { n: r.problems.length }) : t("Dry run: everything in place"));
  };
  return (
    <section className="cue-ctl__box">
      <div className="cue-ctl__boxhead">
        <h2 className="cue-ctl__h">{t("Dry run")}</h2>
        <Button variant="sm" icon="playF" onClick={run}>
          {t("Run in silence")}
        </Button>
      </div>
      <p className="cue-ctl__text">{t("Goes through every GO in order without sending anything to lights, sound or projector, and checks that each memory, track and image is still there.")}</p>
      {report ? (
        report.problems.length === 0 ? (
          <p className="cue-ctl__ok">{t("{gos} GO and {actions} actions: everything in place.", { gos: report.gos, actions: report.actions })}</p>
        ) : (
          <ul className="cue-ctl__problems">
            {report.problems.map((p, i) => (
              <li key={i}>
                <strong>GO {p.number}</strong> · {p.text}
              </li>
            ))}
          </ul>
        )
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ */

function Evening() {
  const t = useT();
  const log = useEvening((s) => s.log);
  const interval = useEvening((s) => s.intervalSince);
  const [end, setEnd] = useState(false);
  return (
    <section className="cue-ctl__box cue-ctl__box--grow">
      <div className="cue-ctl__boxhead">
        <h2 className="cue-ctl__h">{t("Log of the evening")}</h2>
        <span className="cue-ctl__count">{log.length}</span>
      </div>
      <div className="cue-ctl__row">
        {interval ? (
          <Button variant="sm" onClick={() => endInterval(t("Interval ended"))}>
            {t("End of interval")}
          </Button>
        ) : (
          <Button variant="sm" onClick={() => startInterval(t("Interval"))}>
            {t("Interval")}
          </Button>
        )}
        <Button variant="sm" onClick={() => void exportReport(t)} disabled={!log.length}>
          {t("Export report")}
        </Button>
        <Button variant="sm" onClick={() => printReport(t)} disabled={!log.length}>
          {t("Print")}
        </Button>
        <Button variant="primary" onClick={() => setEnd(true)}>
          {t("End of show")}
        </Button>
      </div>
      <ol className="cue-ctl__log">
        {log.length === 0 ? <li className="cue-ctl__text">{t("Nothing yet: the log starts with the first GO.")}</li> : null}
        {[...log].reverse().map((e, i) => (
          <li key={i} className={`cue-ctl__entry cue-ctl__entry--${e.kind}`}>
            <span className="cue-ctl__time">{clock(e.at)}</span> {e.text}
            {e.by ? <span className="cue-ctl__by"> · {byName(t, e.by)}</span> : null}
          </li>
        ))}
      </ol>
      {end ? <EndOfShow onClose={() => setEnd(false)} /> : null}
    </section>
  );
}

const byName = (t: TFunc, by?: string) => (by === "secondary" ? t("secondary") : by === "primary" ? t("primary") : "");

function currentReport(t: TFunc): string {
  const show = useDoc.getState().show;
  return reportText({ title: show?.title ?? "" }, useEvening.getState().log, withSuggestions(show?.checklist ?? [], t), t, (b) => byName(t, b));
}

async function exportReport(t: TFunc) {
  const text = currentReport(t);
  if (!isTauri) {
    await navigator.clipboard?.writeText(text).catch(() => undefined);
    useUi.getState().showToast(t("Report copied"));
    return;
  }
  const { save } = await import("@tauri-apps/plugin-dialog");
  const path = await save({ defaultPath: `${t("Show report")}.txt`, filters: [{ name: t("Text"), extensions: ["txt"] }] });
  if (!path) return;
  try {
    await api.writeText(path, text);
    useUi.getState().showToast(t("Report saved"));
  } catch (e) {
    useUi.getState().showToast(String(e), "error");
  }
}

function printReport(t: TFunc) {
  const w = window.open("", "_blank", "width=800,height=900");
  if (!w) return;
  const pre = w.document.createElement("pre");
  pre.style.cssText = "font: 12px/1.5 Geist, system-ui, sans-serif; white-space: pre-wrap; margin: 24px;";
  pre.textContent = currentReport(t);
  w.document.title = t("Show report");
  w.document.body.appendChild(pre);
  w.focus();
  w.print();
}

/** End of show: what to do with the changes made during the evening, once for both computers (the primary decides). */
function EndOfShow({ onClose }: { onClose: () => void }) {
  const t = useT();
  const show = useDoc((s) => s.show);
  const baseline = useEvening((s) => s.baseline);
  const changed = show ? changedTonight(baseline, show.gos) : [];
  const numbers = new Map(numberGos(show?.gos ?? []).map((n) => [n.id, n.text]));
  const [note, setNote] = useState("");
  const finish = (text: string) => {
    logEvent("end", text);
    onClose();
  };
  const apply = async () => {
    const path = useDoc.getState().filePath;
    if (path) await writeVersion(path, "auto", t("Before the changes of the evening")).catch(() => undefined);
    if (await saveDoc(t)) finish(t("End of show · changes kept"));
  };
  const asVersion = async () => {
    if (!(await saveDoc(t))) return;
    const path = useDoc.getState().filePath;
    if (path) await writeVersion(path, "named", note.trim() || t("Changes of the evening"));
    finish(t("End of show · saved as a new version"));
  };
  const forget = async () => {
    if (!baseline) return finish(t("End of show"));
    if (!(await confirmYesNo({ title: t("Forget the changes?"), message: t("The GOs go back to how they were at the first GO of the evening."), cancel: t("Cancel"), confirm: t("Forget"), danger: true }))) return;
    useDoc.getState().change((s) => ({ ...s, gos: forgetTonight(baseline, s.gos) }));
    finish(t("End of show · changes forgotten"));
  };
  const newEvening = () => {
    resetEvening();
    onClose();
  };
  return (
    <Dialog title={t("End of show")} icon="flag" onClose={onClose} closeLabel={t("Close")}>
      <div className="cue-ctl__end">
        {changed.length === 0 ? (
          <p>{t("No GO was changed during the show.")}</p>
        ) : (
          <>
            <p>{t("{n} GO changed during the show (marked in amber):", { n: changed.length })}</p>
            <ul className="cue-ctl__problems">
              {changed.map((g) => (
                <li key={g.id}>GO {numbers.get(g.id) ?? "?"}</li>
              ))}
            </ul>
            <div className="cue-ctl__row">
              <Button variant="primary" onClick={() => void apply()}>
                {t("Keep the changes")}
              </Button>
              <Button variant="sm" onClick={() => void forget()}>
                {t("Forget")}
              </Button>
            </div>
            <div className="cue-ctl__row">
              <input className="ts-input" value={note} placeholder={t("Note for the version")} onChange={(e) => setNote(e.target.value)} />
              <Button variant="sm" onClick={() => void asVersion()}>
                {t("Save as a new version")}
              </Button>
            </div>
            <p className="cue-ctl__text">{t("Changes are kept in this Cue show; the Diaframma and Granvelo files are not modified.")}</p>
          </>
        )}
        <div className="cue-ctl__row">
          <Button variant="ghost" onClick={() => finish(t("End of show"))}>
            {t("Just log the end")}
          </Button>
          <Button variant="ghost" onClick={newEvening}>
            {t("Start a new evening")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
