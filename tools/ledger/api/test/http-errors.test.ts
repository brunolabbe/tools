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
  "STATEMENT_ROW_CONFLICT",
  "STATEMENT_BEFORE_HISTORY",
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
