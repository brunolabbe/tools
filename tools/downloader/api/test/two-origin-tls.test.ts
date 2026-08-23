/**
 * dl-21: the manifest is verified. The video is not.
 *
 * dl-19 put `-tls_verify 1` on every remote input, and it verifies the
 * connection ffmpeg opens to the **manifest**. The HLS and DASH demuxers open
 * their own connections for segments, and libavformat copies only a fixed list
 * of options onto those. The list is a compile-time array in
 * `libavformat/aviobuf.c`'s `ffio_copy_url_options` — `headers`, `user_agent`,
 * `cookies`, `http_proxy`, `referer`, `rw_timeout`, `icy` — and neither
 * `tls_verify` nor `ca_file` is in it. `hls.c`'s `open_url` builds each segment
 * connection's options from that copy plus a couple of per-call keys, so there
 * is no option, prefix or dictionary that puts the TLS settings back; dl-21
 * measured sixteen candidates and read the source. `dashdec.c` calls the same
 * function, so DASH is identical by construction rather than by coincidence.
 *
 * **So this file pins a defect rather than proving a fix.** The download below
 * succeeds while the origin serving the whole video is untrusted, and that is
 * what the tool does today: an attacker on the path lets the verified manifest
 * through untouched, intercepts only the segment connections, and the
 * substituted video is remuxed into the user's file while the job reports
 * success. Closing it needs a mechanism outside the argv — dl-27 is the ticket,
 * and it carries the one that was measured working. **When dl-27 lands, the
 * middle test here goes red, and that is the point of it.**
 *
 * `proxied-https.test.ts` cannot express any of this: it serves the playlist
 * and the segments from **one** origin with **one** certificate, so an
 * untrusted chain kills the run at the manifest — which is exactly what its
 * dl-19 test asserts happens. The two connections have to be able to *disagree
 * about trust* before the difference between them is observable at all. This
 * file is that fixture: origin A serves the playlists, origin B serves the
 * segments, and their certificates are unrelated.
 *
 * Nothing here reaches the network. Both origins are loopback, both
 * certificates are generated per run, and the clip is made by ffmpeg at
 * `beforeAll`. Nothing here turns verification off, either — the "trust both"
 * case is one PEM holding both certificates, because `-ca_file` takes one
 * bundle and replaces the system store.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import { createEngine, resolveFfmpegPath } from "@downloader/engine";
import type { DownloadRequest } from "@downloader/engine";
import { AppError } from "@downloader/contract";
import type { RequestContext } from "@downloader/contract";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { FixtureCertificate, TlsOrigin } from "./helpers/tls-origin.ts";
import {
  assertDecodable,
  createCaBundle,
  createFixtureCertificate,
  generateHlsClip,
  serveHlsFrom,
  splitHlsClip,
  startTlsOrigin,
} from "./helpers/tls-origin.ts";

const FFMPEG = resolveFfmpegPath();
const CLIP_SECONDS = 4;
/** Real ffmpeg, two TLS origins and a generated clip. Not a unit test's budget. */
const SLOW = 120_000;

const CONTEXT: RequestContext = {
  headers: { Referer: "https://player.example/watch/42", "User-Agent": "Mozilla/5.0 (Fixture)" },
};

/** Origin A: the playlists. Kilobytes of text. */
let manifestCertificate: FixtureCertificate;
let manifestOrigin: TlsOrigin;
/** Origin B: the segments. The entire video. Unrelated certificate, unrelated key. */
let segmentCertificate: FixtureCertificate;
let segmentOrigin: TlsOrigin;

let bothCas: { path: string; cleanup(): Promise<void> };
let playlistDir: string;
let segmentDir: string;
let storageDir: string;

beforeAll(async () => {
  // Distinct common names, and it is not cosmetic: a CA bundle is indexed by
  // subject, so two self-signed certificates sharing one collide and the bundle
  // silently trusts only the first. See `createFixtureCertificate`.
  [manifestCertificate, segmentCertificate] = await Promise.all([
    createFixtureCertificate({ ipAddresses: ["127.0.0.1"], commonName: "dl21-manifest-origin" }),
    createFixtureCertificate({ ipAddresses: ["127.0.0.1"], commonName: "dl21-segment-origin" }),
  ]);
  bothCas = await createCaBundle([manifestCertificate, segmentCertificate]);

  playlistDir = await fs.mkdtemp(path.join(os.tmpdir(), "api-two-origin-playlists-"));
  segmentDir = await fs.mkdtemp(path.join(os.tmpdir(), "api-two-origin-segments-"));
  storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "api-two-origin-storage-"));

  await generateHlsClip(FFMPEG, playlistDir, CLIP_SECONDS);

  // B first: the playlist has to name its port. It serves `segmentDir` lazily,
  // so it can be listening before anything has been put in there.
  segmentOrigin = await startTlsOrigin(segmentCertificate, serveHlsFrom(segmentDir));
  await splitHlsClip(playlistDir, segmentDir, `https://127.0.0.1:${segmentOrigin.port}`);
  manifestOrigin = await startTlsOrigin(manifestCertificate, serveHlsFrom(playlistDir));
}, SLOW);

afterAll(async () => {
  await manifestOrigin?.close();
  await segmentOrigin?.close();
  await manifestCertificate?.cleanup();
  await segmentCertificate?.cleanup();
  await bothCas?.cleanup();
  await fs.rm(playlistDir, { recursive: true, force: true });
  await fs.rm(segmentDir, { recursive: true, force: true });
  await fs.rm(storageDir, { recursive: true, force: true });
});

function masterUrl(): string {
  return `https://127.0.0.1:${manifestOrigin.port}/master.m3u8`;
}

/** The production engine, verifying, trusting exactly the bundle it is given. */
async function startEngine(caFile: string): Promise<ReturnType<typeof createEngine>> {
  const engine = createEngine({
    storageDir,
    maxFileSizeBytes: 256 * 1024 * 1024,
    tlsCaFile: caFile,
  });
  await engine.init();
  return engine;
}

function downloadRequest(jobId: string): DownloadRequest {
  return {
    jobId,
    variant: {
      id: "v0",
      protocol: "hls",
      url: masterUrl(),
      hasVideo: true,
      hasAudio: true,
      videoCodec: "avc1.42c01e",
      audioCodec: "mp4a.40.2",
      width: 320,
      height: 240,
      durationSec: CLIP_SECONDS,
      label: "240p",
    },
    requestContext: CONTEXT,
    title: "segments on a second origin",
    durationSec: CLIP_SECONDS,
  };
}

async function attempt(jobId: string, caFile: string): Promise<AppError | null> {
  const engine = await startEngine(caFile);
  return engine.download(downloadRequest(jobId)).then(
    () => null,
    (error: unknown) => AppError.from(error),
  );
}

/** A verified TLS handshake against one origin, using one CA. */
function handshake(port: number, ca: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: "127.0.0.1",
      port,
      ca,
      // An IP has no SNI (RFC 6066), and the fixture certificate carries the
      // address in `subjectAltName` instead. Node matches on that.
      rejectUnauthorized: true,
    });
    socket.once("secureConnect", () => {
      socket.destroy();
      resolve();
    });
    socket.once("error", (error) => {
      socket.destroy();
      reject(error);
    });
  });
}

describe("the fixture itself, before anything is claimed about ffmpeg", () => {
  test("the two origins really do disagree about trust", async () => {
    // Without this, everything below is indistinguishable from a misconfigured
    // fixture: a fixture that trusted both origins by accident would produce
    // the same green run as one that measured nothing. This is the in-suite
    // form of dl-21's first control, which `openssl s_client -connect B
    // -CAfile a.crt` answers with `verify error:num=18:self-signed certificate`.
    await expect(handshake(manifestOrigin.port, manifestCertificate.ca)).resolves.toBeUndefined();
    await expect(handshake(segmentOrigin.port, segmentCertificate.ca)).resolves.toBeUndefined();
    await expect(handshake(segmentOrigin.port, manifestCertificate.ca)).rejects.toThrow();
    await expect(handshake(manifestOrigin.port, segmentCertificate.ca)).rejects.toThrow();
  });

  test("the playlist really does point off-origin", async () => {
    const playlist = await fs.readFile(path.join(playlistDir, "index.m3u8"), "utf8");
    const segments = playlist.split("\n").filter((line) => line.endsWith(".ts"));
    expect(segments.length).toBeGreaterThan(1);
    expect(
      segments.every((line) => line.startsWith(`https://127.0.0.1:${segmentOrigin.port}/`)),
    ).toBe(true);
  });

  test("the both-CAs bundle really holds both, and both origins verify against it", async () => {
    // `createCaBundle` needs its own proof, because **the download that uses it
    // cannot give one today**. A mutation run made the point: drop the second
    // certificate from the bundle and the "both CAs" download below still
    // passes — trusting origin A alone is already enough, since the segment
    // connections are not verified at all. So the bundle is checked here, where
    // the assertion is about the file rather than about ffmpeg, and dl-27
    // inherits a helper that was actually tested.
    const bundle = await fs.readFile(bothCas.path, "utf8");
    expect(bundle.match(/-----BEGIN CERTIFICATE-----/gu)).toHaveLength(2);
    // And it is a usable trust store for each of them, not merely two PEMs
    // concatenated into something no TLS stack will parse.
    await expect(handshake(manifestOrigin.port, bundle)).resolves.toBeUndefined();
    await expect(handshake(segmentOrigin.port, bundle)).resolves.toBeUndefined();
  });
});

describe("how far dl-19's verification actually reaches", () => {
  test(
    "the manifest connection IS verified: trusting only the segment origin fails it",
    async () => {
      // The control that keeps the next test honest. Same fixture, same argv,
      // one PEM different — and here `-tls_verify 1` bites, at the very first
      // connection, before a byte of playlist is served. So when the next test
      // downloads the whole video over an untrusted segment origin, that is not
      // verification being off somewhere.
      const before = manifestOrigin.requests.length;
      const failure = await attempt("manifest-untrusted", segmentCertificate.caPath);

      expect(failure?.code).toBe("TLS_VERIFICATION_FAILED");
      expect(failure?.retryable).toBe(false);
      expect(String(failure?.details?.["stderr"] ?? "")).toMatch(/certificate/iu);
      // It failed at the handshake: nothing was served.
      expect(manifestOrigin.requests.length).toBe(before);
    },
    SLOW,
  );

  test(
    "the segment connections are NOT: the whole video arrives from an untrusted origin",
    async () => {
      // **This is the defect, pinned.** ffmpeg is given `-tls_verify 1` and a CA
      // that covers A and not B, verifies A, and then fetches every segment of
      // the video from B over a certificate it never checks. Exit 0, playable
      // file, job reports success.
      //
      // The assertions are deliberately on what happens rather than on what
      // should: the download succeeding here is the security hole, and dl-27 is
      // the ticket that closes it. When it does, this test turns red on the first
      // line and the next reader is told where to look — which is the only thing
      // a characterization test is for.
      const before = segmentOrigin.requests.length;
      const engine = await startEngine(manifestCertificate.caPath);

      const outcome = await engine.download(downloadRequest("segments-untrusted"));

      expect(outcome.sizeBytes).toBeGreaterThan(10_000);
      await assertDecodable(FFMPEG, outcome.path);
      // And the bytes really are B's: a download that had somehow stopped at the
      // playlist would have produced no file at all.
      const served = segmentOrigin.requests.slice(before);
      expect(served.filter((request) => request.url.endsWith(".ts")).length).toBeGreaterThan(1);
    },
    SLOW,
  );

  test(
    "the same download succeeds when both CAs are in one bundle",
    async () => {
      // What the fix is supposed to look like from the outside, and today the
      // proof that the fixture is a working HLS download rather than a broken
      // one. One PEM with both certificates in it: `-ca_file` takes one bundle
      // and replaces the system store, so this is the only way to trust two
      // origins without turning verification off.
      const before = segmentOrigin.requests.length;
      const engine = await startEngine(bothCas.path);

      const outcome = await engine.download(downloadRequest("both-trusted"));

      expect(outcome.sizeBytes).toBeGreaterThan(10_000);
      await assertDecodable(FFMPEG, outcome.path);
      const served = segmentOrigin.requests.slice(before);
      expect(served.filter((request) => request.url.endsWith(".ts")).length).toBeGreaterThan(1);
    },
    SLOW,
  );
});
