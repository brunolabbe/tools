/**
 * What this service writes to its log at boot, and what it must not.
 *
 * The downloader's `logging.test.ts` is the shape this follows: a logger
 * writing into an array, so the assertions read the real serialised line rather
 * than a call argument. The subject here is different, though — this tool has
 * no `RequestContext` — and it is the one thing pl-28 introduced that is worth
 * keeping out of a log: **a grounding endpoint**.
 *
 * `logger.ts` censors `apiKey` and the usual auth headers as a backstop, not as
 * permission to log a config object whole. An endpoint is not covered by any of
 * those paths, and it would not be: it is infrastructure detail rather than a
 * credential, which is exactly the kind of field a redactor never learns about.
 * So the discipline is at the call site, and this is what holds it there.
 */

import { AnthropicProvider } from "@planner/agent";
import { AppError } from "@planner/contract";
import { afterEach, describe, expect, test } from "vitest";
import type { App } from "../src/server.ts";
import { createApp } from "../src/server.ts";
import { createLogger } from "../src/logger.ts";
import type { AppLogger } from "../src/logger.ts";

interface Line {
  level: string;
  time: string;
  msg: string;
  [key: string]: unknown;
}

/** A logger writing into an array, so assertions read the real serialised line. */
function capturing(): { logger: AppLogger; lines: Line[] } {
  const lines: Line[] = [];
  const logger = createLogger({
    level: "debug",
    write: (line) => {
      lines.push(JSON.parse(line) as Line);
    },
  });
  return { logger, lines };
}

/** A model provider key, which must reach no log line by any path (pl-39). */
const KEY = "sk-ant-api03-LOGGING-TEST-KEY-9f3c2a7b";

const ROUTING = "http://valhalla.internal:8002";
const GEOCODER = "http://user:hunter2@nominatim.internal:8080";

let app: App | undefined;

afterEach(async () => {
  await app?.shutdown();
  app = undefined;
});

describe("what boot writes down about grounding", () => {
  test("names the backend and never where it is", async () => {
    const { logger, lines } = capturing();
    app = await createApp({
      logger,
      config: {
        databasePath: ":memory:",
        groundingProvider: "valhalla",
        groundingEndpoints: { routing: ROUTING, geocoder: GEOCODER, discovery: undefined },
      },
    });

    const configured = lines.find((line) => line.msg === "grounding configured");
    expect(configured).toBeDefined();
    // The backend's name, which is the answer to "what is this deployment
    // grounding against". A cache is not a backend, so it is not this.
    expect(configured?.["provider"]).toBe("valhalla");
    expect(configured?.["maxCalls"]).toBe(40);

    // Asserted over every line the boot wrote, not just the one that was
    // tempted: a config object logged whole somewhere else is the same leak.
    const everything = JSON.stringify(lines);
    expect(everything).not.toContain("valhalla.internal");
    expect(everything).not.toContain("nominatim.internal");
    // A URL carries its credential in its userinfo and its query string, which
    // is why the repo rule says a bare URL in a log line is as sensitive as a
    // cookie.
    expect(everything).not.toContain("hunter2");
  });

  test("a thrown authentication error, logged through the real logger, does not contain the key", async () => {
    // pl-39. The SDK's errors carry the request that produced them, and the
    // request carries `x-api-key`. The provider logs status, type and request
    // id by hand and attaches no cause; this holds it to that through the
    // logger that production runs, and through the error handler's own fields.
    const { logger, lines } = capturing();

    const provider = new AnthropicProvider({
      apiKey: KEY,
      model: "claude-opus-5",
      effort: "low",
      timeoutMs: 5_000,
      maxRetries: 0,
      fetch: answer401,
      logger,
    });

    const thrown = await provider
      .send({ system: "s", messages: [{ role: "user", content: "u" }], maxOutputTokens: 10 })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(thrown).toBeInstanceOf(AppError);
    const appError = thrown as AppError;
    expect(appError.code).toBe("AGENT_UNCONFIGURED");

    // What `registerErrorHandling` and a run's failure path write about it.
    logger.error("request failed", { code: appError.code, details: appError.details });
    logger.error("run failed", { error: appError.toPayload(), cause: appError.cause });

    const failed = lines.find((line) => line.msg === "model request failed");
    expect(failed).toMatchObject({
      status: 401,
      type: "authentication_error",
      requestId: "req_logging_401",
    });
    expect(JSON.stringify(lines)).not.toContain(KEY);
    // The part of a key that survives a truncating formatter, too.
    expect(JSON.stringify(lines)).not.toContain(KEY.slice(-12));
  });

  test("names the model provider and model at boot, and never the key", async () => {
    const { logger, lines } = capturing();
    app = await createApp({
      logger,
      config: { databasePath: ":memory:", modelProvider: "anthropic", anthropicApiKey: KEY },
    });

    const configured = lines.find((line) => line.msg === "agent configured");
    expect(configured).toMatchObject({ provider: "anthropic", model: "claude-opus-5" });
    // Exactly those two beside pino's own fields, so a later addition — the
    // config object, say — has to come past this test.
    const {
      level: _l,
      time: _t,
      msg: _m,
      pid: _p,
      hostname: _h,
      ...fields
    } = configured ?? ({} as Line);
    expect(new Set(Object.keys(fields))).toEqual(new Set(["model", "provider"]));
    expect(JSON.stringify(lines)).not.toContain(KEY);
  });

  test("says the same about the fixture default, so the line is not a special case", async () => {
    const { logger, lines } = capturing();
    app = await createApp({ logger, config: { databasePath: ":memory:" } });

    const configured = lines.find((line) => line.msg === "grounding configured");
    expect(configured?.["provider"]).toBe("fixtures");
    expect(Object.keys(configured ?? {})).not.toContain("routing");
    expect(Object.keys(configured ?? {})).not.toContain("geocoder");
  });
});

/** A Messages API `401`, as the provider's `fetch` would receive it. */
async function answer401(): Promise<Response> {
  return new Response(
    JSON.stringify({
      type: "error",
      error: { type: "authentication_error", message: "invalid x-api-key" },
      request_id: "req_logging_401",
    }),
    {
      status: 401,
      headers: { "content-type": "application/json", "request-id": "req_logging_401" },
    },
  );
}
