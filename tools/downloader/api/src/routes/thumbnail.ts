/**
 * `GET /api/thumbnail/:token` — serves a preview image this service fetched.
 *
 * The route deliberately has no way to say *which* image except by a token this
 * process minted (see `thumbnails.ts`). There is no `?url=`, and adding one
 * would turn the service into an open proxy that an SSRF guard could only
 * narrow, never close.
 *
 * ## One source (dl-53)
 *
 * The in-memory store, which holds every capture for ten minutes. dl-44 added a
 * second, on-disk copy beside a completed job's file; dl-53 removed the files
 * and the owner chose on 2026-09-27 to remove that copy with them. A miss is
 * `THUMBNAIL_NOT_FOUND`, which is the ordinary answer after ten minutes.
 *
 * ## Why it is rate limited, and on what
 *
 * It was not, while the answer came from a `Map`: at most 512 KB —
 * `MAX_THUMBNAIL_BYTES`, enforced before anything was stored — served out of
 * memory to a caller who had to hold an unguessable 256-bit token to get
 * anything at all. dl-44 changed what a miss costs, by falling through to
 * SQLite and a file read, and its gate measured what that left: **up to 512 KB
 * per request, unlimited requests per minute, per valid token, for up to
 * `fileRetentionHours`**. The owner answered that as "leave it, and carry the
 * follow-up on dl-46" — this is dl-46 closing it. The disk copy is gone since
 * dl-53, and the limit stays: it costs nothing and bounds a leaked token.
 *
 * **Keyed on the token, as `/api/files/:token` is and for the same reason:**
 * what this protects is one image rather than the service, and an address key
 * would hand a leaked token a fresh allowance per address it is fetched from.
 * `capabilityBucketKey` carries the rest, including what the malformed-token
 * fallback does and does not buy.
 *
 * ## The token is a credential in the path, so the log does not write it (dl-75)
 *
 * It is the only thing that authorises the image and there is no session or
 * owner check behind it, which is what makes a file token a capability. The
 * request log therefore replaces it with `[redacted]` on the `request` line and
 * on the `request rejected` line a miss or a 429 writes, as it does for
 * `/api/files/:token` (`CAPABILITY_PREFIXES` in `request-log.ts`).
 */

import { AppError, ROUTES } from "@downloader/contract";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { AppContext } from "../context.ts";
import { capabilityBucketKey, createRateLimitHook } from "../rate-limit.ts";

export function registerThumbnailRoute(app: FastifyInstance, context: AppContext): void {
  const rateLimit = createRateLimitHook({
    limiter: context.rateLimits.thumbnail,
    logger: context.logger,
    scope: "thumbnail",
    key: capabilityBucketKey,
  });

  app.get<{ Params: { token: string } }>(
    ROUTES.thumbnail(":token"),
    { onRequest: rateLimit },
    async (request, reply) => {
      const { token } = request.params;

      const stored = context.thumbnails.get(token);
      if (stored === null) throw notFound();
      return await send(reply, stored.contentType, stored.bytes);
    },
  );
}

/**
 * Its own code, not `JOB_NOT_FOUND`: this names neither a job nor a route. A
 * miss here is ordinary — the in-memory store is TTL'd — so the copy has to
 * read as "gone", which is the taxonomy's default for this code and not something a call site rewrites.
 */
function notFound(): AppError {
  return new AppError("THUMBNAIL_NOT_FOUND");
}

async function send(
  reply: FastifyReply,
  contentType: string,
  bytes: Buffer,
): Promise<FastifyReply> {
  reply.header("Content-Type", contentType);
  reply.header("Content-Length", String(bytes.byteLength));
  // The content type was checked against an allowlist before the bytes were
  // stored; `nosniff` is what
  // stops a browser overruling it anyway on a body that a hostile origin chose
  // the first bytes of.
  reply.header("X-Content-Type-Options", "nosniff");
  // A preview is one user's view of one page they pasted. It is not worth a
  // shared cache holding, and `private` keeps it out of one.
  reply.header("Cache-Control", "private, max-age=300");
  return await reply.send(bytes);
}
