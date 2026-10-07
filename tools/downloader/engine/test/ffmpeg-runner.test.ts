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
import { StderrLevels, streamFfmpeg } from "../src/ffmpeg/runner.ts";
import type { FfmpegRunOptions, FfmpegRunResult } from "../src/ffmpeg/runner.ts";

/** The runner as every caller uses it since dl-53: stdout drained, completion awaited. */
function runFfmpeg(options: FfmpegRunOptions): Promise<FfmpegRunResult> {
  const ffmpeg = streamFfmpeg(options);
  ffmpeg.stdout.resume();
  return ffmpeg.completion;
}

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

/**
 * dl-58, owner decision D3. `onStderrLine` redacts every line through
 * `redactUrlsInText` before handing it to the caller. This is the second
 * consumer D3's case-insensitivity change had to keep working: proof through
 * the real spawn path, not just the direct unit test in
 * `redact-urls-in-text.test.ts`.
 */
describe("onStderrLine redacts what ffmpeg echoes, case included (D3)", () => {
  test("an upper-case scheme in ffmpeg's own stderr is redacted like a lower-case one", async () => {
    const seen: string[] = [];
    await runFfmpeg({
      ...emitting(["https://cdn.example/seg.ts?sig=lower", "HTTPS://cdn.example/seg.ts?sig=UPPER"]),
      failureCode: "DOWNLOAD_FAILED",
      onStderrLine: (line) => seen.push(line),
    }).catch(() => null); // The stand-in always exits 1; only the lines matter here.

    expect(seen).toEqual([
      "https://cdn.example/seg.ts?[redacted]",
      "https://cdn.example/seg.ts?[redacted]",
    ]);
    expect(seen.join("\n")).not.toContain("lower");
    expect(seen.join("\n")).not.toContain("UPPER");
  });
});

/**
 * dl-96 asks ffmpeg for `level+info` so the input's `Duration:` line arrives,
 * and the runner hands everything else back exactly as `-loglevel warning`
 * wrote it. The lines below are the shapes measured on 6.1.1 and 7.0.2.
 */
describe("StderrLevels: info goes to onInfoLine, warnings arrive untagged (dl-96)", () => {
  test("a tag is stripped and the component prefix kept", () => {
    const levels = new StderrLevels();
    expect(levels.read("[http @ 0x5569fb8a5540] [warning] HTTP error 404 Not Found")).toEqual({
      info: false,
      text: "[http @ 0x5569fb8a5540] HTTP error 404 Not Found",
    });
    expect(levels.read("[error] Error opening input file x.mp4.")).toEqual({
      info: false,
      text: "Error opening input file x.mp4.",
    });
    expect(levels.read("[info]   Duration: 00:01:00.00, start: 0.000000")).toEqual({
      info: true,
      text: "  Duration: 00:01:00.00, start: 0.000000",
    });
  });

  test("an untagged line takes the level of the message it continues", () => {
    const levels = new StderrLevels();
    // Before any tag: a stand-in, or a build that ignored the flag.
    expect(levels.read("Stream ends prematurely at 30028").info).toBe(false);
    levels.read("[info]     title           : first line of a title");
    expect(levels.read("                     : certificate verify failed").info).toBe(true);
    levels.read("[hls @ 0x2] [warning] Failed to open segment 3");
    expect(levels.read("continued").info).toBe(false);
  });

  test("a certificate-sounding title fails nothing, reaches no tail, and is offered as info", async () => {
    const info: string[] = [];
    const warnings: string[] = [];
    const failure = await runFfmpeg({
      ...emitting([
        "[info]     title           : certificate verification failed: self-signed",
        "[info]   Duration: 00:00:09.00, start: 0.000000, bitrate: 512 kb/s",
        "[hls @ 0x2] [warning] Segment 1 of playlist 0 failed too many times, skipping",
      ]),
      failureCode: "DOWNLOAD_FAILED",
      onInfoLine: (line) => info.push(line),
      onStderrLine: (line) => warnings.push(line),
    }).then(
      () => null,
      (error: unknown) => AppError.from(error),
    );

    expect(failure?.code).toBe("DOWNLOAD_FAILED");
    const stderr = String(failure?.details?.["stderr"]);
    expect(stderr).not.toContain("certificate");
    expect(stderr).toContain("[hls @ 0x2] Segment 1 of playlist 0 failed too many times");
    expect(info).toHaveLength(2);
    expect(info[1]).toContain("Duration: 00:00:09.00");
    expect(warnings).toEqual([
      "[hls @ 0x2] Segment 1 of playlist 0 failed too many times, skipping",
    ]);
  });

  test("a last line without a newline still reaches the tail", async () => {
    const failure = await runFfmpeg({
      ffmpegPath: process.execPath,
      args: ["-e", `process.stderr.write("[fatal] Conversion failed!"); process.exit(1);`],
      failureCode: "DOWNLOAD_FAILED",
    }).then(
      () => null,
      (error: unknown) => AppError.from(error),
    );
    expect(String(failure?.details?.["stderr"])).toBe("Conversion failed!");
  });
});
