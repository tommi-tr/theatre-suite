// Generates the launcher's icons (PNG + ICO): a light tile with four short strokes, one per app
// (02_design.md): indigo Diaframma, copper Bardo, slate Cantinella, petrol Luci.
// Run with: pnpm --filter launcher icons
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "icons");
const TILE = "#F6F6F8";
const BORDER = "#E1E2E7";
const STROKES = [
  ["M24 36H44", "#6B5BEF"], // Diaframma
  ["M56 36H76", "#C8642C"], // Bardo
  ["M24 64H44", "#55627E"], // Cantinella
  ["M56 64H76", "#c2349f"], // Luci
];

function svg(size) {
  const stroke = size <= 24 ? 11 : size <= 32 ? 9.5 : 7.5;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <rect x="2" y="2" width="96" height="96" rx="22" fill="${TILE}" stroke="${BORDER}" stroke-width="${size <= 24 ? 2 : 1}"/>
${STROKES.map(([d, c]) => `  <path d="${d}" fill="none" stroke="${c}" stroke-width="${stroke}" stroke-linecap="round"/>`).join("\n")}
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
writeFileSync(join(OUT, "icon.ico"), ico([16, 24, 32, 48, 64, 256]));
console.log("Icons written to", OUT);
