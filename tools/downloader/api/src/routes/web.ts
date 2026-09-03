/**
 * Serves the built UI from the API, same-origin.
 *
 * This is what makes `docker compose up` a *service* rather than a backend
 * with homework attached. Same-origin also means no CORS to configure and no
 * `EventSource` origin trouble — SSE cannot send custom headers and is fussy
 * about origins, so the setup the dev proxy already provides is the one worth
 * reproducing in production rather than working around.
 *
 * Off unless `WEB_DIR` points somewhere. Running the API headless is a
 * perfectly good configuration — the UI is not a dependency of the API — and a
 * default that guessed at a `dist` directory would silently serve a stale
 * bundle from a previous build.
 *
 * Note that the bundle is *built* against a transport choice: `VITE_API_MOCK`
 * is baked in. See `apps/web/src/api/client.ts`.
 */

import fs from "node:fs/promises";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppContext } from "../context.ts";

/**
 * Vite writes content-hashed filenames into `assets/`, so those are safe to
 * cache forever — a changed file is a changed URL. Everything else, `index.html`
 * above all, must be revalidated: it is the file that names the current hashes,
 * and a cached one pins a browser to a deleted bundle.
 */
const IMMUTABLE_PREFIX = "assets";
const IMMUTABLE_MAX_AGE_SEC = 31_536_000;

/**
 * Every path in `ROUTES` sits under this. It is spelled out here rather than
 * added to `ROUTES` because `packages/shared` is the contract three packages
 * depend on, and this file is the only thing that has ever needed the prefix
 * on its own.
 */
const API_PREFIX = "/api/";

/**
 * The document's Content-Security-Policy (dl-35).
 *
 * `default-src 'self'` already covers everything the four source lists below
 * repeat, and they are still spelled out. Two reasons, neither decorative: a
 * `default-src` that later has to widen for one subresource would otherwise
 * silently widen all of them, and this list is the only place recording what
 * the bundle was measured to need.
 *
 * What it was measured against — `npm run build`'s output, not the dev server,
 * which injects a client of its own:
 *
 *  - `script-src 'self'` — the built `index.html` carries one
 *    `<script type="module" src="/assets/…">` and no inline script.
 *  - `style-src 'self'` — one `<link rel="stylesheet">`, no `<style>` block,
 *    and no `style=` attribute anywhere in `web/src`. `'unsafe-inline'` is
 *    therefore *not* unavoidable, which is the question worth asking before
 *    adding it. The one CSSOM write the app makes — `theme.ts` setting
 *    `root.style.colorScheme` — is not governed by `style-src`, because CSP
 *    hooks the `style` content attribute rather than `CSSStyleDeclaration`;
 *    `e2e/csp.spec.ts` measures that in a real browser rather than trusting it.
 *  - `img-src 'self'` — dl-29's preview is `/api/thumbnail/<token>` on this
 *    origin by construction, which is the whole point of it: the bytes come
 *    through this service so the SSRF guard sees the fetch. If a preview ever
 *    needs a foreign origin, that is a change to dl-29's design and not a
 *    reason to relax this line.
 *  - `connect-src 'self'` — `fetch` and the `EventSource` progress stream, both
 *    same-origin because this service serves the bundle.
 *
 * `object-src 'none'` and `frame-ancestors 'none'` are tightenings rather than
 * enumerations, and `frame-ancestors` has no `default-src` fallback at all — it
 * exists only if it is written. `base-uri 'self'` stops an injected `<base>`
 * re-pointing every relative URL on the page, the preview's included.
 *
 * No `report-uri`/`report-to`: there is nowhere to send a report, and a
 * collector is a separate piece of work.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join("; ");

/**
 * The policy goes on the *document*, and on nothing else.
 *
 * Gated on the response's content type rather than on a route, because there
 * are two doors to the same document and a route-shaped check has to remember
 * both: `@fastify/static` serves `index.html` at `/`, and
 * `serveIndexForUnknownPath` sends the same file for every client-side deep
 * link. A policy on the first alone is a header that looks right and is missing
 * from most of the ways a user arrives.
 *
 * The other direction matters as much. `/api/*` answers JSON and bytes, where a
 * CSP governs nothing — the thumbnail route's own answer to a content-type
 * attack is the allowlist and `nosniff` in `routes/thumbnail.ts`, not this.
 */
function registerDocumentPolicy(app: FastifyInstance): void {
  app.addHook("onSend", async (_request, reply, payload: unknown) => {
    const contentType = reply.getHeader("content-type");
    if (typeof contentType === "string" && contentType.startsWith("text/html")) {
      reply.header("Content-Security-Policy", CONTENT_SECURITY_POLICY);
    }
    return payload;
  });
}

/** Whether this request is the browser asking for a page, not the app asking for data. */
function wantsHtml(request: FastifyRequest): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  if (request.url.startsWith(API_PREFIX)) return false;
  return (request.headers.accept ?? "").includes("text/html");
}

export async function registerWebRoutes(
  app: FastifyInstance,
  context: AppContext,
): Promise<boolean> {
  const root = context.config.webDir;
  if (root === undefined) return false;

  // Checked here rather than left to fail per-request: a WEB_DIR typo would
  // otherwise present as a UI that 404s, which reads as a routing bug.
  try {
    await fs.access(path.join(root, "index.html"));
  } catch {
    context.logger.warn("WEB_DIR is set but holds no index.html; the UI will not be served", {
      webDir: root,
    });
    return false;
  }

  // Before the static plugin, so the hook is in place by the time its routes
  // are: an `onSend` on this instance flows down into the plugin's own
  // encapsulation context, and reaches the not-found handler `server.ts`
  // registers afterwards. Both doors, one policy.
  registerDocumentPolicy(app);

  await app.register(fastifyStatic, {
    root,
    prefix: "/",
    index: ["index.html"],
    // A build directory has no legitimate dotfiles, so a stray `.env` swept in
    // by a careless copy must not be fetchable. `ignore` rather than `deny`:
    // deny throws a 403 that arrives at the error handler as an untyped error
    // and becomes a 500, while ignore treats the file as simply not there —
    // which is both the truthful answer and the one that says less.
    dotfiles: "ignore",
    setHeaders: (reply: FastifyReply, filePath: string) => {
      const immutable = path.relative(root, filePath).split(path.sep)[0] === IMMUTABLE_PREFIX;
      reply.header(
        "Cache-Control",
        immutable ? `public, max-age=${IMMUTABLE_MAX_AGE_SEC}, immutable` : "no-cache",
      );
    },
  });

  context.logger.info("serving the web UI", { webDir: root });
  return true;
}

/**
 * The SPA fallback, as a not-found handler.
 *
 * The UI routes client-side, so a deep link is a path the server has never
 * heard of and must answer with `index.html` anyway. Only for a browser
 * asking for HTML: an unknown `/api/…` path, or a `fetch` for JSON, still gets
 * the typed 404 it can act on. Answering those with a page is how a client
 * ends up parsing `<!doctype html>` as a `Job`.
 */
export function serveIndexForUnknownPath(request: FastifyRequest, reply: FastifyReply): boolean {
  if (!wantsHtml(request)) return false;
  void reply.header("Cache-Control", "no-cache").sendFile("index.html");
  return true;
}
