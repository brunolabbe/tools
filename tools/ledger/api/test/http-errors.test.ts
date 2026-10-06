import { describe, expect, test } from "vitest";
import { AppError, LEDGER_ERROR_CODES } from "@ledger/contract";
import { toErrorResponse } from "../src/http-errors.ts";

// The 422 test names its codes rather than reading LEDGER_ERROR_CODES: a later
// ledger code that is not a pasted-statement problem has no reason to answer
// 422, and that test must not say it does.
const STATEMENT_CODES = [
  "STATEMENT_UNRECOGNIZED_LINE",
  "STATEMENT_CHAIN_BROKEN",
  "STATEMENT_TOTAL_MISMATCH",
  "STATEMENT_ECHO_MISMATCH",
  "STATEMENT_MONTH_COUNT_MISMATCH",
] as const;

describe("the ledger's statement error codes", () => {
  // A code with no line in http-errors.ts answers 500, the default for "we did
  // not think about this" — which is wrong for a paste the caller can fix.
  test.each(STATEMENT_CODES)("%s answers 422 and carries its details", (code) => {
    const { status, body } = toErrorResponse(
      new AppError(code, undefined, { details: { line: 3 } }),
    );
    expect(status).toBe(422);
    expect(body.error).toMatchObject({ code, retryable: false, details: { line: 3 } });
  });

  // The rule in tools/ledger/CLAUDE.md: a ledger code arrives with its status in
  // http-errors.ts in the same change. An unmapped one answers 500, so this
  // fails the change that forgot, without claiming what the status should be.
  test.each(LEDGER_ERROR_CODES)("%s has a status line and does not answer 500", (code) => {
    expect(toErrorResponse(new AppError(code)).status).not.toBe(500);
  });
});

// lg-2's two codes, in a block of their own at the end: lg-1's record cites
// lines above, and a longer list there would move every one of them.
describe("the ledger's stored-statement error codes", () => {
  test.each(["STATEMENT_ROW_CONFLICT", "STATEMENT_BEFORE_HISTORY"] as const)(
    "%s answers 422 and carries its details",
    (code) => {
      const { status, body } = toErrorResponse(
        new AppError(code, undefined, { details: { date: "2026-10-01" } }),
      );
      expect(status).toBe(422);
      expect(body.error).toMatchObject({ code, retryable: false, details: { date: "2026-10-01" } });
    },
  );
});

// A body over the cap is raised by Fastify before any route runs, so the mapper
// cannot know what the route takes. It says the request is too large; a route
// that wants its own sentence declares it (`statements.ts`), and gets it.
describe("a body over the cap", () => {
  const tooLarge = Object.assign(new Error("Request body is too large"), {
    code: "FST_ERR_CTP_BODY_TOO_LARGE",
    statusCode: 413,
  });

  test("is a 413 whose copy is generic, so a future body route is not called a paste", () => {
    const { status, body } = toErrorResponse(tooLarge);

    expect(status).toBe(413);
    expect(body.error.code).toBe("SIZE_LIMIT_EXCEEDED");
    expect(body.error.message).toContain("too large");
    expect(body.error.message).not.toMatch(/paste|statement/iu);
  });

  test("takes the sentence the route declared, when it declared one", () => {
    const { status, body } = toErrorResponse(tooLarge, {
      tooLargeMessage: "The paste is too long to store in one go.",
    });

    expect(status).toBe(413);
    expect(body.error).toMatchObject({
      code: "SIZE_LIMIT_EXCEEDED",
      message: "The paste is too long to store in one go.",
    });
  });
});

// lg-4: an id the caller named that is not there. Core's NOT_FOUND is a URL that
// matched no route and is not what either of these says.
describe("the rules and inbox error codes", () => {
  test.each(["RULE_NOT_FOUND", "ROW_NOT_FOUND"] as const)(
    "%s answers 404, not retryable",
    (code) => {
      const { status, body } = toErrorResponse(new AppError(code));
      expect(status).toBe(404);
      expect(body.error).toMatchObject({ code, retryable: false });
    },
  );
});
