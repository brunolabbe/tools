import { describe, expect, test } from "vitest";
import { AppError, LEDGER_ERROR_CODES } from "@ledger/contract";
import { toErrorResponse } from "../src/http-errors.ts";

describe("the ledger's own error codes", () => {
  // A code with no line in http-errors.ts answers 500, the default for "we did
  // not think about this" — which is wrong for a paste the caller can fix.
  test.each(LEDGER_ERROR_CODES)("%s answers 422 and carries its details", (code) => {
    const { status, body } = toErrorResponse(
      new AppError(code, undefined, { details: { line: 3 } }),
    );
    expect(status).toBe(422);
    expect(body.error).toMatchObject({ code, retryable: false, details: { line: 3 } });
  });
});
