/**
 * Unit tests for the shared string-matching half of dl-34: what counts as a
 * certificate failure for Chromium and for yt-dlp, and — the part a gate on
 * this ticket found missing — what deliberately does *not*.
 */

import { describe, expect, test } from "vitest";
import {
  chromiumCertificateError,
  TIER_TRUST_STORE_HINT,
  ytdlpCertificateMarker,
} from "../src/tls-verification.ts";

describe("chromiumCertificateError", () => {
  test("reads the net:: token out of Playwright's message", () => {
    expect(
      chromiumCertificateError("page.goto: net::ERR_CERT_AUTHORITY_INVALID at https://x"),
    ).toBe("ERR_CERT_AUTHORITY_INVALID");
  });

  test("matches the whole ERR_CERT_ family, not one member", () => {
    // Gate finding B: these are certificate *policy* codes — weak signature,
    // excess validity, name constraints, CT-adjacent — not "root unreachable"
    // ones. They still belong on TLS_VERIFICATION_FAILED (a page did answer and
    // its certificate did not pass); asserted here so a future narrowing of the
    // prefix has to change this test on purpose.
    for (const code of [
      "ERR_CERT_WEAK_SIGNATURE_ALGORITHM",
      "ERR_CERT_VALIDITY_TOO_LONG",
      "ERR_CERT_NON_UNIQUE_NAME",
      "ERR_CERT_NAME_CONSTRAINT_VIOLATION",
      "ERR_CERT_SYMANTEC_LEGACY",
    ]) {
      expect(chromiumCertificateError(`page.goto: net::${code} at https://x`)).toBe(code);
    }
  });

  test("excludes the one member a private root cannot cause", () => {
    expect(chromiumCertificateError("net::ERR_CERTIFICATE_TRANSPARENCY_REQUIRED")).toBeUndefined();
  });

  test("says nothing about a message with no net:: token", () => {
    expect(chromiumCertificateError("Timeout 30000ms exceeded")).toBeUndefined();
  });
});

describe("ytdlpCertificateMarker", () => {
  test("matches the self-signed case, verbatim from the real binary", () => {
    const stderr =
      "error: [generic] unable to download webpage: [ssl: certificate_verify_failed] " +
      "certificate verify failed: self-signed certificate (_ssl.c:1032)";
    expect(ytdlpCertificateMarker(stderr)).toBe("certificate_verify_failed");
  });

  test("matches libcurl's wording", () => {
    expect(ytdlpCertificateMarker("ssl certificate problem: self-signed certificate")).toBe(
      "ssl certificate problem",
    );
  });

  // Gate finding A. The whole point: this phrase is Python's own message for
  // an *incomplete chain*, not for an untrusted root, and it fires on both a
  // private-root deployment and an ordinary public-site misconfiguration —
  // measured here from a real two-level chain (root -> intermediate -> leaf)
  // served with only the leaf, against the real yt-dlp binary, 2026-09-03.
  describe("an incomplete chain", () => {
    const stderr =
      "error: [generic] unable to download webpage: [ssl: certificate_verify_failed] " +
      "certificate verify failed: unable to get local issuer certificate (_ssl.c:1032) " +
      "(caused by certificateverifyerror('[ssl: certificate_verify_failed] certificate " +
      "verify failed: unable to get local issuer certificate (_ssl.c:1032)'))";

    test("is not matched, even though the generic phrase is present twice", () => {
      // The exclusion has to win over the very phrase it is embedded in — this
      // stderr contains "certificate_verify_failed" and "certificateverifyerror"
      // as well as the ambiguous one, which is the real shape yt-dlp emits.
      expect(ytdlpCertificateMarker(stderr)).toBeUndefined();
    });

    test("the second spelling is excluded too", () => {
      expect(
        ytdlpCertificateMarker("certificate verify failed: unable to get issuer certificate"),
      ).toBeUndefined();
    });
  });
});

describe("TIER_TRUST_STORE_HINT", () => {
  test("does not assert a private root as the cause", () => {
    // Gate finding B: the earlier draft stated flatly that the origin "fails
    // here with EGRESS_CA_FILE set and correct", which is false for a
    // certificate policy violation. The hint must not overclaim causation it
    // cannot back — `details.reason` is where the actual code lives.
    expect(TIER_TRUST_STORE_HINT).toMatch(/if this is/i);
    expect(TIER_TRUST_STORE_HINT).toMatch(/details\.reason/);
  });

  test("does not claim the anchor never reaches the tier, which dl-37 made false", () => {
    // Reaching this hint at all means the tier met an origin certificate
    // itself, so it is behind a tunnel — one configuration out of two since
    // dl-37, where it was all of them when dl-34 wrote the sentence. The hint
    // has to name the configuration and the way out of it, or an operator on
    // the default arrangement reads a flat denial that is simply wrong.
    expect(TIER_TRUST_STORE_HINT).toMatch(/FFMPEG_TLS_INTERCEPT/u);
    expect(TIER_TRUST_STORE_HINT).toMatch(/tunnelling proxy/u);
    expect(TIER_TRUST_STORE_HINT).not.toMatch(/^EGRESS_CA_FILE does not reach this tier\./u);
  });
});
