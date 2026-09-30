/**
 * The downloader's `REDACT_PATHS`, one test per entry (repo-66).
 *
 * `logging.test.ts` proves the cookie half at one depth and never writes a
 * lowercase `authorization` at all: deleting all three authorization entries
 * from `logger.ts` left its 47 tests green. These are the header bags that do
 * *not* arrive as a `RequestContext` — the structural pass in `safeFields`
 * matches the key `requestContext` and nothing else — so the path layer is the
 * only thing between them and a written line, which is why each entry is
 * asserted by itself, named after the entry.
 *
 * Deleting an entry turns its own test red **except where another entry
 * shadows it**: pino's `*` matches one key at any name, so `*.cookie` also
 * matches `headers.cookie`, and `*.authorization` also matches
 * `headers.authorization`. Those two are asserted anyway, because the test is
 * of what the list censors, not of which entry does it.
 *
 * A new file rather than more of `logging.test.ts`, so no existing test moves.
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

describe("the downloader's redaction list", () => {
  test("headers.cookie", () => {
    const { logger, lines } = capturing();
    logger.info("upstream", { headers: { cookie: `session=${SECRET}` } });

    expect(JSON.stringify(lines[0])).not.toContain(SECRET);
  });

  test("headers.authorization", () => {
    const { logger, lines } = capturing();
    logger.info("upstream", { headers: { authorization: `Bearer ${SECRET}` } });

    expect(JSON.stringify(lines[0])).not.toContain(SECRET);
  });

  test("*.headers.cookie", () => {
    const { logger, lines } = capturing();
    logger.info("upstream", { request: { headers: { cookie: `session=${SECRET}` } } });

    expect(JSON.stringify(lines[0])).not.toContain(SECRET);
  });

  test("*.headers.authorization", () => {
    const { logger, lines } = capturing();
    logger.info("upstream", { request: { headers: { authorization: `Bearer ${SECRET}` } } });

    expect(JSON.stringify(lines[0])).not.toContain(SECRET);
  });

  test("*.cookie", () => {
    const { logger, lines } = capturing();
    logger.info("upstream", { request: { cookie: `session=${SECRET}` } });

    expect(JSON.stringify(lines[0])).not.toContain(SECRET);
  });

  test("*.authorization", () => {
    const { logger, lines } = capturing();
    logger.info("upstream", { request: { authorization: `Bearer ${SECRET}` } });

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
