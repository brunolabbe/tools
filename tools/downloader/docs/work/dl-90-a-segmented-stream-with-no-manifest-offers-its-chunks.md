---
id: dl-90
tool: downloader
title: A segmented stream whose manifest was never captured offers its numbered chunks as downloads
kind: fix
status: ready
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
