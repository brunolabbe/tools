import { describe, expect, test } from "vitest";
import { AppError } from "@ledger/contract";
import { toErrorResponse } from "../src/http-errors.ts";

// Named, not read off LEDGER_ERROR_CODES: a later ledger code that is not a
// pasted-statement problem has no reason to answer 422, and this test must not
// say it does.
const STATEMENT_CODES = [
  "STATEMENT_UNRECOGNIZED_LINE",
  "STATEMENT_CHAIN_BROKEN",
  "STATEMENT_TOTAL_MISMATCH",
  "STATEMENT_ECHO_MISMATCH",
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
});
