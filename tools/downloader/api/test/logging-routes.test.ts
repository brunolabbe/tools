/**
 * The routes to a log line that the downloader's `safeFields` never saw
 * (repo-85): the message string, an `Error`, and the `createLogger`
 * `bindings` option. `logging.test.ts` covers a call's `fields`; this file is
 * separate so that file's line numbers stay where the records citing them put
 * them.
 *
 * Every assertion is on the **raw serialised line**, because that is what a
 * log file holds. A parsed-and-picked-over object would pass on a line that
 * still carried the credential somewhere the test did not look.
 */

import { describe, expect, test } from "vitest";
import { createLogger } from "../src/logger.ts";
import type { LoggerOptions } from "../src/logger.ts";

const SIGNED = "https://cdn.example/v.mp4?X-Amz-Signature=SECRET&x=1";
const REDACTED_URL = "https://cdn.example/v.mp4?[redacted]";

interface ErrLine {
  msg: string;
  err?: { type?: string; message?: string; stack?: string; details?: unknown };
  [key: string]: unknown;
}

function capture(options: Partial<LoggerOptions> = {}): {
  logger: ReturnType<typeof createLogger>;
  lines: string[];
} {
  const lines: string[] = [];
  const logger = createLogger({ level: "debug", write: (line) => lines.push(line), ...options });
  return { logger, lines };
}

const parse = (line: string | undefined): ErrLine => JSON.parse(line ?? "{}") as ErrLine;

describe("the message", () => {
  test("a URL concatenated into it loses its query string", () => {
    const { logger, lines } = capture();
    logger.info(`fetching ${SIGNED}`);

    expect(lines[0]).not.toContain("SECRET");
    expect(parse(lines[0]).msg).toBe(`fetching ${REDACTED_URL}`);
  });

  test("so does one on a child logger, at every level", () => {
    const { logger, lines } = capture();
    const child = logger.child({ requestId: "r1" });
    child.debug(`d ${SIGNED}`);
    child.warn(`w ${SIGNED}`);
    child.error(`e ${SIGNED}`);

    expect(lines.join("")).not.toContain("SECRET");
    expect(lines).toHaveLength(3);
  });

  test("a message with no URL is written as given", () => {
    const { logger, lines } = capture();
    logger.info("job finished: 3 of 4 streams");

    expect(parse(lines[0]).msg).toBe("job finished: 3 of 4 streams");
  });
});

describe("an Error", () => {
  test("logged as `err` loses the URL from its message and its stack, and keeps both", () => {
    const { logger, lines } = capture();
    logger.error("probe failed", { err: new Error(`failed ${SIGNED}`) });

    const err = parse(lines[0]).err;
    expect(lines[0]).not.toContain("SECRET");
    expect(err?.type).toBe("Error");
    expect(err?.message).toBe(`failed ${REDACTED_URL}`);
    expect(err?.stack).toContain(`Error: failed ${REDACTED_URL}`);
    expect(err?.stack).toContain("\n    at ");
  });

  test("with an enumerable URL field loses it there too, and keeps its message and stack", () => {
    const { logger, lines } = capture();
    const error = Object.assign(new Error(`failed ${SIGNED}`), { details: { url: SIGNED } });
    logger.error("probe failed", { err: error });

    const err = parse(lines[0]).err;
    expect(lines[0]).not.toContain("SECRET");
    expect(err?.details).toEqual({ url: REDACTED_URL });
    expect(err?.message).toBe(`failed ${REDACTED_URL}`);
    expect(err?.stack).toContain("\n    at ");
  });

  test("keeps its class: a subclass is still reported under its own name", () => {
    class ProbeError extends Error {}
    const { logger, lines } = capture();
    logger.error("probe failed", { err: new ProbeError(`failed ${SIGNED}`) });

    expect(lines[0]).not.toContain("SECRET");
    expect(parse(lines[0]).err?.type).toBe("ProbeError");
  });

  test("redacts a `cause`, which is own but not enumerable", () => {
    const { logger, lines } = capture();
    logger.error("probe failed", {
      err: new Error("outer", { cause: new Error(`inner ${SIGNED}`) }),
    });

    expect(lines[0]).not.toContain("SECRET");
    // pino folds the cause chain into `message` and `stack`, so both must still carry it.
    expect(parse(lines[0]).err?.message).toContain(`inner ${REDACTED_URL}`);
    expect(parse(lines[0]).err?.stack).toContain(`inner ${REDACTED_URL}`);
  });

  test("nested under another key is redacted too", () => {
    const { logger, lines } = capture();
    logger.error("probe failed", {
      details: { attempts: [new Error(`first ${SIGNED}`), new Error(`second ${SIGNED}`)] },
    });

    expect(lines[0]).not.toContain("SECRET");
  });

  test("with nothing to redact is untouched, stack included", () => {
    const { logger, lines } = capture();
    const error = new Error("plain failure");
    logger.error("probe failed", { err: error });

    const err = parse(lines[0]).err;
    expect(err?.message).toBe("plain failure");
    expect(err?.stack).toBe(error.stack);
  });

  test("a cycle through `cause` does not hang or leak", () => {
    const { logger, lines } = capture();
    const error = new Error(`loop ${SIGNED}`);
    error.cause = error;
    logger.error("probe failed", { err: error });

    expect(lines[0]).not.toContain("SECRET");
  });
});

describe("the bindings option", () => {
  test("loses a URL's query string, as a child's bindings do", () => {
    const { logger, lines } = capture({ bindings: { url: SIGNED } });
    logger.info("m");

    expect(lines[0]).not.toContain("SECRET");
    expect(parse(lines[0])["url"]).toBe(REDACTED_URL);
  });

  test("still stamps its other fields on every line", () => {
    const { logger, lines } = capture({ bindings: { service: "downloader" } });
    logger.info("m");

    expect(parse(lines[0])["service"]).toBe("downloader");
    expect(parse(lines[0])["pid"]).toBeTypeOf("number");
  });
});
