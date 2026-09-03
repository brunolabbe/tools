/**
 * Recording the browser's own CSP refusals, for any spec that wants them
 * (dl-35).
 *
 * Shared rather than repeated because three specs need it and they need it for
 * two opposite reasons: `csp.spec.ts` asserts a violation *did* fire, and the
 * two journey specs assert none did. The second is the one that catches a
 * policy which is too strict — a refused subresource is silent from the test's
 * point of view, and dl-29's `Preview` deliberately hides a failed image, so
 * without this an over-tight `img-src` and a correct one look identical.
 *
 * `securitypolicyviolation` and not the console: a console listener also
 * collects every unrelated warning, and matching CSP messages out of it is
 * matching on one browser's prose. The event carries the directive and the
 * blocked URI as fields.
 *
 * Not a `.spec.ts`, so neither Playwright config collects it as a suite — both
 * set `testMatch` to a glob ending in `.spec.ts`.
 */

import type { Page } from "@playwright/test";

export interface CspViolation {
  /** e.g. `img-src`, or `script-src-elem` where a UA reports the CSP3 name. */
  effectiveDirective: string;
  blockedURI: string;
}

declare global {
  interface Window {
    /** Filled by `collectCspViolations`; read back with `cspViolationsOn`. */
    cspViolationLog?: CspViolation[];
  }
}

/**
 * Starts recording, and must be called *before* the first navigation.
 *
 * A listener attached after `goto` misses everything the document did on its
 * way up — a refused stylesheet or bundle, which is exactly the "policy too
 * strict, page silently broken" case this is for.
 */
export async function collectCspViolations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.cspViolationLog = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      window.cspViolationLog?.push({
        effectiveDirective: event.effectiveDirective,
        blockedURI: event.blockedURI,
      });
    });
  });
}

/** Everything the current document has refused since it was created. */
export async function cspViolationsOn(page: Page): Promise<CspViolation[]> {
  return await page.evaluate(() => window.cspViolationLog ?? []);
}
