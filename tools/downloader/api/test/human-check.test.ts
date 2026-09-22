/**
 * dl-50: the Turnstile check in front of probe and job creation.
 *
 * Cloudflare is stood in for here by a stubbed `fetch`, so this suite reaches
 * no network and runs in CI. The two lines the owner asked to see proven
 * against the **real** `siteverify` — the always-pass and always-fail test
 * keys — are also in `human-check.live.test.ts`, which is skipped unless
 * `TURNSTILE_LIVE=1`; the stubs below answer with the shapes that suite
 * measured.
 *
 * What each block proves, against the ticket's Done-when:
 *
 *  - a missing or refused token is `HUMAN_CHECK_FAILED`, **and the gates and
 *    the queue were never asked** — spied, not inferred from a count that a
 *    leaked-then-released slot would also leave at zero;
 *  - a passing token runs a probe and a job exactly as before;
 *  - a verifier that times out, cannot be reached, answers non-2xx or answers
 *    nonsense is a refusal (fail closed);
 *  - with no keys configured nothing is asked for, and `/api/config` says so;
 *  - the token reaches no log line and no stored row.
 */

import { ROUTES } from "@downloader/contract";
import { afterEach, describe, expect, test, vi } from "vitest";
import { loadApiConfig } from "../src/config.ts";
import { createHumanCheck, SITEVERIFY_URL } from "../src/human-check.ts";
import { createLogger } from "../src/logger.ts";
import type { AppLogger } from "../src/logger.ts";
import { createHarness, probeResult, SOURCE_URL, StubResolver, waitFor } from "./helpers.ts";
import type { Harness } from "./helpers.ts";

/** Cloudflare's published test keys: the site key and secret that always pass. */
const PASS_SITE_KEY = "1x00000000000000000000AA";
const PASS_SECRET = "1x0000000000000000000000000000000AA";

/** A token distinctive enough that finding it anywhere is not a coincidence. */
const TOKEN = "XXXX.DUMMY.TOKEN.dl50-must-never-be-logged-0f3c9a";

const KEYS = { siteKey: PASS_SITE_KEY, secretKey: PASS_SECRET };

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.dispose();
  harness = undefined;
});

interface Verifier {
  fetchImpl: typeof fetch;
  calls: { url: string; body: URLSearchParams }[];
}

/** A stand-in for `siteverify`, answering every call with `answer()`. */
function siteverify(answer: (init: RequestInit | undefined) => Promise<Response>): Verifier {
  const calls: Verifier["calls"] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), body: new URLSearchParams(String(init?.body)) });
    return await answer(init);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

/** The two bodies the live suite measured, verbatim in the fields that matter. */
const PASSES = async (): Promise<Response> =>
  Response.json({ success: true, "error-codes": [], hostname: "example.com" });
const FAILS = async (): Promise<Response> =>
  Response.json({ success: false, "error-codes": ["invalid-input-response"] });

interface Line {
  msg?: string;
  reason?: string;
  [key: string]: unknown;
}

function capturing(): { logger: AppLogger; lines: Line[]; raw: string[] } {
  const lines: Line[] = [];
  const raw: string[] = [];
  const logger = createLogger({
    level: "debug",
    write: (line) => {
      raw.push(line);
      lines.push(JSON.parse(line) as Line);
    },
  });
  return { logger, lines, raw };
}

async function checked(
  verifier: Verifier,
  options: { logger?: AppLogger; timeoutMs?: number } = {},
): Promise<Harness> {
  harness = await createHarness({
    resolver: new StubResolver(probeResult()),
    config: { turnstile: KEYS },
    humanCheck: createHumanCheck({
      turnstile: KEYS,
      fetchImpl: verifier.fetchImpl,
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });
  return harness;
}

function postProbe(h: Harness, token?: string) {
  return h.app.server.inject({
    method: "POST",
    url: ROUTES.probe,
    payload: { url: SOURCE_URL, ...(token === undefined ? {} : { humanCheckToken: token }) },
  });
}

function postJob(h: Harness, token?: string) {
  return h.app.server.inject({
    method: "POST",
    url: ROUTES.jobs,
    payload: { url: SOURCE_URL, ...(token === undefined ? {} : { humanCheckToken: token }) },
  });
}

/**
 * Spies on everything a refused request must never reach. A count read after
 * the fact cannot tell "never acquired" from "acquired and released", and the
 * ticket's line is the first of those.
 */
function spyOnIntake(h: Harness) {
  const { context } = h.app;
  return {
    guard: vi.spyOn(context.guard, "assertAllowed"),
    probeGate: vi.spyOn(context.probeGate, "tryAcquire"),
    probeClientGate: vi.spyOn(context.probeClientGate, "tryAcquire"),
    jobClientGate: vi.spyOn(context.jobClientGate, "tryAcquire"),
    enqueue: vi.spyOn(context.queue, "enqueue"),
  };
}

function expectRefused(response: { statusCode: number; body: string }): void {
  expect(response.statusCode).toBe(403);
  const { error } = JSON.parse(response.body) as {
    error: { code: string; retryable: boolean; details?: unknown };
  };
  expect(error.code).toBe("HUMAN_CHECK_FAILED");
  // Not retryable: the token is spent, so the same request cannot succeed.
  expect(error.retryable).toBe(false);
  // Nothing saying *which* refusal it was — that would tell a script what to
  // manufacture. The reason is in the log line instead.
  expect(error.details).toBeUndefined();
}

describe("a request without a passing token is refused before any slot is taken", () => {
  test("a probe with no token", async () => {
    const verifier = siteverify(PASSES);
    const h = await checked(verifier);
    const spies = spyOnIntake(h);
    const resolve = vi.spyOn(h.app.context.registry, "resolve");

    expectRefused(await postProbe(h));

    // No token, so nothing to ask Cloudflare about.
    expect(verifier.calls).toHaveLength(0);
    expect(spies.guard).not.toHaveBeenCalled();
    expect(spies.probeClientGate).not.toHaveBeenCalled();
    expect(spies.probeGate).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
    expect(h.app.context.probeGate.inFlight).toBe(0);
    // A refusal is about the caller, not a host: no dl-57 outcome row.
    expect(h.app.context.store.probeOutcomes()).toEqual([]);
  });

  test("a job with no token", async () => {
    const verifier = siteverify(PASSES);
    const h = await checked(verifier);
    const spies = spyOnIntake(h);

    expectRefused(await postJob(h));

    expect(verifier.calls).toHaveLength(0);
    expect(spies.guard).not.toHaveBeenCalled();
    expect(spies.jobClientGate).not.toHaveBeenCalled();
    expect(spies.enqueue).not.toHaveBeenCalled();
    expect(h.app.context.queue.waiting).toBe(0);
    expect(h.app.context.queue.running).toBe(0);
    expect(h.app.context.store.list().total).toBe(0);
  });

  test("a probe and a job whose token Cloudflare refuses (the always-fail secret's answer)", async () => {
    const verifier = siteverify(FAILS);
    const h = await checked(verifier);
    const spies = spyOnIntake(h);

    expectRefused(await postProbe(h, TOKEN));
    expectRefused(await postJob(h, TOKEN));

    // Each was really asked about — the refusal is Cloudflare's, not a
    // shortcut here — with the secret and the token it was sent.
    expect(verifier.calls).toHaveLength(2);
    for (const call of verifier.calls) {
      expect(call.url).toBe(SITEVERIFY_URL);
      expect(call.body.get("secret")).toBe(PASS_SECRET);
      expect(call.body.get("response")).toBe(TOKEN);
      // Deliberately not sent; see the header of `human-check.ts`.
      expect(call.body.has("remoteip")).toBe(false);
    }
    for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
    expect(h.app.context.store.list().total).toBe(0);
  });
});

describe("a passing token changes nothing about the work", () => {
  test("a probe and a job run as they did before dl-50, each spending its own token", async () => {
    const verifier = siteverify(PASSES);
    const h = await checked(verifier);

    const probe = await postProbe(h, "token-for-the-probe");
    expect(probe.statusCode).toBe(200);
    expect((JSON.parse(probe.body) as { probe: { title: string } }).probe.title).toBe(
      "A test video",
    );

    const created = await postJob(h, "token-for-the-job");
    expect(created.statusCode).toBe(201);
    const { job } = JSON.parse(created.body) as { job: { id: string } };
    await waitFor(
      () => h.app.context.store.get(job.id).status,
      (status) => status === "completed",
      { label: "the job to complete" },
    );

    expect(verifier.calls.map((call) => call.body.get("response"))).toEqual([
      "token-for-the-probe",
      "token-for-the-job",
    ]);
  });
});

describe("failing closed: a verifier that does not answer is a refusal", () => {
  test("a timeout refuses, within the bound", async () => {
    // Answers only when aborted, so the only way out is the timeout.
    const verifier = siteverify(
      async (init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const { logger, lines } = capturing();
    const h = await checked(verifier, { logger, timeoutMs: 25 });
    const spies = spyOnIntake(h);

    const started = Date.now();
    expectRefused(await postProbe(h, TOKEN));
    expectRefused(await postJob(h, TOKEN));

    // Two bounded waits, not a hang: generous against a 25 ms bound, and far
    // short of the suite's minute-long timeout that a hang would hit.
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(lines.filter((line) => line.msg === "human check refused").map((l) => l.reason)).toEqual(
      ["timeout", "timeout"],
    );
    for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
  });

  test("an unreachable verifier refuses", async () => {
    // What undici throws for a refused connection or a failed DNS lookup.
    const verifier = siteverify(async () => {
      throw new TypeError("fetch failed");
    });
    const { logger, lines } = capturing();
    const h = await checked(verifier, { logger });
    const spies = spyOnIntake(h);

    expectRefused(await postProbe(h, TOKEN));
    expectRefused(await postJob(h, TOKEN));

    expect(lines.filter((line) => line.msg === "human check refused").map((l) => l.reason)).toEqual(
      ["unreachable", "unreachable"],
    );
    for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
  });

  test("a non-2xx answer refuses, even one whose body says success", async () => {
    const verifier = siteverify(async () => Response.json({ success: true }, { status: 500 }));
    const h = await checked(verifier);

    expectRefused(await postProbe(h, TOKEN));
  });

  test("an answer that is not Cloudflare's shape refuses", async () => {
    for (const body of ["<html>a captive portal</html>", "{}", '{"success":"true"}']) {
      const verifier = siteverify(async () => new Response(body, { status: 200 }));
      // oxlint-disable-next-line no-await-in-loop
      const h = await checked(verifier);
      // oxlint-disable-next-line no-await-in-loop
      expectRefused(await postProbe(h, TOKEN));
      // oxlint-disable-next-line no-await-in-loop
      await h.dispose();
      harness = undefined;
    }
  });
});

describe("with no keys configured", () => {
  test("no token is asked for, and the page is told there is no check", async () => {
    // The harness's default, which is also every deployment before dl-50.
    harness = await createHarness({ resolver: new StubResolver(probeResult()) });

    expect((await postProbe(harness)).statusCode).toBe(200);
    expect((await postJob(harness)).statusCode).toBe(201);

    const config = await harness.app.server.inject({ method: "GET", url: ROUTES.config });
    expect(config.statusCode).toBe(200);
    expect(JSON.parse(config.body)).toEqual({ humanCheck: null });
  });

  test("a token sent anyway is ignored, not refused", async () => {
    // A page built for a checked deployment, pointed at one without a check.
    harness = await createHarness({ resolver: new StubResolver(probeResult()) });

    expect((await postProbe(harness, TOKEN)).statusCode).toBe(200);
  });
});

describe("GET /api/config with keys configured", () => {
  test("hands the page the site key and nothing else", async () => {
    const h = await checked(siteverify(PASSES));

    const response = await h.app.server.inject({ method: "GET", url: ROUTES.config });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ humanCheck: { siteKey: PASS_SITE_KEY } });
    expect(response.body).not.toContain(PASS_SECRET);
  });
});

describe("the settings", () => {
  test("both keys turn the check on, and neither leaves it off", () => {
    expect(
      loadApiConfig({}, { TURNSTILE_SITE_KEY: PASS_SITE_KEY, TURNSTILE_SECRET_KEY: PASS_SECRET })
        .turnstile,
    ).toEqual(KEYS);
    expect(loadApiConfig({}, {}).turnstile).toBeUndefined();
    // Blank is unset, the way every other setting here reads it.
    expect(
      loadApiConfig({}, { TURNSTILE_SITE_KEY: " ", TURNSTILE_SECRET_KEY: "" }).turnstile,
    ).toBeUndefined();
  });

  test("one key without the other refuses to boot, naming the missing variable only", () => {
    const secretOnly = (): unknown => loadApiConfig({}, { TURNSTILE_SECRET_KEY: PASS_SECRET });
    const siteKeyOnly = (): unknown => loadApiConfig({}, { TURNSTILE_SITE_KEY: PASS_SITE_KEY });

    expect(secretOnly).toThrow(/TURNSTILE_SITE_KEY is not set/u);
    expect(siteKeyOnly).toThrow(/TURNSTILE_SECRET_KEY is not set/u);
    // The error is a boot log line; the secret it was given must not be in it.
    try {
      secretOnly();
    } catch (error: unknown) {
      expect(JSON.stringify(error)).not.toContain(PASS_SECRET);
      expect(String(error)).not.toContain(PASS_SECRET);
    }
  });
});

describe("the token is a credential", () => {
  test("no log line and no stored row carries it, whatever the outcome", async () => {
    const { logger, raw } = capturing();

    // Passing: a probe and a job, run to completion so every row is written.
    let h = await checked(siteverify(PASSES), { logger });
    expect((await postProbe(h, TOKEN)).statusCode).toBe(200);
    const created = await postJob(h, TOKEN);
    const { job } = JSON.parse(created.body) as { job: { id: string } };
    await waitFor(
      () => h.app.context.store.get(job.id).status,
      (status) => status === "completed",
      { label: "the job to complete" },
    );
    const stored = JSON.stringify({
      jobs: h.app.context.store.list(),
      options: h.app.context.store.options(job.id),
      outcomes: h.app.context.store.probeOutcomes(),
    });
    await h.dispose();
    harness = undefined;

    // Refused by Cloudflare, and refused because Cloudflare could not be
    // reached — the two paths that log the most about a token.
    h = await checked(siteverify(FAILS), { logger });
    expectRefused(await postProbe(h, TOKEN));
    await h.dispose();
    harness = undefined;
    h = await checked(
      siteverify(async () => {
        throw new TypeError(`fetch failed for a body carrying ${TOKEN}`);
      }),
      { logger },
    );
    expectRefused(await postJob(h, TOKEN));

    // Non-vacuous: the logger really saw these requests, at debug and above.
    expect(raw.some((line) => line.includes('"human check refused"'))).toBe(true);
    expect(raw.some((line) => line.includes('"job accepted"'))).toBe(true);
    expect(stored).toContain(job.id);

    for (const line of raw) {
      expect(line).not.toContain(TOKEN);
      expect(line).not.toContain(PASS_SECRET);
    }
    expect(stored).not.toContain(TOKEN);
  });
});
