import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Pinned to this file's directory rather than process.cwd(), so the config
// behaves identically whether it is run from the workspace or the repo root
// (`vite build --config apps/web/vite.config.ts`).
const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  build: {
    // `dist/` also receives the declaration output of `tsc --build`; keeping the
    // bundle in a subdirectory means `emptyOutDir` cannot wipe it and desync
    // the incremental build state.
    outDir: "dist/app",
    emptyOutDir: true,
    sourcemap: true,
  },
});
