/**
 * The ledger's redaction list, censored on the way out (repo-66).
 *
 * `logger.ts` says why each path exists: behind Cloudflare Access every
 * request carries the visitor's identity as a signed token, in a header and
 * in a cookie, and either is a live session for as long as it lasts. This
 * tool had no logging test at all before repo-66 lifted the shared adapter
 * out of it — its `REDACT_PATHS` list was unverified. The shape follows the
 * downloader's `logging.test.ts`: a logger writing into an array, so the
 * assertions read the real serialised line rather than a call argument.
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

describe("the ledger's redaction list", () => {
  test("censors a bearer token under Authorization", () => {
    const { logger, lines } = capturing();
    logger.info("upstream", { headers: { authorization: "Bearer super-secret" } });

    expect(JSON.stringify(lines[0])).not.toContain("super-secret");
  });

  test("censors a session cookie", () => {
    const { logger, lines } = capturing();
    logger.info("upstream", { headers: { cookie: "session=super-secret" } });

    expect(JSON.stringify(lines[0])).not.toContain("super-secret");
  });

  test("censors Cloudflare Access's own header", () => {
    const { logger, lines } = capturing();
    logger.info("upstream", {
      headers: { "cf-access-jwt-assertion": "eyJhbGciOiJSUzI1NiJ9.jwt-secret" },
    });

    expect(JSON.stringify(lines[0])).not.toContain("jwt-secret");
  });

  test("censors a top-level apiKey", () => {
    const { logger, lines } = capturing();
    logger.info("configured", { apiKey: "sk-super-secret" });

    expect(JSON.stringify(lines[0])).not.toContain("sk-super-secret");
  });

  test("leaves an unrelated field alone — this is redaction, not deletion", () => {
    const { logger, lines } = capturing();
    logger.info("upstream", {
      headers: { cookie: "session=super-secret" },
      host: "ledger.example",
    });

    expect(lines[0]?.["host"]).toBe("ledger.example");
  });
});
