---
id: dl-79
tool: downloader
title: A manifest served with no recognisable type or extension is never captured
kind: fix
status: done
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

## Review

**Gate: FAIL** — 2026-10-06 · `056aab7..3a72069` · Opus 5.5, depth full

| Done when                                                                                                       | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The step-1 fixture yields an `hls` outcome                                                                      | `resolvers/test/browser/browser-resolver.test.ts` › "an HLS playlist served as text/plain from an extensionless route is an hls outcome" ✓. It asserts `variants[0].protocol === "hls"` and the `/api/playlist?id=1` url. Reproduced red on base `src/` (4 failed, 1 passed of the 5 dl-79 tests) and green at head (5 of 5).                                                                                                                                                                                                                                                                                                                                        |
| An untyped, extensionless `<MPD` body is classified `dash`; a large or non-`fetch`/`xhr` response is never read | **unproven** for the "large" clause. `dash`: `sniff.test.ts` › "an untyped, extensionless body beginning <MPD is a dash hit", and `browser-resolver.test.ts` › "a DASH manifest served as text/plain is a dash outcome" ✓. Non-`fetch`/`xhr`: `sniff.test.ts` › "a %s response is not read" (`reads() === 0`, with "an untyped HLS playlist becomes an hls hit" as the companion that fails on an empty result) ✓. Large: `sniff.test.ts` › "a response over the cap is not read" proves only a large _declared_ length. A gzip body of a few KB that inflates to 12 MiB is read in full (see the first **med** below). The `dash` clause also carries the **high**. |
| A probe that saw only segments reports the new reason                                                           | `browser-resolver.test.ts` › "a probe that saw only segments says so in the error's reason" (`reason` and `segmentCount === 2`), plus `sniff.test.ts` › "names the reason and the count on the NO_MEDIA_FOUND" ✓. The reason reaches the record through `registry.test.ts` › "a token reason is carried on the attempt and on the chain's own error" ✓.                                                                                                                                                                                                                                                                                                              |
| `npm run check` and `npm test -- --project downloader` pass                                                     | verified: `npm run check` exit 0. `npm test -- --project downloader` exit 0, 98 files passed and 1 skipped, 1632 tests passed and 2 skipped. The test diff adds 43 tests and deletes none. CI on `3a72069`: `check` and `test (ubuntu-latest)` pass. **`CodeQL` fails**, and the first bullet below is the reason.                                                                                                                                                                                                                                                                                                                                                   |

- **high** · Done-when line 2 depends on it (the `dash` sniff) · `DASH_ROOT` in
  `resolvers/src/browser/sniff.ts` backtracks exponentially:
  `(?:<!--[\s\S]*?-->\s*)*` can split each `--><!--` boundary two ways. The
  input is any untyped `fetch`/`xhr` body of 200 bytes or more, cut to 2 KiB.
  The match runs synchronously on the API's event loop.
  - Microbenchmark of `sniffManifestKind("<!---->".repeat(k) + "x")` from
    `dist`: k=20 took 10.5 ms, k=22 37 ms and k=24 158 ms, doubling with each
    added comment. 2048 plain characters took 0.01 ms.
  - End to end: a page `fetch()`es a 211-byte `text/plain` body (k=30). Run
    through the real `BrowserResolver` with `timeoutMs: 20000`, the **event loop
    blocked for 60,789 ms** and the probe ended `TIMEOUT` after **60,995 ms**,
    three times its deadline. The control page blocked for 4 ms and resolved
    `hls` in 2.9 s.
  - k=34 is 239 bytes, which by the same doubling is roughly 16 minutes of a
    frozen API, every other job included.
  - CodeQL's `CodeQL` check on `3a72069` fails with this exact alert, reported
    as "may cause exponential backtracking on strings starting with '<!--'".
  - Remedy: skip the prolog and comments with an `indexOf("-->")` loop, then
    test `^<(?:[\w.-]+:)?MPD[\s>]`. Add a test that `sniffManifestKind` returns
    within a fixed budget on `"<!---->".repeat(290)`.
  - Reproduction: `redos.mjs` and `harness.mjs resolver redos30` against
    `server.mjs` (route `/redos?k=N`), in this gate's scratch directory.
- **med** · Done-when line 2 depends on it ("a large … response is never read")
  · For a compressed response, the bound is Chromium's, not the code's.
  `MAX_SNIFF_BODY_BYTES` is checked _after_ `response.body()` has moved the
  whole inflated body into Node. A per-read limit exists only because
  Chromium's inspector cache evicts large bodies: 12 MiB was read, while 20 MiB
  failed with "Request content was evicted from inspector cache". Measured
  through the real collector:
  - 32 untyped gzip responses of about 12 KB each, at 12 MiB inflated, moved
    **384 MiB into Node**. Peak RSS went from 156 MB to **598 MB**, and the peak
    external and array-buffer memory was 796 MB.
  - Typed `.ts` segment events reached the collector at **8,119 ms**, against
    824 ms when the same bodies were served `application/json` and not sniffed.
  - A typed manifest beside them still won, but the probe took 10.5 s against
    3.5 s.
  - The comment on `MAX_SNIFF_ENCODED_BYTES` ("32 KiB bounds that at ~32 MB")
    is false against the measurement. 1 GiB fits in 1,761 bytes of `br` and in
    1,949 bytes of `gzip, gzip`, and Chromium decoded both over plain http, its
    RSS reaching 2.36 GB.
  - Pre-existing in kind: the typed `#captureBody` path has no encoding check
    and is bounded by `MAX_HITS` (400), not 32. 32 typed `.m3u8` bombs measured
    736 MB peak.
  - **Open decision**:
    - (a) Keep encoded sniffing on a separate, small read budget (for example
      2 per probe, about 30 MiB worst case), correct the comment, and file a
      ticket for the typed path. **Recommended.**
    - (b) Never sniff a content-encoded response. Cheaper and fully bounded,
      but it misses gzip-served untyped playlists, which CDNs commonly serve.
- **med** · no Done-when line depends on it · A sniffed hit gets its `seq` only
  after the body read returns, so an untyped master ranks below its own typed
  variant.
  - Page: `fetch("/master")`, where the master is untyped with two
    `STREAM-INF`s, awaited, then a typed `/v/high/media.m3u8`.
  - Collector hit order: `hls:/v/high/media.m3u8`, `segment`, `segment`,
    `hls:/master`, so the master has seq 3.
  - Outcome: `hls n=1 /v/high/media.m3u8`, against `n=2` for the master alone.
    Scores from `rank.ts`: variant 1150, master 1120. With the master at its
    true order, the master scores 1150 against the variant's 1140 and wins.
  - This contradicts the Log's "order is preserved for dependent fetches".
  - Remedy: reserve the `seq` when the response arrives and pass it to
    `#record`.
  - A separate, pre-existing cause: an extensionless master can never earn
    `MASTER_NAME`'s +120, so a variant named `index.m3u8` wins either way
    (measured `n=1`). That belongs to `rank.ts` and is worth a ticket.
- **med** · no Done-when line depends on it · `segments-without-manifest` fires
  on a page that played nothing. A page fetching only one `.vtt`, only one
  `.key`, or only one `.ts` _script_ each ended `NO_MEDIA_FOUND
reason=segments-without-manifest segments=1` (measured through
  `BrowserResolver`). `segmentCount` also counts unconfirmed request-only hits
  and hits with a status of 400 or more. The `PageSignals.segmentCount`
  docblock ("Playback demonstrably started") is false for these cases. The
  builder deferred this to dl-78 because the segment set lives in
  `media-match.ts`. The count could instead be narrowed where it is taken, in
  `resolvers/browser.ts`, to confirmed hits with a status below 400 and a media
  segment type or extension, without touching `media-match.ts`.
- **low** · `attemptReason` leaks nothing, but it drops legitimate causes. All 7
  `reason` producers in `resolvers/src` were run through the real registry into
  a real `JobStore`, and each `attempts_json` row was read back:
  - Kept: `login-route`, `login-form`, `segments-without-manifest`,
    `navigated-away`.
  - Dropped: every Chromium `ERR_CERT_*` token, and 3 of yt-dlp's 4 markers,
    including `certificate_verify_failed`, the one urllib output matches first.
    Only `certificateverifyerror` is kept.
  - Dropped, correctly: the `UNREACHABLE` first line (`page.goto: net::… at
https://…`).
  - A bare single-label host such as `intranet-db` passes the filter, but no
    live producer emits one.
- **low** · Two documented misses, measured. A chunked (no `Content-Length`)
  untyped playlist ends `NO_MEDIA_FOUND segments-without-manifest`. After 32
  junk `text/plain` responses the manifest is never read: 31 junk responses
  still gave `hls`, while 32 gave `NO_MEDIA_FOUND`. The Log names both as known
  limits.
- **low** · CodeQL also reports `js/client-side-request-forgery` twice in
  `test/fixtures/pages/untyped-manifest.html`, for `fetch(src)` and `fetch(url)`
  built from `location.search`. It is a fixture served on 127.0.0.1 only, and
  the alerts keep the check red until they are dismissed with a reason or the
  fixture takes its routes from a fixed table.
- **low** · The Log says the fixture is "the hand-rolled loader the other
  fixtures use". `untyped-manifest.html` has no `MediaSource`, unlike
  `mse.html`. Its `fetch` shape matches the MSE fixture, so the capture path
  under test is the same.
- **dropped** · A lying `Content-Length` (100 declared, 50 MB sent) is not a
  defect. Chromium frames by the declared length: 100 bytes were read in 31 ms,
  and Node grew by 5 MB.
- **dropped** · A declared 4096 bytes that never arrive (socket held open) are
  bounded by `settle()`: the probe ended in 5.9 s.
- **findings** · the hunt returned 10: 8 carried (1 high, 3 med, 4 low) and 2
  dropped.
- Positive controls:
  - With `isSniffable`'s length cap removed, 3 of 33 `sniff.test.ts` tests went
    red.
  - With the post-read `byteLength` check removed from `intercept.ts`, 1 of 33
    went red ("a body longer than it declared is read once and then dropped").
  - With `attemptReason` passing any string, 3 of 32 `registry.test.ts` tests
    went red.
- Invariants:
  - Checked: no cross-tool import; no new throw, so `AppError` is untouched; no
    new log line, so redaction is not affected; the sniff issues no request of
    its own, and sniffed urls still pass `assertAllAllowed` in
    `routes/probe.ts`; contract unchanged; `sniff.test.ts` registered (`vitest
list --project downloader`); no `any` or `console` in the diff.
  - Skipped as untouched: shell and kill-tree, progress, Dockerfile closure, and
    routes.
- NFR: security, the **high** above · performance, the first **med** ·
  reliability, the seq **med** · maintainability, the `segmentCount` docblock and
  the `MAX_SNIFF_ENCODED_BYTES` comment, both false as written.

### Gate 2

**Gate: CONCERNS** — 2026-10-06 · `3a72069..69d13aa` · Opus 5.5, re-gate of the round's diff

| Done when                                                                                                       | Proof                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The step-1 fixture yields an `hls` outcome                                                                      | `browser-resolver.test.ts` › "an HLS playlist served as text/plain from an extensionless route is an hls outcome" ✓. It now runs on `untyped-hls-text.html`, with the same assertions.                                                                                                                                                                                                                                |
| An untyped, extensionless `<MPD` body is classified `dash`; a large or non-`fetch`/`xhr` response is never read | `sniff.test.ts` › "an untyped, extensionless body beginning <MPD is a dash hit" and "a %s response is not read" ✓. Large: "a response over the cap is not read" covers a declared length. "no more than MAX_ENCODED_SNIFFS_PER_PROBE compressed bodies are read, whatever they hold" covers a compressed one, held to 2 reads by the owner's decision (a). Measured: 2 reads, peak Node RSS 227.4 MB (gate 1: 598) ✓. |
| A probe that saw only segments reports the new reason                                                           | `browser-resolver.test.ts` › "a probe that saw only segments says so in the error's reason" ✓, plus `sniff.test.ts` › "countPlayedSegments" ✓.                                                                                                                                                                                                                                                                        |
| `npm run check` and `npm test -- --project downloader` pass                                                     | verified: `npm run check` exit 0. `npm test -- --project downloader` exit 0, 98 files passed and 1 skipped, 1648 tests passed and 2 skipped. Gate 1 had 1632 passed, and no test was deleted. CI on `69d13aa`: every check passes, `CodeQL` included.                                                                                                                                                                 |

Gate 1's findings:

- **high, ReDoS in `DASH_ROOT`: fixed.**
  - `redos30` through `BrowserResolver` gives `hls n=1 /good` in 2,883 ms, with
    a 2 ms longest event-loop block. Gate 1 measured 60,995 ms and 60,789 ms.
  - `redos.mjs`: k=24 takes 0.0 ms.
  - The test pins the property. With the old regex planted beside the new
    code, `sniff.test.ts` › "a head of nothing but empty comments returns at
    once" fails in 736 ms (`expected 730.21 to be less than 50`) instead of
    hanging, and 1 of 49 tests is red.
  - Using `repeat(26)` is the right call. The 50 ms bound has a margin of more
    than ten times on this machine, and the second, `repeat(290)` assertion is
    never reached against the old pattern.
- **med, compressed reads: fixed per the owner's option (a).**
  - `par-32x12` (collector) read 2 bodies of 12,582,912 bytes. Peak Node RSS was
    227.4 MB and peak external memory 52.8 MB; typed segments arrived at
    1,635 ms. Gate 1 measured 598 MB, 796 MB and 8,119 ms.
  - Removing the budget check turns "no more than MAX_ENCODED_SNIFFS_PER_PROBE
    compressed bodies are read" red (1 of 49).
  - The `MAX_SNIFF_ENCODED_BYTES` comment is now true.
  - Chromium's own decode is unbounded (970.4 MB), which the Log states.
- **med, a sniffed master's `seq`: fixed for the case measured.**
  - `untyped-master-neutral` gives `hls n=2`.
  - Removing `seq` from the patch turns "a slowly-read untyped master ranks
    above the typed variant it names" red (1 of 49).
  - The fix has a new limit, in the bullet below.
- **med, `segmentCount`: fixed, and the `.ts` script sub-case is refuted.**
  - Through `BrowserResolver`, `vtt` and `key` now end `NO_MEDIA_FOUND`
    without a reason.
  - A `.ts` served `text/javascript` (new case `ts-js`) is excluded.
  - A `.ts` served `application/octet-stream` still gives `segments=1`. Its
    url, status and type match a real MPEG-TS segment, and a hit records
    nothing else, so the builder's refutation holds.
  - Planting count-everything inside `countPlayedSegments` turns 7 of 49 red.
    Planting it at the call site in `resolvers/browser.ts` turns **none** red,
    104 of 104 across `sniff.test.ts` and `browser-resolver.test.ts`. That gap
    is in the low below.
- **low, CodeQL fixture: fixed.** `CodeQL` passes on `69d13aa`
  (`gh pr checks 373`). Each page passes literal routes to
  `untyped-player.js`.
- **low, the Log's "hand-rolled loader" sentence: fixed**, and it now names
  `hls.html` as the shape it copies.
- **low, `rank.ts`: filed as dl-92.** The other gate-1 lows stand as written.

New findings, in the lines this round touched:

- **med** · no Done-when line depends on it · Reserving `seq` when the response
  arrives is defeated by 10 earlier untyped responses. Every sniffable
  response, manifest or not, now takes a number.
  - `rank.ts`'s `max(0, 100 - seq * 10)` reaches 0 by seq 10. Equal scores are
    then broken by position in `hits`, which `HitCollector.hits` returns in
    recording order. The sniffed master is recorded last, after its body read.
  - Measured through `BrowserResolver`: 5 junk `text/plain` fetches, then
    `/master` and `/v/high/media.m3u8`, give `hls n=2`. The same page with 10
    junk fetches gives `hls n=1 /v/high/media.m3u8`. Collector order at 10:
    `hls:/v/high/media.m3u8`, `segment`, `segment`, `hls:/master`.
  - The Log's "Relative order is unchanged" holds for `seq`, but the outcome
    still flips.
  - Remedy: `get hits()` sorts by `seq`, so equal scores fall back to arrival
    order. Alternatively, `rankHits` breaks ties on `seq`. Either fits dl-92's
    `rank.ts` scope if it is not fixed here.
  - Not a regression: `3a72069` gave `n=1` for this shape too.
- **low** · Only the unit tests pin `countPlayedSegments`. Its one call site in
  `BrowserResolver` can revert to `hits.filter(kind === "segment").length` with
  every test green, because no end-to-end page fetches only a `.vtt`, a `.key`
  or a script-typed `.ts`.
- **low** · Spending the compressed budget hides a later compressed manifest:
  two gzip `text/plain` JSON responses, then a gzip playlist, give
  `NO_MEDIA_FOUND reason=segments-without-manifest segments=2`. This is the
  measured cost of option (a), recorded rather than reopened.
- **low** · dl-91's "Expect ~736 MB at 32" came from gate 1's collector run (a
  bare `HitCollector` on raw Chromium), not from the `BrowserResolver` run its
  step 1 prescribes. Its builder should expect a different baseline.
- dl-91 and dl-92 each stand alone. Each carries a step-1 reproduction recipe
  and its numbers, its Done-when lines have a red/green shape, and neither
  depends on gate 1's scratch files.
- **findings** · this round's hunt returned 4: 4 carried and 0 dropped. The `.ts`
  script sub-case is refuted, not dropped.
- **No high.**

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
