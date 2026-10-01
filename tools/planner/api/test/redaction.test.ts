/**
 * The planner's redaction list, censored on the way out (repo-66).
 *
 * `logger.ts` keeps `REDACT_PATHS` as a backstop for a provider API key or an
 * auth header that someone logs whole. Until repo-66 lifted the shared adapter
 * into `@webtools/core/logger`, nothing here exercised those paths directly —
 * `logging.test.ts` only proves the key never reaches a line through the SDK's
 * error path (pl-39), which would pass even with the list empty. One assertion
 * per entry, so dropping an entry turns its named test red — except
 * `headers.authorization`, which `*.authorization` shadows (pino's `*` also
 * matches the key `headers`): deleting it leaves every test green. It is
 * asserted anyway, because the test is of what the list censors.
 */

import { describe, expect, test } from "vitest";
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

const SECRET = "super-secret";

describe("the planner's redaction list", () => {
  test("apiKey", () => {
    const { logger, lines } = capturing();
    logger.info("configured", { apiKey: SECRET });

    expect(JSON.stringify(lines[0])).not.toContain(SECRET);
  });

  test("*.apiKey", () => {
    const { logger, lines } = capturing();
    logger.info("configured", { config: { apiKey: SECRET } });

    expect(JSON.stringify(lines[0])).not.toContain(SECRET);
  });

  test("headers.authorization", () => {
    const { logger, lines } = capturing();
    logger.info("upstream", { headers: { authorization: `Bearer ${SECRET}` } });

    expect(JSON.stringify(lines[0])).not.toContain(SECRET);
  });

  test("*.headers.authorization", () => {
    const { logger, lines } = capturing();
    logger.info("upstream", { request: { headers: { authorization: `Bearer ${SECRET}` } } });

    expect(JSON.stringify(lines[0])).not.toContain(SECRET);
  });

  test("*.authorization", () => {
    const { logger, lines } = capturing();
    logger.info("upstream", { request: { authorization: `Bearer ${SECRET}` } });

    expect(JSON.stringify(lines[0])).not.toContain(SECRET);
  });

  test("headers['x-api-key']", () => {
    const { logger, lines } = capturing();
    logger.info("upstream", { headers: { "x-api-key": SECRET } });

    expect(JSON.stringify(lines[0])).not.toContain(SECRET);
  });

  test("*.headers['x-api-key']", () => {
    const { logger, lines } = capturing();
    logger.info("upstream", { request: { headers: { "x-api-key": SECRET } } });

    expect(JSON.stringify(lines[0])).not.toContain(SECRET);
  });

  test("redaction, not deletion: the censored key stays and its neighbours are untouched", () => {
    const { logger, lines } = capturing();
    logger.info("upstream", { headers: { authorization: SECRET, accept: "application/json" } });

    expect(lines[0]?.["headers"]).toEqual({
      authorization: "[redacted]",
      accept: "application/json",
    });
  });
});
