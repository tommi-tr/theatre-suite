import { memo, useId } from "react";
import type { MemoryThumbnail } from "@theatre-suite/show-files/granvelo";

/**
 * A compact plan of a Granvelo memory (as Granvelo's memory thumbnail, much smaller): the stage seen from above,
 * audience at the bottom, every lit light as a pool of its colour and brightness where it points. Dark memory = an
 * empty stage. Used by the timeline boxes (and free for the library list of Prepara).
 */
export const MemoryThumb = memo(function MemoryThumb({ thumb, height = 30, className }: { thumb: MemoryThumbnail; height?: number; className?: string }) {
  const { minX, maxX, minY, maxY } = thumb.bounds;
  const w = Math.max(0.1, maxX - minX);
  const h = Math.max(0.1, maxY - minY);
  // Plan y grows upstage: drawn upwards.
  const sy = (y: number) => maxY - y;
  const sx = (x: number) => x - minX;
  const lit = thumb.lights.filter((l) => l.light && !l.unused);
  const r0 = Math.max(w, h) * 0.006;
  const uid = useId().replace(/:/g, "");
  return (
    <svg className={className} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid slice" style={{ height }} aria-hidden="true">
      <defs>
        {lit.map((l) => (
          <radialGradient key={l.id} id={`${uid}${l.id}`}>
            <stop offset="0" stopColor={l.light!.color} stopOpacity={0.35 + 0.65 * l.light!.level} />
            <stop offset="0.55" stopColor={l.light!.color} stopOpacity={(0.35 + 0.65 * l.light!.level) * 0.55} />
            <stop offset="1" stopColor={l.light!.color} stopOpacity={0} />
          </radialGradient>
        ))}
      </defs>
      <rect x={0} y={0} width={w} height={h} fill="#101114" />
      <rect x={sx(-thumb.stage.width / 2)} y={sy(thumb.stage.depth)} width={thumb.stage.width} height={thumb.stage.depth} fill="#1b1c21" />
      {thumb.scenery.map((s) => (
        <rect
          key={s.id}
          x={sx(s.x - s.width / 2)}
          y={sy(s.y + Math.max(0.05, s.depth) / 2)}
          width={s.width}
          height={Math.max(0.05, s.depth)}
          fill={s.color}
          opacity={0.45}
          transform={s.rotation ? `rotate(${-s.rotation} ${sx(s.x)} ${sy(s.y)})` : undefined}
        />
      ))}
      {lit.map((l) => {
        const reach = Math.max(0.8, Math.tan(((l.beam || 25) * Math.PI) / 360) * Math.max(1, l.z - l.aim.z)) * 1.15;
        return <circle key={l.id} cx={sx(l.aim.x)} cy={sy(l.aim.y)} r={reach * 1.4} fill={`url(#${uid}${l.id})`} />;
      })}
      {thumb.trusses.map((tr) => (
        <line key={tr.id} x1={0} x2={w} y1={sy(tr.y)} y2={sy(tr.y)} stroke="#3a3c44" strokeWidth={r0 * 1.6} />
      ))}
      {thumb.lights
        .filter((l) => !l.unused)
        .map((l) => (
          <circle key={`f${l.id}`} cx={sx(l.x)} cy={sy(l.y)} r={r0 * 4} fill={l.light ? l.light.hue : "#4a4d57"} />
        ))}
    </svg>
  );
});
