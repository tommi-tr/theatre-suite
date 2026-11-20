import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed port in development and a static build in dist/.
// Cue uses 1425 (Diaframma 1420, Bardo 1421, Cantinella 1422, Granvelo 1423, launcher 1424).
export default defineConfig({
  plugins: [react()],
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
