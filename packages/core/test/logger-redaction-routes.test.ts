/**
 * The two routes `redactFields` did not cover (repo-85), tested where the
 * mechanism lives: the message string, through the new `redactMessage` hook,
 * and the `createLogger` `bindings` option, through the existing
 * `redactFields`. `logger.test.ts` covers a call's fields and a child's
 * bindings; this file is separate so that file's line numbers stay where the
 * records that cite them put them.
 *
 * Both hooks are stand-ins that replace the word `SECRET`. The downloader's
 * real ones are exercised against the real thing in
 * `tools/downloader/api/test/logging-routes.test.ts`.
 */

import { describe, expect, test } from "vitest";
import { createLogger } from "../src/logger.ts";
import type { LoggerOptions } from "../src/logger.ts";

/** Raw serialised lines, so an assertion sees what a log file would. */
function raw(options: Partial<LoggerOptions> = {}): {
  logger: ReturnType<typeof createLogger>;
  lines: string[];
} {
  const lines: string[] = [];
  const logger = createLogger({ level: "debug", write: (line) => lines.push(line), ...options });
  return { logger, lines };
}

const strip = (text: string): string => text.replaceAll("SECRET", "[hook]");

function stripFields(
  fields: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (fields === undefined) return undefined;
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      typeof value === "string" ? strip(value) : value,
    ]),
  );
}

describe("redactMessage", () => {
  test("is applied to the message of every level", () => {
    const { logger, lines } = raw({ redactMessage: strip });
    logger.debug("a SECRET");
    logger.info("b SECRET");
    logger.warn("c SECRET");
    logger.error("d SECRET");

    expect(lines.join("")).not.toContain("SECRET");
    expect(lines.map((line) => (JSON.parse(line) as { msg: string }).msg)).toEqual([
      "a [hook]",
      "b [hook]",
      "c [hook]",
      "d [hook]",
    ]);
  });

  test("survives child(), including a grandchild", () => {
    const { logger, lines } = raw({ redactMessage: strip });
    logger.child({ a: 1 }).child({ b: 2 }).info("deep SECRET");

    expect(lines[0]).not.toContain("SECRET");
    expect(lines[0]).toContain("deep [hook]");
  });

  test("is independent of redactFields: fields are not run through it and the message is not run through them", () => {
    const { logger, lines } = raw({ redactMessage: strip });
    logger.info("m", { note: "SECRET" });

    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ note: "SECRET", msg: "m" });
  });

  test("a hook that throws replaces the message rather than writing it raw", () => {
    const { logger, lines } = raw({
      redactMessage: () => {
        throw new Error("hook exploded");
      },
    });

    expect(() => logger.error("fetching SECRET", { keep: 1 })).not.toThrow();
    expect(lines[0]).not.toContain("SECRET");
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ msg: "[message dropped]", keep: 1 });
  });

  test("without a hook the message is written as given", () => {
    const { logger, lines } = raw();
    logger.info("fetching SECRET");

    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ msg: "fetching SECRET" });
  });
});

describe("redactFields and the bindings option", () => {
  test("the option's bindings go through the hook, as a child's do", () => {
    const { logger, lines } = raw({ redactFields: stripFields, bindings: { url: "x?SECRET" } });
    logger.info("m");

    expect(lines[0]).not.toContain("SECRET");
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ url: "x?[hook]", msg: "m" });
  });

  test("the hook sees the bindings option exactly once and a call's fields separately", () => {
    const seen: unknown[] = [];
    const { logger } = raw({
      redactFields: (fields) => {
        seen.push(fields);
        return fields;
      },
      bindings: { service: "svc" },
    });
    logger.info("m", { a: 1 });

    expect(seen).toEqual([{ service: "svc" }, { a: 1 }]);
  });

  test("a hook that returns nothing for the bindings leaves pid and hostname", () => {
    const { logger, lines } = raw({ redactFields: () => undefined, bindings: { url: "x?SECRET" } });
    logger.info("m");

    const line = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(line["url"]).toBeUndefined();
    expect(line["pid"]).toBeTypeOf("number");
  });

  test("without a hook the option's bindings pass through untouched", () => {
    const { logger, lines } = raw({ bindings: { url: "x?SECRET" } });
    logger.info("m");

    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ url: "x?SECRET" });
  });
});
