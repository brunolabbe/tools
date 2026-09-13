import { describe, expect, test } from "vitest";
import { CORE_ERROR_CODES } from "@webtools/core";
import {
  AppError,
  DEFAULT_ERROR_MESSAGES,
  ERROR_CODES,
  PLANNER_ERROR_CODES,
  RETRYABLE_CODES,
} from "../src/index.ts";

describe("the planner error taxonomy", () => {
  test("carries every core code plus its own, with no duplicates", () => {
    expect(ERROR_CODES).toEqual([...CORE_ERROR_CODES, ...PLANNER_ERROR_CODES]);
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });

  test("gives every code a non-empty message", () => {
    for (const code of ERROR_CODES) {
      expect(DEFAULT_ERROR_MESSAGES[code], code).toBeTruthy();
    }
  });

  test("takes its retryable answer from the catalog", () => {
    expect(new AppError("AGENT_UNAVAILABLE").retryable).toBe(true);
    // Re-asking belongs inside the agent, with the failure fed back — not as a
    // replay of the same request from the top.
    expect(new AppError("AGENT_MALFORMED_REPLY").retryable).toBe(false);
    expect(RETRYABLE_CODES.has("INVALID_DATES")).toBe(false);
  });

  test("a busy plan is worth retrying and a stale base is not", () => {
    // pl-42. `PLAN_BUSY` clears on its own when the current change finishes;
    // replaying a request built on a superseded revision never succeeds, so
    // `REVISION_STALE` sends the user to reload instead.
    expect(PLANNER_ERROR_CODES).toContain("PLAN_BUSY");
    expect(PLANNER_ERROR_CODES).toContain("REVISION_STALE");
    expect(new AppError("PLAN_BUSY").retryable).toBe(true);
    expect(new AppError("REVISION_STALE").retryable).toBe(false);
    expect(DEFAULT_ERROR_MESSAGES.REVISION_STALE).toMatch(/reload/i);
    expect(DEFAULT_ERROR_MESSAGES.PLAN_BUSY).toMatch(/wait/i);
  });

  test("a plan at its revision ceiling is not worth retrying", () => {
    // pl-42 step 7. Revisions append and are never deleted, so a plan that has
    // reached the ceiling stays there; the next step is a new plan.
    expect(PLANNER_ERROR_CODES).toContain("REVISION_LIMIT_REACHED");
    expect(new AppError("REVISION_LIMIT_REACHED").retryable).toBe(false);
    expect(DEFAULT_ERROR_MESSAGES.REVISION_LIMIT_REACHED).toMatch(/new plan/i);
  });

  test("lets a caller override the catalog's copy and its retry answer", () => {
    const error = new AppError("INVALID_DATES", "You are returning before you leave.", {
      retryable: true,
      details: { departure: "2026-09-10", return: "2026-09-02" },
    });
    expect(error.toPayload()).toEqual({
      code: "INVALID_DATES",
      message: "You are returning before you leave.",
      retryable: true,
      details: { departure: "2026-09-10", return: "2026-09-02" },
    });
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
