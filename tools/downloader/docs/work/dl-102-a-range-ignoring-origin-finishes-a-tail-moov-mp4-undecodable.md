---
id: dl-102
tool: downloader
title: A Range-ignoring origin turns a tail-moov progressive MP4 into an undecodable file reported as success
kind: fix
status: needs-decision
milestone: null
depends_on: []
difficulty: standard
---

# dl-102 — A Range-ignoring origin turns a tail-moov progressive MP4 into an undecodable file reported as success

## Why

Found on 2026-10-08 by dl-99's builder, on `main`'s engine code with ffmpeg
alone and none of dl-99's code. The owner decided on 2026-10-08 to file it
rather than fix it in that batch.

`engine/src/stream.ts` sends a progressive source to ffmpeg **as a URL**, and
its header says why: a tail-`moov` MP4 cannot be demuxed from a pipe, so ffmpeg
has to seek, and it seeks with `Range` (measured there on 2026-09-27: piped, it
logs `partial file`, exits 0 and writes 1,293 bytes). That design assumes the
origin honours `Range`. **An origin that answers every request with `200` and
the whole body brings the same failure back**, and a progressive MP4 with its
`moov` at the end is what ffmpeg itself writes without `+faststart`, so the
shape is ordinary.

### Reproduction

The harness is below, self-contained: it generates the MP4, serves it twice
(an origin that honours `Range` with a `206`, and one that always answers `200`
with the whole body) and runs it two ways. Run it from the repo root after
`npm run build`:

```
FFMPEG=$(node -p 'require("ffmpeg-static")') ENGINE=$PWD/tools/downloader/engine/dist/index.js node <the file below>
```

<details>
<summary>range-ignored.mjs</summary>

```js
import { execFileSync, spawn, spawnSync } from "node:child_process";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";

const { FFMPEG, ENGINE } = process.env;
const file = join(tmpdir(), "dl102-tail.mp4");
// ffmpeg writes `moov` last unless asked for +faststart.
execFileSync(FFMPEG, [
  "-v",
  "error",
  "-y",
  "-f",
  "lavfi",
  "-i",
  "testsrc2=d=4:s=640x480:r=25",
  "-f",
  "lavfi",
  "-i",
  "sine=d=4",
  "-c:v",
  "libx264",
  "-b:v",
  "2M",
  "-minrate",
  "2M",
  "-maxrate",
  "2M",
  "-bufsize",
  "2M",
  "-c:a",
  "aac",
  "-shortest",
  file,
]);
const body = readFileSync(file);

const serve = (honourRange) =>
  http.createServer((req, res) => {
    const m = /^bytes=(\d+)-(\d*)$/u.exec(req.headers.range ?? "");
    if (honourRange && m) {
      const start = Number(m[1]);
      const end = m[2] === "" ? body.length - 1 : Math.min(Number(m[2]), body.length - 1);
      res
        .writeHead(206, {
          "content-type": "video/mp4",
          "accept-ranges": "bytes",
          "content-length": end - start + 1,
          "content-range": `bytes ${start}-${end}/${body.length}`,
        })
        .end(body.subarray(start, end + 1));
    } else {
      // The whole file with a 200, whatever was asked. This is the defect's origin.
      res.writeHead(200, { "content-type": "video/mp4", "content-length": body.length }).end(body);
    }
  });

async function withOrigin(honourRange, run) {
  const server = serve(honourRange);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    return await run(`http://127.0.0.1:${server.address().port}/a.mp4`);
  } finally {
    server.close();
  }
}

// 1. ffmpeg alone, with the engine's output arguments (mux.ts) and none of its input arguments.
const ffmpegOnly = (url) =>
  new Promise((resolve) => {
    const c = spawn(
      FFMPEG,
      [
        "-hide_banner",
        "-nostdin",
        "-loglevel",
        "error",
        "-i",
        url,
        "-map",
        "0:v:0?",
        "-map",
        "0:a:0?",
        "-c",
        "copy",
        "-movflags",
        "frag_keyframe+empty_moov+default_base_moof",
        "-frag_duration",
        "1000000",
        "-f",
        "mp4",
        "pipe:1",
      ],
      { shell: false },
    );
    let bytes = 0;
    let err = "";
    c.stdout.on("data", (d) => (bytes += d.length));
    c.stderr.on("data", (d) => (err += d));
    c.once("close", (code) =>
      resolve({
        bytes,
        code,
        stderr: err.split("\n").filter((l) => /partial file|Stream ends/u.test(l)),
      }),
    );
  });

// 2. The built engine, end to end: what the visitor and the job row would get.
const viaEngine = async (url) => {
  const { createEngine } = await import(ENGINE);
  const media = await createEngine({ maxFileSizeBytes: 256 * 1024 * 1024 }).stream({
    jobId: "dl-102",
    requestContext: { headers: {} },
    variant: { id: "p", protocol: "progressive", url, hasVideo: true, durationSec: 4, label: "p" },
  });
  const chunks = [];
  media.body.on("data", (d) => chunks.push(d));
  const done = await media.done.then(
    (o) => ({ resolved: o.bytes }),
    (e) => ({ rejected: e.code }),
  );
  const out = join(tmpdir(), "dl102-out.mp4");
  writeFileSync(out, Buffer.concat(chunks));
  // Frames that actually decode from what the visitor received.
  const probe = spawnSync(
    FFMPEG,
    ["-v", "error", "-i", out, "-map", "0:v:0", "-f", "null", "-progress", "pipe:1", "-"],
    { encoding: "utf8" },
  );
  const frames = [...probe.stdout.matchAll(/frame=(\d+)/gu)].map((m) => Number(m[1])).pop() ?? 0;
  return {
    bytes: Buffer.concat(chunks).length,
    done,
    decodedFrames: frames,
    decodeExit: probe.status,
  };
};

console.log("source bytes", body.length);
for (const [label, run] of [
  ["ffmpeg alone", ffmpegOnly],
  ["engine.stream()", viaEngine],
]) {
  console.log(label, "| honours Range:", JSON.stringify(await withOrigin(true, run)));
  console.log(label, "| ignores Range:", JSON.stringify(await withOrigin(false, run)));
}
```

</details>

Measured on `origin/main` at `1101aff8`, ffmpeg-static (6.1.1), 2026-10-08:

```
source bytes 1021968
ffmpeg alone | honours Range: {"bytes":1021329,"code":0,"stderr":[]}
ffmpeg alone | ignores Range: {"bytes":1300,"code":0,"stderr":["[mov,mp4,m4a,3gp,3g2,mj2 @ 0x79dcfc0] stream 0, offset 0x30: partial file","[http @ 0x79dd800] Stream ends prematurely at 48, should be 1021968"]}
engine.stream() | honours Range: {"bytes":1021330,"done":{"resolved":1021330},"decodedFrames":100,"decodeExit":0}
engine.stream() | ignores Range: {"bytes":37615,"done":{"resolved":37615},"decodedFrames":0,"decodeExit":183}
```

Two findings, and the second is not what the dl-99 builder's run showed:

1. **ffmpeg alone** (the engine's output arguments, none of its input
   arguments), which is the dl-99 builder's run: 1,300 bytes, exit 0, `partial
file`. The same script on dl-99's 103,485-byte `tail.mp4` printed 1,292 bytes,
   exit 0 and `Stream ends prematurely at 48, should be 103485`. An empty file
   reported as success.
2. **Through the engine** the result is different and `dl-53`'s own check does
   not catch it. The engine adds `-reconnect` and its siblings
   (`engine/src/ffmpeg/args.ts`), so ffmpeg writes `Stream ends prematurely at
48` and then `Will reconnect at 48 in 0 second(s)`, from the same
   connection. `STREAM_ENDED_EARLY` is cleared by a `WILL_RECONNECT` on the same
   connection (that is `stream.ts`'s rule for a progressive body that heals), so
   the exit-time check finds nothing pending. What the visitor receives is a
   clean `200`, **37,615 bytes of which 0 of 100 frames decode** (`ffmpeg`
   exits 183, "Invalid data"), and `done` resolves with `bytes: 37615`. On
   dl-99's `tail.mp4` it is 37,607 bytes, the same 0 of 100 frames, and the log
   carries about a hundred `Invalid NAL unit size` and `missing picture`
   lines. `durationSec` comes back as `3.993832` for the garbage as well as for
   the good file, so a duration check (dl-53's rejected option B) would not
   catch it either. **Why** the reconnect reads garbage is not measured here.

Bounds, each measured on the same harness or on dl-99's fixtures:

- **A fast-start MP4 (`moov` before `mdat`) is not affected.** dl-99's
  `h264.mp4` (boxes `ftyp,moov,free,mdat`) came out 103,116 bytes and
  `done` resolved from the Range-ignoring origin, the same as from the honouring
  one. Only a source whose index is at the end needs the seek.
- **A small file is not affected.** A 59,622-byte tail-`moov` MP4 (320x240,
  4 s) came out 58,936 bytes from the Range-ignoring origin, the same as from
  the honouring one; at 103,485 bytes (dl-99's `tail.mp4`) and 1,021,968 bytes
  the failure appears. The threshold between them was not found. A test
  fixture below it cannot fail, so the Build section's first step is a fixture
  that does.
- **An HLS or DASH source is not affected.** They are fetched sequentially, and
  this ticket reads only the progressive path.

### Context, linked and not re-derived

- `engine/src/stream.ts`, the header comment "Why progressive sources go to
  ffmpeg as a URL too": the 2026-09-27 measurement, and the reason the design
  depends on `Range`.
- [dl-53](./dl-53-finished-files-and-the-tunnel.md), its Log on silent truncation:
  `partial file` and `Stream ends prematurely` are not matched by
  `SEGMENT_SKIPPED`, and `Stream ends prematurely` was refused as a signal on
  its own because a progressive body that is cut and then resumed on reconnect
  logs it too. The reconnect is what lets this case through.
- [dl-64](./dl-64-bare-progressive-rows-show-nothing.md) (done), its Log:
  `createFetchSizeProbe` reads a ranged window, accepts a `200` only for a range
  starting at zero and refuses one for a later range, because that body is the
  file from byte 0. It is the probe-time form of the same fact.

### dl-99 does not change this ticket's scope

Checked on 2026-10-08 against `dl-99-webm-undeclared-codecs` (PR #394, head
`0b6f6bf8`), by reading its diff, not by running it:

- dl-99's header read is `describeProgressiveTracks` over
  `createFetchSizeProbe`, run in the resolver wrapper at **probe time**. For a
  tail-`moov` file it needs a ranged read from the tail (a non-zero start), which
  a Range-ignoring origin answers with `200`, and `size-probe.ts` returns
  `undefined` for that (its own comment says so). The codecs stay undeclared and
  the failure is swallowed, with a debug log.
- What the undeclared codecs then change is the **WebM** request only:
  `assertContainerCanHold` in `mux.ts` throws `CONTAINER_UNSUPPORTED` when the
  container is `webm` and `canMakeWebm` is false. An MP4 or MKV request, which
  is the default, is untouched: the variant, the ffmpeg arguments and the
  input handling are the same as on `main`, so the defect above is reached
  exactly as before.
- So dl-99 refuses WebM for a Range-ignoring tail-`moov` source whose header it
  could not read. It does not make MP4 or MKV safe, and it does not carry the
  "this origin ignored Range" fact forward: `describingProgressiveTracks` drops
  it after the debug line. That is a possible input to the Build options below,
  not a fix.

## Build

**There is a decision here, and it is the owner's.** Do not pick one in the
building session.

Reproduce first, as a stream test in `engine/test/stream.test.ts`, appended at
the end (a block inserted mid-file moves other tickets' recorded line
citations). Serve a tail-`moov` MP4 **larger than the threshold above** from an
origin that answers every request with a `200` and the whole body. Keep the
suite's honouring origin as the control. Take the fixture's size and the
expected outcome from the owner's answer, and record the red run in the Log
before changing source.

What the fix must settle, as options with their real costs:

- **A. Detect it and fail with a typed error before the first byte.** Before
  starting ffmpeg for a progressive source, ask the origin for a one-byte range
  and see whether it answers `206`; if it answers `200`, fail. Cost: one more
  request per progressive stream, through the same egress proxy and the same
  replayed headers. It refuses a fast-start file that would have worked, unless
  the check also learns where `moov` is (a read of the first bytes, which needs
  no `Range`, then `ftyp` followed by `moov` or by `mdat`); that is more code,
  and a wrong sniff refuses a good file. Which code is the open part:
  `DOWNLOAD_FAILED` is what a mid-stream loss uses today, and no existing code
  says "this origin cannot be seeked". A new one is a contract change, so the
  owner decides it; it is not invented in the build.
- **B. Fetch the whole file first, then remux it.** When `Range` is not
  honoured and the index is at the end, read the body to a bounded buffer or a
  temporary file and hand ffmpeg that. It turns a refusal into a download.
  Cost: **it breaks the rule in the header of `stream.ts`**, that nothing is
  written to disk and the owner's reason (2026-09-14) is that no copy of a video
  is kept. A bounded in-memory buffer keeps the rule and costs RAM per
  concurrent job up to `maxFileSizeBytes`, whose default is 4096 MB
  (`ENGINE_DEFAULTS.maxFileSizeMb`), so a buffer needs its own, smaller bound.
  Time to first byte becomes the whole download. Needs the owner's
  decision on both the rule and the bound.
- **C. Detect it after the fact, from ffmpeg's own words.** Treat `partial file`
  (from the mov demuxer), or a `Stream ends prematurely` whose reconnect then
  fails to find the index, as a loss. Cost: not measured. `partial file` appears
  in this reproduction's log and in dl-53's cut-body cases; whether it also
  appears on a source that heals on reconnect (which would make it a false
  positive, the reason dl-53 refused `Stream ends prematurely`) was not
  checked here, and the first bytes may already have gone to the visitor by the
  time the line is written, which makes it a cut connection rather than a
  refusal. Unmeasured: when the line arrives relative to the first output byte.
- **D. Carry the probe-time fact forward.** The size probe already knows when an
  origin answers a later range with a `200` (see the dl-64 link above) and dl-99
  drops it. A variant could carry it and the stream could refuse, or choose B,
  on it. Cost: a field on `MediaVariant`, which is `@downloader/contract` and
  is not edited without the owner; it covers only tiers that run the probe; and
  an origin can answer a probe differently from the ffmpeg request that follows
  (a different path, headers, a signed URL), so it is a hint and not a check.
- **E. Accept and document it.** Only if the owner judges the shape too rare.
  The cost is the current behaviour: a visitor gets a successful download that
  does not play, with nothing in the job row that says so. Dl-53's own gate
  called the silent equivalent for HLS a `high` finding.

Whichever is chosen: the `stream.ts` header's "Why progressive sources go to
ffmpeg as a URL too" has to say what happens when the origin does not honour
`Range`.

## Done when

1. A test in `engine/test/stream.test.ts` (new, last in the file) serves a
   tail-`moov` MP4 above the threshold from an origin that ignores `Range`, and
   it **fails on `main`** with the outcome in the Log: `done` resolves with a
   file whose `ffprobe`/`ffmpeg` decode yields 0 of its frames.
2. After the chosen fix, that test asserts the owner's outcome: a typed
   `AppError` with the owner's code, before the first byte (A); or a received
   file with the control's frame count, within the suite's `TOLERANCE_SEC` of
   the control's duration (B); or the cut connection and `done` rejecting
   (C and D). In no case does `done` resolve with a file that decodes 0 frames.
3. Two controls pass in the same file: the existing honouring-origin
   tail-`moov` case still completes whole, and a **fast-start** MP4 from the
   Range-ignoring origin still completes whole (today it does, so a fix that
   refuses every Range-ignoring origin fails this one).
4. The job row for the Range-ignoring case, in `api/test`, is `failed` with
   the chosen code, or `completed` with a decodable file; never `completed`
   with an undecodable one.
5. The `stream.ts` header states the Range-ignoring behaviour, and this ticket's
   Log names the option taken, the owner's answer and the date.
6. `npm test -- --project downloader` and `npm run check` pass.

## Log

**2026-10-08** — filed by the builder for the dl-99 batch, on the owner's
decision of the same day to file the defect as its own ticket and fix nothing
in that batch. No source changed. `needs-decision`, because the Build section's
options are the owner's to choose from.

**2026-10-08** — reproduced before filing, on `origin/main` at `1101aff8`.

The dl-99 builder's script, run unchanged against dl-99's fixture:

```
node …/scratchpad/dl-99/build/norange.mjs …/dl-99/gate-1/media/tail.mp4
source bytes 103485
origin honours Range: { bytes: 103115, code: 0, stderr: '' }
origin ignores Range: {
  bytes: 1292,
  code: 0,
  stderr: '[mov,mp4,m4a,3gp,3g2,mj2 @ 0x6952fc0] stream 1, offset 0x30: partial file\n' +
    '[http @ 0x6953800] Stream ends prematurely at 48, should be 103485\n' +
    '    Last message repeated 1 times\n' + …
}
```

The same file through `engine.stream()` (the built `engine/dist`, the default
container, no options): `bytes: 37607`, `done` resolved `{ bytes: 37607,
durationSec: 3.993832 }`, the body ended cleanly. Decoding that output with
ffmpeg: exit 183, 0 decoded frames; the honouring origin's output decoded 100
of 100 and exited 0. The log lines, in order, for the Range-ignoring run:
`partial file`, `Could not find codec parameters for stream 0`,
`Stream ends prematurely at 48, should be 103485`, `Will reconnect at 48 in 0
second(s)`, then about a hundred `Invalid NAL unit size` and
`missing picture in access unit`.

**The brief had the failure wrong in one respect:** it described the output as
a ~1.3 KB file. That is ffmpeg alone. Through the engine the file is larger and
worse, because the engine's reconnect flags let ffmpeg carry on reading a body
that is not the continuation it asked for, and `STREAM_ENDED_EARLY` is cleared
by the reconnect. The harness in Why runs both so the next reader sees both.

**2026-10-08** — the dl-99 question, checked rather than guessed: see "dl-99 does
not change this ticket's scope" in Why. In one line, dl-99's header read is a
probe-time ranged read that fails against such an origin and leaves the codecs
undeclared; the only consequence is that WebM is refused, and MP4 and MKV
requests reach the defect unchanged. Not run: dl-99's branch was read, not built.
