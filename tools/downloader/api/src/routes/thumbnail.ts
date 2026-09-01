/**
 * `GET /api/thumbnail/:token` — serves a preview image this service fetched.
 *
 * The route deliberately has no way to say *which* image except by a token this
 * process minted (see `thumbnails.ts`). There is no `?url=`, and adding one
 * would turn the service into an open proxy that an SSRF guard could only
 * narrow, never close.
 *
 * It is not rate limited, and that is a decision rather than an omission. The
 * other three limited routes each protect something expensive: a browser probe
 * costs ~15 s and ~300 MB, a job costs a worker slot, a file is gigabytes off a
 * disk. This answers from a `Map` with at most 512 KB that is already resident,
 * to a caller who had to hold an unguessable 256-bit token to get anything at
 * all; a caller without one gets a 404 that is cheaper than the not-found
 * handler. If that changes — if previews ever grow, or are served to a caller
 * who did not probe — `createRateLimitHook` takes an optional `key` and
 * `fileBucketKey` in `files.ts` is the worked example of keying on a capability
 * rather than an address.
 */

import { AppError, ROUTES } from "@downloader/contract";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";

export function registerThumbnailRoute(app: FastifyInstance, context: AppContext): void {
  app.get<{ Params: { token: string } }>(ROUTES.thumbnail(":token"), async (request, reply) => {
    const stored = context.thumbnails.get(request.params.token);
    if (stored === null) {
      // Its own code, not `JOB_NOT_FOUND`: this names neither a job nor a route.
      // A miss here is ordinary — the store is in memory and TTL'd — so the copy
      // has to read as "gone", which is the taxonomy's default for this code and
      // not something a call site rewrites.
      throw new AppError("THUMBNAIL_NOT_FOUND");
    }

    reply.header("Content-Type", stored.contentType);
    reply.header("Content-Length", String(stored.bytes.byteLength));
    // The content type was checked against an allowlist before the bytes were
    // stored; `nosniff` is what stops a browser overruling it anyway on a body
    // that a hostile origin chose the first bytes of.
    reply.header("X-Content-Type-Options", "nosniff");
    // A preview is one user's view of one page they pasted. It is not worth a
    // shared cache holding, and `private` keeps it out of one.
    reply.header("Cache-Control", "private, max-age=300");
    return await reply.send(stored.bytes);
  });
}
