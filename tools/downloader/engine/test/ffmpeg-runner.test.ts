/**
 * How a failed run is classified, which is the difference between "the link is
 * dead" and "someone is in the middle".
 *
 * dl-19 read the stderr **tail** for a rejected certificate, because a tail is
 * all a failure carries. dl-27 makes that insufficient rather than merely
 * approximate: the egress proxy now refuses an origin it cannot verify by
 * answering the `CONNECT` with `502 TLS certificate verification failed`, and
 * ffmpeg logs one of those per segment attempt, three lines each. A playlist of
 * any real length pushes the first — and every one after it — out of a 4 KB
 * window long before ffmpeg exits, so the run would be filed `DOWNLOAD_FAILED`
 * on exactly the streams the check exists for.
 *
 * **The two-origin fixture cannot show this.** It has two segments and a
 * kilobyte of stderr, so it passes with or without the fix; a mutation run
 * proved it. This file is where the window is the subject, and the binary is
 * `node` rather than ffmpeg because what is under test is the reading, not the
 * writing — spawned with an argument array and `shell: false` like everything
 * else here.
 */

import process from "node:process";
import { AppError } from "@downloader/contract";
import { describe, expect, test } from "vitest";
import { runFfmpeg } from "../src/ffmpeg/runner.ts";

/** A stand-in that writes the stderr a test dictates and exits non-zero. */
function emitting(lines: readonly string[]): { ffmpegPath: string; args: string[] } {
  const script = `for (const line of ${JSON.stringify(lines)}) process.stderr.write(line + "\\n");
process.exit(1);`;
  return { ffmpegPath: process.execPath, args: ["-e", script] };
}

async function codeOf(lines: readonly string[]): Promise<string | undefined> {
  const failure = await runFfmpeg({ ...emitting(lines), failureCode: "DOWNLOAD_FAILED" }).then(
    () => null,
    (error: unknown) => AppError.from(error),
  );
  return failure?.code;
}

/** What the proxy puts in the status line, as ffmpeg echoes it. */
const REFUSAL =
  "[httpproxy @ 0x1] HTTP error 502 TLS certificate verification failed (DEPTH_ZERO_SELF_SIGNED_CERT)";

/** Two more lines per refused segment, which is what fills the window. */
function segmentNoise(count: number): string[] {
  return Array.from({ length: count }, (_, index) => [
    `[hls @ 0x2] Failed to open segment ${index} of playlist 0`,
    `[hls @ 0x2] Segment ${index} of playlist 0 failed too many times, skipping`,
  ]).flat();
}

describe("a failure that says a certificate was refused", () => {
  test("is read off the whole stream, not off the last four kilobytes", async () => {
    // The proxy refuses segment 0 and every segment after it; by the time
    // ffmpeg gives up, the sentence naming the reason is 40 KB behind the end.
    const lines = [
      REFUSAL,
      ...segmentNoise(200),
      "[hls @ 0x2] Error when loading first segment",
      "Error opening input: Invalid data found when processing input",
    ];
    expect(lines.slice(1).join("\n").length).toBeGreaterThan(4096);

    await expect(codeOf(lines)).resolves.toBe("TLS_VERIFICATION_FAILED");
  });

  test("the tail alone would have missed it, which is why the stream is read", async () => {
    // The control that keeps the test above honest: without the distance there
    // is nothing to notice, and a sweep of one-line fixtures would pass on a
    // classifier that only ever looked at the tail.
    await expect(
      codeOf([REFUSAL, "Error opening input: Invalid data found when processing input"]),
    ).resolves.toBe("TLS_VERIFICATION_FAILED");
  });

  test("a long run that never mentions a certificate is still a download failure", async () => {
    // Sticky must not mean indiscriminate. A refused segment and a 404 have to
    // stay distinguishable in both directions — dl-19's `Done when`.
    await expect(
      codeOf([
        ...segmentNoise(200),
        "[hls @ 0x2] Server returned 404 Not Found",
        "Error opening input: Server returned 404 Not Found",
      ]),
    ).resolves.toBe("DOWNLOAD_FAILED");
  });

  test("a clean exit is not classified at all", async () => {
    // A warning-level line about a certificate on a run that succeeded must not
    // invent a failure — `-loglevel warning` since dl-27 makes those reachable.
    const result = await runFfmpeg({
      ffmpegPath: process.execPath,
      args: ["-e", `process.stderr.write(${JSON.stringify(REFUSAL)});`],
      failureCode: "DOWNLOAD_FAILED",
    });
    expect(result.exitCode).toBe(0);
  });
});
