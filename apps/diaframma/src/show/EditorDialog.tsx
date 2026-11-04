import { useState } from "react";
import { useT } from "@theatre-suite/core";
import { Button, Dialog, Segmented } from "@theatre-suite/ui";
import { useDoc, trackDuration } from "../state/doc";
import { useUi } from "../state/ui";
import { WaveEditor } from "./WaveEditor";
import { editTrack } from "./TrackRow";

/** Large editor for IN/OUT, loop points and the volume curve. */
export function EditorDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const id = useUi((s) => s.editorTrackId);
  const track = useDoc((s) => s.tracks.find((x) => x.id === id) ?? null);
  const infos = useDoc((s) => s.infos);
  const voice = useDoc((s) => s.live.voices.find((v) => v.trackId === id) ?? null);
  const [zoom, setZoom] = useState<"1" | "2" | "4" | "8">("1");
  if (!track || !track.file) return null;
  const info = infos[track.file.path];
  const peaks = info && typeof info === "object" ? info.peaks : null;
  const dur = trackDuration(track, infos);
  return (
    <Dialog
      title={track.file.name}
      icon="zoom"
      width={1180}
      onClose={onClose}
      description={t("Drag IN and OUT · click the line to add a point · double-click a point to remove it")}
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
          <Button variant="sm" icon="reset" onClick={() => useDoc.getState().patchTrack(track.id, { envelope: [] })} disabled={!track.envelope.length}>
            {t("Remove volume curve")}
          </Button>
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
            height={320}
            playheadSec={voice?.positionSec ?? null}
            onChange={(patch, phase) => editTrack(track.id, patch, phase)}
            t={t}
          />
        </div>
      </div>
    </Dialog>
  );
}
