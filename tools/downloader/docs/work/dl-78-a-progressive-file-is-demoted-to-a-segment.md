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
