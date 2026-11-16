import { useEffect, useState } from "react";
import { useT, type TFunc } from "@theatre-suite/core";
import { Button, Icon, confirmYesNo } from "@theatre-suite/ui";
import { addScenery, removeScenery, sceneryName, updateScenery } from "../../model/ops";
import type { GranveloDoc, Scenery, SceneryShape, Vec3 } from "../../model/types";
import { useDoc } from "../../store/doc";
import { useUi } from "../../store/ui";
import { FieldNumber, Section } from "./common";
import { useSetup } from "./store";

const SHAPES: SceneryShape[] = ["box", "plane", "cylinder", "cone", "sphere"];

export function shapeName(t: TFunc, shape: SceneryShape): string {
  switch (shape) {
    case "box":
      return t("Box");
    case "plane":
      return t("Flat panel");
    case "cylinder":
      return t("Cylinder");
    case "cone":
      return t("Cone");
    default:
      return t("Sphere");
  }
}

/** Small line drawings of the shapes, for the buttons and the list. */
const SHAPE_PATHS: Record<SceneryShape, string> = {
  box: "M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8",
  plane: "M5 4h14v16H5z",
  cylinder: "M6 6a6 2 0 1 0 12 0a6 2 0 1 0-12 0M6 6v12a6 2 0 0 0 12 0V6",
  cone: "M12 3L5 18a7 2.5 0 0 0 14 0z",
  sphere: "M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16M4 12a8 3 0 0 0 16 0",
};

function ShapeIcon({ shape, size = 16 }: { shape: SceneryShape; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none" }}>
      <path d={SHAPE_PATHS[shape]} />
    </svg>
  );
}

const change = (recipe: (d: GranveloDoc) => GranveloDoc, key?: string) => useDoc.getState().change(recipe, key);

/**
 * The right panel with the "Scenografia" tool: add pieces (box, panel, cylinder, cone, sphere), choose one (here or on
 * the stage) and change its name, place, turn, size and colour.
 */
export function SceneryPanel() {
  const t = useT();
  const doc = useDoc((s) => s.doc)!;
  const sceneryId = useSetup((s) => s.sceneryId);
  const piece = doc.scenery.find((s) => s.id === sceneryId) ?? null;

  const add = (shape: SceneryShape) => {
    let id = "";
    change((d) => {
      const n = d.scenery.length;
      const r = addScenery(d, { shape, name: sceneryName(d, shapeName(t, shape)), position: { x: ((n % 5) - 2) * 0.7, y: d.stage.depth / 2 } });
      id = r.id;
      return r.doc;
    });
    if (id) useSetup.getState().setSceneryId(id);
  };

  return (
    <aside className="gv-props gv-su-props" aria-label={t("Scenery")}>
      <div className="gv-propsbox gv-su-box">
        <Section title={t("Add a piece")}>
          <div className="gv-su-shapes">
            {SHAPES.map((s) => (
              <button key={s} type="button" className="gv-su-shape" onClick={() => add(s)} title={t("Add: {what}", { what: shapeName(t, s) })}>
                <ShapeIcon shape={s} size={20} />
                <span>{shapeName(t, s)}</span>
              </button>
            ))}
          </div>
        </Section>

        <Section title={t("Pieces on stage")}>
          {doc.scenery.length === 0 ? (
            <p className="gv-su-hint">{t("No scenery yet. Pieces are simple shapes: enough to see where the light falls.")}</p>
          ) : (
            <ul className="gv-su-pieces">
              {doc.scenery.map((s) => (
                <li key={s.id}>
                  <button type="button" className="gv-su-piece" aria-pressed={s.id === sceneryId} onClick={() => useSetup.getState().setSceneryId(s.id === sceneryId ? null : s.id)}>
                    <span className="gv-su-piece__swatch" style={{ background: s.color }} />
                    <ShapeIcon shape={s.shape} />
                    <span className="ts-ellipsis">{s.name || shapeName(t, s.shape)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {piece ? <PieceEditor key={piece.id} piece={piece} doc={doc} /> : doc.scenery.length ? <p className="gv-su-hint gv-su-hint--pad">{t("Click a piece, here or on the stage, to change it.")}</p> : null}
      </div>
    </aside>
  );
}

function PieceEditor({ piece, doc }: { piece: Scenery; doc: GranveloDoc }) {
  const t = useT();
  const [name, setName] = useState(piece.name);
  useEffect(() => setName(piece.name), [piece.name]);
  const id = piece.id;
  const set = (patch: Partial<Scenery>, key?: string) => change((d) => updateScenery(d, id, patch), key);
  const vec = (which: "position" | "rotation" | "size", axis: keyof Vec3, v: number) => set({ [which]: { ...piece[which], [axis]: v } }, `scenery:${id}:${which}:${axis}`);
  const round = piece.shape === "cone" || piece.shape === "sphere" || piece.shape === "cylinder";

  const sizeFields: { axis: keyof Vec3; label: string }[] =
    piece.shape === "sphere"
      ? [{ axis: "x", label: t("Diameter") }]
      : round
        ? [
            { axis: "x", label: t("Diameter") },
            { axis: "z", label: t("Height") },
          ]
        : piece.shape === "plane"
          ? [
              { axis: "x", label: t("Width") },
              { axis: "z", label: t("Height") },
            ]
          : [
              { axis: "x", label: t("Width") },
              { axis: "y", label: t("Depth") },
              { axis: "z", label: t("Height") },
            ];

  const del = async () => {
    const used = doc.memories.filter((m) => m.scenery.some((p) => p.sceneryId === id)).length;
    if (used > 0) {
      const ok = await confirmYesNo({
        title: t("Delete this piece?"),
        message: used === 1 ? t("1 memory has it on stage: it will no longer be there.") : t("{n} memories have it on stage: it will no longer be there.", { n: used }),
        confirm: t("Delete"),
        cancel: t("Cancel"),
        close: t("Close"),
        danger: true,
      });
      if (!ok) return;
    }
    change((d) => removeScenery(d, id));
    useSetup.getState().setSceneryId(null);
    useUi.getState().showToast(t("Piece deleted. Undo brings it back."));
  };

  return (
    <>
      <Section title={t("This piece")}>
        <label className="gv-su-f">
          <span className="ts-label">{t("Name")}</span>
          <input
            className="ts-input"
            value={name}
            aria-label={t("Name of the piece")}
            onChange={(e) => setName(e.currentTarget.value)}
            onBlur={() => name.trim() !== piece.name && set({ name })}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") e.currentTarget.blur();
              else if (e.key === "Escape") {
                setName(piece.name);
                e.currentTarget.blur();
              }
            }}
          />
        </label>
        <div className="gv-su-grid2">
          <label className="gv-su-f">
            <span className="ts-label">{t("Shape")}</span>
            <select className="ts-select" value={piece.shape} aria-label={t("Shape")} onChange={(e) => set({ shape: e.currentTarget.value as SceneryShape })}>
              {SHAPES.map((s) => (
                <option key={s} value={s}>
                  {shapeName(t, s)}
                </option>
              ))}
            </select>
          </label>
          <label className="gv-su-f">
            <span className="ts-label">{t("Colour")}</span>
            <input type="color" className="gv-su-color" value={piece.color.toLowerCase()} aria-label={t("Colour of the piece")} onChange={(e) => set({ color: e.currentTarget.value }, `scenery:${id}:color`)} />
          </label>
        </div>
      </Section>

      <Section title={t("Position")}>
        <div className="gv-su-xyz">
          {(["x", "y", "z"] as const).map((axis) => (
            <label key={axis} className="gv-su-xyz__f">
              <span className="gv-su-xyz__axis">{axis.toUpperCase()}</span>
              <FieldNumber value={piece.position[axis]} min={-200} max={200} unit="m" label={`${t("Position")} ${axis.toUpperCase()}`} onCommit={(v) => vec("position", axis, v)} />
            </label>
          ))}
        </div>
        <p className="gv-su-hint">{t("X from left to right seen from the audience, Y depth from the front edge, Z height of the base.")}</p>
      </Section>

      <Section title={t("Turn")}>
        <div className="gv-su-xyz">
          {(["z", "x", "y"] as const).map((axis) => (
            <label key={axis} className="gv-su-xyz__f">
              <span className="gv-su-xyz__axis">{axis.toUpperCase()}</span>
              <FieldNumber value={piece.rotation[axis]} min={-360} max={360} decimals={1} unit="°" label={`${t("Turn")} ${axis.toUpperCase()}`} onCommit={(v) => vec("rotation", axis, v)} />
            </label>
          ))}
        </div>
        <p className="gv-su-hint">{t("Z turns it on the floor; X tilts it forwards or backwards; Y tilts it to the side.")}</p>
      </Section>

      <Section title={t("Size")}>
        <div className="gv-su-xyz">
          {sizeFields.map((f) => (
            <label key={f.axis} className="gv-su-xyz__f gv-su-xyz__f--word">
              <span className="gv-su-xyz__axis">{f.label}</span>
              <FieldNumber value={piece.size[f.axis]} min={0} max={100} unit="m" label={f.label} onCommit={(v) => vec("size", f.axis, v)} />
            </label>
          ))}
        </div>
      </Section>

      <div className="gv-su-foot">
        <Button variant="sm" icon="trash" onClick={() => void del()}>
          {t("Delete the piece")}
        </Button>
      </div>
      <p className="gv-su-hint gv-su-hint--pad">
        <Icon name="info" size={12} /> {t("Memories remember which pieces are on stage and where: that comes with the desk.")}
      </p>
    </>
  );
}
