import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * pdf.js data served from the app itself, never from the network: CMaps (Asian fonts), the standard fonts
 * (PDFs that do not embed Times, Helvetica…), the wasm decoders (JPEG 2000, JBIG2) and the ICC profiles.
 * Development: served from node_modules under /pdfjs/; build: copied to dist/pdfjs/.
 */
function pdfjsData(): Plugin {
  const root = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
  const DIRS = ["cmaps", "standard_fonts", "wasm", "iccs"];
  return {
    name: "cue-pdfjs-data",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = /^\/pdfjs\/([a-z_]+)\/([\w.-]+)$/.exec((req.url ?? "").split("?")[0]);
        if (!m || !DIRS.includes(m[1])) return next();
        try {
          const data = readFileSync(join(root, m[1], m[2]));
          res.setHeader("Content-Type", m[2].endsWith(".wasm") ? "application/wasm" : "application/octet-stream");
          res.end(data);
        } catch {
          next();
        }
      });
    },
    generateBundle() {
      for (const dir of DIRS)
        for (const name of readdirSync(join(root, dir)))
          this.emitFile({ type: "asset", fileName: `pdfjs/${dir}/${name}`, source: readFileSync(join(root, dir, name)) });
    },
  };
}

// Tauri expects a fixed port in development and a static build in dist/.
// Cue uses 1425 (Diaframma 1420, Bardo 1421, Cantinella 1422, Granvelo 1423, launcher 1424).
export default defineConfig({
  plugins: [react(), pdfjsData()],
  clearScreen: false,
  server: {
    port: 1425,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  preview: {
    port: 1425,
    strictPort: true,
  },
  build: {
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 3000,
  },
});
