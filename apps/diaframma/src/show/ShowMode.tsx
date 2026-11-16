import { useEffect, useMemo, useRef, useState } from "react";
import { formatTime, useT } from "@theatre-suite/core";
import { Button, HoldButton, Icon, Kbd, StatusBar } from "@theatre-suite/ui";
import { api, appWindow } from "../lib/api";
import { openDocDialog, pickAudioFiles } from "../lib/files";
import { launchpadClaims, stopEverything } from "../lib/launchpad";
import { effectiveOut, frontVoice, numbering, trackDuration, useDoc } from "../state/doc";
import { useSettings } from "../state/settings";
import { useUi } from "../state/ui";
import { GoBar } from "./GoBar";
import { TrackRow } from "./TrackRow";
import { ReorderDialog } from "./ReorderDialog";
import { EditorDialog } from "./EditorDialog";
import { othersText } from "./labels";

function isTyping(el: EventTarget | null) {
  const e = el as HTMLElement | null;
  return !!e && (e.tagName === "INPUT" || e.tagName === "TEXTAREA" || e.tagName === "SELECT" || e.isContentEditable);
}

export function ShowMode() {
  const t = useT();
  const tracks = useDoc((s) => s.tracks);
  const live = useDoc((s) => s.live);
  const infos = useDoc((s) => s.infos);
  const missing = useDoc((s) => s.missing);
  const expanded = useDoc((s) => s.expanded);
  const view = useDoc((s) => s.view);
  const locked = useDoc((s) => s.locked);
  const settings = useSettings((s) => s.settings);
  const dialog = useUi((s) => s.dialog);
  const [typed, setTyped] = useState("");
  const typedTimer = useRef<number | null>(null);
  const lastEsc = useRef(0);
  const [devices, setDevices] = useState<string[]>([]);
  const numbers = useMemo(() => numbering(tracks, settings.numberFrom), [tracks, settings.numberFrom]);
  const listRef = useRef<HTMLElement>(null);

  // Arm the first track when a cue list is opened and nothing is in standby.
  const filePath = useDoc((s) => s.filePath);
  const hasPlayable = tracks.some((x) => !x.hidden && !!x.file);
  useEffect(() => {
    const st = useDoc.getState();
    if (st.live.standbyId || st.live.voices.length) return;
    const first = st.tracks.find((x) => !x.hidden && x.file);
    if (first) api.engineSetStandby(first.id).catch(() => {});
  }, [filePath, hasPlayable]);

  useEffect(() => {
    api.engineDevices().then(setDevices).catch(() => {});
  }, []);

  // Files dropped onto the window.
  useEffect(() => {
    const un = appWindow.onDragDrop((paths, x, y) => {
      if (useDoc.getState().locked || useUi.getState().mode !== "show") return;
      const ratio = window.devicePixelRatio || 1;
      const el = document.elementFromPoint(x / ratio, y / ratio) as HTMLElement | null;
      const row = el?.closest<HTMLElement>("[data-track-id]");
      useDoc.getState().addFiles(paths, row?.dataset.trackId);
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  // Keyboard: GO, Pause all, standby, stop, lock, undo.
  useEffect(() => {
    const playable = () => useDoc.getState().tracks.filter((x) => !x.hidden && x.file);
    const onKey = (e: KeyboardEvent) => {
      if (useUi.getState().dialog || useUi.getState().mode !== "show") return;
      if (isTyping(e.target)) return;
      const st = useDoc.getState();
      const k = e.key;
      if (k === " " || e.code === "Space") {
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) api.engineGo().catch((err) => useUi.getState().showToast(String(err), "error"));
        return;
      }
      if (launchpadClaims(e)) return;
      if (k === "Escape") {
        // An open menu closes first; it must never trigger Stop all.
        if (document.querySelector(".df-menu")) return;
        e.preventDefault();
        const now = Date.now();
        const immediate = now - lastEsc.current < 900;
        lastEsc.current = now;
        setTyped("");
        stopEverything(immediate);
        return;
      }
      if (e.code === "KeyP" && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        if (!e.repeat) api.enginePauseAll().catch(() => {});
        return;
      }
      if (e.code === "KeyM" && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
        // Marker at the play position of the track in front (like the M of a video editor).
        e.preventDefault();
        if (e.repeat || st.locked) return;
        const v = frontVoice(st.live);
        if (!v) {
          useUi.getState().showToast(t("Nothing is playing: there is no position to mark."));
          return;
        }
        st.addMarker(v.trackId, v.positionSec);
        const n = numbering(st.tracks, useSettings.getState().settings.numberFrom).get(v.trackId);
        useUi.getState().showToast(t("Marker on track {n} at {time}", { n: n ?? "", time: formatTime(v.positionSec, true) }));
        return;
      }
      if (/^[0-9]$/.test(k) && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setTyped((p) => (p + k).slice(-3));
        if (typedTimer.current) window.clearTimeout(typedTimer.current);
        typedTimer.current = window.setTimeout(() => setTyped(""), 4000);
        return;
      }
      if (k === "Backspace") {
        setTyped((p) => p.slice(0, -1));
        return;
      }
      if (k === "Enter") {
        setTyped((p) => {
          if (p) {
            const n = Number(p);
            const nums = numbering(st.tracks, useSettings.getState().settings.numberFrom);
            const target = st.tracks.find((x) => nums.get(x.id) === n);
            if (target && target.file) api.engineSetStandby(target.id).catch(() => {});
            else useUi.getState().showToast(t("There is no track {n}.", { n }));
          }
          return "";
        });
        e.preventDefault();
        return;
      }
      if (k === "ArrowDown" || k === "ArrowUp") {
        e.preventDefault();
        const list = playable();
        if (!list.length) return;
        api.engineStandbyStep(k === "ArrowDown" ? 1 : -1).catch(() => {});
        return;
      }
      if (e.ctrlKey && !e.shiftKey && !e.altKey && k.toLowerCase() === "l") {
        e.preventDefault();
        st.setLocked(!st.locked);
        return;
      }
      if (st.locked) return;
      if (e.ctrlKey && (k.toLowerCase() === "y" || (e.shiftKey && k.toLowerCase() === "z"))) {
        e.preventDefault();
        st.redo();
      } else if (e.ctrlKey && k.toLowerCase() === "z") {
        e.preventDefault();
        st.undo();
      }
    };
    // A focused button must not be "clicked" by the Space bar: Space is only GO.
    const onKeyUp = (e: KeyboardEvent) => {
      if (useUi.getState().dialog || useUi.getState().mode !== "show" || isTyping(e.target)) return;
      if (e.key === " " || e.code === "Space") {
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

  // The track that plays as the first row (option), else keep standby visible.
  const mainId = live.mainId;
  useEffect(() => {
    if (!settings.followPlaying || !mainId) return;
    const row = document.querySelector<HTMLElement>(`[data-track-id="${mainId}"]`);
    const list = listRef.current;
    if (row && list) list.scrollTo({ top: row.offsetTop - list.offsetTop - 10, behavior: "smooth" });
  }, [mainId, settings.followPlaying]);
  useEffect(() => {
    if (!live.standbyId) return;
    const row = document.querySelector<HTMLElement>(`[data-track-id="${live.standbyId}"]`);
    if (!row) return;
    if (!settings.followPlaying) row.scrollIntoView({ block: "nearest" });
    else {
      // Only if it is off screen below.
      const list = listRef.current;
      if (list && row.offsetTop - list.offsetTop > list.scrollTop + list.clientHeight) row.scrollIntoView({ block: "end" });
    }
  }, [live.standbyId, settings.followPlaying]);

  const voiceOf = useMemo(() => {
    const m = new Map<string, (typeof live.voices)[number]>();
    for (const v of live.voices) {
      const prev = m.get(v.trackId);
      if (!prev || (prev.fading === "out" && v.fading !== "out")) m.set(v.trackId, v);
    }
    return m;
  }, [live.voices]);

  const hiddenCount = tracks.filter((x) => x.hidden).length;
  const emptyCount = tracks.filter((x) => !x.file).length;
  const total = tracks
    .filter((x) => !x.hidden && x.file)
    .reduce((acc, x) => {
      const d = trackDuration(x, infos);
      const o = effectiveOut(x, d);
      return acc + (o !== null ? Math.max(0, o - x.inSec) : 0);
    }, 0);
  const missingCount = Object.values(missing).filter(Boolean).length;
  const outputLabel = settings.outputDevice ?? t("Windows default");
  const anyExpanded = Object.values(expanded).some(Boolean);

  return (
    <>
      <div className={locked ? "df-toolbar df-toolbar--locked" : "df-toolbar"}>
        {!locked ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Button icon="folderOpen" onClick={() => openDocDialog(t)} title="Ctrl O">
              <span className="df-bl">{t("Open cue list")}</span>
            </Button>
            <Button icon="reorder" onClick={() => useUi.getState().openDialog("reorder")}>
              <span className="df-bl">{t("Reorder")}</span>
            </Button>
            <Button
              icon="plus"
              onClick={async () => {
                const files = await pickAudioFiles(t, true);
                if (files.length) useDoc.getState().addFiles(files);
              }}
            >
              <span className="df-bl">{t("Add track")}</span>
            </Button>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <span className="df-locked-note">
              <Icon name="lock" size={15} />
              {t("Show locked")}
            </span>
            <span className="ts-ellipsis" style={{ color: "var(--text-2)", fontSize: 12.5 }}>
              {t("Only GO, attention, Pause and Stop can be used")}
            </span>
          </div>
        )}
        <span className="ts-spacer" />
        <label className="ts-btn ts-btn--ghost" style={{ cursor: locked ? "default" : "pointer" }} title={t("Audio output")}>
          <Icon name="speaker" size={15} />
          <span className="df-bl" style={{ color: "var(--text-3)" }}>{t("Output")}</span>
          <select
            className="df-inline-select"
            value={settings.outputDevice ?? ""}
            disabled={locked}
            onFocus={() => api.engineDevices().then(setDevices).catch(() => {})}
            onChange={(e) => {
              useSettings.getState().update({ outputDevice: e.currentTarget.value || null });
              // Give the keyboard back to the cue list (Space = GO).
              e.currentTarget.blur();
            }}
            aria-label={t("Audio output")}
          >
            <option value="">{t("Windows default")}</option>
            {devices.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
            {settings.outputDevice && !devices.includes(settings.outputDevice) ? <option value={settings.outputDevice}>{outputLabel}</option> : null}
          </select>
        </label>
        <div className="df-viewbtns" role="group" aria-label={t("Rows")}>
          <button
            type="button"
            className={view === "compact" ? "ts-btn ts-btn--icon ts-btn--on" : "ts-btn ts-btn--icon"}
            aria-pressed={view === "compact"}
            aria-label={t("Very compact rows: only the chosen options, to see a long cue list at once")}
            title={t("Very compact rows: only the chosen options, to see a long cue list at once")}
            onClick={() => useDoc.getState().setView(view === "compact" ? "normal" : "compact")}
          >
            <Icon name="compact" size={15} />
          </button>
          <button
            type="button"
            className="ts-btn ts-btn--icon"
            aria-label={t("Close the settings of every track")}
            title={t("Close the settings of every track")}
            disabled={!anyExpanded && view === "normal"}
            onClick={() => (useDoc.getState().setAllExpanded(false), useDoc.getState().setView("normal"))}
          >
            <Icon name="collapse" size={15} />
          </button>
          <button
            type="button"
            className="ts-btn ts-btn--icon"
            aria-label={t("Open the settings of every track")}
            title={t("Open the settings of every track")}
            disabled={locked}
            onClick={() => useDoc.getState().setAllExpanded(true)}
          >
            <Icon name="expand" size={15} />
          </button>
        </div>
        {!locked ? (
          <Button icon="lock" onClick={() => useDoc.getState().setLocked(true)} kbd="Ctrl L">
            <span className="df-bl">{t("Lock")}</span>
          </Button>
        ) : (
          <HoldButton className="ts-btn ts-btn--primary" onHold={() => useDoc.getState().setLocked(false)} ariaLabel={t("Hold to unlock")}>
            <Icon name="lock" size={15} />
            {t("Locked")}
            <span style={{ opacity: 0.75, fontWeight: 500 }}>· {t("hold to unlock")}</span>
          </HoldButton>
        )}
      </div>

      <GoBar numbers={numbers} typed={typed} />

      {missingCount > 0 && !locked ? (
        <div className="ts-banner" style={{ borderBottomColor: "var(--stop)", background: "var(--stop-soft)" }}>
          <Icon name="alert" size={15} color="var(--stop)" />
          {t("{n} audio files were not found. They will be skipped until you find them.", { n: missingCount })}
        </div>
      ) : null}

      <main ref={listRef} className={view === "compact" ? "df-list df-list--compact" : "df-list"} aria-label={t("Tracks")}>
        {tracks.map((tr) => (
          <TrackRow
            key={tr.id}
            track={tr}
            number={numbers.get(tr.id) ?? null}
            standby={live.standbyId === tr.id}
            main={live.mainId === tr.id}
            pausedAll={live.pausedAll}
            voice={voiceOf.get(tr.id) ?? null}
            info={tr.file ? infos[tr.file.path] : undefined}
            missing={!!missing[tr.id]}
            locked={locked}
            expanded={!!expanded[tr.id]}
            compact={view === "compact"}
          />
        ))}
        {!locked ? (
          <button type="button" className="df-add-row" onClick={() => useDoc.getState().addTrack()}>
            <Icon name="plus" size={15} />
            {t("Add an empty row")}
          </button>
        ) : null}
        {settings.followPlaying ? <div aria-hidden="true" style={{ flex: "none", height: "70vh" }} /> : null}
      </main>

      <StatusBar>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span className={live.engine.ready ? "ts-dot ts-dot--go" : live.engine.error ? "ts-dot ts-dot--stop" : "ts-dot ts-dot--sb"} />
          {live.engine.ready
            ? `${t("Audio engine ready")} · ${live.engine.device} · ${(live.engine.sampleRate / 1000).toLocaleString()} kHz`
            : live.engine.error ?? t("Starting the audio engine…")}
        </span>
        <span>
          {t("{n} rows", { n: tracks.length })} · {t("{n} hidden", { n: hiddenCount })} · {t("{n} empty", { n: emptyCount })} · {formatTime(total)} {t("total")}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <Icon name="info" size={12} />
          {t("At GO, without an exit")}: {othersText(t, settings.othersOnGo, settings)}
        </span>
        <span className="ts-spacer" />
        <span>
          <Kbd>0–9</Kbd> + <Kbd>Enter</Kbd> {t("standby")} · <Kbd>↑ ↓</Kbd> {t("move standby")} · <Kbd>P</Kbd> {t("pause all")} · <Kbd>M</Kbd> {t("marker")} · <Kbd>Esc</Kbd> ×2 {t("instant stop")}
        </span>
      </StatusBar>

      {dialog === "reorder" ? <ReorderDialog onClose={() => useUi.getState().closeDialog()} /> : null}
      {dialog === "editor" ? <EditorDialog onClose={() => useUi.getState().closeDialog()} /> : null}
    </>
  );
}
