/**
 * `GET /api/files/:token` — serves a finished download.
 *
 * The token is the whole authorisation model (see `jobs/tokens.ts`), so this
 * route's job is to be boring and strict:
 *
 *  - `410 Gone` past the retention window, never a 404 — the distinction
 *    matters to a user staring at a link that worked yesterday.
 *  - Range requests, because a 3 GB file over a flaky connection needs resume,
 *    and because browsers issue them for video regardless.
 *  - `Content-Disposition: attachment`, so a hostile filename cannot render
 *    inline in the API's own origin.
 *  - The path is re-verified to be inside `STORAGE_DIR` before it is opened.
 *    The row was written by us, but confirming a path at the point of use costs
 *    nothing and turns a would-be traversal into a 500.
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { AppError, ROUTES } from "@downloader/contract";
import { assertRealPathInside } from "@downloader/engine";
import { clientKey } from "@webtools/core/rate-limit";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppContext } from "../context.ts";
import { isWellFormedToken } from "../jobs/tokens.ts";
import { createRateLimitHook } from "../rate-limit.ts";

interface ByteRange {
  start: number;
  end: number;
}

/**
 * Parses a single-range `Range` header.
 *
 * Multi-range requests are answered with the whole file, which is explicitly
 * allowed: a server may always ignore `Range`. Implementing multipart byte
 * ranges for a video file nothing asks that way is not worth the surface.
 */
export function parseRange(
  header: string | undefined,
  size: number,
): ByteRange | null | "unsatisfiable" {
  if (header === undefined) return null;
  const match = /^bytes=(\d*)-(\d*)$/u.exec(header.trim());
  if (match === null) return null;
  const [, rawStart = "", rawEnd = ""] = match;

  if (rawStart === "" && rawEnd === "") return null;
  if (rawStart === "") {
    // `bytes=-500` — the final 500 bytes.
    const length = Number(rawEnd);
    if (!Number.isFinite(length) || length <= 0) return "unsatisfiable";
    return { start: Math.max(0, size - length), end: size - 1 };
  }

  const start = Number(rawStart);
  if (!Number.isFinite(start) || start >= size) return "unsatisfiable";
  const end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (!Number.isFinite(end) || end < start) return "unsatisfiable";
  return { start, end };
}

/** RFC 6266: an ASCII fallback plus a UTF-8 form for everyone else. */
export function contentDisposition(filename: string): string {
  const ascii = filename.replaceAll(/[^\x20-\x7e]/gu, "_").replaceAll('"', "'");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * The bucket key for one request to this route.
 *
 * **The token, not the address.** The other two limited routes protect the
 * service and key on `clientKey(request.ip)`; here the thing being protected is
 * one file, and the token is what both names it and bounds who may ask for it.
 * Keying on the token means a leaked link cannot outrun its own bucket by being
 * fetched from many addresses at once — the pair `(token, ip)` would hand each
 * of those addresses a fresh allowance, which is precisely the case worth
 * stopping. It also means the limit survives CGNAT and a reverse proxy, neither
 * of which an address key does; `trustProxy` is off by default and cannot be
 * turned on safely without knowing the deployment.
 *
 * The token is hashed because this key reaches a log line, and a file token is
 * a live credential — the same reason `redactUrl` exists. A prefix of the digest
 * is a stable bucket name that leaks nothing.
 *
 * A token that is not even well formed cannot name a file, so it falls back to
 * the address. Be precise about what that buys: `isWellFormedToken` checks
 * length and charset, not existence, so a scanner guessing *well-formed* tokens
 * — the realistic case — still mints a bucket per guess. What bounds that is
 * `RateLimiter`'s `maxKeys` (10,000, evicted least-recently-seen), not this
 * branch. The fallback buys the two things it can: obviously-malformed junk
 * shares one allowance rather than getting a fresh one per request, and no
 * amount of guessing lands in a real file's bucket.
 */
function fileBucketKey(request: FastifyRequest): string {
  const token = (request.params as { token?: unknown }).token;
  if (typeof token !== "string" || !isWellFormedToken(token)) {
    return `ip:${clientKey(request.ip)}`;
  }
  return `token:${createHash("sha256").update(token).digest("base64url").slice(0, 16)}`;
}

export function registerFileRoutes(app: FastifyInstance, context: AppContext): void {
  // Sized for a video player rather than a form: a `<video>` element issues one
  // open-ended `Range` request per completed seek, so an ordinary scrub-bar
  // drag is hundreds of requests a minute. See `rateLimitFilesPerMinute` and
  // the dl-23 log for the measurement.
  const rateLimit = createRateLimitHook({
    limiter: context.rateLimits.files,
    logger: context.logger,
    scope: "files",
    key: fileBucketKey,
  });

  app.get<{ Params: { token: string } }>(
    ROUTES.file(":token"),
    { onRequest: rateLimit },
    async (request, reply) => {
      const { token } = request.params;
      // Rejected on shape before a database round trip, so scanning for tokens
      // costs an attacker the same as any other 404.
      if (!isWellFormedToken(token)) {
        throw new AppError("JOB_NOT_FOUND", "That download link is not valid.");
      }

      const record = context.store.findToken(token);
      if (record === null) {
        throw new AppError("JOB_NOT_FOUND", "That download link is not valid.");
      }

      if (Date.parse(record.expiresAt) <= context.now().getTime()) {
        throw new AppError("FILE_EXPIRED", undefined, { details: { expiresAt: record.expiresAt } });
      }

      await assertRealPathInside(context.engine.storage.root, record.path);

      let size: number;
      try {
        const stat = await fs.stat(record.path);
        if (!stat.isFile()) throw new AppError("FILE_EXPIRED");
        size = stat.size;
      } catch {
        // The row outlived the file — the retention sweep ran between the two.
        // `FILE_EXPIRED` is the honest answer, not a 500.
        throw new AppError("FILE_EXPIRED", undefined, { details: { expiresAt: record.expiresAt } });
      }

      reply.header("Content-Disposition", contentDisposition(record.filename));
      reply.header("Content-Type", "application/octet-stream");
      reply.header("Accept-Ranges", "bytes");
      reply.header("Cache-Control", "private, no-store");

      const range = parseRange(request.headers.range, size);
      if (range === "unsatisfiable") {
        reply.header("Content-Range", `bytes */${size}`);
        return await reply.code(416).send();
      }

      if (range === null) {
        reply.header("Content-Length", String(size));
        return await sendStream(reply, record.path, 200);
      }

      reply.header("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
      reply.header("Content-Length", String(range.end - range.start + 1));
      return await sendStream(reply, record.path, 206, range);
    },
  );
}

async function sendStream(
  reply: FastifyReply,
  path: string,
  status: number,
  range?: ByteRange,
): Promise<FastifyReply> {
  const stream = createReadStream(
    path,
    range === undefined ? undefined : { start: range.start, end: range.end },
  );
  // Fastify ends the response when the stream ends and destroys it if the
  // client disconnects, so no manual teardown is needed here.
  return await reply.code(status).send(stream);
}
