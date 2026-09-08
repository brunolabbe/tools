/**
 * Which failures are worth a mirror (dl-45), at the unit level.
 *
 * The end-to-end proof is in `mirror-failover.test.ts`, driven by real origins.
 * This file pins the classification itself, because the classification is where
 * the ticket's hard constraint lives: **a re-probe must not be replaced by a
 * mirror attempt.** An expired signed URL is expired at every host, so spending
 * the alternates on one would burn them and then hand the orchestrator the same
 * failure it would have re-probed on.
 *
 * The ffmpeg strings below are transcribed from a measurement rather than
 * invented — see the table in `src/download/failover.ts`, taken at
 * `-loglevel warning` against local fixture origins on 2026-09-07. A test that
 * asserted against strings someone imagined ffmpeg writes would be green and
 * worthless.
 */

import { AppError } from "@downloader/contract";
import { describe, expect, test } from "vitest";
import { downloadCandidates, isHostFailure } from "../src/download/failover.ts";

function ffmpegFailure(stderr: string): AppError {
  return new AppError("DOWNLOAD_FAILED", undefined, { details: { exitCode: 1, stderr } });
}

describe("isHostFailure", () => {
  test("a transport failure from the engine's own fetch is one", () => {
    expect(isHostFailure(new AppError("UNREACHABLE", undefined, { details: { url: "x" } }))).toBe(
      true,
    );
  });

  test("an expired signed URL is not, whichever layer noticed", () => {
    // The whole point. `VARIANT_GONE` is 403/404/410 (see `http.ts`) and is what
    // `REPROBE_WORTHY` acts on; a mirror attempt here would displace the fix.
    expect(
      isHostFailure(new AppError("VARIANT_GONE", undefined, { details: { status: 403 } })),
    ).toBe(false);
    expect(
      isHostFailure(
        ffmpegFailure("Error opening input: Server returned 403 Forbidden (access denied)"),
      ),
    ).toBe(false);
    expect(isHostFailure(ffmpegFailure("Error opening input: Server returned 404 Not Found"))).toBe(
      false,
    );
  });

  test("a host that never answered is one, on either path", () => {
    expect(
      isHostFailure(
        ffmpegFailure("[tcp @ 0x1] Connection to tcp://127.0.0.1:1 failed: Connection refused"),
      ),
    ).toBe(true);
    expect(
      isHostFailure(
        ffmpegFailure(
          "[tcp @ 0x1] Failed to resolve hostname vod-a.example: Name or service not known",
        ),
      ),
    ).toBe(true);
    // The errno alone, without the tcp layer's prefix line: on a long playlist
    // that prefix scrolls out of the 4 KB stderr tail while later repetitions
    // survive, so matching only the whole sentence would miss the common case.
    expect(isHostFailure(ffmpegFailure("Connection timed out"))).toBe(true);
  });

  test("a 5xx is one — the host is up and still not serving the bytes", () => {
    expect(
      isHostFailure(ffmpegFailure("Error opening input: Server returned 5XX Server Error reply")),
    ).toBe(true);
    expect(
      isHostFailure(new AppError("DOWNLOAD_FAILED", undefined, { details: { status: 502 } })),
    ).toBe(true);
    // And a 4xx that reached the same code is not: `classifyHttpStatus` files
    // every other 4xx as a request we got wrong, which the next host gets wrong
    // identically.
    expect(
      isHostFailure(new AppError("DOWNLOAD_FAILED", undefined, { details: { status: 400 } })),
    ).toBe(false);
  });

  test("conditions a mirror cannot fix are excluded, including the deliberate ones", () => {
    expect(isHostFailure(new AppError("JOB_CANCELED"))).toBe(false);
    expect(isHostFailure(new AppError("SIZE_LIMIT_EXCEEDED"))).toBe(false);
    expect(
      isHostFailure(new AppError("AUTH_REQUIRED", undefined, { details: { status: 401 } })),
    ).toBe(false);
    // "End of file" is what a truncated response from a healthy host looks like
    // too, so it does not buy a mirror. Measured, and excluded on purpose.
    expect(isHostFailure(ffmpegFailure("Error opening input: End of file"))).toBe(false);
  });

  test("a rejected certificate buys a mirror, over a recorded objection", () => {
    // Included by the owner's decision of 2026-09-07, against the builder's
    // recommendation. Asserted here rather than left implicit precisely because
    // it is the surprising direction: a reader who knows dl-11, dl-19 and dl-27
    // would expect this to be `false`, and the reason it is not belongs beside
    // the assertion. The objection — a silent success from another host replaces
    // a possible-MITM warning — is on dl-45 and in `failover.ts`.
    expect(isHostFailure(new AppError("TLS_VERIFICATION_FAILED"))).toBe(true);
  });

  test("a variant with no alternate has nowhere to fail over to, whatever the code", () => {
    // The bound on the objection above, at the only level this file can prove
    // it: `isHostFailure` decides whether the loop *may* advance, and
    // `downloadCandidates` decides whether there is anywhere to advance to. On a
    // single-host variant — every variant in the repo before dl-45 — a rejected
    // certificate reaches the caller exactly as it did before, because the list
    // is one long. That the *last* candidate's error is the one that propagates
    // is an engine-loop property and is proven in `mirror-failover.test.ts`.
    expect(isHostFailure(new AppError("TLS_VERIFICATION_FAILED"))).toBe(true);
    expect(downloadCandidates({ url: "https://a.example/i.m3u8" })).toHaveLength(1);
  });

  test("anything that is not an AppError, and anything unrecognised, is not", () => {
    expect(isHostFailure(new Error("Connection refused"))).toBe(false);
    expect(isHostFailure(undefined)).toBe(false);
    expect(isHostFailure(new AppError("DOWNLOAD_FAILED"))).toBe(false);
  });
});

describe("downloadCandidates", () => {
  test("is the primary alone when the rendition has one address", () => {
    expect(downloadCandidates({ url: "https://a.example/i.m3u8" })).toEqual([
      "https://a.example/i.m3u8",
    ]);
    expect(downloadCandidates({ url: "https://a.example/i.m3u8", alternateUrls: [] })).toEqual([
      "https://a.example/i.m3u8",
    ]);
  });

  test("is primary-first, in the order the manifest declared", () => {
    expect(
      downloadCandidates({
        url: "https://a.example/i.m3u8",
        alternateUrls: ["https://b.example/i.m3u8", "https://c.example/i.m3u8"],
      }),
    ).toEqual(["https://a.example/i.m3u8", "https://b.example/i.m3u8", "https://c.example/i.m3u8"]);
  });

  test("never offers the same host twice, whatever the variant carries", () => {
    // A repeated address is one host. Trying it again is the failure the
    // failover exists to avoid, dressed as a retry.
    expect(
      downloadCandidates({
        url: "https://a.example/i.m3u8",
        alternateUrls: ["https://a.example/i.m3u8", "", "https://b.example/i.m3u8"],
      }),
    ).toEqual(["https://a.example/i.m3u8", "https://b.example/i.m3u8"]);
  });
});
