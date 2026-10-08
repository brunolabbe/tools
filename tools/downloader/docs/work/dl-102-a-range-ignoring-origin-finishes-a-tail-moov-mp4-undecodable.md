---
id: dl-102
tool: downloader
title: A Range-ignoring origin turns a tail-moov progressive MP4 into an undecodable file reported as success
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: hard
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
  could not read. It does not make MP4 or MKV safe, and it never has the "this
  origin ignored Range" fact to carry forward: the fact is lost earlier, inside
  `createFetchSizeProbe().bytes()` in `resolvers/src/size-probe.ts`, which
  returns the same `undefined` for a `200` to a read starting past zero as for
  every other failure (a `206` for the wrong range, a status that is neither, a
  range over `maxRangeBytes`, a thrown fetch). dl-99's debug line says only that
  the codecs are still undeclared. Read on `origin/main` at `1101aff8` by gate 1
  and again by the fixer: the `else` branch and the `catch` of `bytes()` both
  `return undefined`. Making the fact available is a change to that return type,
  which is option D's cost below, not something dl-99 already does and discards.

## Decisions

Taken by the owner on 2026-10-08, in two questions.

1. **Which fix the ticket carries: option A.**
   - Question: a tail-`moov` MP4 (over roughly 64 to 91 KB) from an origin that
     ignores `Range` finishes as a clean `200` that does not play, 0 of 100
     frames decoding. Which fix should the ticket carry?
   - Options put: A, probe `Range` before the stream (the filing builder's
     suggestion; the gate recommended nothing); C, detect it from ffmpeg's
     stderr; B, buffer the whole file and then remux; decide later (D and E
     remained available).
   - **Chosen: A.**
2. **Which error the visitor gets: a new, non-retryable code.**
   - Question: option A refuses a tail-`moov` MP4 from a Range-ignoring origin
     before the first byte. Which error should the visitor get?
   - Options put: a new code, non-retryable (a downloader contract code meaning
     "this origin cannot be seeked and the file's index is at the end", name
     chosen in the build, UI copy saying the source cannot be streamed),
     recommended; or reuse `DOWNLOAD_FAILED`.
   - **Chosen: a new code, non-retryable.** The addition to
     `@downloader/contract` is pre-authorised by this answer, and the build
     names the code.

Considered and not taken, kept below so the next reader does not reopen them
without the cost: B, C, D and E, each under "Options not taken". Reusing
`DOWNLOAD_FAILED` was also considered and not taken (it is in `RETRYABLE_CODES`
today).

## Build

Option A, with the owner's code. Three things are the build's to settle, each
with its cost named here so the choice is made knowingly.

**Reproduce first**, as a stream test in `engine/test/stream.test.ts`, appended
at the end (a block inserted mid-file moves other tickets' recorded line
citations). Serve a tail-`moov` MP4 **larger than the threshold** (between
63,749 B, which decodes, and 91,053 B, which does not; take a source of at least
91,053 B so the test can fail) from an origin that answers every request with a
`200` and the whole body. Keep the suite's honouring origin as the control.
Record the red run in the Log before changing source.

**The behaviour.** Before starting ffmpeg for a progressive source, decide
whether the origin will let ffmpeg seek to the index, and if it will not and the
index is at the end, throw a typed `AppError` from `stream()` before the first
byte. The probe asks for a one-byte range and reads whether the answer is `206`.
A `200` alone must not refuse, or a fast-start file that works today would
fail, which Done when 3 guards.

1. **Where the index is.** A `200` is a refusal only when `moov` is at the
   end. Read the first bytes of the file, which needs no `Range`, and **walk
   the top-level boxes** until `moov` or `mdat` is reached; do not test what
   follows `ftyp`. Gate 1 measured ffmpeg 6.1.1's tail-`moov` layout as
   `ftyp,free,mdat,moov` (gate 2: 6 of 6 sources, 50,241 B to 1,026,770 B),
   while dl-99's fast-start `h264.mp4` is `ftyp,moov,free,mdat`, so `free` can
   sit between `ftyp` and either. `readMp4Tracks` in
   `resolvers/src/mp4-header.ts` already walks boxes and `bytes()` accepts a
   `200` for a read from byte 0, so a walk works against this origin. Cost: more
   code, and a wrong walk refuses a good file.
2. **Where the probe lives.** `engine/src` has no HTTP client (the
   `createEngine` notes in `engine/src/index.ts` say the engine does not
   enforce SSRF and relies on the guarded egress proxy). Either the engine gets
   new code that goes through `proxyUrl` with the same `tlsCaFile`, or the
   probe moves to the api before `stream()`. Cost: new engine HTTP code and a
   second place that must be SSRF-checked, or an api-side check that the
   engine's own callers can bypass.
3. **Every candidate.** The engine opens `variant.alternateUrls` on a
   failover, so the probe repeats for each candidate, and the cost is one more
   request per progressive stream per candidate, through the same egress proxy
   and the same replayed headers.

**The code.** Add a new non-retryable code to `@downloader/contract`, named in
the build: in the `ERROR_CODES` list in `contract/src/errors.ts`, with a
message in `DEFAULT_ERROR_MESSAGES` (the catalog's `satisfies` makes a missing
message a compile error), and not in `RETRYABLE_CODES`. The visitor's copy
says the source cannot be streamed. Check `contract/src/api.ts`'s code
mapping and the web's error copy for the places that list codes. A code in the
contract is a contract change, and the owner's answer of 2026-10-08 authorises
it.

The `stream.ts` header's "Why progressive sources go to ffmpeg as a URL too"
has to say what happens when the origin does not honour `Range`.

### Options not taken

Each is considered and not taken on 2026-10-08; kept with its cost.

- **B. Fetch the whole file first, then remux it.** When `Range` is not
  honoured and the index is at the end, read the body to a bounded buffer or a
  temporary file and hand ffmpeg that. It turns a refusal into a download.
  Cost: **it breaks the rule in the header of `stream.ts`**, that nothing is
  written to disk and the owner's reason (2026-09-14) is that no copy of a video
  is kept. A bounded in-memory buffer keeps the letter of the rule (nothing
  touches a disk); whether it keeps its reason, "no copy of one should be kept
  anywhere" in the `stream.ts` header, is the owner's call, since a whole-file
  copy in RAM is arguably such a copy. It costs RAM per concurrent job up to
  `maxFileSizeBytes`, whose default is 4096 MB (`ENGINE_DEFAULTS.maxFileSizeMb`),
  so a buffer needs its own, smaller bound. Time to first byte becomes the whole
  download.
- **C. Detect it after the fact, from ffmpeg's own words.** Treat `partial file`
  (from the mov demuxer), or a `Stream ends prematurely` whose reconnect then
  fails to find the index, as a loss. Cost: partly measured, by gate 1 on
  2026-10-08. `partial file` appears in this reproduction's log and in dl-53's
  cut-body cases. (a) A progressive body that is cut and then healed does not
  log it: dl-53's Log says so for its healing control, and gate 1's run that cut
  a roughly 1 MB tail-`moov` file at 50% and let ffmpeg reconnect logged only
  `Stream ends prematurely` and `Will reconnect`, and decoded 100 of 100. So it
  was not a false positive in the one healing case run. (b) In 5 of 5 runs
  `partial file` reached the engine's `onStderrLine` before `stream()` resolved,
  that is before the first byte reached the reader. stdout and stderr are
  separate pipes, so that is observed order, not a guarantee; if it held, C
  could refuse before the first byte rather than cut a connection (a typed error
  before the first byte when `partial file` arrives first, otherwise the cut
  connection and `done` rejecting). Not measured: other ffmpeg versions, and a
  healing case that is cut inside the `moov` itself.
- **D. Carry the probe-time fact forward.** The size probe sees an origin
  answer a later range with a `200` (see the dl-64 link above) but does not
  report it: `createFetchSizeProbe().bytes()` returns `undefined` for that, the
  same as for every other failure, so nothing downstream, dl-99 included, has
  the fact. A variant could carry it once it is reported, and the stream could
  refuse, or choose B, on it. Cost: a field on `MediaVariant`, which is
  `@downloader/contract`; **and a change to `@downloader/resolvers`**, where
  `bytes()`'s return type (`RangedBytes | undefined`, on `SizeProbe` in
  `size-sample.ts`) must grow a way to say "the origin ignored Range" and that
  has to be threaded through `readMp4Tracks` and `describeProgressiveTracks` in
  `mp4-header.ts` and the callers that set the field: on `main` the only caller
  of `describeProgressiveTracks` is `YtDlpResolver` in
  `resolvers/src/resolvers/ytdlp.ts`, and dl-99's resolver wrapper (unmerged
  when this was written) is a second once it lands. It covers only tiers that
  run the probe; and an origin can answer a probe differently from the ffmpeg
  request that follows (a different path, headers, a signed URL), so it is a hint
  and not a check.
- **E. Accept and document it.** Only if the owner judges the shape too rare.
  The cost is the current behaviour: a visitor gets a successful download that
  does not play, with nothing in the job row that says so. Dl-53's own gate
  called the silent equivalent for HLS a `high` finding.

## Done when

1. A test in `engine/test/stream.test.ts` (new, last in the file) serves a
   tail-`moov` MP4 of at least 91,053 B from an origin that ignores `Range`,
   and it **fails on `main`** with the outcome in the Log: `done` resolves with
   a file whose `ffprobe`/`ffmpeg` decode yields 0 of its frames.
2. After the fix, that test asserts a typed `AppError` with the new code,
   thrown from `stream()` before the first byte. The code is not retryable
   (`RETRYABLE_CODES` does not hold it) and has a message in
   `DEFAULT_ERROR_MESSAGES`. Wherever the probe gets an answer, `done` never
   resolves with a file that decodes 0 frames; where it gets none, ffmpeg runs,
   and the paths that still end in such a file are listed in the Log and
   carried by dl-103. (Scoped by the owner's decision of 2026-10-08, recorded
   in the Log; it read "In no case does `done` resolve with a file that decodes
   0 frames.")
3. Two controls pass in the same file: the existing honouring-origin
   tail-`moov` case still completes whole, and a **fast-start** MP4 from the
   Range-ignoring origin still completes whole (today it does, so a fix that
   refuses every Range-ignoring origin fails this one). A tail-`moov` file
   whose layout is `ftyp,free,mdat,moov` is among the refused cases, so a sniff
   that tests only what follows `ftyp` fails it.
4. The job row for the Range-ignoring case, in `api/test`, is `failed` with
   the new code and its message; never `completed` with an undecodable file.
5. The `stream.ts` header states the Range-ignoring behaviour, and this ticket's
   Log names the code, where the probe lives, and how `alternateUrls` is
   handled.
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
worse, because `STREAM_ENDED_EARLY` is cleared by the reconnect (that part is
read from `stream.ts` and confirmed by the stderr). The builder's account of
why the reconnected body reads as garbage ("the engine's reconnect flags let
ffmpeg carry on reading a body that is not the continuation it asked for") is
**not supported by the origin's request log**, which gate 1 took on 2026-10-08:
against the Range-ignoring origin ffmpeg makes exactly 2 requests, both
`Range: bytes=0-`, both answered `200`. It never asks for the tail, and the
second request asks for byte 0, not byte 48. Against the honouring origin it
asks `bytes=0-`, then `bytes=<tail>-`, then `bytes=48-`. So the cause stays
unmeasured, as the Why says. The harness in Why runs both so the next reader
sees both.

**2026-10-08** — the dl-99 question, checked rather than guessed: see "dl-99 does
not change this ticket's scope" in Why. In one line, dl-99's header read is a
probe-time ranged read that fails against such an origin and leaves the codecs
undeclared; the only consequence is that WebM is refused, and MP4 and MKV
requests reach the defect unchanged. Not run: dl-99's branch was read, not built.

**2026-10-08** — gate 1 (Opus 5.5) on the filing, measured with its own harness
and recorded here as its numbers, not the builder's:

- **The size threshold** for the Range-ignoring origin lies between 63,749 B
  (a tail-`moov` MP4 that decodes 100 of 100 frames) and 91,053 B (decodes 0 of
  100). The ticket's own bound is 59,622 B (fine) and 103,485 B (broken), so the
  gate narrowed it to 63,749 to 91,053 B; the exact value is still not found.
- **The bad output is a constant size:** exactly 37,615 B for each of 5
  sources from 91,053 B to 1,031,212 B (gate 1 reported 4; gate 2 corrected the
  count to 5). Its generated sources were
  1,021,416 to 1,031,212 B rather than the ticket's 1,021,968 B (x264 output
  varies from run to run); every outcome matched.
- Box order of every tail-`moov` file ffmpeg 6.1.1 wrote for the gates:
  `ftyp,free,mdat,moov`, 6 of 6 sources (50,241 B, 63,749 B, 91,053 B, 141,569 B,
  1,021,416 B, 1,026,770 B); gate 1 reported 4 of 4, and gate 2 corrected the
  count to 6.
- Not measured by gate 1: the dl-99 fixture runs above (103,485 B / 1,292 B /
  37,607 B), whose files are in another agent's scratch directory.

**2026-10-08** — gate 1's findings F1 to F8 folded in by the fixer, in the ticket
only: F1 (the Range-ignored fact is lost inside `bytes()`, not dropped by
dl-99; the resolvers change added to D's cost), F2 (A's sniff walks top-level
boxes), F3 (A needs new engine HTTP code, per `alternateUrls` candidate), F4
(B keeps the rule's letter, the reason is the owner's call), F5 (C's two
measured facts), F6 (Done when 2's D outcome), F7 (this Log's cause, above).
**F8, for whoever records the owner's answer:** `difficulty: standard`
is what the filing carries. Option A with a new code, and
D, each edit `@downloader/contract` and/or `@downloader/resolvers`, and
`docs/01-TICKETS.md` rates a contract change `hard`. Re-rate `difficulty` in
the commit that records the owner's answer; it was left unchanged here on
purpose. The ticket recommends no option.

**2026-10-08** — gate 2 (Opus 5.5) passed the round with no high finding.
It raised N1 (Done when 2 did not carry C's pre-first-byte outcome) and N2 (D's
cost named dl-99's unmerged wrapper, not `YtDlpResolver`); both were settled
by the answer recorded next, N1 because Done when 2 now names only option A's outcome,
and N2 by naming `YtDlpResolver` in D, which is kept as "not taken".

**2026-10-08** — the owner answered the decision: option A, with a new,
non-retryable contract code. Recorded in Decisions with the questions and the
options put. `status` moved from `needs-decision` to `ready`; nothing is built.
**`difficulty` re-rated `standard` to `hard`**, as gate 1's F8 said it would
need to be: `docs/01-TICKETS.md` rates "a one-line change to a contract"
`hard`, because difficulty is the judgement the work needs and not the size of
the diff, and this ticket adds a code to `@downloader/contract`, decides where a
new SSRF-sensitive request lives (engine or api), and writes a box walk that must
not refuse a good file. The gate records for this filing are on PR #399's
thread, not in a `## Review` section, because `scripts/status.mjs` rejects one
on a `ready` ticket.

**2026-10-08** — built (Opus 5.5, builder), on `origin/main` at `856a4e87`.

**Red first.** The new last test in `engine/test/stream.test.ts`, "a tail-moov
MP4 from an origin that ignores Range is refused before the first byte", run
against the unchanged engine source:

```
npx vitest run tools/downloader/engine -t "a tail-moov MP4 from an origin that ignores Range"
AssertionError: expected { streamed: 35164, done: 35164, …(1) } to deeply equal { Object (refused, retryable, ...) }
+   "decodedFrames": 0,
+   "done": 35164,
+   "streamed": 35164,
      Tests  1 failed | 178 skipped (179)
```

`done` resolved with the 35,164 bytes it streamed, and 0 frames decode. The
fixture is `generateLargeProgressive` in `engine/test/helpers/media.ts`, 4 s at
640x480 and a constant 2 Mb/s, 1,042,779 B when regenerated by hand; the test
itself asserts it is at least 91,053 B and laid out `ftyp,free,mdat,moov`, so it
can fail. The output is 35,164 B rather than the Why's 37,615 B because the
fixture is encoded `ultrafast`; the outcome is the same. After the fix, the same
command: `Tests 1 passed | 178 skipped (179)`.

**The code: `SOURCE_NOT_SEEKABLE`**, in `DOWNLOADER_ERROR_CODES`, with its
message, not in `RETRYABLE_CODES`, and not in the orchestrator's
`REPROBE_WORTHY` either: a fresh probe names the same origin, which answers the
same way. HTTP 422, like `CONTAINER_UNSUPPORTED`. The UI copy (title "Can't be
streamed from this source") says another quality or format may work, and the
mock API has a `norange` scenario for it, because `web/test/mock-api.test.ts`
requires every code to be demonstrable — a listing place the Build did not
name.

**The three settlements, with the cost accepted for each.**

1. **The box walk: built.** `TopLevelBoxWalk` in
   `engine/src/download/seek-probe.ts` reads top-level box headers as the body
   arrives, skips each body without keeping it, and decides on the first `moov`
   (index first) or `mdat` (index last). It never tests what follows `ftyp`:
   `ftyp,free,mdat,moov`, `ftyp,mdat,moov` and QuickTime's `wide,mdat,moov` are
   refused; `ftyp,moov,free,mdat` and a chain with 64-bit `free` and `uuid`
   boxes before `moov` are not. Bytes that are not a box chain (WebM, MPEG-TS,
   an HTML page), a box smaller than its header, a chain that ends, or one that
   runs past 1 MiB before deciding, are **unknown**, never a refusal. Cost
   accepted: the code, about 70 lines plus 15 unit tests in
   `engine/test/seek-probe.test.ts`, and the risk that a wrong walk refuses a
   good file, which the refusal needing an exact chain to `mdat` keeps narrow.
2. **The probe lives in the engine.** Cost accepted: new engine HTTP code
   (`node:http`, `node:https`, `node:tls`, about 150 lines) and a second
   request that must be vetted. **It is not a second SSRF check**: the request
   takes ffmpeg's own route — `EngineConfig.proxyUrl`, or else the `http_proxy`
   the runner lets ffmpeg inherit, absolute-form for `http:` and a `CONNECT`
   tunnel for `https:`, with ffmpeg's `tlsVerify` and `tlsCaFile` — so the
   guarded egress proxy vets it as it vets ffmpeg, and each redirect hop is a
   fresh request on that route. It never goes around a configured proxy: a
   proxy that is not `http://` makes the verdict unknown and sends nothing. The
   cost not taken, the api-side probe, would have let any other engine caller
   (`scripts/download.ts`, a test) skip the check without knowing, and the api
   cannot see which failover candidate the engine is on. `createEngine`'s notes
   in `engine/src/index.ts` now say the engine makes this one request.
3. **`alternateUrls`: probed per candidate, as each is tried.** The probe runs
   inside `openStream`'s failover loop, once per candidate actually reached, so
   a stream whose primary works costs one request. A refusal **tries the next
   mirror**, because honouring `Range` is the host's behaviour and a mirror may
   well honour it; the last candidate's refusal is the answer. It is handled in
   `stream.ts`, not added to `isHostFailure`, which classifies ffmpeg's
   failures. A refusal is also exempt from the subtitle retry, which would
   otherwise have run ffmpeg without asking again. Cost: one request per
   progressive candidate tried, through the same proxy with the same headers.

**What the brief had wrong or did not say.**

- It describes two reads, a one-byte range and then "the first bytes of the
  file, which needs no `Range`". One request does both: `Range: bytes=1-1`.
  A `206` needs nothing more, and a `200` to it is the file from byte 0, which
  is what the walk reads. The start is 1, not 0, because the seek ffmpeg needs
  is to a later offset and a `206` to a range at zero is weaker evidence.
- **A separate `audioUrl` has the same exposure** and the Build named only the
  candidates. A progressive variant with `audioUrl` (the yt-dlp tier's pairs)
  opens a second progressive input; it is probed once, before the loop, and
  refused with `details.input: "audio"`.
- **The probe moves request counts.** Two dl-53 tests in `stream.test.ts` cut
  `/prog9/moov-end.mp4` on its third request, the sequential body read; with the
  probe first, that read is the fourth, and they now cut the fourth. Before
  the change, "control: a progressive body cut once and resumed" still passed
  with the old count, cutting the tail read instead — a test passing while
  measuring something else.
- **A small tail-`moov` file from such an origin is refused too**, though
  ffmpeg reads one below roughly 64 KB whole and it works today. The threshold
  is ffmpeg's internal buffering; written in the `stream.ts` header as accepted.
- **Unknown means today's behaviour.** A probe that cannot decide (another
  status, a timeout at 15 s, a refused tunnel, a certificate failure) lets
  ffmpeg run as before, so ffmpeg's failures keep their codes:
  `TLS_VERIFICATION_FAILED` still arrives as itself, a `500` still buys a
  mirror. The consequence is that Done when 2's "in no case" holds where the
  probe gets an answer, not for an origin that fails the probe and then serves
  ffmpeg the whole body. Recorded, not resolved: it is the orchestrator's to
  put as a question.
- For dl-98: the probe takes the candidate URL, the origin's, and the
  `stream.ts` header says it must never be whatever ffmpeg is handed instead.
- Found while building, by the api test and by no engine test: through a
  `CONNECT` tunnel, Node checks the certificate against `localhost` unless
  `host` is passed to `tls.connect`, so every probe through the terminating
  proxy came back unknown with `ERR_TLS_CERT_ALTNAME_INVALID` and the job
  completed. Fixed, with the reason at the line; `egress-proxy.ts` carries the
  same note for the same reason.

**Done when, each with its proof.**

1. The red run above.
2. Same test, green: `{ refused: "SOURCE_NOT_SEEKABLE", retryable: false,
message: DEFAULT_ERROR_MESSAGES.SOURCE_NOT_SEEKABLE }`, and the origin saw
   exactly one request, the probe's, so ffmpeg never started.
3. In the same `describe`: "control: the same tail-moov file from an origin that
   honours Range completes whole" and "control: a fast-start MP4 from an origin
   that ignores Range completes whole" (both decode 100 of 100 frames, `done`
   equal to the bytes streamed). The refused case asserts its layout is
   `ftyp,free,mdat,moov`. The dl-53 case "progressive MP4 with its index at the
   end, 9 s" still passes.
4. `api/test/range-ignoring-origin.test.ts`, through a real `createApp` whose
   engine and terminating proxy are `server.ts`'s own: the job is `failed`,
   `SOURCE_NOT_SEEKABLE`, the catalog's message, `retryable: false`, one
   attempt, and the link answers 422. With the refusal disabled by a temporary
   mutation the same test fails `expected 'completed' to be 'failed'`. The
   origin's certificate is trusted only by the proxy, so the refusal is itself
   proof that the probe went through it.
5. This entry, and the `stream.ts` header's "An origin that ignores Range".
6. `node scripts/preflight.mjs --base origin/main --title "…"` at `41653474`,
   exit 0, printing `ok npm run check` and `ok npm test -- --project
downloader`; it prints no counts. The one full run that did print them, at
   the commit before, was `Tests 1 failed | 2257 passed | 2 skipped (2260)`,
   the failure `web/test/mock-api.test.ts` "every ErrorCode is demonstrable",
   which the `norange` scenario fixed (that file and the presentation test:
   38 of 38).

**2026-10-08** — round 1, on gate 1's findings at `2f91f2e` (Sonnet 5.5,
CONCERNS, no high).

**The owner's decision on what the probe does with no answer** (F1), asked by
the orchestrator after gate 1 measured the premise:

- Question: "dl-102: when the Range probe gets no answer, the branch lets
  ffmpeg run as before. Measured: on a Range-ignoring origin, 8 of 13
  no-answer paths still end in a 0-frame file reported as done. That breaks
  Done when 2's 'in no case'. Two paths are worse than main for that origin: a
  one-shot 429/500, or a first CONNECT refused. What should the probe do?"
- Options put: keep the fallback and file a C ticket (the orchestrator's
  recommendation, built on the builder's option C); keep the fallback, no
  ticket (the builder's option A); build C into this branch; B, refuse on any
  no-answer.
- **Chosen: keep the fallback and file a C ticket.** The answer authorises
  rewording Done when 2's last clause, which is now scoped to the case where
  the probe gets an answer. The ticket is
  [dl-103](./dl-103-an-unanswered-seek-probe-still-finishes-a-tail-moov-mp4-undecodable.md),
  `depends_on: [dl-102]`.

**The no-answer paths that still end in a 0-frame file**, from gate 1's Item 4
table (1.02 MB `ftyp,free,mdat,moov`, a Range-ignoring origin, ffmpeg 7.0.2
and 6.1.1 alike), by its row numbers: 2, a `403` or `416` to `bytes=1-1` only;
3, a `429` or `500` on the first request only (`DOWNLOAD_FAILED` before
dl-102); 4, the probe timing out at 15 s; 5, the first connection reset; 6, six
redirects, of which the probe follows 5 and ffmpeg 8; 8, a box chain past the
1 MiB walk limit; 10, a proxy URL that is not `http://`; 13, the first
`CONNECT` alone refused (`DOWNLOAD_FAILED` before dl-102). Rows 1, 11 and 12
fail with ffmpeg's own code, and rows 7 and 9 stream a good file. The
`stream.ts` header and `seek-probe.ts`'s no longer say that an unanswered probe
leaves ffmpeg running "exactly as it did before": they name rows 3 and 13, the
one-shot fault the probe now absorbs, which heals on a Range-honouring origin
and yields the undecodable file on a Range-ignoring one.

**A ninth case, beside the eight rows, found by gate 2 and not in gate 1's
table:** an origin that honours bounded ranges and answers open-ended ones
with the whole file as `200`. The probe asks `bytes=1-1`, gets `206` and says
`seekable`; ffmpeg then asks `bytes=0-` twice and is given the garbage.
Measured by gate 2 on `040d42f` through `engine.stream()`: `0/100 frames,
done=resolved(37609)`, the origin seeing `bytes=1-1 , bytes=0- , bytes=0-`.
This is the converse of F9, which recorded a bounded range answered
differently. No real server of this shape was found. Done when 2's first clause ("wherever the probe gets an
answer") is therefore not true of it, and it is carried by dl-103 beside the
eight rows.

**F2, every redirect hop through the proxy: fixed.** New last test in
`engine/test/seek-probe.test.ts`, "every redirect hop goes through the proxy,
not only the first": the origin URL redirects to a second origin, and the
recording proxy's log must list both absolute URLs while the second origin
sees nothing direct. Against gate 1's mutation (`hop === 0 ? route : { kind:
"direct" }`):
`AssertionError: expected [ 'http://127.0.0.1:43479/hop' ] to deeply equal [ 'http://127.0.0.1:43479/hop', …(1) ]`,
`Tests 1 failed | 15 passed (16)`; unmutated, `Tests 16 passed (16)`.

**F3, the five CodeQL alerts: triaged under adr/005, all false positives.**
Read from the check run's page (run 113491508891, at `2f91f2e`):

- **Server-side request forgery, Critical, ×2**: `engine/test/seek-probe.test.ts`
  and `engine/test/stream.test.ts`, the forward-proxy fixtures, which
  `http.request` the URL from their request line. Test doubles (adr/005 step
  5). **Not excused: removed.** Both proxies now record the absolute URL and
  answer for the origin themselves, so no fixture sends a request on, and what
  a proxy records is exactly what reached it — which the F2 test needs anyway.
- **File data in outbound network request (`js/file-access-to-http`), Medium,
  ×3**: `engine/src/download/seek-probe.ts`, the direct `http.request`, the
  direct `https.request` and the tunnelled `https.request` in `get`. The one
  file the module reads is `tlsCaFile`, the CA bundle the origin is verified
  against; it is passed as the TLS trust anchor and never sent. Structural for
  any version of this code that verifies against the operator's CA file, so
  **excused in place**, a `// codeql[js/file-access-to-http]` line above each
  call with the five fields. **The plain-HTTP call is handed no CA, and why
  the scanner reports file data there was not traced**: the check page showed
  no flow path ("Error loading related location"), and the reasoning there
  rests on the CA being the module's only file read.
- **The test that would catch the true positive**, written first (adr/005 rule
  3): "the CA file configures trust and is never sent", in
  `engine/test/seek-probe.test.ts` (`http:`, direct and through a proxy) and in
  `api/test/range-ignoring-origin.test.ts` (`https:`, direct and tunnelled
  through `server.ts`'s terminating proxy). Measured with a mutation that puts
  a CA line into a header: the engine test failed on the leaked marker, and so
  did the api test, once for the direct route and once with the mutation
  limited to the tunnel. The api test first passed that mutation: the
  generated PEMs are CRLF, so its lines carried a `\r` the header did not; it
  now splits on `\r?\n`. Unmutated: both pass.
- At `040d42f` (this round's head), `gh pr checks 404` shows `CodeQL pass`
  (the code-scanning check run). The three `js/file-access-to-http` alerts are
  still listed on the check page and stay open until the dismissal step runs
  on a push to `main` (adr/005, "Register and mechanism are two jobs"); after
  that push the security tab should show them dismissed with "Suppressed via
  SARIF".

**F6, two comments: fixed.** `api/src/server.ts` now says the probe is the
engine's one request of its own and takes ffmpeg's proxy, in the same three
lines. `seek-probe.ts`'s header and `createEngine`'s notes say the probe's
reach is a subset of ffmpeg's, not the same: it ignores `no_proxy` and stays
on the proxy, and sends nothing where ffmpeg would ignore a non-`http://`
proxy and go direct.

**F7, the heal control: fixed.** It now asserts that its fault fired on the
sequential read (an open-ended range starting past byte 1 and before the
file's midpoint). With the count at 99 and at the old 3, each run gives
`AssertionError: expected false to be true`, `Tests 1 failed | 55 skipped
(56)`.

**F8, the titles: fixed.** The tuple is now `(name, expected, bytes)`, so
`"%s is %s"` prints the verdict.

F4, F5 and F9 are left as gate 1 recorded them, by the dispatch.

The three files, after: `npx vitest run tools/downloader/engine/test/seek-probe.test.ts tools/downloader/engine/test/stream.test.ts tools/downloader/api/test/range-ignoring-origin.test.ts`,
`Test Files 3 passed (3)`, `Tests 77 passed (77)`, against gate 1's 74 (one
hop test and two CA tests added).
