---
id: dl-78
tool: downloader
title: A progressive file is demoted to a segment by a numbered name or a short ranged response
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# dl-78 — A progressive file is demoted to a segment by its name or a ranged response

## Why

The browser tier drops every hit whose kind is `segment` before ranking
(`rank.ts`, the `hit.kind !== "segment"` filter), so a playable file that is
classified as a segment is not offered at all, and a page whose only media is
that file ends in `NO_MEDIA_FOUND`.

`classifyMedia` in `resolvers/src/browser/media-match.ts` demotes a progressive
file to `segment` in `demoteChunks` on either of two signals, both of which a
whole file can carry:

- **The name.** `NUMBERED_SEGMENT` (`/[-_/]\d{1,7}\.(?:mp4|m4v|webm|m4a)$/i`)
  matches `/839201.mp4`, `clip-720.mp4` and `movie_1080.mp4`: a numeric id or a
  resolution suffix, both common for whole files. The rule exists for fMP4
  segments served as `.mp4`, which only matters when a manifest is also present.
- **The size.** `contentLength < SMALL_FILE_BYTES` (512 KB) demotes. In
  `intercept.ts` `#onResponse` reads `content-length`, which for a `206` is the
  length of the _chunk_, not the file; `Content-Range`'s total is ignored. And
  `#record` overwrites `existing.kind` on every confirmed response, so one small
  range response after a large one flips a confirmed progressive file to
  `segment`. `direct.ts` already knows a 206 length is not the file size.

Found by reading the code during a review of the resolver chain's false
"no video" cases, 2026-10-06. **Not yet reproduced**: the shapes below are
inferred, and building them is the first step.

## Build

1. **Reproduce first**, in `resolvers/test/browser/`, against a local fixture
   origin:
   - a page with `<video src="/media/clip-720.mp4">`, served `video/mp4`, about
     5 MB → expect a `progressive` hit and an outcome, observe `NO_MEDIA_FOUND`;
   - the same file under a neutral name, from a server that answers every
     `Range` request with a 256 KB `206` → same expectation.
     Record in the Log which of the two fails on `origin/main` and how.
2. Name rule: apply `NUMBERED_SEGMENT` only when there's evidence of segmented
   playback (a manifest hit in the same collector, or a `SEGMENT_NAME`
   sibling), or drop it. The test at `capture-rules.test.ts` asserting
   `00003.mp4` → `segment` encodes the current rule and must be revised
   deliberately rather than deleted; say in the Log which way you went and why.
3. Size rule: for a `206`, take the total from `Content-Range`
   (`bytes a-b/total`; `*` means unknown) instead of `content-length`.
4. In `#record`, do not downgrade a confirmed `progressive` to `segment` on a
   later response for the same URL.
5. Keep the case `init.mp4` / `seg-1.mp4` with an HLS or DASH manifest present
   classifying as segment. It is why the rule exists.

## Done when

- Both reproduction fixtures from step 1 yield a progressive outcome, not
  `NO_MEDIA_FOUND`.
- A test proves a 206 response's `Content-Range` total, not its chunk length,
  decides the size demotion.
- A test proves a confirmed progressive hit is not downgraded by a later small
  response.
- The fMP4-with-manifest case still classifies its `.mp4` chunks as `segment`.
- `npm run check` and `npm test -- --project downloader` pass.

## Log

### 2026-10-06 — built (builder, branch `dl-78-progressive-not-segment`)

**Reproduced first, and both shapes fail on `origin/main` (056aab7).** The two
new specs at the end of `browser-resolver.test.ts` ("a progressive file is not
demoted to a segment (dl-78)"), run against unchanged `src`:

```
npx vitest run tools/downloader/resolvers/test/browser/browser-resolver.test.ts -t "dl-78"
 × a whole file with a resolution suffix in its name is offered 3002ms
 × a file whose server answers every Range request with a short 206 is offered at its real size 2901ms
AppError: No downloadable video stream was found on that page.   (NO_MEDIA_FOUND, both)
Tests  2 failed | 50 skipped (52)
```

Both fail, each by its own signal: `clip-720.mp4` (5 MB, `200`, `video/mp4`) by the
name rule alone, and `lecture.mp4` (neutral name, 5 MB, every `Range` answered
with a 256 KB `206` carrying `Content-Range: bytes s-e/5242880`) by the size
rule alone. The fixture is `test/browser/helpers/progressive-server.ts`: the
body is generated in memory (zeros) because the sniffer classifies on headers,
which precede any decoding. After the change the same two pass, and the second
also asserts the browser really sent a `Range` header, so it cannot go green by
the server never being asked.

**Decision (step 2): gate the name rule on evidence; do not drop it.** The rule
was `NUMBERED_SEGMENT` inside `classifyMedia`, which sees one request and cannot
see a manifest. Dropping it outright would have been the simpler change, but
`#buildOutcome`'s opaque-manifest fallback (`manifests[0]` present but unparsable)
appends `progressiveVariants(files)`, so every numbered fMP4 chunk of a stream
whose manifest failed to parse would have been offered as a "download". So:

- `classifyMedia` no longer looks at numbered names; `00003.mp4` is `progressive`
  per request. `SEGMENT_NAME` (`init`, `seg`, `chunk`, `frag`...) and the
  small-size rule are unchanged.
- `rankHits` (`rank.ts`) drops a numbered progressive hit when the capture holds
  evidence of segmented playback: any `hls`/`dash` hit, or a chunk-named
  neighbour in the same directory (`init.mp4`, `seg-1.mp4`, `.m4s`, `.ts`, `.cmf*`,
  `.dash`; `.vtt`/`.key`/`.aac` are not evidence).
- **Two numbered names side by side are deliberately not evidence**:
  `clip-720.mp4` + `clip-1080.mp4` are two whole files, and treating the pair as
  chunks would offer neither (the same false "no video" this ticket removes).
- The test at `capture-rules.test.ts` that asserted `00003.mp4` -> `segment` was
  revised in place with a comment pointing at the new describe, not deleted; its
  fMP4 assertions (`init.mp4`, `seg-00042.m4s`, `chunk-9.mp4`, small size) stay.

**What the brief had slightly off.** Done-when says the fMP4-with-manifest case
"still classifies its `.mp4` chunks as `segment`". Chunk-named ones (`init`,
`seg-*`, `chunk-*`) do, in `classifyMedia`. A merely _numbered_ chunk
(`00003.mp4`) next to a manifest is now `progressive` from `classifyMedia` and is
removed by `rankHits`; it never reaches a variant list either way, which is what
the rule is for. Test: "drops a numbered chunk when a manifest is in the capture".
Known cost: a page with a manifest _and_ a numbered whole file loses that file
from the opaque-manifest fallback's extras; the manifest was the better answer.

**Steps 3 and 4.** `responseFileSize(headers, status)` in `media-match.ts`: on a
`206` (or any response with `Content-Range`) the size is the total after the
slash, and `*` or a missing range is `undefined`, never the chunk length;
otherwise `Content-Length` as before. `#onResponse` uses it. `#record` keeps a
confirmed `progressive` when a later response for the same URL classifies as
`segment`. Side effect that is a fix: a ranged hit's `filesizeBytes` is now the
file's, where it used to be the chunk's.

**Mutation checks** (each reverted afterwards): `keep = false` in `#record` fails
"a small response after a confirmed large one does not turn the file into a
segment"; reading `content-length` only in `#onResponse` fails "a 206 records
the file's total from Content-Range as the hit's size" and the ranged browser
spec ("Tests 2 failed | 13 passed").

**Fold-in.** Considered `dl-79` (sniffing an untyped manifest) and `dl-80`..`dl-83`:
none is made free by this change; `dl-79` touches `intercept.ts` before
`#captureBody` and is built on its own branch, so it was left alone to rebase
cleanly.
