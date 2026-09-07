/**
 * `GET /api/thumbnail/:token` — serves a preview image this service fetched.
 *
 * The route deliberately has no way to say *which* image except by a token this
 * process minted (see `thumbnails.ts`). There is no `?url=`, and adding one
 * would turn the service into an open proxy that an SSRF guard could only
 * narrow, never close.
 *
 * ## Two sources, one token
 *
 * The token names the image; **this route decides where its bytes come from**,
 * which is what lets `thumbnailPath` go on meaning exactly `/api/thumbnail/<t>`
 * and nothing else (dl-44). In order:
 *
 *  1. the in-memory store, which holds every capture for ten minutes — the only
 *     source for a probe that has not become a job, and the fast path for one
 *     that has just finished;
 *  2. the copy written into the completed job's `out/<jobId>/` directory, which
 *     lives as long as the file it depicts and survives a restart.
 *
 * A miss on both is `THUMBNAIL_NOT_FOUND`, exactly as a miss on the first alone
 * used to be — for a job whose file the retention sweep has taken, that is now
 * the honest answer rather than the usual one.
 *
 * ## Why it is still not rate limited
 *
 * It was a decision when the answer came from a `Map`, and the reasoning has to
 * be restated now that it can reach SQLite and the disk. The other three
 * limited routes each protect something expensive: a browser probe costs ~15 s
 * and ~300 MB, a job costs a worker slot, a file is gigabytes off a disk. This
 * answers with at most 512 KB — `MAX_THUMBNAIL_BYTES`, enforced before anything
 * was stored — to a caller who had to hold an unguessable 256-bit token to get
 * anything at all. A caller without one is rejected on token *shape*, before
 * the database is touched, so scanning costs what the not-found handler costs.
 *
 * What did change is that a caller holding one valid token can now cause a
 * repeated small disk read rather than a repeated map lookup, for as long as
 * the file survives. If that ever matters, `createRateLimitHook` takes an
 * optional `key` and `fileBucketKey` in `files.ts` is the worked example of
 * keying on a capability rather than an address.
 */

import { AppError, ROUTES } from "@downloader/contract";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { AppContext } from "../context.ts";
import { isWellFormedToken } from "../jobs/tokens.ts";
import { isServableContentType, readPersistedThumbnail } from "../thumbnails.ts";

export function registerThumbnailRoute(app: FastifyInstance, context: AppContext): void {
  app.get<{ Params: { token: string } }>(ROUTES.thumbnail(":token"), async (request, reply) => {
    const { token } = request.params;

    const stored = context.thumbnails.get(token);
    if (stored !== null) return await send(reply, stored.contentType, stored.bytes);

    // Rejected on shape before a database round trip, so scanning for tokens
    // costs an attacker the same as any other 404 — the same guard, and the
    // same reason, as `/api/files/:token`. Every token this service mints has
    // this shape: `ThumbnailStore.put` and `createFileToken` are both 32 CSPRNG
    // bytes as base64url.
    if (!isWellFormedToken(token)) throw notFound();

    const record = context.store.findThumbnail(token);
    if (record === null) throw notFound();

    // The database is a boundary. This value becomes a `Content-Type` header on
    // *our* origin, and it was allowlisted when the bytes were captured — so a
    // row saying otherwise was not written by a build that agreed with this one,
    // and is not something to serve on trust. See `ALLOWED_CONTENT_TYPES`.
    if (!isServableContentType(record.contentType)) throw notFound();

    const bytes = await readPersistedThumbnail(context.engine.storage, record.path);
    // The row outlived the bytes: the retention sweep took the job's output
    // directory, and the image went with the file as intended.
    if (bytes === null) throw notFound();

    return await send(reply, record.contentType, bytes);
  });
}

/**
 * Its own code, not `JOB_NOT_FOUND`: this names neither a job nor a route. A
 * miss here is ordinary — the in-memory store is TTL'd and the disk copy is
 * swept with its file — so the copy has to read as "gone", which is the
 * taxonomy's default for this code and not something a call site rewrites.
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
  // stored, and again on the way back out of the database; `nosniff` is what
  // stops a browser overruling it anyway on a body that a hostile origin chose
  // the first bytes of.
  reply.header("X-Content-Type-Options", "nosniff");
  // A preview is one user's view of one page they pasted. It is not worth a
  // shared cache holding, and `private` keeps it out of one.
  reply.header("Cache-Control", "private, max-age=300");
  return await reply.send(bytes);
}
