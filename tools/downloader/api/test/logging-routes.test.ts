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

import { runInNewContext } from "node:vm";
import { describe, expect, test } from "vitest";
import { createLogger } from "../src/logger.ts";
import type { LoggerOptions } from "../src/logger.ts";

const SIGNED = "https://cdn.example/v.mp4?X-Amz-Signature=SECRET&x=1";
const REDACTED_URL = "https://cdn.example/v.mp4?[redacted]";

interface ErrLine {
  level: string;
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
    expect(
      lines.map((line) => [parse(line).level, parse(line)["requestId"], parse(line).msg]),
    ).toEqual([
      ["debug", "r1", `d ${REDACTED_URL}`],
      ["warn", "r1", `w ${REDACTED_URL}`],
      ["error", "r1", `e ${REDACTED_URL}`],
    ]);
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

  // Not a redaction test: pino writes an `Error` below any key but `err` as `{}`
  // on the base and on this branch alike, so it cannot fail on a leak. It pins
  // that shape, so a change to how such an error is written is a decision.
  test("nested under another key is written as an empty object, as pino always has", () => {
    const { logger, lines } = capture();
    logger.error("probe failed", {
      details: { attempts: [new Error(`first ${SIGNED}`), new Error(`second ${SIGNED}`)] },
    });

    expect(lines[0]).not.toContain("SECRET");
    expect(parse(lines[0])["details"]).toEqual({ attempts: [{}, {}] });
  });

  test("with nothing to redact is untouched, stack included", () => {
    const { logger, lines } = capture();
    const error = new Error("plain failure");
    logger.error("probe failed", { err: error });

    const err = parse(lines[0]).err;
    expect(err?.message).toBe("plain failure");
    expect(err?.stack).toBe(error.stack);
  });

  test("a cycle through `cause` does not hang or leak, and keeps its message and stack", () => {
    const { logger, lines } = capture();
    const error = new Error(`loop ${SIGNED}`);
    error.cause = error;
    logger.error("probe failed", { err: error });

    const err = parse(lines[0]).err;
    expect(lines[0]).not.toContain("SECRET");
    expect(err?.message).toContain(`loop ${REDACTED_URL}`);
    expect(err?.stack).toContain(`Error: loop ${REDACTED_URL}`);
  });

  // The next four are gate 1's F1-F3, appended after the others.
  test("an own enumerable getter's URL is redacted, as the walk always did", () => {
    const { logger, lines } = capture();
    const error = new Error("plain failure");
    Object.defineProperty(error, "target", { get: () => SIGNED, enumerable: true });
    logger.error("probe failed", { err: error });

    const err = parse(lines[0]).err as Record<string, unknown> | undefined;
    expect(lines[0]).not.toContain("SECRET");
    expect(err?.["target"]).toBe(REDACTED_URL);
    expect(err?.["message"]).toBe("plain failure");
  });

  test("an own `message` accessor is redacted along with the stack", () => {
    const { logger, lines } = capture();
    const error = new Error("placeholder");
    Object.defineProperty(error, "message", {
      get: () => `failed ${SIGNED}`,
      configurable: true,
    });
    logger.error("probe failed", { err: error });

    expect(lines[0]).not.toContain("SECRET");
    expect(parse(lines[0]).err?.message).toBe(`failed ${REDACTED_URL}`);
  });

  test("an error from another realm is redacted too", () => {
    const { logger, lines } = capture();
    const foreign: unknown = runInNewContext("new Error(text)", { text: `failed ${SIGNED}` });
    expect(foreign instanceof Error).toBe(false);
    logger.error("probe failed", { err: foreign });

    expect(lines[0]).not.toContain("SECRET");
    expect(parse(lines[0]).err?.message).toBe(`failed ${REDACTED_URL}`);
    expect(parse(lines[0]).err?.stack).toContain("\n    at ");
  });

  test("a DOMException keeps its failure, whose message and name are prototype getters", () => {
    const { logger, lines } = capture();
    logger.error("probe failed", { err: new DOMException(`failed ${SIGNED}`, "AbortError") });

    const line = parse(lines[0]);
    expect(lines[0]).not.toContain("SECRET");
    expect(line["fieldsDropped"]).toBeUndefined();
    expect(line.err?.type).toBe("DOMException");
    expect(line.err?.message).toBe(`failed ${REDACTED_URL}`);
    expect(line.err?.stack).toContain(`AbortError: failed ${REDACTED_URL}`);
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
