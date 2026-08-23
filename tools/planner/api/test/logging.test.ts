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
        groundingEndpoints: { routing: ROUTING, geocoder: GEOCODER },
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

  test("says the same about the fixture default, so the line is not a special case", async () => {
    const { logger, lines } = capturing();
    app = await createApp({ logger, config: { databasePath: ":memory:" } });

    const configured = lines.find((line) => line.msg === "grounding configured");
    expect(configured?.["provider"]).toBe("fixtures");
    expect(Object.keys(configured ?? {})).not.toContain("routing");
    expect(Object.keys(configured ?? {})).not.toContain("geocoder");
  });
});
