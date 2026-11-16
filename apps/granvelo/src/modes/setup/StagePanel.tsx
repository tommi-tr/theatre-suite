import { useMemo, useState } from "react";
import { useLang, useT } from "@theatre-suite/core";
import { Button, Segmented } from "@theatre-suite/ui";
import { dropLights, setAims, updateScenery } from "../../model/ops";
import type { GranveloDoc, Id, Vec3 } from "../../model/types";
import { fmtNum } from "../../lib/format";
import { useDoc } from "../../store/doc";
import { useOutput } from "../../store/output";
import { useSettings } from "../../store/settings";
import { useUi } from "../../store/ui";
import { StageView, lightPosition, webglAvailable, resolveDrop, type OnStagePress, type StageCamera, type StageDrag } from "../../stage";
import { trussName, useSelectedIds } from "./common";
import { numberClick } from "./LightsList";
import { useSetup, type StageTool } from "./store";

/** States of the output in which the stage shows the light: what goes to the lights (also simulated). */
const SHOWS_LIGHT = new Set(["connected", "simulated", "lost"]);

/**
 * The centre of Allestimento: the stage (3D, or 2D on computers without 3D) with its tools — Sposta, Orienta,
 * Numera a clic, Scenografia — and the views Prospettiva / Pianta / Frontale. Every change goes through the document
 * store (one step of undo per drag); while dragging, the stage shows a preview of the document.
 */
export function StagePanel() {
  const t = useT();
  const lang = useLang();
  const doc = useDoc((s) => s.doc)!;
  const selected = useSelectedIds();
  const tool = useSetup((s) => s.tool);
  const camera = useSetup((s) => s.camera);
  const sceneryId = useSetup((s) => s.sceneryId);
  const numbering = useSetup((s) => s.numbering);
  const ask = useSetup((s) => s.numberingAsk);
  const detailSetting = useSettings((s) => s.settings.previewDetail);
  const values = useOutput((s) => (SHOWS_LIGHT.has(s.status.link.state) ? s.under : undefined));
  const [preview, setPreview] = useState<GranveloDoc | null>(null);
  const [readout, setReadout] = useState<string | null>(null);
  const [no3D, setNo3D] = useState(false);
  // "Alta" and "Automatica" arrive with phase 5: until then they draw as "Media".
  const detail = detailSetting === "essential" ? "essential" : "medium";
  const n = (v: number) => fmtNum(v, lang);
  const xyz = (p: Vec3) => `X ${n(p.x)} · Y ${n(p.y)} · Z ${n(p.z)} m`;

  const onPress: OnStagePress = (hit, info) => {
    const ui = useUi.getState();
    const setup = useSetup.getState();
    if (setup.numbering) {
      if (hit.kind === "light") numberClick(t, hit.id);
      return null;
    }
    if (tool === "scenery") {
      if (hit.kind !== "scenery") {
        if (hit.kind === "empty") setup.setSceneryId(null);
        return null;
      }
      setup.setSceneryId(hit.id);
      const start = useDoc.getState().doc!;
      const piece = start.scenery.find((s) => s.id === hit.id);
      if (!piece) return null;
      return drag(piece.position, (to) => {
        setReadout(`${piece.name || t("Piece")} · ${xyz(to)}`);
        return updateScenery(start, piece.id, { position: to });
      }, (d, to) => updateScenery(d, piece.id, { position: to }));
    }
    if (hit.kind === "truss") {
      setup.setEditingTruss(hit.id);
      return null;
    }
    if (hit.kind === "empty") {
      if (!info.ctrl && !info.shift) ui.setSelection([]);
      return null;
    }
    if (hit.kind === "light") {
      const was = useUi.getState().selection;
      let ids: Id[];
      if (info.ctrl || info.shift) {
        ids = was.includes(hit.id) ? was.filter((x) => x !== hit.id) : [...was, hit.id];
        ui.setSelection(ids, hit.id, hit.id);
        if (!ids.includes(hit.id)) return null;
      } else {
        ids = was.includes(hit.id) ? was : [hit.id];
        ui.setSelection(ids, hit.id, hit.id);
      }
      const start = useDoc.getState().doc!;
      const pressed = start.fixtures.find((f) => f.id === hit.id)!;
      const from = lightPosition(pressed, start);
      if (tool !== "move") {
        // Orienta: a click selects; the handles move the aim.
        return null;
      }
      const moves = (to: Vec3) => {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const dz = to.z - from.z;
        return ids.flatMap((id) => {
          const f = start.fixtures.find((x) => x.id === id);
          if (!f) return [];
          const p = lightPosition(f, start);
          return [{ id, to: { x: p.x + dx, y: p.y + dy, z: p.z + dz } }];
        });
      };
      const base = drag(
        from,
        (to) => {
          const r = resolveDrop(start, pressed.mount, to);
          const where =
            r.mount.kind === "truss"
              ? trussName(t, start, r.mount.trussId)
              : r.mount.kind === "newTruss"
                ? t("New truss")
                : r.mount.kind === "floor"
                  ? t("On the floor")
                  : t("Floating");
          setReadout(`${where} · ${xyz(r.position)}`);
          return dropLights(start, moves(to)).doc;
        },
        (d, to) => {
          const r = dropLights(d, moves(to));
          if (r.newTrusses.length) ui.showToast(t("New truss: {name}. Rename it or move it with the pencil in the list.", { name: trussName(t, r.doc, r.newTrusses[0]) }));
          return r.doc;
        },
      );
      return {
        ...base,
        end: (to, axes) => {
          base.end(to, axes);
          // A simple click on a light of a group selects only that light.
          if (!to && !info.ctrl && !info.shift && ids.length > 1) ui.setSelection([hit.id], hit.id, hit.id);
        },
      };
    }
    if (hit.kind === "aim") {
      const start = useDoc.getState().doc!;
      const ids = useUi.getState().selection;
      const pressed = start.fixtures.find((f) => f.id === hit.id);
      if (!pressed) return null;
      const from = pressed.aim;
      const aims = (to: Vec3) => {
        const out: Record<Id, Vec3> = {};
        for (const f of start.fixtures) if (ids.includes(f.id)) out[f.id] = { x: f.aim.x + to.x - from.x, y: f.aim.y + to.y - from.y, z: Math.max(0, f.aim.z + to.z - from.z) };
        return out;
      };
      return drag(from, (to) => {
        setReadout(`${t("Points at")} · ${xyz(aims(to)[hit.id] ?? to)}`);
        return setAims(start, aims(to));
      }, (d, to) => setAims(d, aims(to)));
    }
    return null;
  };

  /** A drag that shows `preview(to)` while moving and commits `commit(doc, to)` once at the end (one step of undo). */
  function drag(from: Vec3, previewAt: (to: Vec3) => GranveloDoc, commit: (d: GranveloDoc, to: Vec3) => GranveloDoc): StageDrag {
    const done = (to: Vec3 | null) => {
      setPreview(null);
      setReadout(null);
      if (to) useDoc.getState().change((d) => commit(d, to));
    };
    return { from, move: (to) => setPreview(previewAt(to)), end: (to) => done(to) };
  }

  const shown = preview ?? doc;
  const pick = useMemo(
    () => (numbering ? { lights: true } : tool === "scenery" ? { scenery: true } : { lights: true, aims: tool === "aim", trusses: true }),
    [numbering, tool],
  );

  const hint = numbering
    ? t("Click the lights one after the other: each gets the next address.")
    : tool === "move"
      ? camera === "perspective"
        ? t("Drag a light to move it (Shift: up and down). Left high with no truss nearby, it creates one; near a truss it hangs on it; near the floor it stands on it.")
        : t("Drag a light to move it. Left high with no truss nearby, it creates one; near a truss it hangs on it; near the floor it stands on it.")
      : tool === "aim"
        ? selected.length
          ? t("Drag the round handle to where the selected lights should point.")
          : t("Select one or more lights, then drag the round handle to where they should point.")
        : t("Add a piece on the right, then drag it on the stage. Size, turn and colour are on the right.");

  return (
    <section className="gv-su-stagearea" aria-label={t("Stage")}>
      <div className="gv-su-stagebar">
        <Segmented<StageTool>
          ariaLabel={t("Tool")}
          small
          value={tool}
          onChange={(v) => {
            useSetup.getState().setTool(v);
            if (v !== "scenery") useSetup.getState().setSceneryId(null);
          }}
          options={[
            { value: "move", label: t("Move") },
            { value: "aim", label: t("Aim") },
            { value: "scenery", label: t("Scenery") },
          ]}
        />
        <Button
          variant="sm"
          icon="listNum"
          on={!!numbering || ask}
          disabled={doc.fixtures.length === 0}
          title={t("Click the lights in order to give them consecutive addresses")}
          onClick={() => {
            const s = useSetup.getState();
            if (s.numbering) s.setNumbering(null);
            else s.setNumberingAsk(!s.numberingAsk);
          }}
        >
          {t("Number by clicking")}
        </Button>
        <span className="ts-spacer" />
        <Segmented<StageCamera>
          ariaLabel={t("View")}
          small
          value={camera}
          onChange={(v) => useSetup.getState().setCamera(v)}
          options={[
            { value: "perspective", label: t("Perspective") },
            { value: "plan", label: t("Plan") },
            { value: "front", label: t("Front") },
          ]}
        />
      </div>
      <div className="gv-su-stageview">
        <StageView
          doc={shown}
          camera={camera}
          values={values}
          selected={selected}
          selectedScenery={tool === "scenery" ? sceneryId : null}
          detail={detail}
          showAims={tool === "aim" && !numbering}
          pick={pick}
          onPress={onPress}
          onNo3D={() => setNo3D(true)}
          className="gv-su-stagebox"
        />
        {readout ? <div className="gv-su-readout">{readout}</div> : null}
        <p className="gv-su-stagehint">
          {hint}
          {camera === "perspective" && !no3D && webglAvailable() ? <span className="gv-su-stagehint__nav"> {t("Mouse: left turns, right moves, wheel zooms.")}</span> : null}
        </p>
      </div>
    </section>
  );
}
