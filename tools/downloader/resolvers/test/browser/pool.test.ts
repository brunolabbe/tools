/**
 * How the pool shares a browser once every probe carries a proxy.
 *
 * Chromium binds `--proxy-server` per process, so a proxy used to mean a
 * dedicated browser — right while a proxy was the exception. Since dl-12 the API
 * hands every probe its loopback egress proxy, so "a proxy means a dedicated
 * browser" would mean a fresh Chromium — ~1 s and ~150 MB — on every single
 * probe. These tests pin the rule that replaced it: the shared browser is keyed
 * on the proxy it was launched with.
 *
 * Real browsers, because the thing under test is a launch. The proxy is never
 * connected to — nothing here navigates.
 */

import { afterEach, describe, expect, test } from "vitest";
import { BrowserPool } from "../../src/browser/pool.ts";

const PROXY = "http://127.0.0.1:1";
const OTHER_PROXY = "http://127.0.0.1:2";
const TEST_TIMEOUT_MS = 90_000;

let pool: BrowserPool | undefined;

afterEach(async () => {
  await pool?.close();
  pool = undefined;
});

/** The pool hands a browser to a callback and reclaims it; this keeps the identity. */
async function lease(
  current: BrowserPool,
  proxyUrl?: string,
): Promise<{
  id: unknown;
  connectedAfter: boolean;
}> {
  const browser = await current.withBrowser(
    proxyUrl === undefined ? {} : { proxyUrl },
    async (leased) => leased,
  );
  return { id: browser, connectedAfter: browser.isConnected() };
}

describe("sharing a browser across probes", () => {
  test(
    "two probes with the same proxy share one browser",
    async () => {
      pool = new BrowserPool({ maxConcurrent: 1, headless: true });

      const first = await lease(pool, PROXY);
      const second = await lease(pool, PROXY);

      expect(second.id).toBe(first.id);
      // Shared, so it outlives the lease: closing it here would cost the next
      // probe a relaunch.
      expect(second.connectedAfter).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a probe asking for a different proxy gets its own, and it is closed after",
    async () => {
      pool = new BrowserPool({ maxConcurrent: 1, headless: true });

      const shared = await lease(pool, PROXY);
      const dedicated = await lease(pool, OTHER_PROXY);

      expect(dedicated.id).not.toBe(shared.id);
      // A dedicated browser belongs to its lease and to nothing else.
      expect(dedicated.connectedAfter).toBe(false);
      // …and the shared one is untouched by it.
      expect(shared.connectedAfter).toBe(true);
      expect((await lease(pool, PROXY)).id).toBe(shared.id);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "no proxy at all still shares, as it always did",
    async () => {
      pool = new BrowserPool({ maxConcurrent: 1, headless: true });

      const first = await lease(pool);
      // An empty string is "no proxy", not a different one — the config layer
      // can produce it and Chromium would reject it.
      const second = await lease(pool, "");

      expect(second.id).toBe(first.id);
      expect(pool.stats.launched).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );
});
