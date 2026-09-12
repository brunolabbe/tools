/**
 * Direct coverage of `trustProxy`, lifted here on repo-40. Neither tool ever
 * tested this parser's edge cases directly before the lift — the planner's
 * `config.test.ts` exercised it only through `loadApiConfig`, and the
 * downloader's `config.ts` had no test file at all (see repo-40's Log) — so
 * this is the first time the boolean forms and the CIDR passthrough are
 * pinned at the function itself, rather than incidentally by whichever
 * caller happened to add a test first.
 */

import { describe, expect, test } from "vitest";
import { trustProxy } from "../src/trust-proxy.ts";

describe("trustProxy", () => {
  test("defaults to false: undefined and blank/whitespace-only input", () => {
    expect(trustProxy(undefined)).toBe(false);
    expect(trustProxy("")).toBe(false);
    expect(trustProxy("   ")).toBe(false);
  });

  test("recognises every truthy spelling, case-insensitively", () => {
    for (const raw of ["1", "true", "TRUE", "yes", "Yes", "on", "ON"]) {
      expect(trustProxy(raw)).toBe(true);
    }
  });

  test("recognises every falsy spelling, case-insensitively", () => {
    for (const raw of ["0", "false", "FALSE", "no", "No", "off", "OFF"]) {
      expect(trustProxy(raw)).toBe(false);
    }
  });

  test("passes a CIDR through verbatim rather than coercing it to a boolean", () => {
    expect(trustProxy("172.30.42.0/24")).toBe("172.30.42.0/24");
  });

  test("passes a single address or a comma-separated list through verbatim", () => {
    expect(trustProxy("10.0.0.1")).toBe("10.0.0.1");
    expect(trustProxy("10.0.0.1,172.30.42.0/24")).toBe("10.0.0.1,172.30.42.0/24");
  });

  test("preserves case and does not treat a word-shaped passthrough as a boolean prefix match", () => {
    // Every other passthrough fixture above is numeric, which leaves two
    // things unpinned: that the returned string keeps its original case
    // rather than the lowercased copy used to classify it, and that a
    // hostname beginning with a truthy word ("On...") is not matched by a
    // loosened `startsWith` check against the truthy list.
    expect(trustProxy("Onprem.Example.COM")).toBe("Onprem.Example.COM");
  });

  test("trims surrounding whitespace before classifying", () => {
    expect(trustProxy("  true  ")).toBe(true);
    expect(trustProxy("  172.30.42.0/24  ")).toBe("172.30.42.0/24");
  });
});
