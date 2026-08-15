/**
 * Serves the built UI from the API, same-origin.
 *
 * The `Dockerfile` has set `WEB_DIR` since pl-2 and `config.ts` has parsed it
 * since pl-2, and until now nothing read it: the image served an API and no
 * page. `planner.yml` waited on `/api/health`, which answered perfectly, so
 * nothing said so. pl-13 needed a bundle to drive and found the hole.
 *
 * Same-origin is also what the dev proxy already arranges — `vite.config.ts`
 * forwards `/api` — so this is the production half of a setup the browser
 * half already assumes. It means no CORS to configure for the intended
 * deployment, which is why `CORS_ORIGINS` is empty by default.
 *
 * Off unless `WEB_DIR` points somewhere. Running the API headless is a
 * perfectly good configuration — the UI is not a dependency of the API — and a
 * default that guessed at a `dist` directory would silently serve whatever a
 * previous build happened to leave there.
 */

import fs from "node:fs/promises";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import { API_PREFIX } from "@planner/contract";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppContext } from "../context.ts";

/**
 * Vite writes content-hashed filenames into `assets/`, so those are safe to
 * cache forever — a changed file is a changed URL. Everything else, `index.html`
 * above all, must be revalidated: it is the file that names the current hashes,
 * and a cached one pins a browser to a bundle that has been deleted.
 */
const IMMUTABLE_PREFIX = "assets";
const IMMUTABLE_MAX_AGE_SEC = 31_536_000;

/** Whether this request is the browser asking for a page, not the app asking for data. */
function wantsHtml(request: FastifyRequest): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  if (request.url.startsWith(`${API_PREFIX}/`)) return false;
  return (request.headers.accept ?? "").includes("text/html");
}

/** Registers the static plugin, and reports whether there is a UI to fall back to. */
export async function registerWebRoutes(
  app: FastifyInstance,
  context: AppContext,
): Promise<boolean> {
  const root = context.config.webDir;
  if (root === undefined) return false;

  // Checked here rather than left to fail per-request: a WEB_DIR typo would
  // otherwise present as a UI that 404s, which reads as a routing bug and
  // sends the next person into this file instead of into their environment.
  try {
    await fs.access(path.join(root, "index.html"));
  } catch {
    context.logger.warn("WEB_DIR is set but holds no index.html; the UI will not be served", {
      webDir: root,
    });
    return false;
  }

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
 * The UI keeps its state in the browser rather than in the URL today, so there
 * are no deep links to fall back for yet. It is registered anyway because the
 * alternative is discovering it the day one is added, in production, as a UI
 * that 404s on refresh.
 *
 * Only for a browser asking for HTML: an unknown `/api/…` path, or a `fetch`
 * for JSON, still gets the typed 404 it can act on. Answering those with a page
 * is how a client ends up parsing `<!doctype html>` as an `IntakeState`.
 */
export function serveIndexForUnknownPath(request: FastifyRequest, reply: FastifyReply): boolean {
  if (!wantsHtml(request)) return false;
  void reply.header("Cache-Control", "no-cache").sendFile("index.html");
  return true;
}
