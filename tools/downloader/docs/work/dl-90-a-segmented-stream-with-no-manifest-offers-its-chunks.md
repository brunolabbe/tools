---
id: dl-90
tool: downloader
title: A segmented stream whose manifest was never captured offers its numbered chunks as downloads
kind: fix
status: done
milestone: null
depends_on: [dl-78, dl-97]
difficulty: standard
---

# dl-90 — A segmented stream with no captured manifest offers its numbered chunks

## Why

[dl-78](./dl-78-a-progressive-file-is-demoted-to-a-segment.md) stopped
`classifyMedia` demoting a whole file to a `segment` just because its name is a
number (`839201.mp4`). A numbered `.mp4` is now `progressive`, and `rankHits`
drops it again only through `isChunkOfSegmentedPlayback` in
`resolvers/src/browser/rank.ts`, which fires when the capture holds an `hls` or
`dash` hit or a chunk-_named_ neighbour (`init.mp4`, `seg-1.mp4`, `chunk-9.mp4`).

A segmented stream whose chunks are named `00000.mp4`, `00001.mp4` … and whose
playlist was **never captured as a manifest hit** has neither. Nothing demotes
the chunks, so they are offered as downloads. At the base of dl-78 the same page
ended in `NO_MEDIA_FOUND`, an honest failure; now it is a wrong answer, one fMP4
fragment with no `moov`, labelled "MP4 · 2.0 MB". Cases where the manifest goes
uncaptured:

- an untyped playlist URL (`/api/playlist?id=7`, `text/plain`), which is
  [dl-79](./dl-79-a-manifest-with-no-recognisable-type-or-extension.md)'s subject;
- a manifest delivered inside a JSON response;
- a manifest held in a blob.

Found by the dl-78 gate (gate 1, 2026-10-06, recorded in dl-78's `## Review`) as
its one `med` finding. **The owner chose to file it rather than fold it into
dl-78** (2026-10-06), so dl-78 landed as it stood.

dl-79 (PR #373, unmerged when this was filed) narrows the case for untyped
playlist responses only. The gate says so from reading dl-79's diff, not from a
run; it did not test a manifest inside JSON or a blob. **Re-run the reproduction
below on the merged tree before building**, since dl-79 may have changed what
remains.

## Reproduction

The gate's harness, `capture.mts`, drives a real Chromium through
`BrowserResolver` against a local server. Run it from the worktree root:
`node --import tsx capture.mts /nomanifest.html`. (Its `ROOT` constant names the
gate's worktree; point it at the checkout under test.) The relevant page, the
server paths it needs and the player script, quoted from it:

```ts
const MB = 1024 * 1024;
const CHUNK = Buffer.alloc(2 * MB);

const HLS = (dir: string) =>
  `#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:6\n#EXT-X-MAP:URI="${dir}00000.mp4"\n#EXTINF:6,\n${dir}00001.mp4\n#EXTINF:6,\n${dir}00002.mp4\n#EXT-X-ENDLIST\n`;

function page(script: string, video = ""): string {
  return `<!doctype html><html><head><title>t</title></head><body>${video}<script>${script}</script></body></html>`;
}
// A "player" that fetches the manifest, then the numbered chunks, as an MSE player would.
const fetchAll = (urls: string[]) =>
  `(async()=>{for(const u of ${JSON.stringify(urls)}){try{const r=await fetch(u);await r.arrayBuffer();}catch(e){}}})();`;

const PAGES: Record<string, string> = {
  // Segmented stream whose manifest URL carries no extension and an untyped content-type.
  "/nomanifest.html": page(
    fetchAll(["/api/playlist?id=7", "/n/00000.mp4", "/n/00001.mp4", "/n/00002.mp4"]),
  ),
};

// in the server handler:
if (path === "/api/playlist") {
  res.writeHead(200, { "content-type": "text/plain" }).end(HLS("/n/"));
  return;
}
if (path.endsWith(".mp4")) {
  res
    .writeHead(200, { "content-type": "video/mp4", "content-length": String(CHUNK.length) })
    .end(CHUNK);
  return;
}

// the resolve call, and how an outcome is printed
const resolver = new BrowserResolver({ pool, quietMs: 1200 });
const result = await resolver.resolve(new URL(origin + path), {
  timeoutMs: 25_000,
  signal: new AbortController().signal,
});
const v = result.variants.map(
  (x) => `${x.protocol} ${x.url.replace(origin, "")} ${x.filesizeBytes ?? "-"}`,
);
process.stdout.write(`[real] ${path} -> ${v.length} variants: ${v.join(" | ")}\n`);
```

The playlist is served `text/plain` from an extensionless URL, so
`classifyMedia` gives it no kind and no manifest hit is recorded. The chunks are
`video/mp4`, 2 MB each.

Measured by the gate:

- at dl-78's head (`df39926`):
  `[real] /nomanifest.html -> 3 variants: progressive /n/00000.mp4 2097152 | progressive /n/00001.mp4 2097152 | progressive /n/00002.mp4 2097152`
- at its base `src` (`056aab7`): `[real] /nomanifest.html -> THROW NO_MEDIA_FOUND`

For contrast, the same pages **with** a captured manifest (HLS and DASH, chunks in
the manifest's directory and in a different one, real and throwing parsers) gave
8 of 8 outcomes offering only the manifest, so the defect is the missing
evidence and not the numbered-name rule.

## Decision

Taken by the owner on 2026-10-07, **overriding the builder's recommendation**.

Question: when no manifest was captured, what should count as proof that
numbered `.mp4` files are chunks of one stream rather than separate videos?

1. Zero-padded names of 3 or more digits, in `rank.ts` only. The builder's
   recommendation. Known misses: unpadded chunks stay offered, and a
   `001`/`002`/`003` gallery of whole files would be dropped (not run).
2. **Sniff each chunk for `moov`.** Accurate for fMP4. Needs a ranged read per
   numbered candidate in `resolvers/src/resolvers/browser.ts`, which dl-97 is
   rewriting, so it waits for dl-97 to merge.
3. Record only, decide later.
4. Leave it and close as won't fix.

**Chosen: option 2.** The evidence is the chunk's own bytes, not the author's
numbering habit. The source change therefore lives in `browser.ts` and not in
`rank.ts`, and `depends_on` now carries dl-97 for that reason.

### Refinement, owner, 2026-10-07: the evidence is a `moof`, not a missing `moov`

Gate 1 of this record found that "no `moov` means chunk" makes the acceptance
lines ask opposite answers of the same bytes. The reproduction's chunks
(`Buffer.alloc(2 * MB)`) and dl-78's committed `clip-720.mp4` fixture
(`Buffer.alloc(PROGRESSIVE_FILE_BYTES)`) are both all zeros, so a read finds no
box in either; yet `/nomanifest.html` must lose its chunks and dl-78's
"a whole file with a resolution suffix in its name is offered" must stay green.

Question put to the owner: how should `Done when` be reworded?

- (a) **Drop on `moof`, with real fMP4 fixtures.** The sniff drops a candidate
  only on positive evidence of a fragment, and offers anything else, including a
  body it cannot parse. The gate's recommendation.
- (b) Keep "no `moov` means drop", and let dl-78's fixture be given a `moov`.
  It drops any numbered non-MP4 body the sniff cannot read.
- (c) Never read a lone file: narrow the candidates by a name and count rule,
  which is the kind of rule the owner turned down above.
- (d) Record the conflict and decide later.

**Chosen: (a).** The sniff's evidence is a `moof` box, not the absence of a
`moov`. The owner had seen the "Known misses" and "Accurate for fMP4" wording of
the first question when answering it.

### Owner answer, 2026-10-10: a whole movie written as fragmented MP4

Raised by gate 1 of the first build (`020b5dfc`), which built the Decision to the
letter: the evidence is a `moof`. ffmpeg `-movflags frag_keyframe+empty_moov` (12
s, video and audio, confirmed by `ffprobe`) writes a whole, playable movie whose
head is `ftyp moov[mvhd,trak,trak,mvex,udta] moof`. The first build stopped at the
`moov` that holds an `mvex`, so a page whose only video was such a file (one
`/lf/839201.mp4`) gave `NO_MEDIA_FOUND`, and with the filter neutralised, one
variant. The Decision had never weighed a fragmented whole file.

Question put to the owner: "What should happen?"

- (A) **Offer a head-then-fragment file as whole.** A head showing a `moov` with
  an `mvex` _followed by_ a `moof` is a self-contained movie and is offered. An
  init segment ends after its `moov` and a media segment has no `moov`, so both
  are still dropped. The gate's recommendation.
- (B) Decide by the file's total size: read the `Content-Range` total, so only a
  small body ending after `moov` counts as an init segment.
- (C) Accept the loss and record it here.

**Chosen: (A)**, by the owner, 2026-10-10. **Accepted cost:** a single-file DASH
on-demand rendition has the same head (`moov` with `mvex`, then `moof`), so it is
offered too, as a file that is not a chunk of anything.

## Build

Steps 2 to 4 below are **superseded by the Decision above**; they are kept
because the measurements in the Log are what the decision rests on. Step 1 was
done on 2026-10-07 (Log). What is left to design is the `moov` sniff: which
candidates it reads (numbered, progressive, no manifest in the capture), the
read's size and deadline, how it replays the captured headers, SSRF-checks the
URL and counts against the probe's budget, and what a failed read or an
unparseable body means (offer the file, as today). Start from dl-97's merged
`#loadManifest`, not from this page.

Facts the builder will hit, **measured by gate 1 of this record (not re-run by
its author)** with ffmpeg on a 3-segment fMP4 HLS and two whole files:

- `00000.mp4: ftyp(28) moov(799) [mvex inside]`,
  `00001.mp4: styp(24) sidx(52) moof(1300) mdat(23459)`,
  `whole-tail.mp4: ftyp(32) free(8) mdat(19985) moov(1971)`. So the **init
  segment** (`/n/00000.mp4` in `Done when` 1) has a `moov` and **no `moof`**: a
  rule that drops only on `moof` leaves it offered. How the init segment is
  caught is the builder's to design and `Done when` 1 requires it gone. Two
  starting points, neither a decision: a `moov` that contains `mvex` is itself
  positive evidence of a fragmented stream, or a numbered sibling in the same
  directory proven to be a fragment demotes the others.
- A whole file written without faststart has its `moov` **after** `mdat`, past
  any read of the head. A head-only sniff must not read "no `moov` yet" as
  "chunk".
- `demoteChunks` in `resolvers/src/browser/media-match.ts` already demotes a
  declared length under 512 KiB, which covers a typical init segment, but only
  when a length is declared.
- `readMp4Tracks` in `resolvers/src/mp4-header.ts` already walks the top-level
  boxes over ranged reads, tail `moov` included. The `SizeProbe.bytes` doc in
  `resolvers/src/size-sample.ts` says the Playwright-backed probe leaves ranged
  reads out on purpose, because `APIResponse` only hands over a body read in
  full; that constrains how the sniff can read inside `browser.ts`.

1. **Re-run the reproduction** on `origin/main` as it stands, and record what it
   prints. If dl-79 has merged, add the JSON-borne and blob variants to the
   harness: dl-79 does not read those, and the gate did not run them.
2. ~~Decide what counts as evidence of a segmented stream when no manifest was
   captured. The gate's candidate, **not a decision**, is option (b) of its open
   decision: three or more purely numeric names (`^\d+\.(mp4|m4v)$`) in one
   directory count as evidence, so `clip-720.mp4`/`clip-1080.mp4` keep their stem
   and stay whole files. The cost is a rule a test has to pin. Check the
   opposing case before adopting it: a directory of three numerically named whole
   files (`/media/1.mp4`, `/media/2.mp4`, `/media/3.mp4`, a gallery or a
   playlist of full clips) must keep its files, or this swaps one wrong answer
   for another.~~ Superseded: the Log shows this rule fails its own opposing case.
3. ~~Put the rule where `isChunkOfSegmentedPlayback` already sits
   (`resolvers/src/browser/rank.ts`) and keep `classifyMedia`'s kind unchanged,
   so dl-78's `responseFileSize` and `keep` behaviour stands.~~ Superseded: the
   rule moves to `browser.ts`. Keeping `classifyMedia`'s kind unchanged still
   holds.
4. ~~If the rule cannot separate the two shapes by name alone, say so and stop
   rather than guessing; the alternatives (sniffing the chunk's `moov`, reading
   its `Content-Range` pattern) are the owner's to choose.~~ Fired, and the owner
   chose the `moov` sniff.

## Done when

Reworded on 2026-10-07 after the owner chose (a) in the Decision's refinement:
the fixtures carry real MP4 boxes where a line depends on what the sniff reads,
because an all-zero body has no box and the sniff drops only on positive
evidence of a fragment.

- The `/nomanifest.html` reproduction, with its chunks served as **real fMP4**
  (an init segment `ftyp`+`moov`, then media segments `styp`/`sidx`/`moof`/`mdat`),
  does not offer `/n/00000.mp4`…`/n/00002.mp4` as downloads: a browser-resolver
  spec that fails on `origin/main` and passes with the fix. The init segment is
  part of the set, so the build has to catch a `moov` with no `moof`.
- A test proves three whole numbered files in one directory are still offered,
  with real non-fragmented MP4 bodies (one of them with `moov` after `mdat`).
- A test proves `clip-720.mp4`/`clip-1080.mp4` stay whole files, with real
  non-fragmented MP4 bodies.
- A body the sniff cannot parse, including an all-zero one, is offered: a test
  proves it, so a failed or unreadable sniff never costs the user a file.
- dl-78's fixtures still pass: a resolution-suffixed whole file and a file whose
  server answers every `Range` with a short 206. The fixture's `BODY` may stay
  zeros, which the unparseable-body line keeps green, or become a real MP4; the
  build chooses and says which in the Log.
- `npm run check` and `npm test -- --project downloader` pass.

## Review

**Gate: FAIL** — 2026-10-10 · `7709411e..020b5dfc` · Opus 5.5, depth full

| Done when                                                                                                      | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/nomanifest.html` with real fMP4 chunks offers none of them; red on `origin/main`; the init segment is caught | `resolvers/test/browser/chunk-streams.test.ts` › "an init segment and its media segments, with the playlist uncaptured, are not offered" ✓ (asserts all three fetched and `NO_MEDIA_FOUND`; red with the final filter in `withoutFragments` neutralised). The init clause is carried by `resolvers/test/browser/chunk-sniff.test.ts` › "an init segment is a fragment: a moov that holds an mvex, though it has no moof" ✓: with the `mvex` rule removed only this unit test goes red, because in the browser spec the directory rule drops the init segment unread |
| Three whole numbered files in one directory are offered, real non-fragmented MP4, one with `moov` after `mdat` | `chunk-streams.test.ts` › "three whole files in one directory are all offered, one with its moov after its mdat" ✓ (3 urls and 3 head reads; red under a "no `moov` means chunk" mutant)                                                                                                                                                                                                                                                                                                                                                                            |
| `clip-720.mp4`/`clip-1080.mp4` stay whole files, real non-fragmented MP4                                       | `chunk-streams.test.ts` › "clip-720.mp4 and clip-1080.mp4 stay whole files" ✓ (red under the same mutant)                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| An unparseable body, all-zero included, is offered                                                             | `chunk-streams.test.ts` › "an all-zero body is offered: no box is no evidence" and "a body that is boxes but not a movie is offered" ✓; `chunk-sniff.test.ts` › "a read that finds nothing, or throws, offers the file" ✓ (red when a failed read drops the file)                                                                                                                                                                                                                                                                                                   |
| dl-78's fixtures still pass                                                                                    | `resolvers/test/browser/browser-resolver.test.ts` › "a whole file with a resolution suffix in its name is offered" and "a file whose server answers every Range request with a short 206 is offered at its real size" ✓; 15 of 15 dl-78 tests pass. `BODY` stays zeros, as the Log says                                                                                                                                                                                                                                                                             |
| `npm run check` and `npm test -- --project downloader` pass                                                    | **verified** — check exit 0; 2315 passed, 2 skipped of 2317 (110 files passed, 1 skipped). PR #415 `test (ubuntu-latest)` green on `020b5dfc`                                                                                                                                                                                                                                                                                                                                                                                                                       |

- **high** · `resolvers/src/browser/chunk-sniff.ts` header: "A head that shows anything else … is **offered**, so a failed or inconclusive sniff never costs the user a file". That is false. `withoutFragments` ends with a filter that drops **every** numbered candidate in a directory holding one proven fragment, including candidates the sniff read and found to be whole. The Log says those siblings are "dropped unread", which the measurements below contradict. Reproduction: a real Chromium through `BrowserResolver`, with ffmpeg fixtures over 512 KiB. Below that size `demoteChunks` demotes the file before the sniff sees it.
  - `/mixed-wholefirst.html` fetches `/m2/1.mp4` (faststart), `/m2/2.mp4` (`moov` after `mdat`) and `/m2/3.mp4` (`-movflags frag_keyframe+empty_moov`). On the head it gives `THROW NO_MEDIA_FOUND`, with head reads `/m2/1.mp4(R),/m2/2.mp4(R),/m2/3.mp4(R)`. With the filter neutralised it gives `3 variants`.
  - `/hls-and-whole.html` fetches an init segment, one media segment and `/mx/7.mp4` (faststart) from one directory. `7.mp4` was read first and is still lost.
  - Remedy: drop only the candidates proven to be fragments and the siblings never read. Keep a candidate whose own head was read and was not a fragment, and correct the header comment and the Log.
- **med** · **open decision** · no `Done when` line depends on it. **A whole movie written as fragmented MP4 is dropped.** ffmpeg `-movflags frag_keyframe+empty_moov` (12 s, video and audio, confirmed by `ffprobe`) lays out its head as `ftyp moov[mvhd,trak,trak,mvex,udta] moof`. `sniffHead` stops at the `moov` that holds an `mvex`, so `/lonefrag.html` (one `/lf/839201.mp4`) gives `THROW NO_MEDIA_FOUND` on the head and `1 variants` with the filter neutralised. The Decision's evidence is "a `moof`", which this file has, so the build follows the letter of the Decision. The Decision never weighed a fragmented whole file. Options:
  - (A) **recommended**: a head showing `moov`+`mvex` _followed by_ a `moof` is a self-contained movie and is offered. An init segment ends after its `moov`, and a media segment has no `moov`. Residue: a DASH on-demand single-file rendition is offered too.
  - (B) read the `Content-Range` total, so that only a small body ending after `moov` counts as an init segment.
  - (C) accept the loss and record it in the Decision.
- **med** · no `Done when` line depends on it · **the sniff ignores cancellation.** Neither `withoutFragments` nor `fetchPrefix` takes `options.signal`, and nothing checks the signal after `#buildOutcome`. Reproduction: `/slow.html` serves 8 numbered files whose ranged reads never finish, and the probe is aborted as the first head read arrives. It settled **6012 ms after the abort** and made **1 new head read after the abort**. It then **returned 8 variants** instead of throwing. Remedy: pass the signal in, stop before each read once aborted, race each read against the abort, and run `throwIfAborted` after the sniff.
- **low** · the directory key is the URL's path without its host, so a fragment on one host drops numbered files under the same path on another. `withoutFragments([https://ads.example.com/media/1.mp4 → mediaSegment, https://cdn.site.example/media/2.mp4 → faststart])` gives `reads: ads… only` and `kept: []`. `directoryOf` in `resolvers/src/browser/rank.ts`, used by `isChunkOfSegmentedPlayback`, has the same shape. That code is not in this branch's range.
- **dropped** · "the sniff spends the manifest fetch's budget". `rankHits` drops every numbered progressive hit whenever an `hls`/`dash` hit is captured, so the sniff has no candidate when a manifest exists.
- **dropped** · "on a page that never goes quiet, slow heads push the probe into `TIMEOUT`". With a beacon every 250 ms, 8 slow heads and a 12 s budget, `/slow-noisy.html` returned 8 variants at 12008 ms.
- **dropped** · "the `readCapped` → `readBody` refactor changed `fetchManifest`". A differential over 21 bodies on the base's and the head's `manifest-fetch.ts` gave identical output for all 21. The bodies covered normal identity, chunked, gzip and br; exactly the cap and the cap plus one, declared and chunked; oversize declared, chunked and gzip; truncated declared, chunked and gzip; empty; an unsupported encoding; 404; a redirect; and a hang.
- **findings** · the hunt returned 7; 4 carried (1 high, 2 med, 1 low), 3 dropped.
- Positive controls:
  - Neutralising the final filter turns 4 of 30 dl-90 tests red, the reproduction spec among them.
  - Exempting `127.0.0.1` in `api/test/chunk-sniff-guard.test.ts` turns it red.
  - The SSRF check refuses each redirect target with HTTP 403 in under 20 ms, and the proxy logs `BLOCKED_TARGET`. The targets were loopback, `169.254.169.254` over http and https, `fe80::1`, `::ffff:127.0.0.1` and a `localhost` name. With the guard exempting them, loopback and `localhost` were reached (`secret hits +1`) and link-local failed by `TIMEOUT` or `EINVAL`, so the refusals came from the check.
  - A body that never ends costs at most 2 reads and 6010 ms, and the files are offered.
- NFR:
  - security ✓: every hop is vetted by the egress proxy; see the controls above.
  - performance ✓: at most 8 reads and 6 s per probe.
  - reliability: the cancellation finding above.
  - maintainability: the false header comment above.

## Log

- 2026-10-06, filed from the dl-78 gate's `med` finding. The owner chose to file
  rather than fold it in. Option (b) above is the gate's candidate fix, not a
  decision. `difficulty: standard` is unconfirmed: the ticket gives no basis for
  more than the judgement the heuristic needs.
- 2026-10-07, step 1 and the stop of step 4, by a builder on origin/main
  `9dcf0f6f` (no commit; the work was measurement only).

  **What was used.** The ticket's `capture.mts` is not in the repo, so it was
  rebuilt from the quoted code and kept in scratch, not committed: a loopback
  server, one pooled Chromium, `new BrowserResolver({ pool, quietMs: 1200 })`
  with the real parsers and 25 s per probe, 2 MB `video/mp4` chunks, and one
  page per shape below. Each page's script `fetch`es the listed URLs, except
  `/gallery-video.html`, which uses `<video preload="auto">` elements.

  The pages, so the table can be re-run with the ticket's `page`, `fetchAll`,
  `HLS`, `MB` and `CHUNK` (the chunk files are served `video/mp4` with a
  `Content-Length` from any path ending `.mp4`). `HLS("/n/", PADDED)` is the
  ticket's playlist with `PADDED = ["00000.mp4", "00001.mp4", "00002.mp4"]`:

  ```ts
  const PAGES = {
    "/nomanifest.html": page(
      fetchAll(["/api/playlist?id=7", "/n/00000.mp4", "/n/00001.mp4", "/n/00002.mp4"]),
    ),
    // the same, but /api/playlist-len replies text/plain WITH a content-length
    "/nomanifest-len.html": page(
      fetchAll(["/api/playlist-len?id=7", "/n/00000.mp4", "/n/00001.mp4", "/n/00002.mp4"]),
    ),
    // /api/info replies application/json: {"hls": HLS("/n/", PADDED), "chunks": ["/n/00000.mp4", ...]}
    "/json.html": page(
      `(async()=>{const j=await (await fetch('/api/info')).json();
       for(const u of j.chunks){try{await (await fetch(u)).arrayBuffer();}catch(e){}}})();`,
    ),
    // the playlist is built in the page, so no request names it
    "/blob.html": page(
      `(async()=>{const b=new Blob([${JSON.stringify(HLS("/n/", PADDED))}],
       {type:'application/vnd.apple.mpegurl'});await (await fetch(URL.createObjectURL(b))).text();
       for(const u of ['/n/00000.mp4','/n/00001.mp4','/n/00002.mp4']){
         try{await (await fetch(u)).arrayBuffer();}catch(e){}}})();`,
    ),
    "/bare-padded.html": page(fetchAll(["/n/00000.mp4", "/n/00001.mp4", "/n/00002.mp4"])),
    "/bare-unpadded0.html": page(fetchAll(["/u/0.mp4", "/u/1.mp4", "/u/2.mp4", "/u/3.mp4"])),
    "/gallery.html": page(fetchAll(["/media/1.mp4", "/media/2.mp4", "/media/3.mp4"])),
    "/gallery-padded.html": page(fetchAll(["/media/01.mp4", "/media/02.mp4", "/media/03.mp4"])),
    "/resolutions.html": page(fetchAll(["/media/clip-720.mp4", "/media/clip-1080.mp4"])),
    "/resolutions3.html": page(
      fetchAll(["/media/clip-480.mp4", "/media/clip-720.mp4", "/media/clip-1080.mp4"]),
    ),
    "/gallery-video.html": page(
      "",
      ["1", "2", "3"]
        .map((n) => `<video muted preload="auto" src="/media/${n}.mp4"></video>`)
        .join(""),
    ),
  };
  ```

  The bodies were all zeros (`Buffer.alloc(2 * MB)`), as in the ticket's
  harness. That is why none of these rows says anything about what a `moov` read
  would find; see the 2026-10-07 refinement in Decision.

  **Brief correction.** The ticket says dl-79 narrows the untyped-playlist case.
  It does only when the response declares a `Content-Length`:
  `resolvers/src/browser/sniff.ts` has `if (length === undefined || length <= 0)
return false;`. The ticket's own harness answers with
  `writeHead(...).end(string)`, which Node sends chunked, so the literal repro
  still fails after dl-79. A chunked untyped playlist, a JSON-borne one and a
  blob-borne one all remain.

  **Base results.** Every page printed progressive variants, 2097152 bytes each,
  except the one marked:

  | Page                                                              | Offered                                                   |
  | ----------------------------------------------------------------- | --------------------------------------------------------- |
  | `/nomanifest.html` (the ticket's, chunked `text/plain` playlist)  | `/n/00000.mp4`, `00001`, `00002`                          |
  | `/nomanifest-len.html` (same playlist, `Content-Length` declared) | one `hls` variant, `/api/playlist-len?id=7` (dl-79 works) |
  | `/json.html` (playlist inside a JSON response)                    | `/n/00000.mp4`, `00001`, `00002`                          |
  | `/blob.html` (playlist held in a blob)                            | `/n/00000.mp4`, `00001`, `00002`                          |
  | `/bare-padded.html` (only the three chunk requests)               | `/n/00000.mp4`, `00001`, `00002`                          |
  | `/bare-unpadded0.html`                                            | `/u/0.mp4` to `3.mp4`                                     |
  | `/gallery.html`, `/gallery-video.html`                            | `/media/1.mp4`, `2`, `3`                                  |
  | `/gallery-padded.html`                                            | `/media/01.mp4`, `02`, `03`                               |
  | `/resolutions.html`                                               | `clip-720.mp4`, `clip-1080.mp4`                           |
  | `/resolutions3.html`                                              | `clip-480.mp4`, `720`, `1080`                             |

  **Candidate rule (b) fails.** `/media/1.mp4`, `2.mp4`, `3.mp4` is the ticket's
  own must-keep case, and by name it is the same shape as `0.mp4`, `1.mp4`,
  `2.mp4` chunks. `/gallery-video.html` shows Chromium does capture all three
  whole files from a gallery of `<video preload="auto">` elements, so the case is
  real at capture level. Three or more purely numeric names would drop the
  gallery.

  **Padded-name prototype (option 1), measured and discarded.** In `rank.ts`:
  three or more progressive hits in one directory, each named `/0\d{2,}.(mp4|m4v)`.
  With it, `/nomanifest.html`, `/json.html`, `/blob.html` and `/bare-padded.html`
  threw `NO_MEDIA_FOUND` (dl-78's honest failure), and every other row above was
  unchanged. Residue: `/bare-unpadded0.html` still offers its four chunks, and a
  gallery of three or more zero-padded 3-digit whole files would be demoted (no
  such page was run). It separates the ticket's two literal examples but is a
  guess about how an author numbers files, not evidence that playback is
  segmented.

- 2026-10-07, owner decision: option 2, sniff each chunk for `moov`, over the
  builder's recommendation of option 1. See Decision. `depends_on` gains dl-97.
  `status` stays `ready` and `difficulty` is unchanged. This entry first said
  the `Done when` lines "still hold" under the `moov` read. **That was wrong**:
  with the quoted all-zero fixtures, line 1 (drop the chunks) and line 4 (keep
  dl-78's `clip-720.mp4`) ask opposite answers of the same bytes. Gate 1 of this
  record found it (reproduced with `names.mts`: `/n/00000.mp4` and
  `/media/clip-720.mp4` are both numbered, progressive and all zeros, and
  dl-78's fixture answers `206` with `nonZero=false`).
- 2026-10-07, owner refinement: option (a), drop on a `moof` with real fMP4
  fixtures, over "no `moov` means drop", "never read a lone file" and "decide
  later". `Done when` is reworded; see Decision. Gate 1 also measured the box
  layouts recorded under Build, and noted that `difficulty: standard` has no
  stated basis (the author's call; reassess once dl-97 merges). It is left as it
  is on the owner's instruction.
- 2026-10-10, built by a builder on origin/main `7709411e` (branch
  `dl-90-sniff-moov-for-chunk-streams`; `status` and `difficulty` left as they
  were).

  **Design, inside the Decision.** `rankHits` is unchanged. After ranking,
  `#buildOutcome` in `resolvers/src/resolvers/browser.ts` hands the progressive
  hits to `withoutFragments` (`resolvers/src/browser/chunk-sniff.ts`), which reads
  the first 64 KiB of each numbered `.mp4`/`.m4v`/`.m4a` (`isNumberedName`) and
  drops it only on positive evidence of a fragment: a top-level `moof`, or a
  `moov` holding an `mvex` (**round 1: and then no `moof`; see the owner answer
  under Decision**). The second is how the init segment is caught (gate
  1's first starting point): it has a `moov` and no `moof`. Everything else is
  offered: an all-zero body, a body that is not boxes, a head that ends before
  either box, and a `moov` after `mdat` (the walk stops at `mdat`, so a tail
  `moov` is never read as "no moov yet, so a chunk"). `classifyMedia` and its
  kinds are untouched.

  **Choices the Decision did not spell out, none changing behaviour between the
  options it named.**
  - _Bounded reads._ At most 8 candidates are read per probe, 3 s each and 6 s in
    all, taken from the probe's deadline. Past the cap an unproven candidate is
    offered, as before the sniff.
  - _One proven fragment settles its directory._ **Corrected in round 1: this
    entry first said the directory's numbered files were "dropped unread". The
    code dropped every numbered file in the directory, including ones it had
    read and found whole (gate 1 measured it).** Now the numbered files beside a
    proven fragment that were **never read** are dropped (gate 1's second
    starting point); a file whose own head was read and was not a fragment is
    kept. The cost, accepted: what survives depends on read order, so a whole
    file ranked after the first fragment is never read and is dropped. Twelve
    chunks cost one read, not twelve (`chunk-streams.test.ts`).
  - _The read._ `fetchPrefix` in `resolvers/src/browser/manifest-fetch.ts`, the
    dl-97 client, so it has the proxy, the jar, redirects and the root CA. It
    sends `Range: bytes=0-65535` and `accept-encoding: identity`, replays the
    captured headers except `Range`, `If-Range`, `If-None-Match` and
    `If-Modified-Since`, and stops at 64 KiB when a server ignores `Range`.
    `readCapped` became `readBody` with a `refuse`/`truncate` overflow mode;
    `fetchManifest` is unchanged in behaviour. It is not routed through
    `SizeProbe.bytes`: that interface is for `describeProgressiveTracks`, which
    the browser tier does not call, and wiring it would change what the tier
    returns for codecs.
  - _SSRF._ Same guard as the manifest re-fetch: the egress proxy vets every hop.
    `api/test/chunk-sniff-guard.test.ts` proves a sniff redirected to a refused
    loopback address never makes the hop and the file is still offered. With no
    proxy configured the client dials the origin directly, exactly as the
    re-fetch and the size probe do; that is dl-97's boundary, not widened here.

  **Fixtures.** Real boxes, built in `resolvers/test/helpers/mp4.ts`
  (`initSegment`, `mediaSegment`, plus the existing `faststartMp4` and
  `tailMoovMp4`). dl-78's own fixtures are unchanged: `BODY` stays zeros, which
  the unparseable-body line keeps green (`-t dl-78`: 2 of 162 selected, both
  pass). The init segment in `chunk-server.ts` is served chunked: with a declared
  length under 512 KiB `demoteChunks` already classes it a `segment`, and the test
  must reach the `mvex` rule.

  **Brief corrections.** The reproduction's `/nomanifest.html` still resolved to
  three chunks on `origin/main` once its bodies were real fMP4 (the spec is red
  there). A page with no media left now fails `NO_MEDIA_FOUND`, dl-78's honest
  failure. The Build note that the Playwright-backed probe leaves ranged reads out
  is stale since dl-101: the doc on `SizeProbe.bytes` in `size-sample.ts` is
  updated.

  **Fold-in considered and not taken.** `createRequestSizeProbe` could now
  implement `bytes()` over `fetchPrefix`, which would let the browser tier
  describe progressive codecs (dl-64). It is not free: it changes what the tier
  returns, needs a ranged-window read rather than a prefix, and has no ticket.

- 2026-10-10, round 1: gate 1 failed `020b5dfc` (one high, two med, one low; all
  six `Done when` lines held). Fixed on the same branch; `main` taken at
  `15adb4f7` by merge.

  **High, fixed: the filter dropped files the sniff had read and found whole.**
  Reproduced by the gate's `capture.mts` shapes and by two new tests, both red on
  the old filter (`sed 's/!read.has(hit) && segmented/segmented/'` on
  `chunk-sniff.ts`): `chunk-sniff.test.ts` "a file read and found whole is kept
  when a fragment beside it is proven later" and `chunk-streams.test.ts` "the
  whole file, read first, survives the init and media segments that follow it"
  (2 failed, 11 passed). `withoutFragments` now drops the proven fragments and
  the numbered siblings in a proven directory that were never read, and nothing
  else. The header comment of `chunk-sniff.ts` and the "dropped unread" line in
  the entry above were false of the first build and are corrected in both
  places. Known cost, in the comment and above: survival depends on read order,
  which is rank order (bigger first).

  **Med, owner decision recorded: a whole movie written as fragmented MP4.**
  The owner chose (A) on 2026-10-10; the question, options, choice and accepted
  cost are under Decision. `sniffHead` now reads a `moov` with an `mvex` as an
  init segment only when no `moof` follows it and every byte of the head parsed
  as a box. A `moov`+`mvex` followed by a `moof` is a whole movie and is offered.
  A `moov`+`mvex` followed by bytes the walk could not read as a box (a fragment
  too big for the head) is also offered: not proof. One test per shape in
  `chunk-sniff.test.ts` (whole fragmented movie: unknown; init segment: fragment;
  media segment, which has no `moov`: fragment), and in a real Chromium
  `chunk-streams.test.ts` "a lone numbered file with moov, mvex and then moof is
  offered" (red on `020b5dfc`'s `chunk-sniff.ts`: `AppError: No downloadable
video stream was found on that page.`) and "beside two whole files in one
  directory, all three are offered". The small-body unit case is what pins the
  `moof` clause: with that clause deleted only `fragmentedMovie(1024)` fails,
  because a large `mdat` already leaves unparsed bytes after the head.

  **Med, fixed: the sniff ignored cancellation.** `withoutFragments` takes the
  probe's `signal`, starts no read once it is aborted, races each read against
  it, and `#buildOutcome` calls `throwIfAborted` after it. `fetchPrefix` takes no
  signal: an abandoned request runs to its own timeout (at most 3 s) and is then
  closed, which costs a socket and no answer. Test: `chunk-streams.test.ts`
  "aborting while a head read is outstanding rejects with the abort, promptly, and
  reads no more" (a `/slow.html` of 8 files whose head reads are never answered;
  aborts when the first arrives; expects `CANCELED`, under 2 s, and no further
  head read). With the signal not passed it fails `expected 6009 to be less than
2000`, the gate's 6012 ms. Unit: "an abort starts no further read" and "an
  abort abandons the read in flight instead of waiting out its budget".

  **Low, fixed in the sniff, found real in `rank.ts`.** The sniff's directory is
  now `origin + path`; test "a fragment on one host proves nothing about the same
  path on another". The gate's `crosshost.mts` on the old tree printed
  `reads: https://ads.example.com/media/1.mp4` and `kept: []`; on this tree
  `reads: https://ads.example.com/media/1.mp4, https://cdn.site.example/media/2.mp4`
  and `kept: ["https://cdn.site.example/media/2.mp4"]`. **`rank.ts` has the same
  shape and it deserves its own ticket.** `directoryOf` there ignores the host,
  and it is a defect today, not an idea: with
  `https://ads.example.com/media/init.mp4` and `https://cdn.site.example/media/5.mp4`
  captured, `rankHits` returns `["https://ads.example.com/media/init.mp4"]`, so a
  whole numbered file is dropped for a chunk-named file on an unrelated host
  (`node --import tsx rank-crosshost.mts <tree>`, kept in the builder's scratch,
  not committed). Left alone here as instructed (outside this branch's range); the
  fix is the same one line the sniff now has, and a ticket should carry the
  reproduction above. Filing is the orchestrator's call.

  **Dropped by the gate, no action:** the manifest-budget claim, the noisy-page
  `TIMEOUT` claim, and the `readBody` refactor claim (a 21-body differential
  matched).

- 2026-10-10, owner answer on gate 2's read-order cost. Gate 2 measured that a
  whole movie ranked after a larger fragment in its directory is never read, and
  is dropped (its `/whole-after.html` gives `NO_MEDIA_FOUND`). The cost was
  already recorded in the round 1 entry above ("what survives depends on read
  order"); gate 2 priced it. Question put to the owner, with the options:
  - **Accept it as recorded, and land.** The recommended option. **Chosen.**
  - Land, and file it as dl-106.
  - Fix before landing.

  Gate 2's lows are recorded unfixed, as the record carries them. Two defects
  found alongside are filed in this pull request:
  [dl-104](./dl-104-a-chunk-named-file-on-another-host-drops-a-whole-numbered-file.md)
  (`rank.ts`'s `directoryOf` ignores the host, the shape the sniff's own
  directory key was fixed for here) and
  [dl-105](./dl-105-the-empty-floor-test-measures-below-its-own-floor-in-a-full-suite.md)
  (dl-80's empty-floor test read 8577 ms against its 9000 ms floor in this
  ticket's first preflight; passes alone).
