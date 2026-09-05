/**
 * dl-37: `namingRefusedOrigins`, the wrapper that reattaches a certificate
 * verdict a terminating proxy took away from a tier — tested directly, against
 * a fake resolver that throws whatever a test names, because `buildRegistry`
 * gives no way to substitute one in place of the real `YtDlpResolver` /
 * `BrowserResolver`, and driving `DRM_PROTECTED` through a live tier would
 * test Chromium or yt-dlp rather than this wrapper.
 *
 * ## Why every "it reattaches" test records from inside `resolve()`
 *
 * `namingRefusedOrigins` reads `Date.now()` itself for `startedAt`, with no
 * clock injection — a resolver has no reason to know the wall clock is fake,
 * and adding one only for this test would test a wrapper this file does not
 * use. `TlsRejectionLog.since` requires the record's timestamp to be `>=`
 * `startedAt`, so a test that calls `rejections.record(...)` **before**
 * invoking `resolve()` depends on both calls landing in the same millisecond —
 * true almost always on a fast machine and not guaranteed, which is exactly
 * the kind of test this repo's own history warns against writing. Recording
 * **from inside** the fake resolver's own `resolve()` — which only runs after
 * the wrapper has already captured `startedAt` — makes the ordering true by
 * construction instead of true by coincidence.
 */

import { AppError } from "@downloader/contract";
import type { ProbeResult, Resolver, ResolveOptions } from "@downloader/contract";
import { describe, expect, test } from "vitest";
import { namingRefusedOrigins } from "../src/resolvers.ts";
import { TlsRejectionLog } from "../src/tls-rejections.ts";
import { probeResult } from "./helpers.ts";

/** Fails with `code`, first recording a certificate rejection for the host. */
function throwingAfterRejection(code: string, rejections: TlsRejectionLog): Resolver {
  return {
    name: "fake",
    priority: 20,
    canHandle: () => true,
    resolve: () => {
      rejections.record("cdn.example", "DEPTH_ZERO_SELF_SIGNED_CERT");
      return Promise.reject(new AppError(code as never));
    },
  };
}

function throwing(code: string): Resolver {
  return {
    name: "fake",
    priority: 20,
    canHandle: () => true,
    resolve: () => Promise.reject(new AppError(code as never)),
  };
}

function succeeding(result: ProbeResult): Resolver {
  return {
    name: "fake",
    priority: 20,
    canHandle: () => true,
    resolve: () => Promise.resolve(result),
  };
}

function options(): ResolveOptions {
  return { timeoutMs: 5000, signal: new AbortController().signal };
}

const URL_UNDER_TEST = new URL("https://cdn.example/watch");

describe("namingRefusedOrigins", () => {
  test("a success passes through untouched", async () => {
    const wrapped = namingRefusedOrigins(succeeding(probeResult()), new TlsRejectionLog());

    await expect(wrapped.resolve(URL_UNDER_TEST, options())).resolves.toMatchObject(probeResult());
  });

  test("UNREACHABLE with a rejection recorded during the call becomes TLS_VERIFICATION_FAILED", async () => {
    const rejections = new TlsRejectionLog();
    const wrapped = namingRefusedOrigins(
      throwingAfterRejection("UNREACHABLE", rejections),
      rejections,
    );

    await expect(wrapped.resolve(URL_UNDER_TEST, options())).rejects.toMatchObject({
      code: "TLS_VERIFICATION_FAILED",
      retryable: false,
      details: { reason: "DEPTH_ZERO_SELF_SIGNED_CERT" },
    });
  });

  test("NO_MEDIA_FOUND with a rejection recorded during the call becomes TLS_VERIFICATION_FAILED too", async () => {
    // yt-dlp's generic fallthrough bucket, not just the browser tier's.
    const rejections = new TlsRejectionLog();
    const wrapped = namingRefusedOrigins(
      throwingAfterRejection("NO_MEDIA_FOUND", rejections),
      rejections,
    );

    await expect(wrapped.resolve(URL_UNDER_TEST, options())).rejects.toMatchObject({
      code: "TLS_VERIFICATION_FAILED",
    });
  });

  test("with no recorded rejection, the raw code passes through", async () => {
    const wrapped = namingRefusedOrigins(throwing("UNREACHABLE"), new TlsRejectionLog());

    await expect(wrapped.resolve(URL_UNDER_TEST, options())).rejects.toMatchObject({
      code: "UNREACHABLE",
    });
  });

  test("a rejection recorded before the caller's own window does not reach it", async () => {
    // The staleness rule, exercised through the wrapper with an unambiguous
    // gap rather than relying on execution speed: the record happens, then the
    // whole event loop turns over before `resolve()` is even called.
    const rejections = new TlsRejectionLog();
    rejections.record("cdn.example", "DEPTH_ZERO_SELF_SIGNED_CERT");
    await new Promise((resolve) => setTimeout(resolve, 20));
    const wrapped = namingRefusedOrigins(throwing("UNREACHABLE"), rejections);

    await expect(wrapped.resolve(URL_UNDER_TEST, options())).rejects.toMatchObject({
      code: "UNREACHABLE",
    });
  });

  test("a verdict the tier already reached on its own is left alone", async () => {
    // The tier's own `reason` is more specific than anything reattached here —
    // reattaching would replace it with a generic OpenSSL code from a rejection
    // that may not even be the one this tier met.
    const rejections = new TlsRejectionLog();
    const own = new AppError("TLS_VERIFICATION_FAILED", undefined, {
      details: { reason: "ERR_CERT_AUTHORITY_INVALID" },
    });
    const wrapped = namingRefusedOrigins(
      {
        name: "fake",
        priority: 20,
        canHandle: () => true,
        resolve: () => {
          rejections.record("cdn.example", "DEPTH_ZERO_SELF_SIGNED_CERT");
          return Promise.reject(own);
        },
      },
      rejections,
    );

    await expect(wrapped.resolve(URL_UNDER_TEST, options())).rejects.toBe(own);
  });

  test.each(["DRM_PROTECTED", "AUTH_REQUIRED", "GEO_BLOCKED", "CANCELED", "TIMEOUT"])(
    "%s is never overwritten, even with a rejection recorded during the same call",
    async (code) => {
      // The finding a gate on this ticket raised: the wrapper's first version
      // excluded only `TLS_VERIFICATION_FAILED`, so any of these five — each a
      // fact the tier established about the source, not an absence of one —
      // would have been clobbered by a coincidental host-and-window match. The
      // rejection is recorded from inside `resolve()` specifically so that, if
      // the allowlist regressed to that single exclusion, `since()` would find
      // it and this test would fail rather than pass by missing the record.
      const rejections = new TlsRejectionLog();
      const wrapped = namingRefusedOrigins(throwingAfterRejection(code, rejections), rejections);

      await expect(wrapped.resolve(URL_UNDER_TEST, options())).rejects.toMatchObject({ code });
    },
  );

  test("a non-certificate refusal recorded concurrently blocks reattachment here too", async () => {
    // The identity gap, exercised through the wrapper rather than only through
    // `TlsRejectionLog` directly: a resolver that raises `UNREACHABLE` must not
    // be told it was the certificate when a different, concurrent CONNECT to
    // the same host failed for an unrelated reason.
    const rejections = new TlsRejectionLog();
    const resolver: Resolver = {
      name: "fake",
      priority: 20,
      canHandle: () => true,
      resolve: () => {
        // Both recorded during this call, which is the shape a real
        // concurrent probe produces: a rejection lands while this resolve()
        // is in flight, and so does an unrelated failure for the same host.
        rejections.record("cdn.example", "DEPTH_ZERO_SELF_SIGNED_CERT");
        rejections.recordOtherFailure("cdn.example");
        return Promise.reject(new AppError("UNREACHABLE"));
      },
    };
    const wrapped = namingRefusedOrigins(resolver, rejections);

    await expect(wrapped.resolve(URL_UNDER_TEST, options())).rejects.toMatchObject({
      code: "UNREACHABLE",
    });
  });

  test("a concurrent success on the same host blocks reattachment (dl-38)", async () => {
    // dl-38's load-balanced origin, driven through the wrapper that actually
    // reattaches: one hostname, two backends. A sibling probe lands on the
    // broken one and is cert-refused; this resolver's own connection lands on
    // the healthy one, completes, and the tier then concludes `NO_MEDIA_FOUND`
    // for a reason of its own — no extractor for the page. That verdict is a
    // fact about the page and must survive.
    //
    // Red before the fix: `since` had no third map, saw one lone certificate
    // rejection in the window, and this came back `TLS_VERIFICATION_FAILED`.
    const rejections = new TlsRejectionLog();
    const resolver: Resolver = {
      name: "fake",
      priority: 20,
      canHandle: () => true,
      resolve: () => {
        // Both inside this call's own window, which is the shape a real
        // concurrent pair produces — and recorded from in here rather than
        // before, for the ordering reason this file's header gives.
        rejections.record("cdn.example", "DEPTH_ZERO_SELF_SIGNED_CERT");
        rejections.recordSuccess("cdn.example");
        return Promise.reject(new AppError("NO_MEDIA_FOUND"));
      },
    };
    const wrapped = namingRefusedOrigins(resolver, rejections);

    await expect(wrapped.resolve(URL_UNDER_TEST, options())).rejects.toMatchObject({
      code: "NO_MEDIA_FOUND",
    });
  });

  test("a success on another host leaves the reattachment alone (dl-38)", async () => {
    // The over-suppression guard for the same change, through the same
    // wrapper: dl-38 must not turn into "suppress whenever the proxy did
    // anything", which the header of `tls-rejections.ts` rejects by name. A
    // page host that loaded fine says nothing about the media host that was
    // refused, and dl-34's verdict has to keep arriving.
    const rejections = new TlsRejectionLog();
    const resolver: Resolver = {
      name: "fake",
      priority: 20,
      canHandle: () => true,
      resolve: () => {
        rejections.record("cdn.example", "DEPTH_ZERO_SELF_SIGNED_CERT");
        rejections.recordSuccess("page.example");
        return Promise.reject(new AppError("NO_MEDIA_FOUND"));
      },
    };
    const wrapped = namingRefusedOrigins(resolver, rejections);

    await expect(wrapped.resolve(URL_UNDER_TEST, options())).rejects.toMatchObject({
      code: "TLS_VERIFICATION_FAILED",
      retryable: false,
      details: { reason: "DEPTH_ZERO_SELF_SIGNED_CERT" },
    });
  });

  test("dispose is forwarded when the wrapped resolver has one", async () => {
    let disposed = false;
    const resolver: Resolver = {
      name: "fake",
      priority: 20,
      canHandle: () => true,
      resolve: () => Promise.resolve(probeResult()),
      dispose: () => {
        disposed = true;
        return Promise.resolve();
      },
    };
    const wrapped = namingRefusedOrigins(resolver, new TlsRejectionLog());

    await wrapped.dispose?.();

    expect(disposed).toBe(true);
  });

  test("name, priority and canHandle pass through unchanged", () => {
    const wrapped = namingRefusedOrigins(throwing("UNREACHABLE"), new TlsRejectionLog());

    expect(wrapped.name).toBe("fake");
    expect(wrapped.priority).toBe(20);
    expect(wrapped.canHandle(URL_UNDER_TEST)).toBe(true);
  });
});
