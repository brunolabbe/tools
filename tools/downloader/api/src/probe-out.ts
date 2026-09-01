/**
 * The last thing that happens to a `ProbeResult` before a client sees it.
 *
 * ## What this strips, and why it is not optional
 *
 * `RequestContext.headers` is the credential set a resolver captured from the
 * source — `contract/src/media.ts:121` says so plainly: _"Replayed verbatim.
 * Typically Referer, Origin, User-Agent, Cookie, Authorization."_ Those are live
 * session credentials for a third-party site, and until this function existed
 * every one of them was serialised into the probe response and into the `probed`
 * SSE frame, in full.
 *
 * Nothing in the browser has ever used them. `requestContext` is read in exactly
 * one place under `web/src`, and that place is the mock's own fixture data. The
 * field is server-side machinery — the engine replays it on every segment fetch —
 * that happened to be inside a shape which also goes out on the wire.
 *
 * ## Why it strips rather than removes
 *
 * `headers` is **required** by `requestContextSchema` inside
 * `probeResultSchema`. Emptying it keeps every existing client, schema parse and
 * fixture valid with no contract edit. Removing the field from the wire schema
 * would be a contract change, and this repo does not make those unilaterally —
 * whether `requestContext` belongs on the wire at all, given nothing reads it, is
 * a live question and deliberately not settled here.
 *
 * ## Why it is applied here and not earlier
 *
 * The server needs these headers. The engine replays them to download the media,
 * and `captureThumbnail` replays them to fetch the preview. So this cannot run at
 * the resolve seam the way `withoutEgressProxy` does — it has to be the last step
 * on the way out, leaving the object the server keeps for its own use intact.
 *
 * ## Three seams, not two
 *
 * `POST /api/probe` fresh, `POST /api/probe` **from cache**, and the `probed` SSE
 * frame. The cached early-return is the one that gets missed — it returns before
 * the fresh path's rewrites and never sees them. That is why this is one function
 * called identically at three call sites rather than a few lines inlined at two
 * of them.
 */

import type { ProbeResult } from "@downloader/contract";

/**
 * A probe as a client may see it: same shape, no credentials.
 *
 * `expiresAt` is deliberately kept. It is not a secret and it is the field that
 * tells a client its variant URLs are about to go stale, which is the one part of
 * `requestContext` a client could act on.
 */
export function probeForClient(probe: ProbeResult): ProbeResult {
  const { headers: _credentials, ...rest } = probe.requestContext;
  return { ...probe, requestContext: { ...rest, headers: {} } };
}
