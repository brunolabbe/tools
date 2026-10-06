---
id: dl-79
tool: downloader
title: A manifest served with no recognisable type or extension is never captured
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# dl-79 — A manifest with no recognisable type or extension is never captured

## Why

`classifyMedia` in `resolvers/src/browser/media-match.ts` recognises a manifest
by its content type (`HLS_CONTENT_TYPE`, `DASH_CONTENT_TYPE`) or by its path
(`HLS_PATH`, `DASH_PATH`), and returns `undefined` for anything else. A player
that fetches its playlist from `/api/playlist?id=1` served as `text/plain` or
`application/octet-stream` therefore records no manifest hit, because nothing in
the collector ever reads a response body that hasn't already been classified
(`#captureBody` in `intercept.ts` runs only for `hls` and `dash`). The
segments it then fetches (`.ts`, `.m4s`) _are_ recorded, and are then dropped by
the ranking, so the probe ends in `NO_MEDIA_FOUND`, with nothing in the outcome
saying segments were seen.

Found by reading the code during a review of the resolver chain's false
"no video" cases, 2026-10-06. **Not yet reproduced**: building the fixture is
the first step.

## Build

1. **Reproduce first**: a fixture page that loads hls.js (or a hand-rolled MSE
   loader, if the fixtures already have one, so no new dependency) pointed at
   `/api/playlist?id=1`, served `text/plain; charset=utf-8`, whose segments are
   ordinary `.ts`. Expect an `hls` outcome. Record what `origin/main` returns.
2. In `intercept.ts`, for a response that `classifyMedia` leaves `undefined`,
   whose type is absent, `text/plain` or `application/octet-stream`, whose
   resource type is `fetch`/`xhr`, and which is small (pick and justify a cap,
   e.g. 256 KB; never read an unbounded body), read the start of the body and
   classify as `hls` on a leading `#EXTM3U` and as `dash` on an `<MPD` root.
   Then record it like any other manifest hit, so `#captureBody` and the rest of
   the pipeline see it unchanged.
3. Bound the cost: the sniff must not hold up network-quiet detection or the
   probe deadline (look at how `#pending` and `drain` already bound body
   reads).
4. When a probe ends with segment hits and no playable candidate, set a
   distinct `details.reason` on the `NO_MEDIA_FOUND` (e.g.
   `segments-without-manifest`), so the case can be diagnosed from the record
   instead of guessed. Check `@downloader/contract` for whether `reason` values
   are enumerated there. If they are, adding one is a contract change: **stop
   and say so** rather than editing it.

## Done when

- The step-1 fixture yields an `hls` outcome.
- A test proves an untyped, extensionless body beginning `<MPD` is classified
  `dash`, and that a large or non-`fetch`/`xhr` response is never read.
- A test proves a probe that saw only segments reports the new reason.
- `npm run check` and `npm test -- --project downloader` pass.

## Log

### 2026-10-06 — built (builder)

**Reproduced on `origin/main` (056aab7) before any source change.** The new
fixture `test/fixtures/pages/untyped-hls-text.html` (round 1 had one page that
took its routes from `location.search`; round 2 split it into one page per case)
fetches `/api/playlist?id=1` (served `text/plain; charset=utf-8`, body a media playlist
whose segments are `.ts`), then the segments. Against unmodified `src/`:

```
npx vitest run tools/downloader/resolvers/test/browser/browser-resolver.test.ts -t "dl-79"
 × an HLS playlist served as text/plain from an extensionless route is an hls outcome
 × an HLS playlist served as application/octet-stream is an hls outcome
 × a DASH manifest served as text/plain is a dash outcome
 × a probe that saw only segments says so in the error's reason
 Tests  4 failed | 1 passed | 50 skipped (55)
AppError: No downloadable video stream was found on that page.   (classify.ts, NO_MEDIA_FOUND)
```

After the change the same command gives `Tests 5 passed | 50 skipped (55)`.
(The fifth is a negative control, a page that fetched no segments, which is green
on both sides by design.)

**What changed.**

- `resolvers/src/browser/sniff.ts` (new): `isSniffable` decides from headers
  alone whether a body is worth reading; `sniffManifestKind` reads the first
  2 KiB. Kept out of `media-match.ts` on purpose, so this does not overlap dl-78's
  edits to the size and segment rules.
- `intercept.ts`: `#onResponse` calls `#sniffBody` when `classifyMedia` returns
  `undefined`. The read joins `#pending`, so `settle()` bounds it exactly as it
  bounds a typed manifest's body, and it never touches `#lastActivityAt`, which
  only `#touch` moves, so network quiet is not deferred. Everything else in
  `#onResponse` and `#record` is untouched.
- `classify.ts` and `resolvers/browser.ts`: `PageSignals.segmentCount`, and the
  final `NO_MEDIA_FOUND` carries `reason: "segments-without-manifest"` and
  `segmentCount` when the probe saw segments. It is the last branch, so a bot
  challenge, a login wall, an age gate, a geo block, an HTTP error and a timeout
  all still win over it.

**Which cap, and why.** Sniffed bodies: **1 MiB declared `Content-Length`**
(`MAX_SNIFF_BODY_BYTES`). A three-hour VOD at six-second segments is ~1,800
entries and, with a ~300-character signed URL on each, ~590 KB. The ticket's
example of 256 KB would have refused the long signed playlists this exists for,
and more than 1 MiB only turns every untyped `fetch()` into a megabyte-class
read. Three further bounds, none of which the brief named:

- **A response with no `Content-Length` is never read.** Playwright cannot stop
  a body part way, so a chunked response is unbounded and has nothing to compare
  to a cap. **This is a known miss**: an untyped, chunked playlist is still not
  captured. Measuring how common that is needs a real site, not a fixture, so it
  is unmeasured here.
- **A compressed response is held to 32 KiB declared** (`MAX_SNIFF_ENCODED_BYTES`)
  and, since round 2, to 2 reads a probe. _Round 1 said this "bounds a hostile
  page at ~32 MB"; that was false_ (see round 2): the declared length bounds
  nothing once Chromium inflates the body. A real playlist compresses ~10:1, so
  32 KiB still admits several hundred kilobytes of text.
- **At most 32 reads per probe** (`MAX_SNIFFS_PER_PROBE`), one per url, so a page
  that polls an untyped JSON endpoint does not pay for every poll.

Also only `status === 200` (a `206` need not start at byte 0), and only a type
that is absent, `text/plain` or `application/octet-stream`: an
`application/json` response says what it is, and is not read. Ad, analytics and
`/ads/` urls are refused through `isDeniedUrl`.

**What the brief had wrong: step 4's `details.reason` never reaches the record.**
The brief says to set it "so the case can be diagnosed from the record". But
`ResolverRegistry.resolve` swallows every `NO_MEDIA_FOUND` and, when the chain is
exhausted, throws its own error carrying only `{ url, attempts }`, where an
attempt is `{ resolver, code, durationMs }`. The browser tier's `details` are
dropped at that point, so in production (direct, yt-dlp, then browser) a
`reason` set only in `classifyFailure` is visible to a test that calls
`BrowserResolver` directly and to nothing else. dl-55's `navigated-away` has the
same fate; its tests also call the resolver directly. I made it reach the record:
`ResolverAttempt` (and the API's structural twin `ProbeAttempt`) gained an
optional `reason`, copied from `error.details.reason` by `attemptReason` in
`registry.ts`. That lands in `probe_outcomes.attempts_json` and in the error's
`details.attempts`. **Only a token is copied** (`/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/`,
at most 40 characters), because those rows are documented as holding "never a
path, a query string or an address", and some resolvers put a browser's own
message in `reason` (`classify.ts`, the navigation-error branch), which can
carry a url. Proved in `registry.test.ts`: "a resolver's reason survives the
fall-through (dl-79)". This also means `navigated-away` and `login-route` now
show in the record, as a side effect. That is a visible change to what a probe
outcome row holds, not a schema change; no migration, since the column is JSON.

**Contract.** `details` is `z.record(z.string(), z.unknown())` in
`contract/src/api.ts`; `reason` is not enumerated anywhere in
`tools/downloader/contract/src/`, so the stop condition did not fire. Re-checked
by reading the schema, not only by grep. No contract file is changed.

**Known limits.**

- _Round 1: `segmentCount` counted every `segment`-kind hit, `.vtt` and `.key`
  included. Narrowed in round 2; see below._
- _Round 1: a sniffed hit's `seq` was assigned after its body was read, and this
  entry said "order is preserved for dependent fetches". That was false: the
  gate measured an untyped master ranking below the typed variant it names,
  because a variant request is made once the master's response has arrived, not
  once the collector has finished reading it. Fixed in round 2._
- Not run against a real hls.js player. The fixture pages use a hand-written
  `fetch` chain with no `MediaSource` (the shape of `hls.html`; `mse.html`, which
  does use `MediaSource`, is not what it copies), as the brief allowed. The
  capture path under test is the same, because it sees the requests either way.

**Fold-in.** Nothing else was made free. dl-80 and dl-83 both end in a bare
"no video" that a `reason` token would explain, and `attemptReason` now carries
any token a resolver sets, so each can adopt one in its own ticket; I did not,
since neither is specified to.

**Process note.** A `.ts` file under `test/fixtures/` is linted as TypeScript
(`oxlint` read the placeholder segments as code and failed `npm run check`), so
the `.ts` segments are generated in `fixture-server.ts` instead of checked in.

### 2026-10-06 — round 2, after gate 1 (builder)

Gate 1 failed `056aab7..3a72069`. Each item below was reproduced before it was
changed, against the gate's own scripts (`redos.mjs`, `server.mjs`,
`harness.mjs`, repointed at this worktree's `dist`).

**1. High, `DASH_ROOT` backtracked exponentially: fixed.** Reproduced: the
gate's `harness.mjs resolver redos30` (a 211-byte `text/plain` body, k=30)
blocked the event loop for 60,789 ms. After the fix, same case, same server:
`{"outcome":"hls n=1 /good","totalMs":2916,"maxEventLoopBlockMs":3}`, and
`redos.mjs` gives `k=24 chars=169 ms=0.0` (the gate measured 345 ms). The prolog
and comments are now skipped with an `indexOf("-->")` loop and only
`^<(?:[\w.-]+:)?MPD[\s>]` is a regex. Test: `sniff.test.ts` "a head of nothing
but empty comments returns at once" asserts under 50 ms on `"<!---->".repeat(26)`
and on `.repeat(290)`. With the old regex put back it fails:
`AssertionError: expected 3966.224733 to be less than 50`. (The sized-down first
input is deliberate: at 290 the old pattern never returns, which would hang the
run instead of failing it.)

**2. Med, compressed body read in full: fixed as the owner decided (a),
2026-10-06.** Compressed (`Content-Encoding` other than identity) untyped
bodies are read on a separate budget of **2 per probe**
(`MAX_ENCODED_SNIFFS_PER_PROBE`), also counted against the 32. Why 2: one probe
needs one manifest, so a second is only slack for a url that turns out not to be
one; and each read can move up to Chromium's inspector-cache ceiling (the gate
saw 12 MiB read and 20 MiB refused) into Node, so two bound it at about 24-30 MiB
where 32 reads measured 384 MiB. Measured after the fix on the gate's
`harness.mjs collector par-32x12` (32 gzip bodies of 12 MiB, untyped):
`"bodies":[…2 entries of 12582912 bytes…]`, `peakNodeMB 228.3` (gate: 598),
`peakNodeExternalMB 52.4` (gate: 796), typed `.ts` segments reached the
collector at 2,532 ms (gate: 8,119). Test: `sniff.test.ts` "no more than
MAX_ENCODED_SNIFFS_PER_PROBE compressed bodies are read, whatever they hold"
(10 compressed responses, 2 reads; with the cap raised to 100 it fails, 10 reads
against 100 asserted, plus the "not charged to the compressed budget" test). The
`MAX_SNIFF_ENCODED_BYTES` comment is rewritten: the 32 KiB is a filter, **not a
bound**, and the old "~32 MB" was false. **What this does not bound:** Chromium's
own decode. The same run showed `peakChromeMB 985.6`, and the gate measured
2.36 GB for a 1 GiB `br` body; nothing in the collector can limit that. The
typed `#captureBody` path has the same exposure with no budget at all, filed as
**dl-91** (`tools/downloader/docs/work/dl-91-a-compressed-typed-manifest-body-is-read-in-full.md`).

**3. Med, `seq` after the read: fixed.** Reproduced: `harness.mjs resolver
untyped-master-neutral` (an untyped master, then a typed `media.m3u8` variant)
gave the gate `hls n=1`; after the fix it gives
`{"outcome":"hls n=2 /v/high/index.m3u8 /v/low/index.m3u8"}`, the master's
variants. `#sniffBody` now reserves `this.#seq++` when the response arrives and
passes it through `HitPatch.seq`; `#record` uses it in place of its own counter.
Test: `sniff.test.ts` "a slowly-read untyped master ranks above the typed variant
it names" (with `seq,` removed from the patch it fails:
`expected [ …(2) ] to deeply equal [ 'https://site.example/master', … ]`). The
round-1 sentence "order is preserved for dependent fetches" was wrong and is
corrected above. A cost of reserving at arrival: a sniffed response that turns
out not to be a manifest still uses a number, so a page that polls many untyped
JSON endpoints pushes every later hit's `seq` up. Relative order is unchanged and
`rank.ts` only reads `seq` through `max(0, 100 - seq * 10)`, which a busy page
already exhausts.
**The gate's separate, pre-existing cause** (an extensionless master never earns
`MASTER_NAME`'s +120) is filed as **dl-92**, not fixed. Re-measured:
`harness.mjs resolver untyped-master` (variant named `index.m3u8`) still gives
`hls n=1 /v/high/index.m3u8` after this round, scores 1150 against 1260.

**4. Med, `segments-without-manifest` on a page that played nothing:
narrowed, with one case refuted.** `countPlayedSegments` in `classify.ts`
(called from `resolvers/browser.ts`; `media-match.ts` untouched) counts a segment
hit only if it was confirmed, has a status below 400, is not a `.vtt` or `.key`,
and has no `text/*`, JSON, JavaScript or TypeScript content type. The
`PageSignals.segmentCount` docblock no longer says "playback demonstrably
started"; it says evidence of fetching, not proof of playing. Measured on the
gate's server through `BrowserResolver`: the `vtt` and `key` pages now end
`NO_MEDIA_FOUND reason=undefined`. **Refuted: the `.ts` _script_ page.** The
gate's `ts-script` case serves `/sub/app.ts` as `application/octet-stream`, and
still ends `reason=segments-without-manifest segments=1`. By URL, status and
type it is byte-for-byte what an MPEG-TS segment looks like, and the collector
records no other signal (no `resourceType` is kept on a hit), so no rule over what
it holds can separate them. A real script served as a script type is excluded.
Test: `sniff.test.ts` "countPlayedSegments", with a row per exclusion.

**5. Low, CodeQL `js/client-side-request-forgery`: fixed.** The fixture no
longer reads `location.search`. One shared `untyped-player.js` takes the routes as
call arguments, and five pages (`untyped-hls-text`, `untyped-hls-octet`,
`untyped-dash-text`, `untyped-segments-only`, `untyped-no-segments`) call it with
literals. Whether the alert closes is for PR #373's `CodeQL` check to say; I have
not seen it run on this head.

**6. Low, the Log's "hand-rolled loader the other fixtures use": corrected**
above. `untyped-*.html` has no `MediaSource`; it copies `hls.html`'s `fetch`
chain, not `mse.html`'s.

**7. Low, `rank.ts`:** filed as dl-92, per the owner, with the measurement.

**Unchanged, as asked.** `attemptReason` dropping `ERR_CERT_*` and three of
yt-dlp's four markers, and the two documented misses (chunked untyped playlist;
a manifest after 32 junk responses), stay as the Log wrote them in round 1.
Neither became free.

**Fold-in.** None. dl-91 and dl-92 are filed because the owner decided to file.
