import type { MemoryThumbnail } from "@theatre-suite/show-files/granvelo";

/**
 * The preview of a memory in the library: Granvelo's stage plan (`memoryThumbnail`) in 34 × 20 px. The stage is a
 * dark floor, every light that makes light draws its pool of colour where it points. Decorative: the name is next to it.
 */
export function MiniThumb({ thumb, width = 34, height = 20 }: { thumb: MemoryThumbnail; width?: number; height?: number }) {
  const { bounds: b, stage } = thumb;
  const w = Math.max(0.01, b.maxX - b.minX);
  const h = Math.max(0.01, b.maxY - b.minY);
  // Plan y grows upstage: the audience is at the bottom of the picture.
  const px = (x: number) => x - b.minX;
  const py = (y: number) => b.maxY - y;
  const lit = thumb.lights.filter((l) => l.light && !l.unused);
  return (
    <svg className="cue-thumb" width={width} height={height} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect x="0" y="0" width={w} height={h} fill="#0b0c0f" />
      <rect x={px(-stage.width / 2)} y={py(stage.depth)} width={stage.width} height={stage.depth} fill="#16181d" />
      {thumb.scenery.map((s) => (
        <rect key={s.id} x={px(s.x - s.width / 2)} y={py(s.y + Math.max(s.depth, 0.15) / 2)} width={s.width} height={Math.max(s.depth, 0.15)} fill={s.color} opacity="0.5" />
      ))}
      <g style={{ mixBlendMode: "screen" }}>
        {lit.map((l) => {
          const throwM = Math.max(0.5, l.z);
          const r = Math.min(Math.max(0.5, throwM * Math.tan((l.beam * Math.PI) / 360)), Math.max(w, h) / 3);
          return <circle key={l.id} cx={px(l.aim.x)} cy={py(l.aim.y)} r={r} fill={l.light!.color} opacity={Math.min(0.9, 0.25 + l.light!.level * 0.65)} />;
        })}
      </g>
    </svg>
  );
}
