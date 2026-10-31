import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Pinned to this file's directory rather than process.cwd(), so the config
// behaves identically whether it is run from the workspace or the repo root
// (`vite build --config tools/downloader/web/vite.config.ts`).
const root = fileURLToPath(new URL(".", import.meta.url));

/**
 * The version the footer shows (repo-131): the API's, which is the file
 * release-please bumps (`extra-files`), so the bundle in a released image carries
 * the released number. `@webtools/ui` declares and reads `__TOOL_VERSION__`.
 */
const TOOL_VERSION = (
  JSON.parse(readFileSync(new URL("../api/package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;

/** Where `tools/downloader/api` listens in development. Matches `API_DEFAULTS`. */
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
 * This block is duplicated, word for word, in the other tool's config. That is
 * deliberate and repo-5 is where it was decided: 14 of its 15 lines are this
 * docblock, and a shared `@webtools/*` import would put the one line of code
 * behind a built dependency. With that dependency's `dist` missing, Vite
 * refuses to start at all, behind an esbuild stack blaming a `package.json`;
 * today the same broken state starts the server and prints an error naming the
 * exact source line. This is the file whose failures are already silent, and it
 * does not get another one. `packages/core/test/host-resolution.test.ts` is what
 * keeps the copies honest instead — including for a tool that does not exist yet.
 *
 * `false` is Vite's own "localhost only" and stays the default off a container,
 * so nothing is published on a laptop's network without asking.
 */
const HOST = process.env["HOST"] ?? false;

export default defineConfig({
  root,
  plugins: [
    react(),
    {
      // The bundle sets the theme before React renders, but a module script is
      // deferred, so a browser may paint the page once before it runs: a light
      // flash for a reader who chose dark (repo-131, measured). `blocking="render"`
      // asks the engine to hold the first paint until the entry has run; whether
      // it does is the engine's choice. Chromium does (the e2e suite's
      // `csp.spec.ts` measures it); other engines are not measured, and one that
      // ignores the attribute may paint one light frame (owner, 2026-10-31,
      // accepted). Vite writes the built entry's tag itself and drops the
      // attribute from `index.html`'s, so it is put back here. It replaces a
      // literal of Vite's output, so a change to that output makes it a silent
      // no-op that only the Chromium e2e notices.
      name: "render-blocking-entry",
      transformIndexHtml: {
        order: "post",
        handler: (html) =>
          html.replace(
            '<script type="module" crossorigin',
            '<script type="module" blocking="render" crossorigin',
          ),
      },
    },
  ],
  define: { __TOOL_VERSION__: JSON.stringify(TOOL_VERSION) },
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
    rolldownOptions: {
      // `theme.js` is the static terms page's one script (repo-131). That page is
      // a file in `public/`, which Vite copies untouched, so it can only name a
      // fixed path: this entry is written to `/theme.js` rather than a hashed
      // name, and `@fastify/static` revalidates it like any file outside
      // `assets/`. What it imports still lands in `assets/`, hashed.
      input: {
        index: path.join(root, "index.html"),
        theme: path.join(root, "theme.js"),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "theme" ? "theme.js" : "assets/[name]-[hash].js",
      },
    },
  },
});
