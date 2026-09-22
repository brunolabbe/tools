/**
 * dl-50 against Cloudflare's **real** `siteverify`, with its published test
 * secrets. Skipped unless `TURNSTILE_LIVE=1`.
 *
 * The owner asked on 2026-09-14 for the always-pass and always-fail lines to
 * be proven against the live endpoint rather than a stub. The repo's rule is
 * fixtures, not live network calls, and on 2026-09-22 the owner chose this
 * shape to satisfy both: the proof is committed and re-runnable, and CI never
 * depends on Cloudflare's uptime or a runner's egress. `human-check.test.ts`
 * covers the same lines against stubs that answer with the bodies measured
 * here.
 *
 *   TURNSTILE_LIVE=1 npx vitest run tools/downloader/api/test/human-check.live.test.ts
 *
 * The devcontainer's firewall blocks `challenges.cloudflare.com`, so from in
 * there it needs the firewall opened first; a blocked run fails on the pass
 * case, never green.
 *
 * The test keys are public, documented, and valid only for testing: the
 * always-pass secret accepts any token and the always-fail secret refuses any,
 * each answering with `metadata.result_with_testing_key: true`.
 */

import process from "node:process";
import { ROUTES } from "@downloader/contract";
import { afterEach, describe, expect, test } from "vitest";
import { createHumanCheck } from "../src/human-check.ts";
import { createLogger } from "../src/logger.ts";
import { createHarness, probeResult, SOURCE_URL, StubResolver } from "./helpers.ts";
import type { Harness } from "./helpers.ts";

const LIVE = process.env["TURNSTILE_LIVE"] === "1";

/** Cloudflare's published test keys. */
const PASS_SITE_KEY = "1x00000000000000000000AA";
const PASS_SECRET = "1x0000000000000000000000000000000AA";
const FAIL_SECRET = "2x0000000000000000000000000000000AA";

/** The token Cloudflare's test site keys hand a page, per its documentation. */
const DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.dispose();
  harness = undefined;
});

async function live(secretKey: string): Promise<Harness> {
  const turnstile = { siteKey: PASS_SITE_KEY, secretKey };
  harness = await createHarness({
    resolver: new StubResolver(probeResult()),
    config: { turnstile },
    // The real verifier, the real `fetch`, the real endpoint, the default
    // timeout. Nothing here is stood in for.
    humanCheck: createHumanCheck({ turnstile }),
    logger: createLogger({ level: "silent" }),
  });
  return harness;
}

describe.skipIf(!LIVE)("against the live siteverify", () => {
  test("the always-pass secret lets a probe and a job run", async () => {
    const h = await live(PASS_SECRET);

    const probe = await h.app.server.inject({
      method: "POST",
      url: ROUTES.probe,
      payload: { url: SOURCE_URL, humanCheckToken: DUMMY_TOKEN },
    });
    const job = await h.app.server.inject({
      method: "POST",
      url: ROUTES.jobs,
      payload: { url: SOURCE_URL, humanCheckToken: DUMMY_TOKEN },
    });

    expect(probe.statusCode, probe.body).toBe(200);
    expect(job.statusCode, job.body).toBe(201);
  });

  test("the always-fail secret refuses both with HUMAN_CHECK_FAILED", async () => {
    const h = await live(FAIL_SECRET);

    for (const url of [ROUTES.probe, ROUTES.jobs]) {
      // oxlint-disable-next-line no-await-in-loop
      const response = await h.app.server.inject({
        method: "POST",
        url,
        payload: { url: SOURCE_URL, humanCheckToken: DUMMY_TOKEN },
      });
      expect(response.statusCode, url).toBe(403);
      expect(JSON.parse(response.body), url).toMatchObject({
        error: { code: "HUMAN_CHECK_FAILED", retryable: false },
      });
    }
    expect(h.app.context.store.list().total).toBe(0);
  });
});
