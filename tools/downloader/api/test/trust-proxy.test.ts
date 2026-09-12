/**
 * `trustProxy` wired through to Fastify, proven at the route rather than at
 * the parser.
 *
 * `packages/core/test/trust-proxy.test.ts` (repo-40) covers the parsing —
 * default, both boolean directions, CIDR/list passthrough — at the one place
 * the function now lives. What it cannot prove is that the parsed value
 * reaches `Fastify({ trustProxy })` and thereby changes *which address* this
 * tool's own rate limiters key on. That is wiring, not parsing, and this file
 * had never tested it before repo-40: there is no other test here that sets
 * `TRUST_PROXY` or `config.trustProxy` at all.
 *
 * Modelled on the planner's existing coverage of the same wiring —
 * `tools/planner/api/test/runs.test.ts`'s `describe("behind a proxy
 * (pl-38)")` block — rather than invented fresh, since the two tools wire the
 * identical setting into the identical Fastify option.
 */

import { ROUTES } from "@downloader/contract";
import { describe, expect, test } from "vitest";
import type { Harness } from "./helpers.ts";
import { createHarness, probeResult, SOURCE_URL, StubResolver } from "./helpers.ts";

const createJob = (harness: Harness, remoteAddress: string, claimedIp: string) =>
  harness.app.server.inject({
    method: "POST",
    url: ROUTES.jobs,
    payload: { url: SOURCE_URL },
    remoteAddress,
    headers: { "x-forwarded-for": claimedIp },
  });

describe("behind a proxy (repo-40)", () => {
  // An address in front of one client, as far as `trustProxy` is concerned —
  // the shape a compose network's `edge` hop has.
  const TRUSTED_PROXY_CIDR = "172.30.42.0/24";
  const PROXY_ADDRESS = "172.30.42.10";

  test("two clients behind a trusted proxy get independent allowances", async () => {
    const harness = await createHarness({
      resolver: new StubResolver(probeResult()),
      config: { rateLimitJobsPerMinute: 1, trustProxy: TRUSTED_PROXY_CIDR },
    });
    try {
      const first = await createJob(harness, PROXY_ADDRESS, "203.0.113.5");
      expect(first.statusCode).toBe(201);
      // Same claimed client, same trusted hop, over its one-per-minute budget.
      const second = await createJob(harness, PROXY_ADDRESS, "203.0.113.5");
      expect(second.statusCode).toBe(429);
      expect((second.json() as { error: { code: string } }).error.code).toBe("RATE_LIMITED");

      // A different client behind the same trusted hop is unaffected: a bug
      // that keyed on the proxy's own address instead of the forwarded one
      // would have this client refused too.
      const third = await createJob(harness, PROXY_ADDRESS, "203.0.113.9");
      expect(third.statusCode).toBe(201);
    } finally {
      await harness.dispose();
    }
  });

  test("a client outside the trusted CIDR cannot choose its own bucket", async () => {
    const harness = await createHarness({
      resolver: new StubResolver(probeResult()),
      config: { rateLimitJobsPerMinute: 2, trustProxy: TRUSTED_PROXY_CIDR },
    });
    try {
      // Not `PROXY_ADDRESS`, and outside `TRUSTED_PROXY_CIDR` — an untrusted
      // hop naming a different `X-Forwarded-For` on every request, the way an
      // attacker minting itself unlimited buckets would.
      const UNTRUSTED_ADDRESS = "203.0.113.1";

      const first = await createJob(harness, UNTRUSTED_ADDRESS, "10.0.0.1");
      const second = await createJob(harness, UNTRUSTED_ADDRESS, "10.0.0.2");
      const third = await createJob(harness, UNTRUSTED_ADDRESS, "10.0.0.3");

      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(201);
      // A different claimed identity on every request and still refused: the
      // header was ignored because the hop it arrived from is not trusted, so
      // all three counted against the one real address's bucket.
      expect(third.statusCode).toBe(429);
      expect((third.json() as { error: { code: string } }).error.code).toBe("RATE_LIMITED");
    } finally {
      await harness.dispose();
    }
  });
});
