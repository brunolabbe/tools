/**
 * Resolver contract.
 *
 * A resolver turns a page URL into a `ProbeResult`. The registry tries resolvers
 * in ascending `priority` and takes the first usable answer, so a cheap
 * site-specific extractor runs before the expensive browser sniffer.
 *
 * Adding site support should mean adding a resolver — never editing the engine,
 * the API or the UI. If a change to support one site touches another layer, the
 * abstraction is wrong and should be fixed rather than worked around.
 */

import type { ProbeResult } from "./media.ts";

export interface ResolveOptions {
  /** Hard wall-clock budget. Resolvers must abort cleanly when it elapses. */
  timeoutMs: number;
  signal: AbortSignal;
  /** Route all outbound traffic through this proxy when set. */
  proxyUrl?: string;
  /** Cookies to inject, for sources behind a login the operator has provided. */
  cookieHeader?: string;
  /** Preferred UI/content language, sent as Accept-Language. */
  locale?: string;
}

export interface Resolver {
  /** Stable identifier, surfaced in `ProbeResult.resolver` and in logs. */
  readonly name: string;
  /** Lower runs first. Site-specific: 10–49. Generic fallbacks: 50+. */
  readonly priority: number;

  /**
   * Cheap synchronous check — hostname/pattern matching only.
   * Must not perform I/O; the registry calls it for every resolver on every request.
   */
  canHandle(url: URL): boolean;

  /**
   * Perform the analysis.
   *
   * Throw `AppError('NO_MEDIA_FOUND')` to let the registry fall through to the
   * next resolver. Throw any other `AppError` to stop the chain — `DRM_PROTECTED`
   * and `AUTH_REQUIRED` are real answers about the source, not this resolver
   * failing, so trying another resolver would only waste time.
   */
  resolve(url: URL, options: ResolveOptions): Promise<ProbeResult>;

  /** Release browsers, temp dirs and sockets. Called on shutdown. */
  dispose?(): Promise<void>;
}
