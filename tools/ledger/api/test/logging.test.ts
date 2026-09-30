/**
 * The ledger's redaction list, censored on the way out (repo-66).
 *
 * `logger.ts` says why each path exists: behind Cloudflare Access every
 * request carries the visitor's identity as a signed token, in a header and
 * in a cookie, and either is a live session for as long as it lasts. This
 * tool had no logging test at all before repo-66 lifted the shared adapter
 * out of it — its `REDACT_PATHS` list was unverified. One assertion per
 * entry, named after the entry, so dropping one turns a named test red. The
 * shape follows the downloader's `logging.test.ts`: a logger writing into an
 * array, so the assertions read the real serialised line rather than a call
 * argument.
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

describe("the ledger's redaction list", () => {
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

  test("headers.cookie", () => {
    const { logger, lines } = capturing();
    logger.info("upstream", { headers: { cookie: `session=${SECRET}` } });

    expect(JSON.stringify(lines[0])).not.toContain(SECRET);
  });

  test("*.headers.cookie", () => {
    const { logger, lines } = capturing();
    logger.info("upstream", { request: { headers: { cookie: `session=${SECRET}` } } });

    expect(JSON.stringify(lines[0])).not.toContain(SECRET);
  });

  test("headers['cf-access-jwt-assertion']", () => {
    const { logger, lines } = capturing();
    logger.info("upstream", { headers: { "cf-access-jwt-assertion": SECRET } });

    expect(JSON.stringify(lines[0])).not.toContain(SECRET);
  });

  test("*.headers['cf-access-jwt-assertion']", () => {
    const { logger, lines } = capturing();
    logger.info("upstream", { request: { headers: { "cf-access-jwt-assertion": SECRET } } });

    expect(JSON.stringify(lines[0])).not.toContain(SECRET);
  });

  test("redaction, not deletion: the censored key stays and its neighbours are untouched", () => {
    const { logger, lines } = capturing();
    logger.info("upstream", { headers: { cookie: SECRET, accept: "application/json" } });

    expect(lines[0]?.["headers"]).toEqual({ cookie: "[redacted]", accept: "application/json" });
  });
});
