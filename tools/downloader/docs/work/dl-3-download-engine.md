---
id: dl-3
tool: downloader
title: Download engine — ffmpeg, HLS/DASH/progressive, mux, storage
kind: work-package
status: done
milestone: M1
depends_on: []
---

# dl-3 — Download engine

**Package:** `tools/downloader/engine` · **Was:** WP-3 · **Ran parallel with:**
[dl-1](./dl-1-resolver-registry-and-parsers.md),
[dl-2](./dl-2-browser-sniffer.md), [dl-4](./dl-4-web-ui.md)

## Why

`ProbeResult` → a file on disk. This is the half of the pipeline that proves the
captured headers are worth capturing: a segment fetched without the `Referer`
the resolver saw is a 403, so header replay is the vertical slice worth building
first (M1).

## Build

1. `ffmpeg/runner.ts` — spawn bundled `ffmpeg-static` (override via
   `FFMPEG_PATH`) with an argument array. Pass captured headers via `-headers`
   (CRLF-joined). Use `-progress pipe:1 -nostats` and parse the `key=value`
   stream (`out_time_us`, `total_size`, `speed`) into `JobProgress`. Kill the
   **whole process tree** on abort — on Windows, `taskkill /T /F`; a bare
   `child.kill()` leaves orphans.

2. `download/progressive.ts` — ranged GET, resumable, retry with exponential
   backoff and jitter, honour `Retry-After`.

3. `download/hls.ts` and `download/dash.ts` — prefer handing the manifest
   straight to ffmpeg (it handles AES-128, discontinuities and timestamps
   correctly). Fall back to manual segment fetching with a bounded concurrency
   pool only when ffmpeg cannot replay the required headers.

4. `mux.ts` — join separate audio/video with explicit `-map`, embed subtitles as
   soft tracks, apply `-c copy` **always** plus `-bsf:a aac_adtstoasc` for
   TS→MP4 and `-movflags +faststart`. Transcode only when the container
   genuinely cannot hold the codec, and log loudly when you do.

5. `storage.ts` — `tmp/<jobId>/` for working files, `out/<jobId>/` for results,
   sanitised filenames confined to `STORAGE_DIR` (resolve and verify the final
   path is inside it — reject anything that escapes). Cleanup on every terminal
   state. Retention GC by age.

6. `estimate.ts` — size from bitrate × duration, so `SIZE_LIMIT_EXCEEDED` is
   raised **before** a four-hour 4K download starts, not after.

## Done when

**(M1)** A CLI script downloads a real HLS URL with replayed headers to a
playable, seekable, fast-start MP4.

## Log

Shipped in `ca35a55`. M1 is proven by
`tools/downloader/engine/test/hls-e2e.test.ts`.

Path confinement (5) and retention GC turned out to satisfy two of
[dl-6](./dl-6-security-and-limits.md)'s items outright — they were already done
here and in dl-5 by the time that ticket was picked up.

`ffmpeg-static` hands out a confident path inside `node_modules` whether or not
its postinstall download ran, which is why
[dl-7](./dl-7-ops-and-e2e.md) made `/api/health` **stat** the binary rather than
trust the path. On Linux CI the static build dies of `SIGSEGV` against a newer
glibc, so both CI and the image point `FFMPEG_PATH` at the distribution's
ffmpeg.
