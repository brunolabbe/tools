/**
 * `ENABLE_AGE_CONFIRMATION`, from the environment to the browser tier.
 *
 * `loadApiConfig` is otherwise only exercised inside other suites. This setting
 * earns its own because its default is a decision rather than a convenience
 * (dl-48): pressing "I am over 18" is an attestation made on the user's behalf,
 * so a fresh install must never make it, and that is tested rather than trusted.
 */

import { describe, expect, test } from "vitest";
import { loadApiConfig } from "../src/config.ts";
import { createLogger } from "../src/logger.ts";
import { buildRegistry } from "../src/resolvers.ts";

describe("ENABLE_AGE_CONFIRMATION", () => {
  test("is off in an empty environment", () => {
    expect(loadApiConfig({}, {}).enableAgeConfirmation).toBe(false);
  });

  test("an operator turns it on", () => {
    expect(loadApiConfig({}, { ENABLE_AGE_CONFIRMATION: "true" }).enableAgeConfirmation).toBe(true);
  });

  test("a value the parser does not recognise leaves it off", () => {
    expect(loadApiConfig({}, { ENABLE_AGE_CONFIRMATION: "sure" }).enableAgeConfirmation).toBe(
      false,
    );
  });

  test.each([
    [{}, false],
    [{ ENABLE_AGE_CONFIRMATION: "true" }, true],
  ])("reaches the browser tier and the resolver-chain log line (%o)", async (env, expected) => {
    const lines: string[] = [];
    const { browser } = buildRegistry({
      config: loadApiConfig({ enableYtdlpResolver: false }, env),
      logger: createLogger({ level: "info", write: (line) => void lines.push(line) }),
      fetchImpl: globalThis.fetch,
    });
    try {
      expect(browser?.confirmsAge).toBe(expected);
      const composed = lines
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .find((entry) => entry["msg"] === "resolver chain composed");
      expect(composed?.["ageConfirmation"]).toBe(expected);
    } finally {
      // Nothing was launched: the pool starts a browser on first lease.
      await browser?.dispose();
    }
  });
});
