import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Pinned to this file's directory rather than process.cwd(), so the config
// behaves identically whether it is run from the workspace or the repo root
// (`vite build --config apps/web/vite.config.ts`).
const root = fileURLToPath(new URL(".", import.meta.url));

/** Where `apps/api` listens in development. Matches `API_DEFAULTS`. */
const API_TARGET = process.env["VITE_API_PROXY_TARGET"] ?? "http://127.0.0.1:8080";

/**
 * Which interfaces the dev server binds, taken from the same `HOST` the API
 * reads.
 *
 * Vite's default is `localhost`, and that is the bug this exists to avoid:
 * inside the dev container `localhost` resolves to `::1`, so the server ends up
 * on IPv6 loopback alone and Docker's port forwarding — which connects over
 * IPv4 — reaches nothing. The page is simply blank, with no error anywhere to
 * explain it. The container sets `HOST=0.0.0.0` for precisely this reason; the
 * API honoured it and this did not.
 *
 * `false` is Vite's own "localhost only" and stays the default off a container,
 * so nothing is published on a laptop's network without asking.
 */
const HOST = process.env["HOST"] ?? false;

export default defineConfig({
  root,
  plugins: [react()],
  server: {
    host: HOST,
    port: 5173,
    // Vite's default is to walk to the next free port, which is the second way
    // to get a blank page here: 5174 is not the port that was forwarded, so the
    // browser connects to nothing while the terminal cheerfully reports ready.
    // Failing is the more useful answer.
    strictPort: true,
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
