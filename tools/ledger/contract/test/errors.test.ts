import { describe, expect, test } from "vitest";
import { CORE_ERROR_CODES } from "@webtools/core";
import {
  AppError,
  DEFAULT_ERROR_MESSAGES,
  ERROR_CODES,
  LEDGER_ERROR_CODES,
  RETRYABLE_CODES,
} from "../src/index.ts";

describe("the ledger error taxonomy", () => {
  test("carries every core code plus its own, with no duplicates", () => {
    expect(ERROR_CODES).toEqual([...CORE_ERROR_CODES, ...LEDGER_ERROR_CODES]);
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });

  test("gives every code a non-empty message", () => {
    for (const code of ERROR_CODES) {
      expect(DEFAULT_ERROR_MESSAGES[code], code).toBeTruthy();
    }
  });

  test("takes its retryable answer from the catalog", () => {
    expect(new AppError("UNREACHABLE").retryable).toBe(true);
    expect(new AppError("BAD_REQUEST").retryable).toBe(false);
    expect(RETRYABLE_CODES.has("BAD_REQUEST")).toBe(false);
  });

  test("wraps an unknown throw as INTERNAL and keeps the cause", () => {
    const cause = new TypeError("boom");
    const error = AppError.from(cause);
    expect(error.code).toBe("INTERNAL");
    expect(error.cause).toBe(cause);
    // An error that is already ours passes through untouched.
    expect(AppError.from(error)).toBe(error);
  });
});
