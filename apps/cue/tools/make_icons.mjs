// Generates Cue's app icons (PNG + ICO) from the geometry of CUE_LOGO in packages/ui ("Filo", 02_design.md):
// the dot on the script (filled, logo colour), the line and the GO button (ink, outline only).
// The stroke grows at small sizes. Run with: pnpm --filter cue icons
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "icons");
const ACCENT = "#77726A"; // Gesso (logo)
const INK = "#1B1C21";
const TILE = "#F6F6F8";
const BORDER = "#E1E2E7";

/** Same geometry as CUE_LOGO (packages/ui/src/icons.tsx). */
const DOT = { cx: 22, cy: 50, r: 10 };
const INK_PATH = "M33 50H50M59 35H73A9 9 0 0 1 82 44V56A9 9 0 0 1 73 65H59A9 9 0 0 1 50 56V44A9 9 0 0 1 59 35Z";

/** Stroke on the 100×100 grid: 6 (8.5 up to 32 px, 11 at 16–20 px). Same rule as CUE_LOGO.stroke. */
export function strokeFor(size) {
  return size <= 20 ? 11 : size <= 32 ? 8.5 : 6;
}

export function svg(size) {
  const stroke = strokeFor(size);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <rect x="2" y="2" width="96" height="96" rx="22" fill="${TILE}" stroke="${BORDER}" stroke-width="${size <= 24 ? 2 : 1}"/>
  <path d="${INK_PATH}" fill="none" stroke="${INK}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="${DOT.cx}" cy="${DOT.cy}" r="${DOT.r}" fill="${ACCENT}"/>
</svg>`;
}

function png(size) {
  return new Resvg(svg(size), { fitTo: { mode: "width", value: size } }).render().asPng();
}

/** ICO file whose entries are PNG images (supported since Windows Vista). */
function ico(sizes) {
  const images = sizes.map((s) => ({ s, data: png(s) }));
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach((img, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(img.s >= 256 ? 0 : img.s, e);
    header.writeUInt8(img.s >= 256 ? 0 : img.s, e + 1);
    header.writeUInt8(0, e + 2);
    header.writeUInt8(0, e + 3);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(img.data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += img.data.length;
  });
  return Buffer.concat([header, ...images.map((i) => i.data)]);
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "icon.svg"), svg(512));
writeFileSync(join(OUT, "32x32.png"), png(32));
writeFileSync(join(OUT, "64x64.png"), png(64));
writeFileSync(join(OUT, "128x128.png"), png(128));
writeFileSync(join(OUT, "128x128@2x.png"), png(256));
writeFileSync(join(OUT, "icon.png"), png(512));
writeFileSync(join(OUT, "icon.ico"), ico([16, 20, 24, 32, 48, 64, 256]));
if (process.argv.includes("--preview")) {
  // Small sizes, to judge legibility at 16–24 px (not committed).
  for (const s of [16, 20, 24, 32]) writeFileSync(join(OUT, "..", "..", `preview-${s}.png`), png(s));
}
console.log("Icons written to", OUT);
