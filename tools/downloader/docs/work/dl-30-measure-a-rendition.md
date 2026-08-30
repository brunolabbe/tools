---
id: dl-30
tool: downloader
title: Measure a rendition instead of trusting its declared bitrate
kind: fix
status: done
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
   by a test over a checked-in fixture and a stubbed `SizeProbe`. **The fixture
   has to be able to fail the claim** — a uniform one cannot, since any sample of
   it is its own mean.
2. An HLS master whose media playlist can be sampled produces sizes on every
   variant in the ladder, proven by a test; the sampled rendition's is within
   10% of the fixture's true bytes.
3. A single-file rendition is reported **exactly** and with
   `filesizeIsEstimate: false`, so no `~` reaches the label, proven by a test.
4. Every failure mode leaves the variants exactly as parsed — probe throws,
   probe times out, no `Content-Length`, live stream, no duration, factor out of
   range, fewer than 2 segments — proven by a test per mode.
5. Sampling costs at most 9 requests **per component** — a playlist body and 8
   segment reads — for a ladder of any size, and a split rendition has two
   components, so 18 is the ceiling. Proven by tests counting calls on a stub.
   _Rewritten twice during the build: it said 4 outright, then 4 per component.
   Both numbers are in the Log with the measurement that moved them._

6. `buildLabel` round-trips: rebuilding a parsed variant with its own size
   reproduces its label byte for byte, proven by a test over the DASH and yt-dlp
   producers both.
7. `YtDlpResolver` with no `fetch` injected behaves exactly as it does today,
   proven by the existing yt-dlp suite passing unchanged.
8. `npm run check` and `npm test -- --project downloader` pass, and so does the
   `packages` project, since the repo-wide source scans live there.

### Gate 1

_Citations resolve against the tip of this branch, not against the commit
reviewed: the branch moved under every finding below, and a table pointing at
lines that no longer hold what it claims is worse than no table. Where a finding
quotes what the reviewed tree did, it says so._

**2026-08-30 — CONCERNS**, reviewed at `2478756` on a different model from the
one that wrote the code, as `docs/01-TICKETS.md` requires. Recorded here in full
because the reviewer's worktree does not survive its session and this file is
the only durable place for it. Every finding was reproduced by this builder
before being accepted; all five are fixed or closed, and two of them changed the
design rather than the tests.

| #   | Done when                                        | Proven by                                                                                                                                                                                         | Verdict  |
| --- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | DASH overstatement corrected to within 10%       | `size-sample.test.ts:156` — declaration is 1.5x over the truth, correction lands inside 10%                                                                                                       | proven   |
| 2   | HLS master ladder gains sizes; sampled rung ≤10% | `size-sample.test.ts:195` (every rung) and `:202` (0.2% against a 2.5x VBR spread)                                                                                                                | proven   |
| 3   | Single-file rendition exact, no `~`              | `size-sample.test.ts:148`                                                                                                                                                                         | proven   |
| 4   | Every failure mode leaves the variants as parsed | `size-sample.test.ts:261` throw, `:275` no length, `:281` half a split, `:288` live, `:296` no duration, `:304` implausible factor, `:314` too few segments, `:322` aborted, `:335` templated MPD | proven   |
| 5   | ≤9 requests per component, ≤18 for a split       | `size-sample.test.ts:220` (9, one component) and `:233` (14, two components, asserted under 18)                                                                                                   | proven   |
| 6   | `buildLabel` round-trips byte for byte           | `size-sample.test.ts:361` (DASH audio-only, the one that could not) and `:381` (yt-dlp)                                                                                                           | proven   |
| 7   | `YtDlpResolver` with no `fetch` is unchanged     | `ytdlp.test.ts:235`, beside `:245` which drives the sampled path                                                                                                                                  | proven   |
| 8   | `check`, `downloader`, and the repo-wide scans   | re-run at the tip: `npm run check` exit 0; downloader 53 files / 797 tests; `core` + `repo` 5 / 99                                                                                                | verified |

| #   | Finding                                                                   | Disposition                          |
| --- | ------------------------------------------------------------------------- | ------------------------------------ |
| F1  | The one-rung factor is asserted, and the 10% fixture could not falsify it | Accepted; **changed the sampler**    |
| F2  | `BrowserResolver#sizeProbe` is not merely untested but unobservable       | Accepted; **extracted and tested**   |
| F3  | The round-trip pin misses `dash.ts`'s audio-only producer, the named trap | Accepted; producer fixed and pinned  |
| F4  | The 18-request ceiling is derived, never produced by a test               | Accepted; fixture found, test added  |
| F5  | `onSkip` has no consumer, so the fail-open path is invisible              | Accepted; hook removed, gap recorded |

**F1 is the finding that earned the gate, and it was worse than reported.** The
reviewer observed that the HLS fixture applied one bytes-per-second figure to
every segment, so a 3-segment sample was its own mean and the "within 10%" claim
could not fail. Reproducing that meant building a fixture that could: 60
segments of 6 s under a capped-VBR profile, segments ranging 2.42 MB to 6.08 MB.
Against it, the shipped sampler was **29.2% low** — the same order as the error
this ticket exists to remove. It would have passed its own acceptance and been
wrong in production.

Two things came out of measuring the fix rather than guessing it, across a family
of profiles (scene periods 7 to 41, a motion component, and a bursty profile
where 8% of segments carry 2.6x the mean), at playlist lengths from 20 to 900:

```
k     evenly spaced, worst      low-discrepancy, worst
3            27.7%                      27.7%
4            28.9%                      18.6%
6            25.0%                      13.8%
8           100.7%                      13.8%
10           17.8%                       9.3%
12           16.8%                       9.1%
```

**Taking more evenly spaced samples does not converge** — 8 is worse than 6, and
peaks at a 101% error where the sample stride lines up with the burst period.
That is aliasing, and it is the real defect: video is periodic, and a fixed
stride samples it in step. Sample placement now comes from the golden ratio,
which is low-discrepancy by construction, and the count is 8 rather than 3. On
the VBR fixture the error is **0.20%**, and `size-sample.test.ts:202` pins it
inside 1% — a bound the shipped sampler missed by two orders of magnitude.

The eight reads are now concurrent rather than sequential. The comment they
replace claimed sequential requests were politer to a rate-limiting CDN; at
three that cost little, but eight sequential HEADs against a slow origin would
put the sampler's own worst case past the caller's whole deadline, and eight
concurrent ones are fewer than any media player opens to start playing.

**What F1 leaves open, deliberately, and it is the honest limit of this ticket.**
Nothing validates that the reference rung's factor describes the _other_ rungs.
Packagers routinely give lower rungs a tighter rate-control profile, and that is
exactly where a top-rung factor would miscalibrate — in the understating
direction, which is the one the pre-flight cap cares about. Sampling a second
rung would close it and doubles the request budget. This is recorded rather than
resolved: it is a decision about how much a probe may spend, and the ticket's
own budget argument is the thing it would reopen. The `[0.2, 1.5]` band does not
help here — it bounds the reference rung's own plausibility and nothing else.

**F2 was reproduced exactly as described.** The suite's recording parsers set no
`bitrateBps` (`test/browser/helpers/fake-parsers.ts:38-45`), so the sampler's
`(variant.bitrateBps ?? 0) > 0` filter was empty for every browser test and
`#sizeProbe` was never called; the one test using the real parsers asserts only
`variants.length > 0`. A correct probe and a broken one were indistinguishable.
The fix is not another test but a seam: the probe moved to
`src/browser/size-probe.ts` behind an `ApiRequestLike` interface naming the three
Playwright calls it makes, so the call shape is now checkable without launching
a browser — `test/browser/size-probe.test.ts`, 7 tests including the ranged-GET
fallback, the `Content-Range`-only rule, and the deadline it refuses to spend.

**F3 is fixed at the producer, not at the test.** `dash.ts` passed
`humanAudioCodec(audioCodec)` into `buildLabel` while storing the raw codec on
the variant, so that one label was not reproducible from the variant's own
fields — the exact trap the Build section named. The reviewer's finding that
`humanAudioCodec` is idempotent over its whole table is correct and was
re-derived here, so no label changed; but relying on a fixed-point property that
nothing tests is what the Build section said not to accept. The producer now
passes the raw codec, and `dash-audio-only.mpd` plus `size-sample.test.ts:361`
pin the round trip.

**F4 needed no new fixture, only the right one.** `hls-master-split-audio.m3u8`
has audio renditions carrying their own `URI`, so both components take the
playlist path — the shape that actually approaches the ceiling. Measured at 14
requests, asserted under 18.

**F5: the hook is gone rather than wired.** `onSkip` had no consumer, and the
resolvers are libraries with no logger to give it. A seam with no caller is not
observability, it is the appearance of it. The gap the reviewer names is real
and is recorded in the Log: a CDN that refuses every HEAD is currently
indistinguishable from a source with nothing to improve.

**What the gate did not do**, and neither did this builder: no Playwright e2e run
and no container build. Neither runs locally; nothing here changes what the image
ships or what the browser bundle loads, but that is an argument from the diff
rather than from a run.

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

- **2026-08-30** — Built. `npm run check` green, `npm test -- --project downloader`
  green at 52 files / 788 tests, and the `core` and `repo` projects green at
  5 / 99 — those two carry the repo-wide source scans, and `--project packages`
  in Done-when 8 is not a project name (the four are `core`, `repo`,
  `downloader`, `planner`). Nothing here was written before the command that
  proves it exited.

  **Three things the brief had wrong, each found by building it.**

  **The request budget was wrong, and Done-when 5 is rewritten above rather than
  quietly satisfied.** The brief said "at most 4 requests per probe", which
  assumed a rendition is one thing to weigh. It is not: a variant with an
  `audioUrl` is two files whose _combined_ bitrate is what `bitrateBps`
  declares. Weighing only the video and dividing by that declaration understates
  the factor by the audio's share — 4% on a 3 Mbps rung, 18% on a 600 kbps one —
  and understating is the direction that matters, because the same
  `filesizeBytes` feeds the pre-flight cap at
  [`engine/src/estimate.ts:64`](../../engine/src/estimate.ts), where erring high
  is deliberate. Every video representation in
  `dash-ondemand-baseurl.mpd` is split, so this is not a corner: it is the first
  fixture the ticket touches. Both halves are weighed or neither is, which costs
  a second component and puts the ceiling at 8. Measured cost on the two
  fixtures: **2 requests** for the split DASH pair, **4** for the HLS playlist.

  **A duration is not always available before the sample, and the HLS half of
  the ticket turns on it.** An HLS master carries no `EXT-X-ENDLIST` and no
  duration anywhere — `parseHls` returns `durationSec: undefined` for one, and
  every variant is a media-playlist URL. So the brief's ordering (find a
  duration, then measure) makes step 5 impossible, and the whole ladder would
  have been unmeasurable for want of a number the sample itself reads. The
  segment list now reports what it covers and the duration falls out of the
  measurement. Verified against the fixture: `hls-master-multibitrate.m3u8` has
  five rungs, no sizes and no duration before, and five sizes after.

  **A yt-dlp format URL has no path extension** —
  `videoplayback?itag=140&mime=audio%2Fmp4` — so the first cut, which decided
  reachability from the extension alone, judged the _audio_ half of every
  YouTube-shaped split format unreachable and skipped the rendition. The
  variant's `protocol` is what says a URL is a plain file, and it now governs
  both halves rather than only the first.

  **Which resolver produced the reported cards is still not established, and the
  fix covers all three tiers anyway.** The network is blocked in this container
  (`curl https://twitter.yandex.com.tr/` times out), so nothing was probed
  against the reported URLs, and there was no job store to read a `resolver`
  field out of. What is now measured rather than argued: `yt-dlp` is priority 20
  and `enableYtdlpResolver` defaults true, so it is tried first; the browser
  tier at 50 is the other candidate; and `hls.ts`'s `buildMasterVariant`
  attaches no `filesizeBytes` at all, so an HLS master could not have produced a
  `~107 MB` label under any tier. That leaves `parseDash` and `mapYtDlpInfo`,
  and both are now sampled.

  **Step 5 survived step 3, which the brief was unsure of.** The label rebuild
  goes through `buildLabel` from the variant's own fields, and the round-trip is
  pinned in both directions: a DASH variant and a yt-dlp variant, each rescaled
  by a factor of exactly 1.0, keep their labels byte for byte. The
  `humanAudioCodec` double-application the brief warned about is real but
  harmless — `lookup(codec, NAMES) ?? codec` falls through on an
  already-humanised name — so no producer needed changing.

  **A behaviour change worth naming: the direct resolver now makes a third
  request on a manifest probe.** `direct.test.ts` pinned the sequence as
  `["HEAD", "GET"]` and it is now `["HEAD", "GET", "GET"]`; that test asserts
  the new sequence and, beside it, that the sample changed nothing — its stub
  answers every GET with the master playlist, which lists no segments. A second
  test drives the whole path with a stub that does serve a media playlist, and
  checks that the `Referer` replay reaches the segment HEADs and not just the
  manifest.

  **What is not proved.** No e2e run and no container build — neither runs
  locally, and nothing here changes what the image ships or what the browser
  loads, but that is an argument from the diff rather than from a run. The
  browser tier's `#sizeProbe` is wired the same way as `#loadManifest` and is
  covered by no test of its own: Playwright's `APIRequestContext` is not
  stubbable from the resolvers suite the way a `fetch` is, and the sampler it
  hands off to is tested directly. That is the thinnest part of this branch and
  the place a reviewer should look first.

  **Not folded in, deliberately.** The `~` in a picker label means "estimate",
  and after this ticket it can mean two quite different things — a rung scaled
  from another rung's measurement, and a declaration nothing could weigh. The
  contract has no field for that distinction (`filesizeIsEstimate` is a boolean)
  and `CLAUDE.md` forbids editing a contract unilaterally, so it is left alone
  rather than smuggled in.

- **2026-08-30, after gate 1** — Five findings, all accepted, two of them design
  changes rather than test changes. The record is in the Review section above;
  what belongs here is what the next person needs and cannot read off the diff.

  **The sampler that passed its own acceptance was 29% wrong.** Three evenly
  spaced samples looked fine against a fixture that applied one bytes-per-second
  figure to every segment, and that fixture is why it looked fine. This is the
  lesson worth keeping: an accuracy claim tested against uniform data is not an
  accuracy claim, and I wrote one without noticing. The fixture is now
  `hls-media-vbr.m3u8` and the profile that fills it is in the test, not in the
  playlist.

  **Aliasing, not sample count, was the defect.** Going from 3 evenly spaced
  samples to 8 made the worst case _worse_ — 25% to 101% — because a fixed
  stride falls into step with periodic content. The table is in the Review
  section. Anyone tempted to tune `MAX_SEGMENT_SAMPLES` should change the
  placement rule first and re-run that measurement; the constant's comment says
  so, and the numbers there are measured, not reasoned.

  **A known interaction, from dl-27's builder via its orchestrator, recorded here
  because it will otherwise cost someone a long afternoon.** `FFMPEG_CA_FILE`
  reaches the egress proxy and ffmpeg but has never reached the undici
  dispatcher (`EgressDispatcherOptions.requestTls` is documented "Unset in
  production"). On a deployment whose origins chain to the operator's private
  root, an ffmpeg download therefore succeeds while a `GuardedFetch` request
  fails on trust. That asymmetry is pre-existing — resolvers already fetch
  manifests through `GuardedFetch` — and dl-30 does not cause it, but dl-30 makes
  it reachable on _segment_ origins for the first time. If a size probe ever
  fails on trust in such a deployment while the download works, that is the
  reason. Both sessions agreed it is a separate ticket and not a blocker; it is
  unfiled as of this writing.

  **Two gaps this branch knowingly leaves open.** Neither is a defect, both are
  places a later reader might otherwise think the code is trying and failing:

  - **The cross-rung assumption** — the reference rung's factor is applied to
    every other rung, and nothing checks that it should be. See the Review
    section for why closing it is a budget decision rather than a fix.
  - **A sampling failure is silent.** With `onSkip` removed there is no signal
    anywhere that the fail-open path is firing, so a CDN that refuses every HEAD
    looks exactly like a source with nothing to improve. Giving the resolvers a
    logger is a larger change than this ticket, and a hook with no caller was
    not a substitute for one.

  **Not done, deliberately: `EXT-X-BYTERANGE` playlists are skipped when they
  could be exact.** Such a playlist states every segment's length in the manifest
  itself, so summing them would give the true size with _zero_ requests — better
  than any sample. `listMediaSegments` returns `[]` for them instead, because one
  URL there is many segments and a `Content-Length` describes the file. Closing
  it is a self-contained improvement and a good next ticket; it is named here
  rather than filed because it is an enhancement with no reproduction behind it.

  **Gates at the tip.** `npm run check` exit 0. `npm test -- --project downloader`
  exit 0, 53 files / 797 tests. `npm test -- --project core --project repo`
  exit 0, 5 files / 99 tests — that is where the repo-wide spawn-safety and
  image-closure scans live. Done-when 8 says `--project packages`, which is not a
  project name; the four are `core`, `repo`, `downloader`, `planner`.
