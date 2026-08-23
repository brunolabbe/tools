---
id: dl-25
tool: downloader
title: A CDN hostname containing "srt" classifies the track as SubRip
kind: fix
status: ready
milestone: null
depends_on: []
---

# dl-25 — the `srt` row reads a hostname as a format claim

**Packages:** `resolvers` (`common.ts`).

## Why

`SUBTITLE_FORMATS`' second row is
[`common.ts:242`](../../resolvers/src/common.ts) —
`/(^|\W)srt(\W|$)|subrip/i`. It matches `srt` as a token _anywhere_ in the
hint, and [`dash.ts:338`](../../resolvers/src/manifest/dash.ts) builds that
hint as `` `${mimeType} ${codecs} ${fileUrl}` `` — a whole URL, host and path
included. A host or a path segment that happens to contain `srt` is therefore
read as a format claim:

```
"application/mp4  https://srt.cdn.net/sub.mp4"        -> srt   ✗  should be unknown
"application/mp4  https://cdn.net/srt/sub.mp4"        -> srt   ✗  should be unknown
"video/mp4  https://srt-edge.example.com/s/sub.mp4"   -> srt   ✗  should be unknown
"application/ttml+xml  https://srt.cdn.net/sub.ttml"  -> srt   ✗  should be ttml
```

`srt` is a plausible label for a CDN — SRT is also a widely used transport
protocol (Secure Reliable Transport), so `srt.cdn.example` and `/srt/` paths
exist in the wild for reasons that have nothing to do with SubRip.

**This one reaches the disk, and it is the reason the ticket is a `fix`.**
[`engine/src/index.ts:119`](../../engine/src/index.ts) declares
`SUBTITLE_FORMATS_FFMPEG_READS = new Set(["vtt", "srt"])` and
[`index.ts:533`](../../engine/src/index.ts) skips any track outside it. `srt`
is _inside_ it. So where dl-24's wrong answers (`ttml`, `unknown`) caused a
track to be silently dropped, this one causes the opposite: a file that is not
a subtitle at all is downloaded, written as `sub-<i>-<lang>.srt`
([`index.ts:541`](../../engine/src/index.ts)) and handed to ffmpeg as a
subtitle stream. The blast radius is a wasted fetch and an ffmpeg failure or a
garbage track, not a crash — `#fetchSubtitles` catches per-track errors — but
it is a real wrong download.

The fourth row above is the sharper case: a genuine TTML track, correctly
described by its own mime type, is answered `srt` because the `srt` row is
scanned before the `ttml` row. Ordering is doing real work here, which is the
other half of why this is worth fixing rather than tolerating.

## Build

1. **Reproduce first.** The four hints above, through `subtitleFormat`. They
   behave identically on `origin/main` and on the dl-24 branch — this is
   entirely pre-existing and dl-24 neither caused nor worsened it.

2. **Decide what the row should mean, and say so in the Log.** The tension is
   that the row serves three callers with different amounts of context.
   `hls.ts:278` passes a bare extension (`srt`), `ytdlp.ts:256` passes
   `chosen.ext ?? chosen.url` — so possibly a whole URL — and `dash.ts:338`
   always passes a whole URL with a mime type in front. A boundary tight
   enough to reject a hostname must not reject the bare extension. Options
   worth weighing: anchoring the token to an extension position
   (`\.srt(\?|#|$)`) with a separate whole-hint alternative for the bare
   extension; or having `dash.ts` stop concatenating the URL into the hint at
   all and pass mime type and codec only, falling back to the URL's extension.
   The second is a larger change and touches a caller, but it removes the
   whole class rather than this instance — **`ttml`, `dfxp` and `stpp` are
   matched unanchored too, and have the same bug.** Confirmed while filing
   this: `"application/mp4  https://stpp.cdn.net/sub.mp4"` and
   `"application/mp4  https://cdn.net/ttml/sub.mp4"` both answer `ttml`. Those
   two are less damaging than the `srt` case only because `ttml` fails the
   `index.ts:533` gate and so is dropped rather than downloaded.

3. **Extend `common.test.ts`.** dl-24 added the table at
   `tools/downloader/resolvers/test/common.test.ts`; it has boundary probes but
   no hostname probes. Add the four hints above plus the `stpp`/`ttml`
   equivalents, and keep every existing row passing — that table is the
   regression net for this file now.

4. **Re-check the ordering comment** at `common.ts:223-239`. It currently
   documents this very defect as the reason the row order is still
   load-bearing. If the fix removes the overlap, that paragraph needs to change
   with it.

Trap: do not tighten the row by dropping `|subrip`, which is unanchored on
purpose and matches mime types like `application/x-subrip`.

## Done when

1. A DASH-shaped hint whose _host or path_ contains `srt` but whose mime type,
   codec and file extension do not, classifies as something other than `srt`,
   proven by a test.
2. `application/ttml+xml https://srt.cdn.net/sub.ttml` classifies as `ttml`,
   proven by a test.
3. A bare `srt` extension and `application/x-subrip` still classify as `srt`,
   proven by the existing table in `common.test.ts`.
4. The same hostname defect in the `ttml` row — confirmed present, see Build 2
   — is either fixed with it or filed separately. Answered in the Log, not left
   unstated.
5. `npm run check` and `npm test -- --project downloader` pass.

## Log

- **2026-08-23** — Filed from gate 1 on
  [dl-24](./dl-24-classify-wvtt-as-webvtt.md). dl-24 fixed the `vtt` and `ttml`
  rows and deliberately left the `srt` row alone; the reviewer found this
  latent defect beside it and confirmed leaving the row alone was right, since
  it is pre-existing and out of that ticket's scope. Reproduced against both
  `origin/main`'s table and the dl-24 branch's — identical answers on both, so
  nothing about dl-24 is implicated. The `application/ttml+xml` case in the Why
  is one this builder found while reproducing, and is worse than the gate
  reported: it is a correctly-described subtitle being mislabelled, not just a
  non-subtitle being picked up.
