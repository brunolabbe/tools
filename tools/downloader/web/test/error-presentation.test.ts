import { describe, expect, test } from "vitest";
import { DEFAULT_ERROR_MESSAGES, ERROR_CODES, RETRYABLE_CODES } from "@downloader/contract";
import type { AppErrorPayload, ErrorCode } from "@downloader/contract";
import {
  ERROR_PRESENTATION,
  localErrorPayload,
  presentError,
} from "../src/lib/error-presentation.ts";

function payload(code: ErrorCode, overrides: Partial<AppErrorPayload> = {}): AppErrorPayload {
  return {
    code,
    message: DEFAULT_ERROR_MESSAGES[code],
    retryable: RETRYABLE_CODES.has(code),
    ...overrides,
  };
}

describe("error presentation", () => {
  test("covers every code in the taxonomy, with distinct copy", () => {
    expect(Object.keys(ERROR_PRESENTATION).toSorted()).toEqual(ERROR_CODES.toSorted());

    const titles = new Set<string>();
    const details = new Set<string>();
    for (const code of ERROR_CODES) {
      const entry = ERROR_PRESENTATION[code];
      expect(entry.title.length).toBeGreaterThan(0);
      expect(entry.detail.length).toBeGreaterThan(0);
      titles.add(entry.title);
      details.add(entry.detail);
    }
    // Distinct rendering per code is the point of the taxonomy.
    expect(titles.size).toBe(ERROR_CODES.length);
    expect(details.size).toBe(ERROR_CODES.length);
  });

  test("every code produces a renderable view", () => {
    for (const code of ERROR_CODES) {
      const view = presentError(payload(code));
      expect(view.code).toBe(code);
      expect(view.message.length).toBeGreaterThan(0);
      expect(typeof view.retryable).toBe("boolean");
    }
  });

  test("DRM_PROTECTED is final and offers no retry, even if the payload claims otherwise", () => {
    const honest = presentError(payload("DRM_PROTECTED"));
    expect(honest.retryable).toBe(false);
    expect(honest.final).toBe(true);

    // A buggy or hostile server must not be able to put a retry button in
    // front of a DRM refusal.
    const lying = presentError(payload("DRM_PROTECTED", { retryable: true }));
    expect(lying.retryable).toBe(false);
  });

  test("no code that is final ever allows a retry", () => {
    for (const code of ERROR_CODES) {
      const entry = ERROR_PRESENTATION[code];
      if (entry.final) expect(entry.allowRetry).toBe(false);
    }
  });

  test("the retryable codes from the taxonomy do surface a retry", () => {
    for (const code of RETRYABLE_CODES) {
      expect(presentError(payload(code)).retryable).toBe(true);
    }
  });

  test("a server-declared non-retryable error shows no retry", () => {
    expect(presentError(payload("DOWNLOAD_FAILED", { retryable: false })).retryable).toBe(false);
  });

  test("the payload's message wins over the default copy", () => {
    const view = presentError(payload("UNREACHABLE", { message: "getaddrinfo ENOTFOUND" }));
    expect(view.message).toBe("getaddrinfo ENOTFOUND");
  });

  test("an empty message falls back to the taxonomy default", () => {
    const view = presentError(payload("INTERNAL", { message: "   " }));
    expect(view.message).toBe(DEFAULT_ERROR_MESSAGES.INTERNAL);
  });

  test("localErrorPayload derives retryability from the shared set", () => {
    expect(localErrorPayload("INVALID_URL").retryable).toBe(false);
    expect(localErrorPayload("TIMEOUT").retryable).toBe(true);
    expect(localErrorPayload("JOB_CANCELED").message).toBe(DEFAULT_ERROR_MESSAGES.JOB_CANCELED);
  });

  // The code has two causes: the setting is off, or it is on and the press
  // declined (dl-83). The detail must be true of both (dl-94).
  test("age confirmation says the server did not make it, and claims nothing about its setting", () => {
    const { detail } = presentError(payload("AGE_CONFIRMATION_REQUIRED"));
    expect(detail).toBe(
      "The page asks the viewer to confirm they are an adult before it plays the video. The server did not make that confirmation on anyone's behalf.",
    );
    expect(detail).not.toMatch(/not set|turned on|operator|enable|setting|configur/i);
  });
});
