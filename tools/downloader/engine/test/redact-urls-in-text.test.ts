/**
 * `redactUrlsInText`, at the unit level.
 *
 * dl-58, owner decision D3: made case-insensitive so `api/src/logger.ts` can
 * reuse it to redact every string value in a log line without first
 * requiring a caller to have lower-cased a URL. This is the direct proof;
 * `ffmpeg-runner.test.ts`'s own new case proves the same property through
 * this function's original consumer, ffmpeg's stderr.
 */

import { describe, expect, test } from "vitest";
import { redactUrlsInText } from "../src/ffmpeg/runner.ts";

describe("redactUrlsInText", () => {
  test("redacts a lower-case http(s) URL's query string, keeping origin and path", () => {
    expect(redactUrlsInText("fetching https://cdn.example/v.m3u8?sig=SECRET now")).toBe(
      "fetching https://cdn.example/v.m3u8?[redacted] now",
    );
  });

  test("redacts an upper-case scheme the same way (D3)", () => {
    expect(redactUrlsInText("ERROR: Unsupported URL: HTTPS://cdn.example/v.m3u8?sig=SECRET")).toBe(
      "ERROR: Unsupported URL: https://cdn.example/v.m3u8?[redacted]",
    );
  });

  test("redacts a mixed-case scheme too", () => {
    expect(redactUrlsInText("HtTpS://cdn.example/p?sig=SECRET")).toBe(
      "https://cdn.example/p?[redacted]",
    );
  });

  test("a URL with no query string is left alone, case included", () => {
    expect(redactUrlsInText("HTTPS://cdn.example/v.m3u8")).toBe("https://cdn.example/v.m3u8");
  });

  test("redacts every URL in a line with more than one", () => {
    expect(redactUrlsInText("http://a.example/x?sig=1 then HTTPS://b.example/y?sig=2")).toBe(
      "http://a.example/x?[redacted] then https://b.example/y?[redacted]",
    );
  });

  test("known gap: a protocol-relative URL is not matched (no scheme at all)", () => {
    // Pinned rather than left implicit: the owner's D3 answer widened the
    // scheme's case, not whether a scheme is required at all. No known
    // caller — here or in api/src/logger.ts — produces a bare `//host/path`,
    // so this is a documented boundary, not a live leak.
    expect(redactUrlsInText("fetching //cdn.example/v.m3u8?sig=SECRET now")).toBe(
      "fetching //cdn.example/v.m3u8?sig=SECRET now",
    );
  });

  test("text with no URL at all passes through unchanged", () => {
    const text = "ffmpeg exited with code 1";
    expect(redactUrlsInText(text)).toBe(text);
  });
});
