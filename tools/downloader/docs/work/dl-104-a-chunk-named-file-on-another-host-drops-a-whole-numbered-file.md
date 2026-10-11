---
id: dl-104
tool: downloader
title: A chunk-named file on one host drops a whole numbered file on another host under the same path
kind: fix
status: done
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

## Review

**Gate: PASS** — 2026-10-11 · `55214e67..54d37652` · Opus 5.5, depth full

| Done when                                                                                       | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A test with the reproduction's two hits returns both URLs, and fails on the tree before the fix | `resolvers/test/browser/capture-rules.test.ts` › "keeps a numbered file whose chunk-named neighbour is on another host under the same path" ✓. The assertion is a sorted `toEqual` of both URLs. The "fails before" clause is **verified**: with `rank.ts` reverted to the base, the same test fails with `expected [ Array(1) ] to deeply equal [ …(2) ]` (1 failed, 1 passed, filtered to the two dl-104 tests). There is no `rank.test.ts`. The `rankHits` suites live in `capture-rules.test.ts`, and the Log says so. |
| The same-host case still drops the numbered file                                                | `capture-rules.test.ts` › "still drops a numbered file beside a chunk-named neighbour under one origin and path" ✓. The assertion is an exact `toEqual(["https://cdn.site.example/media/init.mp4"])`. It also passed against the reverted `rank.ts`, so it is a true control.                                                                                                                                                                                                                                              |
| `npm run check` and `npm test -- --project downloader` pass                                     | **verified**. `npm run check` exit 0, and `npm test -- --project downloader` exit 0: 2439 passed, 2 skipped of 2441, in 113 files plus 1 skipped. PR #423 on `54d37652` also passed `check` and `test (ubuntu-latest)`.                                                                                                                                                                                                                                                                                                    |

- **low** · `nfr:maintainability` · no `Done when` line depends on it. `directoryOf` now exists twice, in `rank.ts` and in `chunk-sniff.ts`, and the two bodies are byte-identical (`diff` of the two function bodies exits 0). The comment in `rank.ts` says "The same key `chunk-sniff.ts` uses since dl-90", but no test makes the two agree, so an edit to one copy leaves that comment false without any failure. The Log chose not to fold them, and the reason it gives is real. Either export the function from `media-match.ts` or add one test that runs both keys on the same URL.
- **dropped** · the sharded-CDN trade-off, as a defect. It is the judgement Build asked for, and the Log records it. Measured with `sharded.mts`: an init on `cdn1`, N numbered fMP4 chunks on `cdn2`, run through `rankHits` and then `withoutFragments`, as `browser.ts`'s `#buildOutcome` does. The base offers 0 of N. The head with readable heads offers 0 of N, after 1 read for both N=3 and N=20. The head with heads that cannot be read offers all 20 of 20, after 8 reads. The only real loss is a sharded stream with no manifest whose chunks cannot be read. The Log calls the loss "reasoned, not observed", and this measurement makes it observed. No fixture or capture in the repo has the layout: `git grep` for `cdn[0-9]` and `shard` under `tools/downloader` finds nothing outside the ticket. Every chunk-named fixture is a `.mpd` or `.m3u8` manifest, which the manifest proof covers whatever the directory.
- **dropped** · key edge cases, all intended origin semantics. A differing host case, an explicit default port, userinfo and query strings (a `/` inside the query included) all still share a directory. A non-default port, a scheme change and a trailing-dot host are now separate directories, where the base merged them. Each of those three is a different origin to the browser too.
- **dropped** · `blob:`, `data:`, protocol-relative, unparseable and non-special-scheme URLs, which all have the opaque origin `null`. Only those last ones could collide across hosts. No live call site: `sniff.ts` rejects every candidate with `isDeniedUrl`, which refuses anything that does not parse or is not `http:`/`https:`, before a hit exists. The fallback for an unparseable URL gives the same output as the base (`protocol-relative` and `unparseable-same` match on both trees).
- **dropped** · out of range. `test (windows-latest, informational)` is red on `54d37652`: 3 failures, all in `engine/test/parallel-ranges.test.ts` (dl-98). `engine` does not import `resolvers`, and this diff touches only `resolvers`. Whether `main` is red there too is unmeasured: the Windows leg at `72b47fe1` was cancelled, and at `55214e67` it was skipped.
- **dropped** · Done when 1 names `rank.test.ts`, which does not exist. That is an error in the brief, not the build. The Log records where the tests are.
- **findings** · the hunt returned 6. 1 carried, 5 dropped.
- Callers: `directoryOf` in `rank.ts` has one caller, `isChunkOfSegmentedPlayback`. The manifest proof (`hits.some(... hls || dash)`) and `scoreHit`'s `pathOf` and `originOf` do not use it, and they are unchanged.
- Invariants: style is checked (no `any`, no `console`, no new imports). The new tests are in an existing registered spec. Skipped as not touched by the diff: cross-tool imports, `AppError`, shell, redaction, SSRF, progress, contract, Dockerfile, routes.
- NFR: security ✓ (no new URL reaches a request) · performance ✓ (key cost unchanged; the sharded case adds at most 8 head reads, bounded by the dl-90 budget) · reliability ✓ · maintainability, above.

## Log

- 2026-10-10, filed from dl-90's round 1 (builder's note under dl-90's Log; the
  reproduction re-run on the merged branch by the fixer, output above). The owner
  chose to file it as a downloader ticket, over leaving it and over folding it
  into dl-90. `difficulty: standard`: the fix is one line, but the sharded-CDN
  case in Build is a judgement the builder has to make and record.
- 2026-10-11, built. `directoryOf` in `resolvers/src/browser/rank.ts` now returns
  origin plus directory (raw-prefix fallback when the URL does not parse), the key
  `chunk-sniff.ts` uses. Tests are a new `describe` at the end of
  `resolvers/test/browser/capture-rules.test.ts` (there is no `rank.test.ts`; the
  `rankHits` suites live there): "keeps a numbered file whose chunk-named
  neighbour is on another host under the same path" failed before the fix
  (`expected [ Array(1) ] to deeply equal [ …(2) ]`, 1 failed | 159 passed of 160) and passes after; "still drops a numbered file beside a chunk-named
  neighbour under one origin and path" passes on both sides. After:
  `npx vitest run tools/downloader/resolvers` gave 1049 passed of 1049 (24 files).
  - **Sharded-CDN choice: the origin key.** `cdn1/seg/init.mp4` no longer vouches
    for `cdn2/seg/5.mp4`. What that loses is a segmented stream with no manifest
    request in the capture whose chunk-named file and numbered chunks sit on
    different hosts; every stream with a manifest still drops the numbered file
    through the manifest proof (which ignores the directory), and dl-90's byte
    sniff in `chunk-sniff.ts` reads a numbered file's own head and decides on its
    bytes. What it protects is a whole video ranked away by an unrelated host, a
    wrong answer with no error. Measured nowhere: no capture in the repo has the
    sharded manifest-less layout, so the loss is reasoned, not observed.
  - **Not folded in:** the two `directoryOf` copies (here and in
    `chunk-sniff.ts`) could share one export, but that edits dl-90's merged file
    for a saving of eight lines and a comment; left as two.
