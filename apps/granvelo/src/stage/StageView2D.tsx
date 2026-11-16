import { useEffect, useId, useMemo, useRef, type PointerEvent as RPointerEvent } from "react";
import { useT } from "@theatre-suite/core";
import { fixtureType } from "../model/fixtureTypes";
import type { Vec3 } from "../model/types";
import { SymbolGlyph } from "../common/symbolGlyph";
import { facing, project, sceneryOutline, unproject, viewBounds, type Box2, type View2D } from "./geometry";
import { lightLabel, sceneryOnStage, stageLights, symbolOffset, type StageLight } from "./scene";
import type { DragAxes, StageDrag, StageHit, StageViewProps } from "./types";
import "./stage.css";

const NONE: readonly string[] = [];

/**
 * The stage in 2D, in SVG: the **plan** (from above, the audience at the bottom) or the **front** (from the audience).
 * Stage outline, trusses, scenery, the flat symbols of the lights and the light they make (pools, and in "Media" the
 * beams). Cheap enough for the thumbnails of the memories (`compact`), and the view used when the computer has no 3D.
 * Units of the drawing = metres.
 */
export function StageView2D(props: StageViewProps & { view: View2D }) {
  const { doc, view, values, selected = NONE, scenery = "all", selectedScenery = null, detail = "medium", showAims, pick = {}, onPress, compact, className, label } = props;
  const t = useT();
  const uid = useId().replace(/:/g, "");
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef<{ drag: StageDrag; start: { x: number; y: number }; startWorld: Vec3; moved: boolean; axes: DragAxes; pointer: number } | null>(null);
  const frozen = useRef<Box2 | null>(null);

  const lights = useMemo(() => stageLights(doc, values, selected, !compact), [doc, values, selected, compact]);
  const pieces = useMemo(() => sceneryOnStage(doc, scenery), [doc, scenery]);
  const live = useMemo(() => viewBounds(doc, view), [doc, view]);
  // While dragging, the drawing does not re-frame itself under the mouse.
  const b = dragging.current && frozen.current ? frozen.current : live;
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  const s = Math.min(0.8, Math.max(0.3, Math.max(w, h) * 0.042));
  const { width, depth, height } = doc.stage;

  // Far things first in the front view (the near ones are drawn over them).
  const ordered = useMemo(() => (view === "front" ? [...lights].sort((a, c) => c.pos.y - a.pos.y) : lights), [lights, view]);
  const orderedPieces = useMemo(() => (view === "front" ? [...pieces].sort((a, c) => c.position.y - a.position.y) : pieces), [pieces, view]);
  const lit = lights.filter((l) => l.light);
  const hues = [...new Set(lit.map((l) => l.light!.hue))];
  const gid = (hue: string) => `${uid}-g${hue.slice(1)}`;

  const toWorld = (e: { clientX: number; clientY: number }, keep: Vec3): Vec3 | null => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return unproject({ x: p.x, y: p.y }, view, keep);
  };

  const hitOf = (target: EventTarget | null): StageHit => {
    const el = (target as Element | null)?.closest?.("[data-hit]");
    const v = el?.getAttribute("data-hit");
    if (!v) return { kind: "empty" };
    const i = v.indexOf(":");
    return { kind: v.slice(0, i), id: v.slice(i + 1) } as StageHit;
  };

  const onPointerDown = (e: RPointerEvent<SVGSVGElement>) => {
    if (!onPress || e.button !== 0) return;
    const drag = onPress(hitOf(e.target), { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey });
    if (!drag) return;
    const startWorld = toWorld(e, drag.from);
    if (!startWorld) return;
    e.preventDefault();
    frozen.current = live;
    dragging.current = { drag, start: { x: e.clientX, y: e.clientY }, startWorld, moved: false, axes: view === "plan" ? "xy" : "xz", pointer: e.pointerId };
    svgRef.current?.setPointerCapture(e.pointerId);
  };
  const pointAt = (e: { clientX: number; clientY: number }): Vec3 | null => {
    const d = dragging.current!;
    const p = toWorld(e, d.drag.from);
    if (!p) return null;
    const f = d.drag.from;
    const to = { x: f.x + p.x - d.startWorld.x, y: f.y + p.y - d.startWorld.y, z: f.z + p.z - d.startWorld.z };
    return view === "plan" ? { ...to, z: f.z } : { ...to, y: f.y };
  };
  const onPointerMove = (e: RPointerEvent<SVGSVGElement>) => {
    const d = dragging.current;
    if (!d || e.pointerId !== d.pointer) return;
    if (!d.moved && Math.hypot(e.clientX - d.start.x, e.clientY - d.start.y) < 4) return;
    d.moved = true;
    const to = pointAt(e);
    if (to) d.drag.move(to, d.axes);
  };
  const finish = (e: { clientX: number; clientY: number } | null) => {
    const d = dragging.current;
    if (!d) return;
    dragging.current = null;
    frozen.current = null;
    d.drag.end(e && d.moved ? pointAt(e) : null, d.axes);
  };

  // Esc while dragging puts everything back.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dragging.current) {
        e.stopPropagation();
        finish(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const P = (v: Vec3) => project(v, view);
  const deg = (rad: number) => (rad * 180) / Math.PI;
  const stroke = compact ? 0.03 : 0.025;

  /** The pool of a light on this view: centre, half axes, rotation (degrees, screen). */
  const poolShape = (l: StageLight) => {
    const p = l.pool;
    if (view === "plan") return { cx: p.cx, cy: -p.cy, rx: p.rx, ry: p.ry, rot: -deg(p.angle) };
    if (p.kind === "floor") {
      const c = Math.cos(p.angle);
      const sn = Math.sin(p.angle);
      return { cx: p.cx, cy: 0, rx: Math.hypot(p.rx * c, p.ry * sn), ry: Math.min(0.14, p.ry * 0.12), rot: 0 };
    }
    if (p.kind === "aim") return { cx: p.end.x, cy: -p.end.z, rx: p.endRadius, ry: p.endRadius, rot: 0 };
    const a = P(l.pos);
    const e = P(p.end);
    return { cx: (a.x + e.x) / 2, cy: (a.y + e.y) / 2, rx: Math.max(p.endRadius, Math.hypot(e.x - a.x, e.y - a.y) / 2), ry: p.endRadius, rot: deg(Math.atan2(e.y - a.y, e.x - a.x)) };
  };

  /** The beam as a triangle from the light to the two sides of where it lands. */
  const beamPoints = (l: StageLight) => {
    const a = P(l.pos);
    const ps = poolShape(l);
    const end = view === "plan" || l.pool.kind === "aim" ? { x: ps.cx, y: ps.cy } : P(l.pool.end);
    const dx = end.x - a.x;
    const dy = end.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.05) return null;
    const r = view === "plan" ? ps.ry : Math.max(l.pool.endRadius, 0.1);
    const nx = (-dy / len) * r;
    const ny = (dx / len) * r;
    return `${a.x},${a.y} ${end.x + nx},${end.y + ny} ${end.x - nx},${end.y - ny}`;
  };

  const pickLights = !!pick.lights && !!onPress;
  const pickScenery = !!pick.scenery && !!onPress;
  const pickTrusses = !!pick.trusses && !!onPress;
  const pickAims = !!pick.aims && !!onPress;
  const sel = lights.filter((l) => l.selected);

  return (
    <svg
      ref={svgRef}
      className={`gv-stage2d${compact ? " gv-stage2d--compact" : ""}${className ? ` ${className}` : ""}`}
      viewBox={`${b.minX} ${b.minY} ${w} ${h}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={label ?? (view === "plan" ? t("Stage seen from above") : t("Stage seen from the audience"))}
      data-interactive={onPress ? "" : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => finish(e)}
      onPointerCancel={() => finish(null)}
    >
      <defs>
        {detail === "medium"
          ? hues.map((hue) => (
              <radialGradient key={hue} id={gid(hue)}>
                <stop offset="0" stopColor={hue} stopOpacity="0.95" />
                <stop offset="0.55" stopColor={hue} stopOpacity="0.55" />
                <stop offset="1" stopColor={hue} stopOpacity="0" />
              </radialGradient>
            ))
          : null}
      </defs>

      {/* The stage: floor solid, the rest of the volume in thin lines. */}
      {view === "plan" ? (
        <g data-hit={undefined}>
          <rect x={-width / 2} y={-depth} width={width} height={depth} className="gv-stage2d__floor" strokeWidth={stroke} />
          <line x1={-width / 2} y1={0} x2={width / 2} y2={0} className="gv-stage2d__edge" strokeWidth={stroke * 2.4} />
          {!compact ? (
            <>
              <text x={-width / 2 + 0.12} y={-depth + s * 0.62} className="gv-stage2d__words" fontSize={s * 0.42}>
                {t("Back of the stage")}
              </text>
              <text x={-width / 2 + 0.12} y={s * 0.62} className="gv-stage2d__words" fontSize={s * 0.42}>
                {t("Audience")}
              </text>
            </>
          ) : null}
        </g>
      ) : (
        <g>
          <rect x={-width / 2} y={-height} width={width} height={height} className="gv-stage2d__volume" strokeWidth={stroke} />
          <line x1={-width / 2} y1={0} x2={width / 2} y2={0} className="gv-stage2d__edge" strokeWidth={stroke * 4} />
        </g>
      )}

      {/* Scenery. */}
      <g>
        {orderedPieces.map((p) => {
          const pts = sceneryOutline(p, view);
          const on = p.id === selectedScenery;
          return (
            <polygon
              key={p.id}
              points={pts.map((q) => `${q.x},${q.y}`).join(" ")}
              fill={p.color}
              className={`gv-stage2d__piece${on ? " is-selected" : ""}`}
              strokeWidth={on ? stroke * 3 : stroke}
              data-hit={pickScenery ? `scenery:${p.id}` : undefined}
            >
              {!compact ? <title>{p.name}</title> : null}
            </polygon>
          );
        })}
      </g>

      {/* The light the lights make. */}
      <g className="gv-stage2d__light">
        {detail === "medium"
          ? lit.map((l) => {
              const pts = beamPoints(l);
              return pts ? <polygon key={`b${l.f.id}`} points={pts} fill={l.light!.hue} opacity={0.05 + 0.13 * l.light!.level} /> : null;
            })
          : null}
        {lit.map((l) => {
          const ps = poolShape(l);
          return (
            <ellipse
              key={`p${l.f.id}`}
              cx={ps.cx}
              cy={ps.cy}
              rx={ps.rx}
              ry={ps.ry}
              transform={ps.rot ? `rotate(${ps.rot} ${ps.cx} ${ps.cy})` : undefined}
              fill={detail === "medium" ? `url(#${gid(l.light!.hue)})` : l.light!.hue}
              opacity={detail === "medium" ? Math.min(1, 0.25 + 0.75 * l.light!.level) : 0.2 + 0.5 * l.light!.level}
            />
          );
        })}
      </g>

      {/* Where the selected lights point (always, also dark). */}
      {!compact
        ? sel.map((l) => {
            const ps = poolShape(l);
            const a = P(l.pos);
            const aim = P(l.f.aim);
            return (
              <g key={`o${l.f.id}`} className="gv-stage2d__aimline">
                <line x1={a.x} y1={a.y} x2={aim.x} y2={aim.y} strokeWidth={stroke} strokeDasharray={`${s * 0.18} ${s * 0.14}`} />
                <ellipse cx={ps.cx} cy={ps.cy} rx={ps.rx} ry={ps.ry} transform={ps.rot ? `rotate(${ps.rot} ${ps.cx} ${ps.cy})` : undefined} strokeWidth={stroke} strokeDasharray={`${s * 0.18} ${s * 0.14}`} />
              </g>
            );
          })
        : null}

      {/* Trusses: a bar across the whole width. */}
      <g>
        {doc.trusses.map((tr) => {
          const y = view === "plan" ? -tr.y : -tr.z;
          const x1 = -width / 2 - 0.3;
          const x2 = width / 2 + 0.3;
          const gap = Math.min(0.08, s * 0.12);
          return (
            <g key={tr.id} className="gv-stage2d__truss" data-hit={pickTrusses ? `truss:${tr.id}` : undefined}>
              <line x1={x1} y1={y} x2={x2} y2={y} className="gv-stage2d__trusshit" strokeWidth={s * 0.5} />
              <line x1={x1} y1={y - gap} x2={x2} y2={y - gap} strokeWidth={stroke * 1.4} />
              <line x1={x1} y1={y + gap} x2={x2} y2={y + gap} strokeWidth={stroke * 1.4} />
            </g>
          );
        })}
      </g>

      {/* The lights. */}
      <g>
        {ordered.map((l) => {
          const p = P(l.pos);
          const fallback = view === "plan" ? 0 : 180;
          const rot = facing(l.pos, l.f.aim, view, fallback) + symbolOffset(l.symbol);
          const lens = l.light ? l.light.hue : null;
          return (
            <g key={l.f.id} transform={`translate(${p.x - s / 2} ${p.y - s / 2}) scale(${s / 24})`} data-hit={pickLights ? `light:${l.f.id}` : undefined} className="gv-stage2d__fixture">
              <rect x={-2} y={-2} width={28} height={28} fill="transparent" stroke="none" />
              <SymbolGlyph kind={l.symbol} state={l.look} frame={l.selected} lens={lens} rotate={rot} />
            </g>
          );
        })}
      </g>

      {/* Handles of the aim points ("Orienta"). */}
      {showAims
        ? sel.map((l) => {
            const a = P(l.f.aim);
            const r = s * 0.32;
            return (
              <g key={`h${l.f.id}`} className="gv-stage2d__handle" data-hit={pickAims ? `aim:${l.f.id}` : undefined}>
                <circle cx={a.x} cy={a.y} r={r * 1.6} fill="transparent" stroke="none" />
                <circle cx={a.x} cy={a.y} r={r} strokeWidth={stroke * 2} />
                <line x1={a.x - r * 1.5} y1={a.y} x2={a.x + r * 1.5} y2={a.y} strokeWidth={stroke * 1.4} />
                <line x1={a.x} y1={a.y - r * 1.5} x2={a.x} y2={a.y + r * 1.5} strokeWidth={stroke * 1.4} />
              </g>
            );
          })
        : null}

      {/* Labels of the selected lights. */}
      {!compact
        ? sel.map((l) => {
            const p = P(l.pos);
            return (
              <text key={`l${l.f.id}`} x={p.x + s * 0.62} y={p.y - s * 0.32} className="gv-stage2d__label" fontSize={s * 0.4} strokeWidth={s * 0.12}>
                {lightLabel(l.f, t(fixtureType(l.f.typeId).name))}
              </text>
            );
          })
        : null}
    </svg>
  );
}
