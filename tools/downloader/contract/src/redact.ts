/**
 * Redaction of downloader-specific shapes.
 *
 * The generic redactors — headers and signed URLs — live in `@webtools/core`
 * and are re-exported here so that downloader code has one import surface.
 * Only `RequestContext`, which core has never heard of, is handled locally.
 */

import { redactHeaders, redactUrl } from "@webtools/core";
import type { RequestContext } from "./media.ts";

export { REDACTED, redactHeaders, redactUrl } from "@webtools/core";

/**
 * Log-safe view of a `RequestContext`. The return type is deliberately not
 * `RequestContext` — a redacted context is evidence, not something to replay.
 */
export function redactRequestContext(context: RequestContext): Record<string, unknown> {
  return {
    headers: redactHeaders(context.headers),
    ...(context.expiresAt === undefined ? {} : { expiresAt: context.expiresAt }),
    ...(context.proxyUrl === undefined ? {} : { proxyUrl: redactUrl(context.proxyUrl) }),
  };
}
