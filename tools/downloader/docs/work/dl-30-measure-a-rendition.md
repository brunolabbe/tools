---
id: dl-30
tool: downloader
title: Measure a rendition instead of trusting its declared bitrate
kind: fix
status: in-flight
milestone: null
depends_on: []
---

# dl-30 — the picker's size is a declared peak, and the job card prints it next to the truth

**Packages:** `resolvers` (a new sampler, `manifest/hls.ts`, `resolvers/direct.ts`,
`resolvers/browser.ts`, `resolvers/ytdlp.ts`), `api` (`resolvers.ts`).

## Why

`JobCard` puts `job.variant.label` in its heading and `result.sizeBytes` in its
body ([`web/src/components/JobCard.tsx:49`](../../web/src/components/JobCard.tsx)
and [`:182`](../../web/src/components/JobCard.tsx)), so a finished job shows the
estimate and the measurement one above the other. Reported from a real session,
four cards, three distinct videos:

| label     | `result.sizeBytes` | duration | implied est. | actual    | ratio |
| --------- | ------------------ | -------- | ------------ | --------- | ----- |
| `~107 MB` | `59 MB`            | 5:18     | 2823 kbps    | 1556 kbps | 1.81× |
| `~155 MB` | `137 MB`           | 3:01     | 7184 kbps    | 6349 kbps | 1.13× |
| `~148 MB` | `74 MB`            | 7:51     | 2636 kbps    | 1318 kbps | 2.00× |

(Both formatters are 1024-based — [`common.ts:133`](../../resolvers/src/common.ts)
and [`web/src/lib/format.ts:7`](../../web/src/lib/format.ts) — so the units
agree and no part of the gap is a MB/MiB mismatch. The displayed figures are
rounded to three significant digits, so each ratio carries about ±2%.)

**It is not a bug in the arithmetic; it is the wrong input.** Every size that
reaches the picker with a `~` on it is `bitrate × duration`, and the bitrate is
a number the manifest _declares_:

- [`dash.ts:411-413`](../../resolvers/src/manifest/dash.ts) —
  `estimateSizeBytes(rep.bandwidth, durationSec)`. DASH `@bandwidth` is defined
  by the spec as the **maximum** bitrate over any window of the buffering model.
  For VBR content it is a ceiling, and the ratios above are what that ceiling
  costs.
- [`ytdlp.ts:222-224`](../../resolvers/src/resolvers/ytdlp.ts) — `tbr × duration`,
  and for an adaptive format yt-dlp's `tbr` is derived from that same declared
  attribute.

Our own HLS parser already prefers `AVERAGE-BANDWIDTH` over `BANDWIDTH`
([`hls.ts:430`](../../resolvers/src/manifest/hls.ts)), which is the right
instinct — but `buildMasterVariant` attaches no `filesizeBytes` at all, so an
HLS master variant shows no size rather than a wrong one.

**Which of the two produced the reported cards is not established, and it could
not be from here** — the network is blocked in the dev container, so no probe
was run against the reported URLs, and no job store was available to read the
`resolver` field back out of. yt-dlp is priority 20 and enabled by default
([`api/src/config.ts:273`](../../api/src/config.ts)), so it is tried first and
is the likelier of the two; the browser tier at priority 50 parsing a DASH
manifest is the other candidate. **This ticket therefore fixes both**, which is
affordable because one mechanism serves them. Do not spend the ticket narrowing
it down.

**The second half of the Why, and the reason this is not just a cosmetic
change.** One number is doing two jobs. `estimateVariantBytes` reads
`variant.filesizeBytes` for the pre-flight cap
([`engine/src/estimate.ts:64`](../../engine/src/estimate.ts)), and that call site
says erring high is deliberate — an under-estimate defeats the whole check. The
picker wants a best guess and is being handed the ceiling. A _measurement_
serves both honestly, which is why sampling is worth more here than a correction
factor would be: it is the only answer that improves the cap and the label at
once. The runtime caps in `runner.ts` and `progressive.ts` remain the backstop
either way.

Not affected, and worth knowing so it is not "fixed" too: the progress bar. A
manifest download reports `totalBytes: null`
([`download/manifest.ts:180`](../../engine/src/download/manifest.ts),
[`download/segments.ts:92`](../../engine/src/download/segments.ts)) rather than
scaling against this estimate, which is the repo's never-fake-progress rule
already holding.

## Build

**The seam that constrains the whole design.**
[`manifest/types.ts`](../../resolvers/src/manifest/types.ts) says it in the
header: _"Parsers are pure: text in, description out. No fetching, no I/O, no
clock. Anything that needs the network belongs in the resolver that calls
them."_ So the sampler is not in a parser. It is a separate module the resolvers
call after parsing, and it reaches the network only through a tiny interface
they inject — which is also what lets the tests use fixtures instead of a live
CDN.

1. **`listMediaSegments(text, baseUrl)`, exported from
   [`manifest/hls.ts`](../../resolvers/src/manifest/hls.ts).** Pure, no I/O,
   beside the EXTINF grammar that already lives there — `parseMediaPlaylist`
   walks `EXTINF` at [`:340`](../../resolvers/src/manifest/hls.ts) and keeps
   only `totalDuration` and `firstSegmentUri`. Return
   `{ url, durationSec }[]` instead of duplicating the tag parsing in a second
   place, where it would drift. Do **not** widen `ParsedManifest` to carry the
   list: one consumer does not earn a field on the seam every parser fills in.

2. **`resolvers/src/size-sample.ts` — the sampler.** Its network dependency is
   two methods, nothing more:

   ```ts
   export interface SizeProbe {
     /** Total bytes of a resource: HEAD, falling back to a `Range: bytes=0-0` GET. */
     contentLength(url: string): Promise<number | undefined>;
     /** A playlist body. */
     text(url: string): Promise<string | undefined>;
   }
   ```

   The algorithm, and every bound on it:

   - Pick **one** reference rendition — the highest-bitrate variant that is
     samplable, ties broken by `id` so the choice is deterministic. Sampling
     every rendition would multiply the request count by the size of the ladder
     for no extra information, because the peak-to-average ratio is a property
     of the encoder, not of the rung.
   - Measure it. Three cases, and only three:
     - a rendition addressable as a single file (a progressive variant, or a
       DASH representation whose `fileUrl` the parser set) → one
       `contentLength` and the answer is **exact**;
     - an HLS media playlist → one `text`, then `listMediaSegments`, then at
       most **3** `contentLength` calls on segments spread across the timeline
       (not the first three — the opening segments of an encode are routinely
       atypical, and an init segment is not a media segment at all). Bytes
       summed over the sampled `EXTINF` seconds gives bytes per second;
     - a yt-dlp `http_dash_segments` format, whose `fragments` yt-dlp already
       lists with durations → the same three `contentLength` calls, no playlist
       fetch.
   - `factor = measured ÷ declared` for that rendition, then apply it to every
     variant whose size is flagged an estimate. Renditions we did not sample are
     scaled, not measured, so they stay `filesizeIsEstimate: true`. Only the
     exact single-file case may set it `false`.
   - **Discard the sample rather than clamping it** when `factor` falls outside
     `[0.2, 1.5]`, or when fewer than 2 segments or 6 seconds were covered. A
     wild ratio means the sample was wrong — an init segment counted as media,
     a byte-range playlist, a CDN answering 200 with an error page — and a
     clamped wrong answer is indistinguishable from a right one downstream.
   - **Fail open, always.** Any throw, any timeout, any missing
     `Content-Length`, `isLive`, no duration → return the variants untouched.
     A probe that cannot measure must never be a probe that fails.
   - Bound the whole thing: ≤4 requests per probe whatever the ladder looks
     like, a short deadline, and honour the `AbortSignal` the resolver is
     already carrying.

3. **Rebuilding the label is the part with a trap in it.** The size is baked
   into `variant.label` by `buildLabel`, so a corrected size means a corrected
   label. Everything `buildLabel` needs is already on `MediaVariant` except
   `fallback`, so rebuild from the variant rather than by string surgery on the
   rendered label. **Pin the round-trip**: rebuilding a `parseDash` variant with
   its _own_ size must reproduce its label byte for byte. If it does not, the
   reconstruction is lossy — the DASH audio-only path passes
   `humanAudioCodec(audioCodec)` into a `buildLabel` that applies
   `humanAudioCodec` again, which is the first place to look — and the fix is to
   make it lossless, not to accept a label that drifts.

4. **Wire it into the three resolvers, each with the fetch it already has.**
   - [`direct.ts`](../../resolvers/src/resolvers/direct.ts) — after
     `#resolveManifest` parses, with a `SizeProbe` over `this.#fetch` and the
     `headers` it already built.
   - [`browser.ts`](../../resolvers/src/resolvers/browser.ts) — after the parse
     in `#buildOutcome`, over `context.request` with `replayHeaders(hit)`, the
     same way `#loadManifest` fetches at
     [`:349`](../../resolvers/src/resolvers/browser.ts).
   - [`ytdlp.ts`](../../resolvers/src/resolvers/ytdlp.ts) — this one has no
     fetch at all today. Add `fetch?: typeof globalThis.fetch` to
     `YtDlpResolverOptions` and hand it the guarded one from
     [`api/src/resolvers.ts:87`](../../api/src/resolvers.ts), which is exactly
     what `DirectUrlResolver` is already given. With no fetch injected the
     resolver must behave as it does today — sampling off, not broken.

   `RequestContext` replay is not optional here: segments are gated the same way
   manifests are, and a sample that 403s is a sample discarded for the wrong
   reason. Log no bare URL — `redactUrl` from `@downloader/contract`.

5. **HLS master variants get a size they never had**, because the same
   measurement produces it: sample the reference media playlist, scale the rest
   of the ladder by declared bitrate. This is the one part of the ticket that
   _adds_ a number rather than correcting one, so keep it separable — if the
   round-trip in step 3 or the request budget in step 2 makes it awkward, drop
   it and say so in the Log rather than bending either.

Traps, all of them things that would produce a confidently wrong number:

- An HLS `#EXT-X-MAP` init segment and an `#EXT-X-BYTERANGE` playlist both break
  "one URL is one segment". Skip a byte-range playlist rather than sampling it
  wrong.
- A `Content-Length` on a `Range` response is the length of the _range_, not the
  resource; read `Content-Range` when the status is 206.
- `estimateVariantBytes` is not the place to fix this. It reads what the
  resolver put on the variant, and it is right to.

## Done when

1. A DASH manifest whose declared `@bandwidth` overstates its real segment bytes
   produces a variant size within 10% of the fixture's true byte count, proven
   by a test over a checked-in fixture and a stubbed `SizeProbe`.
2. An HLS master whose media playlist can be sampled produces sizes on every
   variant in the ladder, proven by a test; the sampled rendition's is within
   10% of the fixture's true bytes.
3. A single-file rendition is reported **exactly** and with
   `filesizeIsEstimate: false`, so no `~` reaches the label, proven by a test.
4. Every failure mode leaves the variants exactly as parsed — probe throws,
   probe times out, no `Content-Length`, live stream, no duration, factor out of
   range, fewer than 2 segments — proven by a test per mode.
5. Sampling costs at most 4 requests for a ladder of any size, proven by a test
   counting calls on a stub.
6. `buildLabel` round-trips: rebuilding a parsed variant with its own size
   reproduces its label byte for byte, proven by a test over the DASH and yt-dlp
   producers both.
7. `YtDlpResolver` with no `fetch` injected behaves exactly as it does today,
   proven by the existing yt-dlp suite passing unchanged.
8. `npm run check` and `npm test -- --project downloader` pass, and so does the
   `packages` project, since the repo-wide source scans live there.

## Log

- **2026-08-30** — Filed from a user report, with the four job cards in the Why
  as the reproduction. Two things this brief is _not_ sure of, both stated where
  they matter: which resolver produced the reported labels (network blocked, no
  job store — see the Why), and whether step 5 survives contact with step 3.
  The approach — sample real bytes rather than calibrate a correction factor —
  was chosen against three alternatives (a correction factor with no new
  requests; relabelling the figure as the upper bound it is; instrumenting
  estimate-vs-actual first and deciding later), on the grounds in the Why's
  second half: a measurement is the only one of the four that improves the
  pre-flight cap and the label at the same time.
