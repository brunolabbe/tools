/**
 * `@webtools/core/logger`, tested where it lives (repo-66).
 *
 * The adapter was lifted here from three tools whose suites exercised it only
 * through each tool's own `createLogger`, and none of them drove the hook's
 * routes separately: replacing `safe(extra)` with `extra` on the `child` line
 * passed every downloader, planner and ledger test, though that call is what
 * stops `child({ requestContext })` writing a session cookie. So each route a
 * `redactFields` hook is applied on has a test of its own here — a call's
 * fields, a child's bindings, a grandchild's bindings and a grandchild's call
 * fields — and so does the fallback when the hook throws.
 *
 * The hook is a stand-in, `scrub`, that replaces the value of a `secret` key.
 * The tools' real hooks (the downloader's `RequestContext` pass and URL walk)
 * are tested against the real thing in `tools/downloader/api/test/`.
 */

import { describe, expect, test } from "vitest";
import { createLogger } from "../src/logger.ts";
import type { AppLogger, LoggerOptions } from "../src/logger.ts";

interface Line {
  level: string;
  time: string;
  msg: string;
  [key: string]: unknown;
}

function capturing(options: Partial<LoggerOptions> = {}): { logger: AppLogger; lines: Line[] } {
  const lines: Line[] = [];
  const logger = createLogger({
    level: "debug",
    write: (line) => {
      lines.push(JSON.parse(line) as Line);
    },
    ...options,
  });
  return { logger, lines };
}

const HOOKED = "[hook]";

/** Replaces the value of a `secret` key, and only that. */
function scrub(fields: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (fields === undefined) return undefined;
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, key === "secret" ? HOOKED : value]),
  );
}

describe("createLogger", () => {
  test("writes one JSON line per call, with a string level and an ISO timestamp", () => {
    const { logger, lines } = capturing();
    logger.info("hello", { answer: 42 });

    expect(lines).toHaveLength(1);
    expect(lines[0]?.level).toBe("info");
    expect(lines[0]?.msg).toBe("hello");
    expect(lines[0]?.["answer"]).toBe(42);
    expect(lines[0]?.time).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
  });

  test("drops lines below the configured level, and silent writes nothing", () => {
    const info = capturing({ level: "info" });
    info.logger.debug("invisible");
    info.logger.warn("visible");
    expect(info.lines.map((line) => line.msg)).toEqual(["visible"]);

    const silent = capturing({ level: "silent" });
    silent.logger.error("not even errors");
    expect(silent.lines).toEqual([]);
  });

  test("the bindings option and child bindings are stamped on every line, and compose", () => {
    const { logger, lines } = capturing({ bindings: { service: "svc" } });
    logger.child({ jobId: "job-1" }).child({ requestId: "req-1" }).info("working");

    expect(lines[0]?.["service"]).toBe("svc");
    expect(lines[0]?.["jobId"]).toBe("job-1");
    expect(lines[0]?.["requestId"]).toBe("req-1");
  });
});

describe("redactPaths", () => {
  test("censors a listed path with the core REDACTED string", () => {
    const { logger, lines } = capturing({ redactPaths: ["apiKey"] });
    logger.info("configured", { apiKey: "super-secret", host: "example" });

    expect(lines[0]?.["apiKey"]).toBe("[redacted]");
    expect(lines[0]?.["host"]).toBe("example");
  });

  test("censors nothing when no path is given", () => {
    const { logger, lines } = capturing();
    logger.info("configured", { apiKey: "super-secret" });

    expect(lines[0]?.["apiKey"]).toBe("super-secret");
  });
});

describe("redactFields", () => {
  test("is applied to a call's fields", () => {
    const { logger, lines } = capturing({ redactFields: scrub });
    logger.info("m", { secret: "x", keep: 1 });

    expect(lines[0]?.["secret"]).toBe(HOOKED);
    expect(lines[0]?.["keep"]).toBe(1);
  });

  test("is applied to a child's bindings", () => {
    const { logger, lines } = capturing({ redactFields: scrub });
    logger.child({ secret: "x" }).info("m");

    expect(lines[0]?.["secret"]).toBe(HOOKED);
  });

  test("is applied to a grandchild's bindings", () => {
    const { logger, lines } = capturing({ redactFields: scrub });
    logger.child({ a: 1 }).child({ secret: "x" }).info("m");

    expect(lines[0]?.["secret"]).toBe(HOOKED);
    expect(lines[0]?.["a"]).toBe(1);
  });

  test("is applied to a call's fields on a grandchild", () => {
    const { logger, lines } = capturing({ redactFields: scrub });
    logger.child({ a: 1 }).child({ b: 2 }).info("m", { secret: "x" });

    expect(lines[0]?.["secret"]).toBe(HOOKED);
    expect(lines[0]?.["b"]).toBe(2);
  });

  test("sees undefined for a call with no fields, and an undefined result is an empty object", () => {
    const seen: unknown[] = [];
    const { logger, lines } = capturing({
      redactFields: (fields) => {
        seen.push(fields);
        return undefined;
      },
    });
    logger.info("bare");

    expect(seen).toEqual([undefined]);
    expect(lines[0]?.msg).toBe("bare");
  });

  test("a hook that throws costs the fields and not the message", () => {
    const { logger, lines } = capturing({
      redactFields: () => {
        throw new Error("hook exploded");
      },
    });

    expect(() => logger.error("boom", { anything: 1 })).not.toThrow();
    expect(lines[0]?.msg).toBe("boom");
    expect(lines[0]?.["fieldsDropped"]).toBe(true);
    expect(lines[0]?.["anything"]).toBeUndefined();
  });

  test("without a hook, fields pass through untouched", () => {
    const { logger, lines } = capturing();
    logger.info("m", { secret: "x" });

    expect(lines[0]?.["secret"]).toBe("x");
  });
});
