import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Pinned to this file's directory rather than process.cwd(), so the config
// behaves identically whether it is run from the workspace or the repo root
// (`vite build --config apps/web/vite.config.ts`).
const root = fileURLToPath(new URL(".", import.meta.url));

/** Where `apps/api` listens in development. Matches `API_DEFAULTS`. */
const API_TARGET = process.env["VITE_API_PROXY_TARGET"] ?? "http://127.0.0.1:8080";

export default defineConfig({
  root,
  plugins: [react()],
  server: {
    // Proxying `/api` keeps the dev setup same-origin, which means the API
    // needs no CORS configuration and `EventSource` — which cannot send custom
    // headers and is fussy about origins — just works.
    proxy: {
      "/api": {
        target: API_TARGET,
        changeOrigin: true,
        // SSE must not be buffered, or progress arrives all at once at the end.
        ws: false,
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes) => {
            if (proxyRes.headers["content-type"]?.includes("text/event-stream") === true) {
              delete proxyRes.headers["content-length"];
            }
          });
        },
      },
    },
  },
  build: {
    // `dist/` also receives the declaration output of `tsc --build`; keeping the
    // bundle in a subdirectory means `emptyOutDir` cannot wipe it and desync
    // the incremental build state.
    outDir: "dist/app",
    emptyOutDir: true,
    sourcemap: true,
  },
});
