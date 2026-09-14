/**
 * The four model prices (pl-49): unset by default, read from their own
 * variables, and a value that is not a price refuses to boot.
 */

import { AppError } from "@planner/contract";
import { afterEach, describe, expect, test, vi } from "vitest";
import { loadApiConfig, MODEL_PRICE_VARIABLES } from "../src/config.ts";
import { createApp } from "../src/server.ts";

afterEach(() => {
  vi.unstubAllEnvs();
});

function refusal(run: () => unknown): AppError {
  try {
    run();
  } catch (error: unknown) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("model prices", () => {
  test("are unset by default, because nothing in code may guess one", () => {
    expect(loadApiConfig({}, {}).modelPrices).toEqual({
      inputPerMTok: undefined,
      outputPerMTok: undefined,
      cacheReadPerMTok: undefined,
      cacheWritePerMTok: undefined,
    });
  });

  test("are each read from their own variable, and zero is a price", () => {
    const config = loadApiConfig(
      {},
      {
        MODEL_PRICE_INPUT_PER_MTOK: "5",
        MODEL_PRICE_OUTPUT_PER_MTOK: " 25 ",
        MODEL_PRICE_CACHE_READ_PER_MTOK: "0.5",
        MODEL_PRICE_CACHE_WRITE_PER_MTOK: "0",
      },
    );
    expect(config.modelPrices).toEqual({
      inputPerMTok: 5,
      outputPerMTok: 25,
      cacheReadPerMTok: 0.5,
      cacheWritePerMTok: 0,
    });
  });

  test("a blank price is unset, the way a commented-out line collapses", () => {
    const config = loadApiConfig({}, { MODEL_PRICE_INPUT_PER_MTOK: "  " });
    expect(config.modelPrices.inputPerMTok).toBeUndefined();
  });

  test.each(["five", "25$", "-1", "Infinity", "NaN"])(
    "refuses %s rather than treating it as unset, naming the variable",
    (value) => {
      for (const variable of Object.values(MODEL_PRICE_VARIABLES)) {
        const error = refusal(() => loadApiConfig({}, { [variable]: value }));
        expect(error.code).toBe("INTERNAL");
        expect(error.message).toContain(variable);
        expect(error.details).toMatchObject({ variable });
      }
    },
  );

  test("a price that is not a number refuses the server's boot", async () => {
    vi.stubEnv("MODEL_PRICE_OUTPUT_PER_MTOK", "twenty-five");
    await expect(
      createApp({ config: { databasePath: ":memory:", logLevel: "silent" } }),
    ).rejects.toMatchObject({
      code: "INTERNAL",
      details: { variable: "MODEL_PRICE_OUTPUT_PER_MTOK" },
    });
  });
});
