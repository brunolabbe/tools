/**
 * dl-102, as a visitor meets it, on the wiring production uses.
 *
 * A tail-`moov` MP4 from an origin that answers every request with `200` and
 * the whole body used to finish as a `completed` job whose file had not one
 * decodable frame. The engine now asks the origin first, and refuses before
 * the first byte. This file runs that through a real `createApp`: the direct
 * tier finds the file, the engine is the one `server.ts` builds, and its probe
 * leaves through **the terminating egress proxy ffmpeg is given**, verifying
 * against the root that proxy issued (`ffmpegEgress.tlsCaFile`).
 *
 * The origin is HTTPS on loopback with a fixture certificate that only the
 * proxy trusts (`EGRESS_CA_FILE`). So the refusal below is itself the evidence
 * that the probe took the proxy's route: sent direct, it would have met the
 * fixture certificate with the proxy's root as its only anchor, failed the
 * handshake, and been an "unknown" that lets the job complete.
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { DEFAULT_ERROR_MESSAGES, RETRYABLE_CODES, ROUTES } from "@downloader/contract";
import type { Job, JobResponse } from "@downloader/contract";
import { probeSeek, resolveFfmpegPath } from "@downloader/engine";
import { createApp } from "../src/server.ts";
import { waitFor } from "./helpers.ts";
import type { FixtureCertificate, TlsOrigin } from "./helpers/tls-origin.ts";
import { assertDecodable, createFixtureCertificate, startTlsOrigin } from "./helpers/tls-origin.ts";

const FFMPEG = resolveFfmpegPath();
/** Real ffmpeg, a generated clip and a TLS origin behind a terminating proxy. */
const SLOW = 120_000;

const NOOP_LOGGER = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => NOOP_LOGGER,
};

let certificate: FixtureCertificate;
let origin: TlsOrigin;
let dir: string;
let app: Awaited<ReturnType<typeof createApp>>;

function ffmpeg(args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", ...args], {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "dl102-api-"));
  // About 1 MB: below roughly 64 to 91 KB ffmpeg never needs to seek, and the
  // defect cannot appear (dl-102's gate 1).
  const tail = path.join(dir, "moov-end.mp4");
  await ffmpeg(
    [
      ["-f", "lavfi", "-i", "testsrc2=size=640x480:rate=25:duration=4"],
      ["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=4"],
      ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"],
      ["-b:v", "2M", "-minrate", "2M", "-maxrate", "2M", "-bufsize", "2M"],
      ["-c:a", "aac", "-shortest", tail],
    ].flat(),
  );
  await ffmpeg([
    "-i",
    tail,
    "-c",
    "copy",
    "-movflags",
    "+faststart",
    path.join(dir, "faststart.mp4"),
  ]);

  certificate = await createFixtureCertificate({ ipAddresses: ["127.0.0.1"] });
  // The whole file with a `200`, whatever was asked: `Range` is ignored.
  origin = await startTlsOrigin(certificate, async (request, response) => {
    const name = path.basename(new URL(request.url ?? "/", "https://x").pathname);
    let body: Buffer;
    try {
      body = await fs.readFile(path.join(dir, name));
    } catch {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "video/mp4", "content-length": String(body.length) });
    response.end(request.method === "HEAD" ? undefined : body);
  });

  app = await createApp({
    startGc: false,
    logger: NOOP_LOGGER,
    // Tests elsewhere stub this; here nothing in the probe should spawn one.
    grabFrame: async () => null,
    config: {
      databasePath: ":memory:",
      storageDir: path.join(dir, "storage"),
      ssrfAllowPrivateAddresses: true,
      enableBrowserResolver: false,
      enableYtdlpResolver: false,
      enableDirectResolver: true,
      // The production default, written out: ffmpeg's proxy terminates TLS.
      ffmpegTlsIntercept: true,
      egressCaFile: certificate.caPath,
      rateLimitProbePerMinute: 0,
      rateLimitProbeEventsPerMinute: 0,
      rateLimitJobsPerMinute: 0,
      rateLimitFilesPerMinute: 0,
      rateLimitThumbnailPerMinute: 0,
      turnstile: undefined,
    },
  });
}, SLOW);

afterAll(async () => {
  await app?.shutdown();
  await origin?.close();
  await certificate?.cleanup();
  await fs.rm(dir, { recursive: true, force: true });
});

/** Creates the job, opens its link as a visitor would, and waits for its end. */
async function runJob(name: string): Promise<{ job: Job; status: number; file: string }> {
  const created = await app.server.inject({
    method: "POST",
    url: ROUTES.jobs,
    payload: { url: `https://127.0.0.1:${origin.port}/${name}` },
  });
  expect(created.statusCode).toBe(201);
  const job = (created.json() as JobResponse).job;
  const opened = await app.server.inject({ method: "GET", url: job.link?.url ?? "" });
  const file = path.join(dir, `received-${name}`);
  await fs.writeFile(file, opened.rawPayload);
  const finished = await waitFor(
    () => app.context.store.get(job.id),
    (candidate) => candidate?.status === "completed" || candidate?.status === "failed",
    { timeoutMs: 60_000, label: `job ${job.id}` },
  );
  return { job: finished as Job, status: opened.statusCode, file };
}

describe("dl-102: a Range-ignoring origin through the real app", () => {
  test(
    "a tail-moov MP4 fails its job with SOURCE_NOT_SEEKABLE, never completes undecodable",
    async () => {
      const { job, status } = await runJob("moov-end.mp4");

      expect(job.status).toBe("failed");
      expect(job.error?.code).toBe("SOURCE_NOT_SEEKABLE");
      expect(job.error?.message).toBe(DEFAULT_ERROR_MESSAGES.SOURCE_NOT_SEEKABLE);
      expect(job.error?.retryable).toBe(false);
      expect(RETRYABLE_CODES.has("SOURCE_NOT_SEEKABLE")).toBe(false);
      // Final on the first attempt: neither retried nor re-probed.
      expect(job.attempts).toBe(1);
      // Refused before the first byte, so the visitor got an error, not a file.
      expect(status).toBe(422);
    },
    SLOW,
  );

  test(
    "control: the same video with its index first completes, and decodes",
    async () => {
      const { job, status, file } = await runJob("faststart.mp4");

      expect(job.status).toBe("completed");
      expect(status).toBe(200);
      await assertDecodable(FFMPEG, file);
    },
    SLOW,
  );

  test("with no proxy, the probe verifies the origin against tlsCaFile, as ffmpeg would", async () => {
    // The direct route, which an engine built without `proxyUrl` takes, as its
    // ffmpeg does. Verification stays on: without the fixture CA it is not a
    // refusal, it is unknown, and ffmpeg is left to report the certificate.
    const url = `https://127.0.0.1:${origin.port}/moov-end.mp4`;
    const base = { requestContext: { headers: {} }, proxyUrl: undefined, env: {} };
    expect(
      await probeSeek(url, { ...base, tlsVerify: true, tlsCaFile: certificate.caPath }),
    ).toEqual({ kind: "unseekable" });
    expect(await probeSeek(url, { ...base, tlsVerify: true, tlsCaFile: undefined })).toMatchObject({
      kind: "unknown",
    });
  });
});
