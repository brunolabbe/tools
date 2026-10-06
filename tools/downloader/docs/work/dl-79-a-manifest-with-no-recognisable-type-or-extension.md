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
fixture `test/fixtures/pages/untyped-manifest.html` fetches
`/api/playlist?id=1` (served `text/plain; charset=utf-8`, body a media playlist
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
- **A compressed response is held to 32 KiB** (`MAX_SNIFF_ENCODED_BYTES`),
  because Chromium hands back the inflated body and a declared length is then
  not a bound; 32 KiB bounds a hostile page at ~32 MB. A real playlist
  compresses ~10:1, so this still admits several hundred kilobytes of text.
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

- `segmentCount` counts every `segment`-kind hit, and that kind includes
  `.vtt` and `.key` (`SEGMENT_PATH`). A page that fetched only subtitles and no
  media would be reported `segments-without-manifest`. Not fixed here: the set
  belongs to `media-match.ts`, which dl-78 is editing.
- A sniffed hit is recorded after its body has been read, so its `seq` is
  assigned late rather than at response time. Ranking only reads `seq` to prefer
  an earlier master, and a master's variants are requested after its body is
  read, so order is preserved for dependent fetches. A page that fires an
  untyped master and a typed variant in parallel could rank them the other way
  round; not measured.
- Not run against a real hls.js player, only the hand-rolled loader the other
  fixtures use, as the brief allowed.

**Fold-in.** Nothing else was made free. dl-80 and dl-83 both end in a bare
"no video" that a `reason` token would explain, and `attemptReason` now carries
any token a resolver sets, so each can adopt one in its own ticket; I did not,
since neither is specified to.

**Process note.** A `.ts` file under `test/fixtures/` is linted as TypeScript
(`oxlint` read the placeholder segments as code and failed `npm run check`), so
the `.ts` segments are generated in `fixture-server.ts` instead of checked in.
