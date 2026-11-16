import { useState } from "react";
import { formatTime, useT } from "@theatre-suite/core";
import { Button, Dialog, Icon, Segmented, type IconName } from "@theatre-suite/ui";
import { api } from "../lib/api";
import { useDoc, trackDuration, effectiveOut } from "../state/doc";
import { seekAllowed } from "./seek";
import { useSettings } from "../state/settings";
import { useUi } from "../state/ui";
import type { EnvPoint, Track } from "../state/types";
import { WaveEditor, type EditGroup } from "./WaveEditor";
import { editTrack } from "./TrackRow";

interface GroupDef {
  id: EditGroup;
  title: string;
  icon: IconName;
  hint: string;
}

const GROUPS: GroupDef[] = [
  { id: "cut", title: "Start & end cut", icon: "edges", hint: "Drag IN and OUT, or type the times." },
  { id: "volume", title: "Volume curve", icon: "sliders", hint: "Click the line to add a point · drag it · double-click a point to remove it." },
  { id: "loop", title: "Loop cut", icon: "loopCut", hint: "Drag LOOP IN and LOOP OUT. The track repeats between them when Loop is on." },
  { id: "pan", title: "Pan", icon: "headphones", hint: "Click in the lower strip to add a point · up is right, down is left." },
];

const KEYS: Record<EditGroup, { ignore: keyof Track; visible: keyof Track }> = {
  cut: { ignore: "ignoreCut", visible: "cutVisible" },
  volume: { ignore: "ignoreEnvelope", visible: "envelopeVisible" },
  loop: { ignore: "ignoreLoop", visible: "loopVisible" },
  pan: { ignore: "ignorePan", visible: "panVisible" },
};

/** Large editing window: start & end cut, volume curve, loop cut and pan, each one on its own. */
export function EditorDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const id = useUi((s) => s.editorTrackId);
  const track = useDoc((s) => s.tracks.find((x) => x.id === id) ?? null);
  const infos = useDoc((s) => s.infos);
  const voice = useDoc((s) => s.live.voices.find((v) => v.trackId === id) ?? null);
  const settings = useSettings((s) => s.settings);
  const [zoom, setZoom] = useState<"1" | "2" | "4" | "8">("1");
  const [editing, setEditing] = useState<EditGroup | null>("cut");
  if (!track || !track.file) return null;
  const info = infos[track.file.path];
  const peaks = info && typeof info === "object" ? info.peaks : null;
  const dur = trackDuration(track, infos);
  const out = effectiveOut(track, dur);
  const patch = (p: Partial<Track>) => useDoc.getState().patchTrack(track.id, p);

  const reset = (g: EditGroup) => {
    if (g === "cut") patch({ inSec: 0, outSec: null });
    else if (g === "volume") patch({ envelope: [] });
    else if (g === "loop") patch({ loop: null });
    else patch({ panEnvelope: [] });
  };
  const isDefault = (g: EditGroup) =>
    g === "cut" ? track.inSec === 0 && track.outSec === null : g === "volume" ? !track.envelope.length : g === "loop" ? !track.loop : !track.panEnvelope.length;

  const standardFade = (kind: "in" | "out") => {
    if (!dur || out === null) return;
    const len = kind === "in" ? settings.fadeInSec : settings.fadeOutSec;
    let pts: EnvPoint[] = [...track.envelope];
    if (kind === "in") {
      const end = Math.min(out, track.inSec + len);
      pts = pts.filter((p) => p.t > end + 0.01 || p.t < track.inSec - 0.01);
      pts.push({ t: track.inSec, v: 0 }, { t: end, v: 1 });
    } else {
      const start = Math.max(track.inSec, out - len);
      pts = pts.filter((p) => p.t < start - 0.01 || p.t > out + 0.01);
      pts.push({ t: start, v: 1 }, { t: out, v: 0 });
    }
    pts.sort((a, b) => a.t - b.t);
    patch({ envelope: pts, envelopeVisible: true });
  };

  const addLoop = () => {
    if (!dur || out === null) return;
    const len = out - track.inSec;
    patch({
      loop: { inSec: Math.round((track.inSec + len * 0.4) * 100) / 100, outSec: Math.round((track.inSec + len * 0.8) * 100) / 100 },
      loopVisible: true,
    });
    setEditing("loop");
  };

  const status = (g: EditGroup): string => {
    if (g === "cut") return track.inSec === 0 && track.outSec === null ? t("Whole track") : `IN ${formatTime(track.inSec, true)} · OUT ${formatTime(out ?? 0, true)}`;
    if (g === "volume") return track.envelope.length ? t("{n} points", { n: track.envelope.length }) : t("No curve");
    if (g === "loop") return track.loop ? `${formatTime(track.loop.inSec, true)} → ${formatTime(track.loop.outSec, true)}` : t("No loop points");
    return track.panEnvelope.length ? t("{n} points", { n: track.panEnvelope.length }) : t("No curve");
  };

  const current = GROUPS.find((g) => g.id === editing) ?? null;

  return (
    <Dialog
      title={`${t("EDITING")} · ${track.file.name}`}
      icon="pencil"
      width={1180}
      onClose={onClose}
      description={current ? t(current.hint) : t("Press Edit on a group to change it. The others stay as they are.")}
      footer={
        <>
          <Segmented
            small
            ariaLabel={t("Zoom")}
            value={zoom}
            onChange={setZoom}
            options={[
              { value: "1", label: "1×" },
              { value: "2", label: "2×" },
              { value: "4", label: "4×" },
              { value: "8", label: "8×" },
            ]}
          />
          <span className="ts-spacer" />
          <Button variant="primary" icon="check" onClick={onClose}>
            {t("Done")}
          </Button>
        </>
      }
    >
      <div style={{ overflowX: "auto", paddingBottom: 6 }}>
        <div style={{ width: `${Number(zoom) * 100}%` }}>
          <WaveEditor
            track={track}
            duration={dur}
            peaks={peaks}
            height={280}
            panHeight={track.panVisible ? 96 : 0}
            playheadSec={voice?.positionSec ?? null}
            editing={editing}
            waveStyle={settings.waveStyle}
            onChange={(p, phase) => editTrack(track.id, p, phase)}
            onSeek={seekAllowed(voice, settings.seekClick, false) ? (sec) => api.engineSeek(track.id, sec).catch(() => {}) : undefined}
            onRemoveMarker={(i) => useDoc.getState().removeMarker(track.id, i)}
            snap={settings.snapMarkers}
            t={t}
          />
        </div>
      </div>
      <div className="df-groups">
        {GROUPS.map((g) => {
          const ignored = !!track[KEYS[g.id].ignore];
          const visible = !!track[KEYS[g.id].visible];
          const on = editing === g.id;
          return (
            <section key={g.id} className={on ? "df-group df-group--on" : "df-group"} aria-label={t(g.title)}>
              <div className="df-group__head">
                <Icon name={g.icon} size={14} />
                <b>{t(g.title)}</b>
                <span className="df-group__status">{ignored ? t("Ignored") : status(g.id)}</span>
              </div>
              <div className="df-group__btns">
                <Button
                  variant="sm"
                  icon="pencil"
                  on={on}
                  aria-pressed={on}
                  onClick={() => {
                    if (on) setEditing(null);
                    else {
                      setEditing(g.id);
                      if (!visible) patch({ [KEYS[g.id].visible]: true } as Partial<Track>);
                    }
                  }}
                >
                  {t("Edit")}
                </Button>
                <Button variant="sm" icon="reset" disabled={isDefault(g.id)} onClick={() => reset(g.id)}>
                  {t("Reset")}
                </Button>
                <Button
                  variant="sm"
                  icon="ignoreVol"
                  on={ignored}
                  aria-pressed={ignored}
                  title={t("Keeps the settings but plays as if they were not there")}
                  onClick={() => patch({ [KEYS[g.id].ignore]: !ignored } as Partial<Track>)}
                >
                  {t("Ignore")}
                </Button>
                <Button
                  variant="sm"
                  icon={visible ? "eye" : "eyeOff"}
                  aria-pressed={visible}
                  title={t("Hidden, it keeps working")}
                  onClick={() => {
                    patch({ [KEYS[g.id].visible]: !visible } as Partial<Track>);
                    // A hidden group cannot be edited: stop editing it.
                    if (visible && on) setEditing(null);
                  }}
                >
                  {visible ? t("Hide group") : t("Show group")}
                </Button>
                {g.id === "volume" ? (
                  <>
                    <Button variant="sm" icon="fadeIn" disabled={!dur} onClick={() => standardFade("in")}>
                      {t("Standard fade in")}
                    </Button>
                    <Button variant="sm" icon="fadeOut" disabled={!dur} onClick={() => standardFade("out")}>
                      {t("Standard fade out")}
                    </Button>
                  </>
                ) : null}
                {g.id === "loop" && !track.loop ? (
                  <Button variant="sm" icon="repeat" disabled={!dur} onClick={addLoop}>
                    {t("Add loop points")}
                  </Button>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>
    </Dialog>
  );
}
