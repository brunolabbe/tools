---
id: dl-104
tool: downloader
title: A chunk-named file on one host drops a whole numbered file on another host under the same path
kind: fix
status: ready
milestone: null
depends_on: [dl-78]
difficulty: standard
---

# dl-104 — A chunk-named file on one host drops a numbered file on another

## Why

`rankHits` in `resolvers/src/browser/rank.ts` drops a numbered `.mp4`
(`5.mp4`) when the capture shows playback is segmented, and one of its two proofs
is a chunk-_named_ neighbour (`init.mp4`, `seg-1.m4s`) "in its own directory"
(`isChunkOfSegmentedPlayback`, dl-78). The directory is `directoryOf`, which keys
it by **path alone** and ignores the host. So a chunk-named file on one host
proves segmentation for a numbered file on a different host that happens to share
the path: typically an ad or tracker host serving `/media/init.mp4` beside the
page's own CDN serving `/media/5.mp4`, a whole video.

The result is a wrong answer in the quiet direction: the page's real video is
ranked away and the ad's file is what the user is offered (or, with nothing else,
`NO_MEDIA_FOUND`).

Found while building [dl-90](./dl-90-a-segmented-stream-with-no-manifest-offers-its-chunks.md):
the chunk sniff in `resolvers/src/browser/chunk-sniff.ts` had the same shape, and
gate 1 of dl-90's first build measured it there (`reads:
https://ads.example.com/media/1.mp4`, `kept: []`). dl-90 fixed its own copy by
keying the directory as origin plus path and left `rank.ts` alone as outside that
branch. **The owner chose to file this as a downloader ticket, and not to fold it
into dl-90 (2026-10-10).**

## Reproduction

The builder's script, kept in scratch and not committed, builds two progressive
hits and ranks them. Run it as
`node --import tsx rank-crosshost.mts <worktree root>` with a worktree root as the
working directory:

```ts
// Usage: node --import tsx rank-crosshost.mts <worktree root>
const ROOT = process.argv[2];
const rank = await import(`${ROOT}/tools/downloader/resolvers/src/browser/rank.ts`);
const hit = (url: string, seq: number) => ({
  url,
  key: url,
  kind: "progressive",
  headers: {},
  seq,
  confirmed: true,
});
// A chunk-named file on one host, a numbered whole file under the same path on another.
const hits = [
  hit("https://ads.example.com/media/init.mp4", 0),
  hit("https://cdn.site.example/media/5.mp4", 1),
];
const ranked = rank.rankHits(hits, "https://site.example/watch");
console.log(`ranked: ${JSON.stringify(ranked.map((h: { url: string }) => h.url))}`);
```

Measured on this branch (`dl-90-sniff-moov-for-chunk-streams`, merged with
`origin/main` `1a044437`, 2026-10-10):

```
ranked: ["https://ads.example.com/media/init.mp4"]
```

`https://cdn.site.example/media/5.mp4` is gone. The builder measured the same
output on its own tree.

## Build

Key `directoryOf` in `rank.ts` by origin plus path, as `chunk-sniff.ts`'s
`directoryOf` does after dl-90 (it falls back to the raw prefix when the URL does
not parse). One thing to decide when building, which is why this is `standard`
and not `mechanical`: an origin key also stops `cdn1.site.example/seg/init.mp4`
from vouching for `cdn2.site.example/seg/5.mp4`, a real sharded-CDN layout. Check
whether that loses a case the current rule gets right (the manifest proof
elsewhere in the capture still covers most streams) and say which was chosen in
the Log.

## Done when

- A `rank.test.ts` case with the reproduction's two hits returns both URLs, and
  fails on the tree before the fix.
- The same-host case still drops the numbered file: `init.mp4` and `5.mp4` under
  one origin and path give only `init.mp4`.
- `npm run check` and `npm test -- --project downloader` pass.

## Log

- 2026-10-10, filed from dl-90's round 1 (builder's note under dl-90's Log; the
  reproduction re-run on the merged branch by the fixer, output above). The owner
  chose to file it as a downloader ticket, over leaving it and over folding it
  into dl-90. `difficulty: standard`: the fix is one line, but the sharded-CDN
  case in Build is a judgement the builder has to make and record.
