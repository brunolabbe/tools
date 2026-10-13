/**
 * dl-107: keep the least visitor data the law allows.
 *
 * Six things, each with the test that proves it. The terms page says what is
 * kept; `terms-page.test.ts` holds the page to the code, and this file holds the
 * code to what it says:
 *
 *  - a finished job's row loses its page address, media URL, title and error
 *    URLs once its link's lifetime has passed, and keeps its host, status, error
 *    code and times;
 *  - a `request` line holds a network, never an address;
 *  - a stored error holds no query string;
 *  - no log line holds a page's or a media file's path.
 *
 * `OUTCOME_RETENTION_DAYS=0` is in `probe-outcomes.test.ts`, beside the retention
 * it changes.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AppError, ROUTES } from "@downloader/contract";
import type { JobResponse } from "@downloader/contract";
import Database from "better-sqlite3";
import { afterEach, describe, expect, test } from "vitest";
import { FINISHED_JOB_CLEAR_AFTER_MS, JOB_RETENTION_DAYS } from "../src/jobs/links.ts";
import { shortenAddress, shortenKey } from "../src/log-address.ts";
import { createLogger, cutUrlsToOrigin } from "../src/logger.ts";
import { runSweep } from "../src/server.ts";
import {
  createHarness,
  probeResult,
  SOURCE_URL,
  StubResolver,
  variant,
  waitFor,
} from "./helpers.ts";
import type { Harness, HarnessOptions } from "./helpers.ts";

type Line = Record<string, unknown> & { msg: string };

// dl-124: a request id is a random UUID unless the caller supplies one, and a
// UUID is hex, so it can contain `aaaa`, `bbbb` or `cccc` — the interface ids the
// IPv6 test below uses. Pinning one that does makes the collision happen on every
// run instead of about one run in 340.
const HEX_RUN_REQUEST_ID = "f74250e2-bbbb-4ab7-9146-1d93423997db";

describe("shortenAddress", () => {
  test.each([
    ["203.0.113.77", "203.0.113.0/24"],
    ["198.51.100.1", "198.51.100.0/24"],
    ["2001:db8:1:2:3:4:5:6", "2001:db8:1::/48"],
    ["2001:DB8:1::9", "2001:db8:1::/48"],
    ["[2001:db8:1::9]", "2001:db8:1::/48"],
    ["fe80::1%eth0", "fe80:0:0::/48"],
    ["::1", "0:0:0::/48"],
    // An IPv4 address behind an IPv6 socket is still an IPv4 address.
    ["::ffff:203.0.113.77", "203.0.113.0/24"],
    // A /64 is what `clientKey` hands the rate limiter for IPv6.
    ["2001:db8:1:2::/64", "2001:db8:1::/48"],
  ])("%s becomes %s", (address, expected) => {
    expect(shortenAddress(address)).toBe(expected);
  });

  test("what cannot be read is 'unknown', never passed through", () => {
    for (const junk of [undefined, "", "not an address", "1.2.3", "1:2:3:4:5:6:7:8:9", "1::2::3"]) {
      expect(shortenAddress(junk)).toBe("unknown");
    }
  });

  test("a rate-limit key keeps its shape and loses its address", () => {
    expect(shortenKey("ip:203.0.113.77")).toBe("ip:203.0.113.0/24");
    expect(shortenKey("203.0.113.77")).toBe("203.0.113.0/24");
    expect(shortenKey("2001:db8:1:2::/64")).toBe("2001:db8:1::/48");
    // A credential's digest holds no address and is what makes the bucket legible.
    expect(shortenKey("token:AbC123_-xyz")).toBe("token:AbC123_-xyz");
    expect(shortenKey("unknown")).toBe("unknown");
  });
});

describe("the address on a log line", () => {
  let harness: Harness | undefined;

  afterEach(async () => {
    await harness?.dispose();
    harness = undefined;
  });

  async function logged(
    send: (current: Harness) => Promise<void>,
    config: HarnessOptions["config"] = {},
  ): Promise<{ lines: Line[]; raw: string }> {
    const raw: string[] = [];
    harness = await createHarness({
      logger: createLogger({
        level: "info",
        write: (line) => void raw.push(line),
        // dl-124: the logger writes `os.hostname()` on every line, and under Docker that
        // is a random 12-hex container id that can hold `aaaa`, `bbbb` or `cccc`. A
        // matching machine would fail the IPv6 leak check below on every run.
        bindings: { hostname: "test-host" },
      }),
      resolver: new StubResolver(probeResult()),
      config,
    });
    // Startup lines describe the host, not a visitor.
    raw.length = 0;
    await send(harness);
    return { lines: raw.map((line) => JSON.parse(line) as Line), raw: raw.join("") };
  }

  test.each([
    ["an IPv4 client", "203.0.113.77", "203.0.113.0/24"],
    ["an IPv6 client", "2001:db8:1:2:3:4:5:6", "2001:db8:1::/48"],
  ])("a served request writes its network and not %s's address", async (_name, client, network) => {
    const { lines, raw } = await logged(async (current) => {
      await current.app.server.inject({
        method: "POST",
        url: ROUTES.probe,
        payload: { url: SOURCE_URL },
        remoteAddress: client,
      });
    });

    const request = lines.filter((line) => line.msg === "request");
    expect(request.map((line) => line["ip"])).toEqual([network]);
    expect(raw).not.toContain(client);
  });

  test.each([
    ["an IPv4 client", "203.0.113.77", "203.0.113.0/24"],
    ["an IPv6 client", "2001:db8:1:2:3:4:5:6", "2001:db8:1::/48"],
  ])(
    "a request the router refuses before any hook runs writes the same, for %s",
    async (_name, client, network) => {
      const { lines, raw } = await logged(async (current) => {
        const response = await current.app.server.inject({
          method: "GET",
          url: "/api/%zz",
          remoteAddress: client,
        });
        expect(response.statusCode).toBe(400);
      });

      const request = lines.filter((line) => line.msg === "request");
      expect(request).toHaveLength(1);
      expect(request[0]?.["code"]).toBe("FST_ERR_BAD_URL");
      expect(request[0]?.["ip"]).toBe(network);
      expect(raw).not.toContain(client);
    },
  );

  test("a rate-limited request's line holds the network, not the bucket's whole key", async () => {
    const client = "203.0.113.77";
    const { lines, raw } = await logged(
      async (current) => {
        for (let i = 0; i < 2; i += 1) {
          // oxlint-disable-next-line no-await-in-loop
          await current.app.server.inject({
            method: "POST",
            url: ROUTES.probe,
            payload: { url: SOURCE_URL },
            remoteAddress: client,
          });
        }
      },
      { rateLimitProbePerMinute: 1 },
    );

    const limited = lines.filter((line) => line.msg === "rate limited");
    expect(limited).toHaveLength(1);
    expect(limited[0]?.["key"]).toBe("203.0.113.0/24");
    expect(raw).not.toContain(client);
  });

  test("an IPv6 client's rate-limited line says the /48, while the limiter still counts its /64", async () => {
    // `clientKey` hands the limiter the /64, so the line would otherwise write
    // `2001:db8:1:1::/64`: a network of one household, not the /48 the request
    // line writes.
    const a = "2001:db8:1:1::aaaa";
    const b = "2001:db8:1:2::bbbb";
    const statuses: number[] = [];
    const { lines, raw } = await logged(
      async (current) => {
        for (const remoteAddress of [a, b, a, "2001:db8:1:1::cccc"]) {
          // oxlint-disable-next-line no-await-in-loop
          const response = await current.app.server.inject({
            method: "POST",
            url: ROUTES.probe,
            payload: { url: SOURCE_URL },
            headers: { "x-request-id": HEX_RUN_REQUEST_ID },
            remoteAddress,
          });
          statuses.push(response.statusCode);
        }
      },
      { rateLimitProbePerMinute: 1 },
    );

    // Two /64s in one /48 are two buckets; the same /64 shares one.
    expect(statuses).toEqual([200, 200, 429, 429]);
    const limited = lines.filter((line) => line.msg === "rate limited");
    expect(limited.map((line) => line["key"])).toEqual(["2001:db8:1::/48", "2001:db8:1::/48"]);
    // The request id is the one thing taken out before the leak check, and only
    // after the lines are shown to carry it: the check below keeps its bare
    // `aaaa|bbbb|cccc`, so an interface id leaking on its own is still caught.
    const served = lines.filter((line) => line.msg === "request");
    expect(served.map((line) => line["requestId"])).toEqual(statuses.map(() => HEX_RUN_REQUEST_ID));
    expect(raw.replaceAll(HEX_RUN_REQUEST_ID, "")).not.toMatch(
      /2001:db8:1:1|2001:db8:1:2|aaaa|bbbb|cccc/u,
    );
  });

  test.each([
    ["an IPv4 client", "203.0.113.77", "203.0.113.78", "203.0.113.0/24", /203\.0\.113\.7[78]/u],
    ["an IPv6 client", "2001:db8:5:1::1", "2001:db8:5:2::1", "2001:db8:5::/48", /2001:db8:5:[12]/u],
  ])(
    "the per-client cap line says the network for %s, and the cap still counts the address",
    async (_name, first, second, network, leaked) => {
      let release: (() => void) | undefined;
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      const raw: string[] = [];
      harness = await createHarness({
        logger: createLogger({ level: "info", write: (line) => void raw.push(line) }),
        resolver: new StubResolver(async () => {
          await blocked;
          return probeResult();
        }),
        config: { maxConcurrentJobs: 4, maxJobsPerClient: 1, maxQueuedJobs: 0 },
      });
      const current = harness;
      raw.length = 0;

      // Opens a job's link and reports whether it took a slot (201) or was refused.
      const open = async (remoteAddress: string, url: string): Promise<number> => {
        const created = await current.app.server.inject({
          method: "POST",
          url: ROUTES.jobs,
          payload: { url },
          remoteAddress,
        });
        const { job } = created.json() as JobResponse;
        const token = (job.link?.url ?? "").split("/").at(-1) ?? "";
        let answered: number | null = null;
        void current.app.server
          .inject({ method: "GET", url: job.link?.url ?? "", remoteAddress })
          .then((response) => {
            answered = response.statusCode;
            return undefined;
          });
        await waitFor(
          () => ({ answered, used: current.app.context.store.findLink(token)?.usedAt ?? null }),
          (state) => state.answered !== null || state.used !== null,
        );
        return answered ?? 201;
      };

      try {
        const results = [
          await open(first, `${SOURCE_URL}/1`),
          await open(first, `${SOURCE_URL}/2`),
          // A different address in the same network is a different client to the cap.
          await open(second, `${SOURCE_URL}/3`),
        ];
        expect(results).toEqual([201, 429, 201]);
        const refused = raw
          .map((line) => JSON.parse(line) as Line)
          .filter((line) => line.msg === "download refused: per-client cap reached");
        expect(refused.map((line) => line["key"])).toEqual([network]);
        expect(raw.join("")).not.toMatch(leaked);
      } finally {
        release?.();
      }
    },
  );
});

describe("a finished job's row (dl-107)", () => {
  const MINUTE = 60_000;
  const NOW = new Date("2026-10-12T12:00:00.000Z");
  const PAGE = "https://site.example/watch/secret-path?token=PAGE_SECRET";
  const MEDIA = "https://cdn.example/segments/master.m3u8?sig=MEDIA_SECRET";
  const ALTERNATE = "https://cdn2.example/other/path.m3u8?sig=ALT_SECRET";
  const AUDIO = "https://cdn.example/audio/track.m4a?sig=AUDIO_SECRET";
  const TITLE = "A Very Private Title";

  let dir: string | undefined;
  let harness: Harness | undefined;
  let reader: Database.Database | undefined;

  afterEach(async () => {
    reader?.close();
    reader = undefined;
    await harness?.dispose();
    harness = undefined;
    if (dir !== undefined) await fs.rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function iso(offsetMs: number): string {
    return new Date(NOW.getTime() + offsetMs).toISOString();
  }

  /** A real database file, so the test can read the row the way the disk holds it. */
  async function start(clock: { now: Date }): Promise<{ harness: Harness; raw: () => string }> {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "downloader-dl107-"));
    const databasePath = path.join(dir, "jobs.sqlite");
    harness = await createHarness({
      now: () => clock.now,
      config: { databasePath },
    });
    reader = new Database(databasePath, { readonly: true });
    return {
      harness,
      raw: () => JSON.stringify(reader?.prepare("SELECT * FROM jobs ORDER BY id").all()),
    };
  }

  function create(current: Harness, id: string, createdAt: string): void {
    current.app.context.store.create({
      id,
      sourceUrl: PAGE,
      options: {},
      variantId: "hls-1080p",
      createdAt,
      link: { token: `tok-${id}`, url: `/api/files/tok-${id}`, expiresAt: iso(60 * MINUTE) },
    });
  }

  /** queued -> probing -> downloading -> completed, with everything a visitor shaped. */
  function complete(current: Harness, id: string, at: string): void {
    const { store } = current.app.context;
    store.transition(id, "probing", {}, at);
    store.transition(
      id,
      "downloading",
      {
        variant: variant({
          url: MEDIA,
          alternateUrls: [ALTERNATE],
          audioUrl: AUDIO,
        }),
      },
      at,
    );
    store.transition(
      id,
      "completed",
      { result: { filename: `${TITLE}.mp4`, sizeBytes: 1234, container: "mp4", durationSec: 10 } },
      at,
    );
  }

  test("one sweep after the link's lifetime blanks the four fields and keeps the rest", async () => {
    const clock = { now: NOW };
    const { harness: current, raw } = await start(clock);
    const { store } = current.app.context;

    // Finished at NOW, swept a link's lifetime and a minute later.
    create(current, "done", iso(-5 * MINUTE));
    complete(current, "done", NOW.toISOString());
    create(current, "failed", iso(-5 * MINUTE));
    store.transition(
      "failed",
      "failed",
      {
        error: {
          code: "UNREACHABLE",
          message: "The site could not be reached.",
          retryable: true,
          details: { url: PAGE, stderr: `ERROR: Unsupported URL: ${MEDIA}`, hint: "x" },
        },
      },
      NOW.toISOString(),
    );
    // The premise: the secrets are on disk before the sweep.
    expect(raw()).toContain("PAGE_SECRET");
    expect(raw()).toContain("MEDIA_SECRET");
    expect(raw()).toContain("secret-path");
    expect(raw()).toContain(TITLE);

    clock.now = new Date(NOW.getTime() + FINISHED_JOB_CLEAR_AFTER_MS + MINUTE);
    runSweep(current.app.context);

    const dump = raw();
    for (const secret of [
      "PAGE_SECRET",
      "MEDIA_SECRET",
      "ALT_SECRET",
      "AUDIO_SECRET",
      "secret-path",
      "cdn.example",
      "cdn2.example",
      TITLE,
      "Unsupported URL",
    ]) {
      expect(dump).not.toContain(secret);
    }

    const done = store.get("done");
    expect(done.sourceUrl).toBe("");
    expect(done.variant).toBeNull();
    expect(done.result).toEqual({
      filename: "",
      sizeBytes: 1234,
      container: "mp4",
      durationSec: 10,
    });
    expect(done.status).toBe("completed");
    expect(done.finishedAt).toBe(NOW.toISOString());
    expect(done.createdAt).toBe(iso(-5 * MINUTE));
    expect(store.jobHost("done")).toBe("site.example");

    const failed = store.get("failed");
    expect(failed.sourceUrl).toBe("");
    expect(failed.error).toEqual({
      code: "UNREACHABLE",
      message: "The site could not be reached.",
      retryable: true,
    });
    expect(failed.status).toBe("failed");
    expect(store.jobHost("failed")).toBe("site.example");
  });

  test("not before the link's lifetime is up, and never for a job still running", async () => {
    const clock = { now: NOW };
    const { harness: current } = await start(clock);
    const { store } = current.app.context;
    create(current, "done", iso(-5 * MINUTE));
    complete(current, "done", NOW.toISOString());
    create(current, "running", iso(-5 * MINUTE));
    store.transition("running", "probing", {}, iso(-4 * MINUTE));

    // One minute short of the lifetime: a tab reopened now still finds it whole.
    clock.now = new Date(NOW.getTime() + FINISHED_JOB_CLEAR_AFTER_MS - MINUTE);
    runSweep(current.app.context);
    expect(store.get("done").sourceUrl).toBe(PAGE);

    // Long after: the finished one goes, and the unfinished one is not a candidate.
    clock.now = new Date(NOW.getTime() + 3 * FINISHED_JOB_CLEAR_AFTER_MS);
    runSweep(current.app.context);
    expect(store.get("done").sourceUrl).toBe("");
    expect(store.get("running").sourceUrl).toBe(PAGE);
    expect(store.get("running").status).toBe("probing");
  });

  test("a cleared row is left alone by the next sweep, and still goes with the fourteen days", async () => {
    const clock = { now: NOW };
    const { harness: current } = await start(clock);
    const { store } = current.app.context;
    create(current, "done", iso(-5 * MINUTE));
    complete(current, "done", NOW.toISOString());

    clock.now = new Date(NOW.getTime() + 20 * MINUTE);
    expect(store.clearFinishedBefore(iso(10 * MINUTE))).toBe(1);
    // Nothing left to clear: the marker is the blank address.
    expect(store.clearFinishedBefore(iso(10 * MINUTE))).toBe(0);

    clock.now = new Date(NOW.getTime() + (JOB_RETENTION_DAYS + 1) * 24 * 60 * MINUTE);
    runSweep(current.app.context);
    expect(store.find("done")).toBeNull();
  });

  test("a cancel's reason and a wait's length survive, because the card reads them", async () => {
    const clock = { now: NOW };
    const { harness: current } = await start(clock);
    const { store } = current.app.context;
    create(current, "canceled", iso(-30 * MINUTE));
    store.transition(
      "canceled",
      "canceled",
      {
        error: {
          code: "JOB_CANCELED",
          message: "Canceled.",
          retryable: false,
          details: { reason: "link-expired", retryAfterSec: 10, url: PAGE, note: "free text" },
        },
      },
      iso(-20 * MINUTE),
    );

    runSweep(current.app.context);

    expect(store.get("canceled").error?.details).toEqual({
      reason: "link-expired",
      retryAfterSec: 10,
    });
  });
});

describe("a stored error holds no query string (dl-107)", () => {
  let harness: Harness | undefined;
  let dir: string | undefined;
  let reader: Database.Database | undefined;

  afterEach(async () => {
    reader?.close();
    reader = undefined;
    await harness?.dispose();
    harness = undefined;
    if (dir !== undefined) await fs.rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  test("at any depth, and inside a sentence, while the row is still live", async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "downloader-dl107-err-"));
    const databasePath = path.join(dir, "jobs.sqlite");
    harness = await createHarness({ config: { databasePath } });
    reader = new Database(databasePath, { readonly: true });
    const { store } = harness.app.context;
    store.create({
      id: "job",
      sourceUrl: "https://site.example/watch?v=1",
      options: {},
      variantId: null,
      createdAt: "2026-10-12T12:00:00.000Z",
      link: { token: "tok", url: "/api/files/tok", expiresAt: "2026-10-12T12:15:00.000Z" },
    });

    // The error a resolver throws, through the class that builds the payload.
    const payload = new AppError("UNREACHABLE", undefined, {
      details: {
        url: "https://site.example/watch?v=1&sig=QUERY_SECRET",
        stderr: "ERROR: Unsupported URL: https://site.example/watch?sig=SENTENCE_SECRET\n",
        attempts: [{ manifestUrl: "https://cdn.example/m.m3u8?sig=NESTED_SECRET" }],
        exitCode: 1,
      },
    }).toPayload();
    store.transition("job", "failed", { error: payload }, "2026-10-12T12:01:00.000Z");

    const row = reader.prepare("SELECT error_json FROM jobs WHERE id = 'job'").get() as {
      error_json: string;
    };
    expect(row.error_json).not.toMatch(/QUERY_SECRET|SENTENCE_SECRET|NESTED_SECRET/u);
    // Redaction, not deletion: the live row still names what failed, and keeps its path.
    const details = JSON.parse(row.error_json).details as Record<string, unknown>;
    expect(details["url"]).toBe("https://site.example/watch?[redacted]");
    expect(details["exitCode"]).toBe(1);
    expect(String(details["stderr"])).toContain("Unsupported URL: https://site.example/watch");
  });
});

describe("no log line holds a page's or a media file's path (dl-107)", () => {
  function capture(): { logger: ReturnType<typeof createLogger>; lines: Line[]; raw: string[] } {
    const raw: string[] = [];
    const lines: Line[] = [];
    const logger = createLogger({
      level: "debug",
      write: (line) => {
        raw.push(line);
        lines.push(JSON.parse(line) as Line);
      },
    });
    return { logger, lines, raw };
  }

  test("a details.url, a nested requestContext URL and a URL inside a sentence are cut to their origins", () => {
    const { logger, lines, raw } = capture();
    logger.warn("probe failed", {
      details: {
        url: "https://site.example/watch/secret-path?token=SECRET_Q#frag",
        stderr: "ERROR: Unsupported URL: https://cdn.example:8443/a/b/c.m3u8?sig=S2 (retrying)",
      },
      nested: {
        requestContext: {
          headers: { Referer: "https://referer.example/page/private?x=1", "User-Agent": "UA/1" },
        },
      },
      list: ["http://one.example/a/b", "no url here"],
    });

    const line = lines[0];
    expect(line?.["details"]).toEqual({
      url: "https://site.example",
      stderr: "ERROR: Unsupported URL: https://cdn.example:8443 (retrying)",
    });
    expect(line?.["nested"]).toEqual({
      requestContext: { headers: { Referer: "https://referer.example", "User-Agent": "UA/1" } },
    });
    expect(line?.["list"]).toEqual(["http://one.example", "no url here"]);
    for (const leftover of ["secret-path", "SECRET_Q", "frag", "/a/b", "private", "x=1", "S2"]) {
      expect(raw.join("")).not.toContain(leftover);
    }
  });

  test("the message, a child's bindings and an Error are cut the same way", () => {
    const { logger, lines, raw } = capture();
    const error = new Error("fetch https://err.example/deep/path?sig=E1 failed");
    logger.child({ page: "https://bound.example/b/c?q=1" }).error("saw https://msg.example/m/n", {
      err: error,
    });

    expect(lines[0]?.msg).toBe("saw https://msg.example");
    expect(lines[0]?.["page"]).toBe("https://bound.example");
    expect(JSON.stringify(lines[0]?.["err"])).toContain("https://err.example failed");
    expect(raw.join("")).not.toMatch(/\/m\/n|\/b\/c|\/deep\/path|E1/u);
  });

  test("an address of a path-less URL, and a route that is not a URL, are left as they are", () => {
    const { logger, lines } = capture();
    logger.info("request", { url: "/api/files/[redacted]", host: "https://site.example" });

    expect(lines[0]?.["url"]).toBe("/api/files/[redacted]");
    expect(lines[0]?.["host"]).toBe("https://site.example");
  });

  test("credentials before the host go too, and a bare scheme is not touched", () => {
    expect(cutUrlsToOrigin("see https://user:pass@host.example/p?q=1 now")).toBe(
      "see https://host.example now",
    );
    expect(cutUrlsToOrigin("HTTPS://Host.Example\\back\\slash")).toBe("HTTPS://Host.Example");
    expect(cutUrlsToOrigin("https://host.example?x=1")).toBe("https://host.example");
    expect(cutUrlsToOrigin("https://host.example#frag")).toBe("https://host.example");
    expect(cutUrlsToOrigin("a scheme alone: https:// and nothing")).toBe(
      "a scheme alone: https:// and nothing",
    );
    expect(cutUrlsToOrigin("no url")).toBe("no url");
  });
});
