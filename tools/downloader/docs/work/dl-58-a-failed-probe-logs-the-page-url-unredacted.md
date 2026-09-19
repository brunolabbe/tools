---
id: dl-58
tool: downloader
title: A failed probe logs the page URL with its query string, credentials included
kind: fix
status: done
milestone: M5
depends_on: []
difficulty: standard
---

# dl-58 — A failed probe logs the page URL unredacted

**Packages:** `api` (the error handler, and possibly the logger), plus whichever
packages put URLs into `AppError.details`.

## Why

The root `CLAUDE.md` says to redact credentials anywhere URLs are logged,
because "a signed URL carries its credential in the query string". A failed
probe breaks that rule:

- `resolvers/src/registry.ts:136` (`:105` at filing time, drifted since —
  re-resolved 2026-09-17) "details: { url: url.href, attempts },"
  — sets the page URL, query string included, as the `NO_MEDIA_FOUND` error's
  `details`. A second, un-cited site at `registry.ts:75` does the same for the
  "no resolver can handle that address" case.
- `downloader/api/src/server.ts:603` (`:600` at filing time) "details:
  appError.details," — is how the error handler copies those `details` into
  the `request rejected` (and `request failed`) line as they are. The `url`
  field beside it goes through `redactLoggedUrl`, and `details` does not.
- `downloader/api/src/logger.ts:104` "function safeFields(" — the logger's
  last line of defence rewrites only a `requestContext`, and its pino
  `redact` paths cover only `cookie` and `authorization` headers.

**Reproduced on 2026-09-13**, from the worktree at `origin/main` `1835657`,
against the real `createLogger`. It logged the fields the error handler builds,
with a signed page URL in `details`:

```text
{"level":"info",…,"url":"/api/probe","code":"NO_MEDIA_FOUND","status":422,
 "details":{"url":"https://cdn.example/watch?v=1&sig=SECRET123","attempts":[]},
 "msg":"request rejected"}
```

`sig=SECRET123` reached the output unchanged. That run exercised the logger,
not a request through Fastify. The server half above was read, not run. Step 1
closes that gap.

**Exposure today is low, and it grows at launch.** Behind Access, only the
owner's own URLs reach the owner's own logs. Once
[dl-49](./dl-49-open-without-a-login.md) removes the login, strangers' signed
URLs would be written to the host's logs, which is why dl-49 waits on this.

## Build

1. **Write the failing test first, through the real server.** Use Fastify
   `inject` with a resolver chain whose tiers all fail, a page URL carrying
   `?sig=SECRET123`, and a logger whose `write` captures lines. Assert that no
   line contains `SECRET123`. Record in the Log that it failed on `origin/main`.
2. **Sweep before fixing.** List every place an `AppError` is built with a URL
   in its `details`, across `resolvers`, `engine` and `api`, and every log call
   passing a URL field that does not go through `redactUrl` or
   `redactLoggedUrl`. Write the list in the Log. The fix should cover all of
   them with one mechanism, not one call site at a time.
3. **Choose the layer and say why in the Log.** Two candidates:
   - **The error handler** redacts absolute `http(s)` URLs inside `details`
     with `redactUrl` from `@webtools/core`. Narrow, and it matches where
     `url` is already redacted.
   - **`safeFields` in the logger** does it for every line. It catches callers
     that forget, which is that function's stated job, but it has to leave
     relative paths such as `/api/probe` readable.

   Either is acceptable. Picking one without saying why is not.

4. **Do not redact the probe's HTTP response.** The client sent that URL, so
   echoing it back discloses nothing. This fix is about what reaches the log.

## Done when

- The step-1 test fails on `origin/main` and passes on the branch, and the Log
  records both runs.
- The step-2 sweep is in the Log, and a test covers each other URL-carrying
  site it found, or the Log says why one needs none.
- A test proves the redacted line still carries the host and path, so the log
  still says which site failed.
- **Widened by the owner's decision on D1/D2, 2026-09-17**: scope is not
  limited to `details` or to the page URL a failed probe was working on. A
  top-level field such as `egress-proxy.ts`'s `host` (H1), a URL embedded
  mid-sentence rather than being the whole of a field's value (H2), and the
  success-path `Referer` that reaches `probe complete` on a probe that
  _succeeded_ (H3, not only a failed one — the ticket's title undersells its
  own step 2, which already said "every log call passing a URL") are all
  covered. Each of H1, H2 and H3 has its own test, red at the gate's commit
  (`b63d8c6`)'s logger and green after.
- **Reworded by the owner's decision on D3, 2026-09-18** (superseding the
  line above's implied "every string value"): the shared matcher covers a
  lower- **or** upper-case `http(s)://` URL, anywhere in a string, however
  deeply nested in the fields object — not literally every string value
  regardless of shape. A protocol-relative URL (`//host/path`, no scheme at
  all) is still not matched; no known caller in this tool produces one, and
  the owner's D3 answer (case-insensitivity, not a scheme-optional match) does
  not close that gap. See the Log for the measurement this rewording is based
  on and for D3's answer in full.
- `npm run check`, `npm test -- --project downloader` and
  `node scripts/citations-gate.mjs --against origin/main` are green.

## Review

Five rounds so far, all by `a9a05d05c8083a85d`. **Disclosure** (gate 3 found
the round-two commit's transcription of gates 1 and 2 was not verbatim — see
the Log's gate-3 entry for what that round found and how it was corrected;
gate 5 then found gate 4 itself had gone uncommitted entirely, fixed in this
same commit): all five subsections below are the reviewer's text exactly as
sent, gate 3's one dated correction above marked as such. The only
edits anywhere are to citation coordinates, never to a finding's own words —
either a bare line number moved to match where content that is still
genuinely present now sits (`runner.ts`'s matcher, `logging.test.ts`'s cycle
test), or, where a fix deleted the exact text a citation quoted, the citation
stayed as written and is excused by the declaration below it names.

**Owner decision D4: no branch-sha pins in this record.** An earlier draft of
this section pinned five citations to `b63d8c6`, `31ba6c9` and `d81cfce` —
none of which are ancestors of `origin/main`, so each pin would have gone
unresolvable the moment this branch was squash-merged and its ref deleted,
breaking `citations-gate` for every later pull request (measured at gate 3,
in a fresh single-branch clone of `main` with this ticket copied in). The
owner chose prose over archival tags — declared here rather than tagged,
against `records.md`'s own default ("reach for a pin when the citation was
true of some commit in this repository"), on the reasoning that a pin's
whole value is resolving against a real tree, and none of `b63d8c6`,
`31ba6c9` or `d81cfce` is one after this branch lands. Each gate's header
already names the commit it reviewed, in prose, which is what a pin's header
disclosure would have said anyway.

<!-- citations: evidence tools/downloader/api/src/logger.ts:115, tools/downloader/api/src/logger.ts:125, tools/downloader/api/src/logger.ts:142, tools/downloader/api/src/logger.ts:127 -->

The four citations that declaration excuses quote text a later round's own
fix deleted outright — line 115 (gate 1, the `parses whole` check the D1
rewrite replaced), line 125 (gate 2, the `seen`-based cycle guard the M1 fix
replaced), and lines 142 and 127 (gate 3, the back-edge return and its
docstring, both replaced by the M3 fix) — all four in `api/src/logger.ts`.
The file
has since been rewritten around each of those four lines too, so what stands
at that exact line number today is unrelated text, not a later version of
the same statement — there is nowhere in the current tree to repoint any of
them without changing what they say. Each is quoted as evidence for a
finding about code that no longer exists in this shape; repointing it to
wherever similar reasoning now lives would misrepresent what the reviewer
actually read at the time.

### Gate 1

**Gate: FAIL** — 2026-09-17 · `origin/main...b63d8c6` (base `20c8fd1`) · defect
hunt run by the reviewer itself at medium depth, every log call site in
`tools/downloader/{api,engine,resolvers}/src` enumerated

| Done when                                                                  | Proof                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Step-1 test fails on `origin/main`, passes on the branch, Log records both | `tools/downloader/api/test/logging.test.ts:771-772 "expect(failed).toHaveLength(1)"` and `tools/downloader/api/test/logging.test.ts:802-803 "expect(rejected).toHaveLength(1)"` ✓ — re-run: `logger.ts` alone reverted to `origin/main` gives 3 failed / 37 passed, the `request failed` line carrying `sig=SECRET123`; restored, 40 passed |
| Sweep in the Log, and a test per other URL-carrying site or a reason       | **unproven** — the sweep misses three live paths (the three **high** below), and the Log claim that the `safeFields` unit test covers `egress-proxy.ts` is false for the `host` field on the same line                                                                                                                                      |
| A test proves the redacted line keeps host and path                        | `tools/downloader/api/test/logging.test.ts:771-774 "const failed = raw.filter"` ✓, `tools/downloader/api/test/logging.test.ts:802-805 "const rejected = raw.filter"` ✓                                                                                                                                                                      |
| `npm run check` and `npm test -- --project downloader` green               | **verified** — check exit 0; 85 files, 1434 passed; base 1429 (`logging.test.ts` 35 at base, 40 at tip, no other test file in the diff, no assertion removed)                                                                                                                                                                               |

- **high** · `egress-proxy.ts` logs the full plain-HTTP target, query string
  included, as the top-level `host` field, which the new code never looks at:
  `tools/downloader/api/src/egress-proxy.ts:472-474 "await guard.assertAllowed(target);"`
  passes `target` (the absolute-form request URL) to
  `tools/downloader/api/src/egress-proxy.ts:352 "function refused(host: string, error: unknown)"`,
  and `tools/downloader/api/src/egress-proxy.ts:527-528 "proxied.once("` hands
  the same `target` to `connectFailed` (read, not run). Reproduced at b63d8c6
  through the real `startEgressProxy` and `createLogger`:
  `GET http://blocked.test/seg.ts?sig=SECRET_BLOCKED` logged
  `"host":"http://blocked.test/seg.ts?sig=SECRET_BLOCKED"` beside a correctly
  redacted `details.url`.
- **high** · `tools/downloader/resolvers/src/resolvers/ytdlp.ts:906 "stderr: stderr.slice(-500)"`
  puts raw yt-dlp stderr in `details`, and yt-dlp echoes the URL mid-sentence
  (`ERROR: Unsupported URL: http://…?sig=…`, measured with yt-dlp 2025.09.26
  against a local server). `tools/downloader/api/src/logger.ts:115 "parsed = new URL(value);"`
  redacts only a value that parses whole. Reproduced with the real
  `YtDlpResolver` and the branch logger: a URL containing `drm` classifies
  `DRM_PROTECTED` (terminal, so it reaches `request rejected`) and the line
  carries `sig=SECRET123` in `details.stderr`. Conditional on the yt-dlp tier
  being enabled and the URL text matching a terminal marker.
- **high** · the page URL, query string included, reaches the `probe complete`
  line at `info` on a successful browser probe:
  `tools/downloader/api/src/routes/probe.ts@fb15bc9:255 "requestContext: probe.requestContext,"`
  logs the request context, and `redactRequestContext` keeps `Referer`
  verbatim. Two sources, both measured:
  `tools/downloader/resolvers/src/browser/request-context.ts:65 "??= input.pageUrl;"`
  fills it with the full page URL when the capture had none (reviewer, real
  `buildRequestContext` and `createLogger`); and Chromium itself sends the
  full page URL as the captured `Referer` of a same-origin media fetch under
  its default referrer policy (builder, real headless Chromium through
  Playwright, page `/watch?v=1&sig=SECRET_PAGE` with a same-origin `<video>`,
  reviewer did not re-run). Outside the ticket title (a failed probe) but
  inside its step 2 (every log call passing a URL); **where to fix it is an
  open decision**, not settled here.
- **low** · the Why still cites `logger.ts` line 104 for `function safeFields(`,
  which this branch moved to 150 (`citations.mjs` reports MOVED); the sweep
  coordinates for `classify.ts` (line 135, a closing brace) and
  `browser/pool.ts` (line 224, a throw with no `details`) point at the wrong
  lines.
- **low** · the Log says 1431 before the branch and three new tests; the
  branch adds five and the base count is 1429.
- **low** · value-shape gaps with no live site found: a URL nested one level
  deeper inside `details`, in an array, protocol-relative, or unparseable
  (`ssrf.ts` records an unparseable raw URL whole) is not redacted — measured
  by logging each shape through the branch logger. The docstring states the
  top-level-only limit for `requestContext` but not for `details` itself.
- **dropped** · `tools/downloader/api/src/main.ts:83 "details: appError.details,"`
  carrying a config credential: booted `dist/main.js` with
  `PROXY_URL=http://user:SECRET_PROXY@…` into EADDRINUSE, a malformed
  PROXY_URL and a `socks5:` scheme; none of the three lines contained the
  secret, and no throw on the boot path echoes the value. Not a defect.
- **dropped** · a DoS or crash in the new walk: no recursion, a 10 MB URL
  value logged in 98 ms, a cycle and a throwing getter both still emitted a
  line. Not a defect.
- **dropped** · yt-dlp classifying a no-media page as `DRM_PROTECTED` because
  the echoed URL contains `drm` — a real misclassification in
  `classifyFailure`, but not this ticket and outside the reviewed range;
  raised to the orchestrator as a filing question.
- **findings** · the reviewer hunt returned 9; 6 carried, 3 dropped.
- NFR: security — three high above · performance ✓ (measured, above) ·
  reliability ✓ (getter and cycle, above) · maintainability — the two low
  citation and count bullets.
- Invariants: no cross-tool import ✓; reuses `redactUrl` from `@webtools/core`
  rather than reimplementing ✓, but not the text matcher `redactUrlsInText`
  that `engine/src/ffmpeg/runner.ts` already has for exactly the embedded
  case; `@webtools/core` already declared in `api/package.json` ✓; no
  contract edit ✓; style ✓. Skipped as not touched: shell, process trees,
  SSRF, progress, test registration, Dockerfile.

### Gate 2

**Gate: FAIL** — 2026-09-17 · `origin/main...31ba6c9` (base `20c8fd1`; this
round is the delta from `b63d8c6`) · defect hunt run by the reviewer itself at
medium depth over the new walk in `logger.ts`, the four new tests and the
ticket edits

| Done when                                                                                                | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Step-1 test fails on `origin/main`, passes on the branch, Log records both                               | unchanged from gate 1 ✓ — still green at 31ba6c9 (`logging.test.ts` 43 passed)                                                                                                                                                                                                                                                                                                                                                                       |
| Sweep in the Log, and a test per other URL-carrying site or a reason                                     | H1 `tools/downloader/api/test/egress-proxy.test.ts:1181-1182 "expect(refused).toHaveLength(1)"` ✓, H2 `tools/downloader/api/test/logging.test.ts:896-908 "DRM_PROTECTED"` ✓, H3 `tools/downloader/api/test/logging.test.ts:937-954 "referer.example/watch?v=1&sig=SECRET_REFERER"` ✓ — re-run: `logger.ts` alone reverted to `b63d8c6` gives 4 failed / 77 passed across the two files, one per high plus the H1 unit companion; restored, 81 passed |
| A test proves the redacted line keeps host and path                                                      | gate 1 rows still hold; each new high test also asserts host and path ✓                                                                                                                                                                                                                                                                                                                                                                              |
| Widened scope: every string value in a log line is covered, H1–H3 each red at `b63d8c6` and green after  | **unproven** — the H1–H3 half is proven above, but every string value is false as measured: the second occurrence of a shared (non-cyclic) object is written unredacted, and so are an upper-case `HTTPS://` and a protocol-relative `//host/p?sig=`                                                                                                                                                                                                 |
| `npm run check`, `npm test -- --project downloader` and `citations-gate.mjs --against origin/main` green | **verified** — check exit 0; 85 files, 1438 passed (1434 at `b63d8c6`, 1429 at base); citations-gate exit 0, 84 enforced, 0 failing                                                                                                                                                                                                                                                                                                                  |

- **med** · the cycle guard fails open on a shared reference:
  `tools/downloader/api/src/logger.ts:125 "if (seen.has(value)) return value;"`
  returns the _original_ object for any object already visited anywhere in the
  line, not only an ancestor. Measured through the built logger:
  `log.info(m, { a: shared, b: shared })` with
  `shared = { url: https://h.example/p?sig=SHARED }` wrote `a` redacted and
  `b` with `sig=SHARED`, and `{ details: shared, again: [shared] }` leaked in
  `again`. No live call site found that logs one object twice; it is a hole
  in the net whose job is to catch the call site nobody has written yet.
- **med** · the gate-1 record is not in the branch: the ticket at 31ba6c9 has
  no `## Review` section, and its Log says see Review below once committed. A
  merge from this commit loses the FAIL that caused the round.
- **low** · the matcher at
  `tools/downloader/engine/src/ffmpeg/runner.ts:71 "return text.replaceAll"`
  is case-sensitive and requires a scheme, so `HTTPS://…?sig=` and
  `//host/p?sig=` pass unredacted (measured). No live source found:
  `URL.href`, the Chromium `Referer` and the ffmpeg target are all lower-case
  absolute. Closing this is an **open decision**: reword the widened
  Done-when to the real reach of the matcher (recommended), or add the `i`
  flag to the shared matcher, which also changes ffmpeg stderr redaction.
- **dropped** · a raw `Error` in fields is not walked (pino writes its message
  verbatim): every log call in the tool passes `String(error)` or
  `error.message`, both now redacted. Not a live defect.
- **dropped** · deep nesting: a 20,000-level object raises inside the walk,
  `emit` catches it and writes the line with `fieldsDropped: true`. The line
  survives; not a defect.
- **dropped** · the `@downloader/engine` value import: already under
  `dependencies` in `api/package.json` and shipped by the image; `runner.ts`
  is byte-identical to `origin/main`. Not a finding.
- **findings** · the reviewer hunt returned 6; 3 carried, 3 dropped. Gate 1
  highs are closed by the tests above; L1 and L2 are corrected in the Log.
- NFR: security — two med above · performance — a walk of every field on
  every line, accepted by the owner under D1 · reliability ✓ (cycle, depth,
  getter) · maintainability ✓.
- Invariants: no cross-tool import ✓ (`@downloader/engine` is the same tool);
  reuses `redactUrlsInText` rather than reimplementing ✓; no contract edit ✓;
  test registration unchanged ✓; style ✓. Skipped as not touched: shell,
  process trees, SSRF, progress, Dockerfile.

### Gate 3

**Gate: FAIL** — 2026-09-17 · `origin/main...d81cfce` (base `20c8fd1`; this
round is the delta from `31ba6c9`) · defect hunt run by the reviewer itself at
medium depth over the ancestor-tracking walk, the three new tests and the
committed `## Review` transcription

| Done when                                                                                                | Proof                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Step-1 test fails on `origin/main`, passes on the branch, Log records both                               | unchanged ✓ — green at d81cfce                                                                                                                                                                                                                                                                                                                                                                             |
| Sweep in the Log, and a test per other URL-carrying site or a reason                                     | unchanged from gate 2 ✓                                                                                                                                                                                                                                                                                                                                                                                    |
| A test proves the redacted line keeps host and path                                                      | unchanged ✓                                                                                                                                                                                                                                                                                                                                                                                                |
| Widened scope: every string value in a log line is covered                                               | **unproven** — the shared-reference half is now proven, `tools/downloader/api/test/logging.test.ts:974-977 "a: shared, b: shared"` ✓ (re-run: `logger.ts` alone reverted to `31ba6c9` gives 2 failed / 82 passed, both shared-reference tests; restored, 84 passed); still false for an upper-case scheme and a protocol-relative URL (D3, open) and for any cycle holding a URL (the first **med** below) |
| `npm run check`, `npm test -- --project downloader` and `citations-gate.mjs --against origin/main` green | **verified** — check exit 0; 85 files, 1441 passed (1438 at `31ba6c9`); citations-gate exit 0, 85 enforced, 0 failing                                                                                                                                                                                                                                                                                      |

- **med** · a cycle leaks its URL on the first back edge, not only on a second
  re-entry: `tools/downloader/api/src/logger.ts:142 "if (ancestors.has(value)) return value;"`
  hands pino the _original_ object at the back edge, and pino serialises it
  one more level before it writes its circular marker. Measured through the
  built logger: an object holding `url: https://h.example/p?sig=CYCLE` and a
  `self` field pointing back at itself logged the raw `sig=CYCLE` inside
  `self`, and a two-object parent/child cycle leaked `sig=PARENT` the same
  way. The new test at
  `tools/downloader/api/test/logging.test.ts:1003 "sig=CYCLE"` puts that
  secret in and asserts only that one line was written, so it passes while
  the secret is in that line; the docstring at
  `tools/downloader/api/src/logger.ts:127 "content reached only by re-entering a genuine cycle"`
  understates the reach. No live call site logs a cycle. **[Gate 5 note, not
  in the reviewer's original text: the citation still resolves to the same
  `sig=CYCLE` line, but a low-2 fix after this gate added a host-survival
  assertion to that same test, so "asserts only that one line was written"
  describes the test as it stood at gate 3, not as it stands now. The
  citation is not a declared-evidence case — it still passes — so it keeps
  its plain coordinate; this sentence is the correction gate 5 asked for.]**
- **med** · the two branch-sha pins in this section break CI once the branch
  is squash-merged: `b63d8c6` and `31ba6c9` are not ancestors of
  `origin/main`, and no archival ref holds them. Measured in a fresh
  single-branch copy of `main` with this ticket placed in it:
  `citations.mjs --section Review` reports `rev b63d8c6 not in this
repository` twice and `rev 31ba6c9 not in this repository` once. After
  merge that fails `citations-gate` for every later pull request. The
  section preamble saying the pins stay reachable through the pull request is
  false for the same reason. How to repair it is an **open decision** (D4).
- **med** · the transcription is not verbatim and carries no disclosure note.
  Against the text the reviewer sent, the committed gates change tense
  throughout (`has` to `had`, `loses` to `would have lost`), add `Fixed in
the Log below` twice, `Fixed by this commit`, a `dl-67` link, a
  parenthetical calling the gate 1 recursion clause stale and `(D3, for the
orchestrator)`, and add a preamble paragraph. The Log says gate 1 is
  unchanged except the H3 bullet. The two pins are the only necessary
  edits.
- **dropped** · `ancestors` is a `Set`, not a `WeakSet`: it is created per
  call and emptied by the `finally`, so it holds nothing past the line. Not a
  defect.
- **findings** · the reviewer hunt returned 4; 3 carried, 1 dropped. Gate 2
  M1 is closed by the tests above; gate 2 M2 is closed apart from the
  transcription bullet; the gate 2 low (D3) is still open.
- NFR: security — cycle **med** above · performance ✓ (one `Set` per line) ·
  reliability — CI after merge, second **med** · maintainability —
  transcription **med**.
- Invariants: no cross-tool import ✓; no contract edit ✓; test registration
  unchanged ✓; style ✓. Skipped as not touched: shell, process trees, SSRF,
  progress, Dockerfile.

### Gate 4

**Gate: FAIL** — 2026-09-17 · `origin/main...29aaacd` (base `20c8fd1`; this
round is the delta from `d81cfce`) · defect hunt run by the reviewer itself at
medium depth over the back-edge placeholder, the two cycle tests and the
re-transcribed `## Review`

| Done when                                                                                                | Proof                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Step-1 test fails on `origin/main`, passes on the branch, Log records both                               | unchanged ✓ — green at 29aaacd                                                                                                                                                                                                                                                                                                                                                      |
| Sweep in the Log, and a test per other URL-carrying site or a reason                                     | unchanged ✓                                                                                                                                                                                                                                                                                                                                                                         |
| A test proves the redacted line keeps host and path                                                      | unchanged ✓                                                                                                                                                                                                                                                                                                                                                                         |
| Widened scope: every string value in a log line is covered                                               | **unproven** — shared references and cycles now proven: `tools/downloader/api/test/logging.test.ts:1013-1020 "sig=PARENT"` ✓ and the rewritten self-cycle test beside it (re-run: `logger.ts` alone reverted to `d81cfce` gives 2 failed / 83 passed, both cycle tests; restored, 85 passed). Still false for an upper-case scheme and a protocol-relative URL until D3 is answered |
| `npm run check`, `npm test -- --project downloader` and `citations-gate.mjs --against origin/main` green | **verified** — check exit 0; 85 files, 1442 passed (1441 at `d81cfce`); citations-gate exit 0, 85 enforced, 0 failing                                                                                                                                                                                                                                                               |

- **med** · gate 3 M4 still open: the section now carries five branch-sha
  pins, the three new ones to `d81cfce`, which is no more reachable from
  `main` than `b63d8c6` or `31ba6c9`. The repair is open decision D4; the
  builder left the pins in place rather than choose, which is right.
- **low** · the transcription is verbatim apart from the disclosed pins and
  one undisclosed word: gate 3 quotes the builder Log as `unchanged except
the H3 bullet` and the committed text reads `unchanged apart from the H3
bullet`, while the preamble says nothing else was altered. Word-diffed
  against the sent text.
- **low** · both cycle tests assert only that the secret is absent and one
  line exists; a line written as `fieldsDropped: true` would also pass them.
  A companion asserting the host survives would pin redaction rather than
  deletion, as every other new test here does. Measured the live output is
  correct: `{ url: https://h.example/p?[redacted], self: [Circular] }`.
- **dropped** · replacing the back edge with a string makes a cycle with no
  URL in it allocate a copy; one object per cyclic value per line. Not a
  defect.
- **findings** · the reviewer hunt returned 3; 2 carried, 1 dropped, plus
  gate 3 M4 carried forward. Gate 3 M3 and M5 are closed.
- NFR: security ✓ (no leak shape found in the walk) · performance ✓ ·
  reliability — CI after merge, the **med** above · maintainability — the
  two **low** above.
- Invariants: no cross-tool import ✓; no contract edit ✓; test registration
  unchanged ✓; style ✓. Skipped as not touched: shell, process trees, SSRF,
  progress, Dockerfile.

### Gate 5

**Gate: CONCERNS** — 2026-09-18 · `origin/main...6f17db4` (base `20c8fd1`;
this round is the delta from `29aaacd`, and includes ede8965, the
foreign-citation repair) · scoped by the orchestrator to the new ground: the
`i` flag at both consumers, the reworded acceptance line, the evidence
declarations, and the two lows held from gate 4

| Done when                                                                                                                             | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Step-1 test, the sweep with a test per site, host and path kept                                                                       | unchanged from gates 1 to 4 ✓, not re-swept                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Reworded scope: a lower- or upper-case `http(s)://` URL anywhere in a string, however nested; a protocol-relative URL still unmatched | `tools/downloader/engine/test/redact-urls-in-text.test.ts:21 "redacts an upper-case scheme the same way"` ✓, `tools/downloader/engine/test/redact-urls-in-text.test.ts:43 "known gap: a protocol-relative URL is not matched"` ✓, and through the real spawn path `tools/downloader/engine/test/ffmpeg-runner.test.ts:110-124 "onStderrLine: (line) => seen.push(line),"` ✓ — re-run: `tools/downloader/engine/src/ffmpeg/runner.ts:71 "replaceAll(/https?:"` toggled back to `gu` gives 5 failed / 169 passed in the engine project; restored, 174 passed. The line matches what the matcher does, measured against the built function on eleven shapes |
| `npm run check`, `npm test -- --project downloader` and `citations-gate.mjs --against origin/main` green                              | **verified** — check exit 0; 86 files, 1450 passed (1442 at `29aaacd`); engine project 174 passed; citations-gate exit 0, 85 enforced, 0 failing, including the repo-34 and dl-19 repairs; `citations.mjs` on this ticket exit 0, 4 evidence, 0 pinned. The flake the Log names did not recur here                                                                                                                                                                                                                                                                                                                                                       |

- **med** · gate 4 is missing from the record and the preamble miscounts:
  the section says four rounds and all four subsections below, and only
  `### Gate 1`, `### Gate 2` and `### Gate 3` are there. Gate 4 was sent and
  is not committed — the same shape as gate 2's own finding about gate 1,
  and a merge from this commit loses the round that closed the cycle leak
  and the transcription.
- **low** · a repointed citation now contradicts its own bullet: gate 3's
  cycle finding cites the same
  `tools/downloader/api/test/logging.test.ts:1003 "sig=CYCLE"` quoted above
  and says that test asserts only that one line was written, which was true
  at d81cfce; the test at that coordinate today also asserts the secret is
  absent and the host survives. The anchor still resolves, so nothing
  fails — a reader following it sees the opposite of the claim. Recommend
  naming it in the evidence declaration beside the other four, as historical
  evidence rather than a live coordinate; keeping it and adding a clause
  saying the test was rewritten afterwards is also defensible.
- **verified** · the two lows gate 4 held are closed: the word `except` is
  restored (word-diffed against the sent text — gates 1 to 3 now differ only
  in citation coordinates and, in gate 1, the H3 bullet agreed at gate 2),
  and both cycle tests carry a host companion (`logging.test.ts` lines 1011
  and 1024, qualified elsewhere in this record).
- **dropped** · the `i` flag widening ffmpeg's own stderr redaction: measured
  on eleven shapes through the built function. Nothing that was redacted
  before stops being; what is new is upper- and mixed-case schemes, and
  `redactUrl` normalises the scheme and host case in what it writes back,
  which it already did for lower-case input. The engine project passes 174
  with the flag and fails 5 without it.
- **dropped** · the fresh single-branch check of `main` still exits 3, as
  the builder reported. Every failure is a citation into a test line this
  branch adds, which `main` cannot hold until it merges; that is true of any
  branch citing its own new tests. No pin remains in any gate record, and
  the two `@20c8fd1` pins added to repo-34 and dl-19 name a commit on `main`
  today. Not a defect.
- **findings** · the reviewer hunt returned 4; 2 carried, 2 dropped.
- NFR: security ✓ · performance ✓ · reliability ✓ · maintainability — the
  record itself, the **med** and **low** above.
- Invariants: no cross-tool import ✓; no contract edit ✓; the new engine
  test file is registered and runs in the project's 174 ✓; style ✓. Skipped
  as not touched: shell, process trees, SSRF, progress, Dockerfile.

### Gate 6

**Gate: PASS** — 2026-09-18 · `origin/main...ed4ece4` (base `20c8fd1`; this
round is the delta from `6f17db4`, documentation only — the diff names one
file, this ticket) · scoped to what gate 5 left open: the missing record,
the round count and the repointed citation

| Done when                                                                                                | Proof                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Step-1 test, the sweep with a test per site, host and path kept, and the reworded D3 scope               | unchanged from gates 1 to 5 ✓ — no source or test file differs from 6f17db4, so gate 5 runs stand (engine 174, api suites 85, downloader 86 files / 1450)                                  |
| `npm run check`, `npm test -- --project downloader` and `citations-gate.mjs --against origin/main` green | **verified** — check exit 0 at this commit; citations-gate exit 0, 85 enforced, 0 failing; `citations.mjs` on this ticket exit 0, 23 verified, 4 evidence, 0 pinned, 0 moved, 0 unanchored |

- **low** · two words of the transcription are still the builder writing,
  against a preamble that says only citation coordinates were edited: the
  second low in gate 4 reads `would also pass them` where the reviewer sent
  `would also pass`, and the verified bullet in gate 5 carries a paraphrase
  of the citation the reviewer wrote rather than the citation itself (the
  same two coordinates, 1011 and 1024; the account from the builder names
  the `oxfmt` line-wrap that forced it). Neither changes a finding.
  Recorded rather than repaired: another commit to fix two words would cost
  more than it buys.
- **verified** · the med from gate 5 is closed: `### Gate 4` and `### Gate
5` are both in the record, the preamble says five rounds, and gates 4 and
  5 are otherwise the text of the reviewer word for word (word-diffed).
- **verified** · the low from gate 5 is closed by the second of the two
  offered remedies, and the reasoning for not using the declaration is
  right: the citation resolves `ok`, and a declaration excusing a citation
  that is not failing is refused. The added sentence is marked as a gate 5
  note that is not in the original text of the reviewer, which is the
  disclosure this record has been short of twice.
- **findings** · the reviewer hunt returned 3; 1 carried, 2 closed, 0
  dropped.
- NFR: security ✓ · performance ✓ · reliability ✓ · maintainability ✓.
- Invariants: documentation only this round; nothing else to walk.

**Nothing in this ticket is unproven or unverified, and no finding above
`low` stands. This record needs one more commit — gate 6 itself — and no
gate after it: a transcription of text the reviewer wrote, with the suites
unchanged, has nothing left to review.**

## Log

- 2026-09-13 — Filed on the owner's instruction instead of being fixed on the
  spot. Found while filing
  [dl-57](./dl-57-a-record-of-how-probes-and-downloads-end.md), which reads
  these same log lines. The logger half was reproduced as above. The
  error-handler half was read, not run.

- 2026-09-17 — Built on `dl-58-redact-probe-error-url` off `origin/main`
  (`20c8fd1`).

  **Citations re-resolved before relying on them** (both had drifted since
  filing): `registry.ts:105` is now `registry.ts:136`; `server.ts:600` is now
  `server.ts:603`. Corrected in the Why section above.

  **Step 1 — the failing test, through the real server.** Added
  `describe("a failed probe never logs the page URL's credentials", ...)` to
  `api/test/logging.test.ts`. Two cases, not one: a 5xx (`TLS_VERIFICATION_FAILED`,
  the "request failed" branch, logged at `error`) and a 4xx
  (`AUTH_REQUIRED`, the "request rejected" branch, logged at `info` — the
  ticket's own reproduced shape). Both inject a `StubResolver` that throws an
  `AppError` carrying `details: { url: signedUrl }` where `signedUrl` has
  `?sig=SECRET123`, through `POST /api/probe` via Fastify `inject`, with a
  logger whose `write` captures raw lines. **Neither case uses `NO_MEDIA_FOUND`**:
  that code is a fall-through in `ResolverRegistry.resolve()`, so with the
  real `direct` tier also registered (required for the app to boot at all —
  `assertUsable` refuses a config with every tier off) the chain would move on
  to it and reach real DNS for the fixture host — `probe-outcomes.test.ts`
  already documents this exact constraint and avoids it the same way. Ran
  first against unfixed `origin/main`: both **failed**, each with `SECRET123`
  present in exactly one raw line (`"msg":"request failed"` /
  `"msg":"request rejected"`), reproducing the vulnerability through the real
  server rather than only against `createLogger` directly, which is the gap
  the ticket's own 2026-09-13 reproduction named ("that run exercised the
  logger, not a request through Fastify"). Command:
  `npx vitest run tools/downloader/api/test/logging.test.ts -t "a failed probe never logs"`.

  **Step 2 — the sweep.** Every `AppError` built with a URL in its `details`,
  across `resolvers`, `engine` and `api`:
  - Already redacted at the source, via `redactUrl` (no action needed):
    `resolvers/src/browser/classify.ts:140,240,245` (all three paths of
    `classifyFailure`/`classifyNavigationError`; `:135` in an earlier draft of
    this Log pointed at a closing brace, not the `redactUrl` call).
  - Unredacted, feeding an `AppError.details.url` that a caller may log
    verbatim: `resolvers/src/registry.ts:75,136`;
    `resolvers/src/resolvers/direct.ts:109,175,210,343,349,383`;
    `resolvers/src/resolvers/ytdlp.ts:276,290,906`. (`engine/src/**` has no
    such site — checked by grep, none found.)
  - Manifest parsers (`resolvers/src/manifest/hls.ts:325`,
    `resolvers/src/manifest/dash.ts:361,368`), `browser/drm.ts:134` and
    `browser/pool.ts:224,321` (both throws, neither carrying `details` with a
    URL in it at all — `:224` has no `details` object at all) — not sites.

  Every log call passing `AppError.details` to a line, across `api` (`engine`
  and `resolvers` have no logger of their own): `api/src/server.ts:603` (the
  ticket's own site); two more the ticket did not name,
  `api/src/egress-proxy.ts:357` (`refused`) and `:450` (`upstreamRefused`);
  and `api/src/main.ts:83`, a direct `process.stderr.write` with no `AppLogger`
  involved at all — "no logger yet if `createApp` was what failed", per its
  own comment.

  **Step 3 — the layer, and why.** Chose **the logger's `safeFields`**
  (candidate two), not the error handler, on a measurement rather than a
  guess: `egress-proxy.ts`'s `refused` and `upstreamRefused` share the exact
  same `AppLogger` (`createLogger`/`adapt()`) that `server.ts`'s error handler
  uses, so redacting inside `safeFields` covers those two sites _and_
  `server.ts`'s **for free** — three of the four known log sites, with zero
  additional call-site edits — where redacting only inside
  `registerErrorHandling` would cover exactly one of the four. That is the
  "one mechanism, not one call site at a time" the Build asked for, measured
  against the sweep above rather than assumed from the ticket's own framing of
  the two candidates. Implemented as `redactDetailsUrls()` in `logger.ts`: for
  every string value under a top-level `details` key, if it parses whole as an
  absolute `http(s)` URL, replace it with `redactUrl(value)` (origin + path,
  query redacted); anything else — a relative path, a number, `attempts`,
  `stderr` tails — passes through untouched, matching the "leave relative
  paths readable" requirement without a name-based allowlist (a relative path
  simply fails `new URL()`). This changed **zero lines in `server.ts`**, which
  also means it needed no coordination with dl-66's planned edit to
  `registerErrorHandling` in the same file — there was nothing to keep out of
  its way.

  `main.ts:83` is the one known log site this does not cover, and it is
  deliberately left that way rather than patched without a test: it writes
  directly to `process.stderr` before any `AppLogger` exists, and it only
  fires on a **startup** failure (`createApp()` rejecting) — before a single
  request, let alone a page URL, has entered the process. Read every
  `AppError` reachable from that synchronous boot path
  (`config.ts`'s `PROXY_URL` validation, `assertUsable`'s tier check,
  `ssrf.ts`'s guard construction, `operator-ca.ts`'s CA read): none carries a
  request-scoped URL — `config.ts`'s own two sites carry `hint`/`scheme`
  fields, not a URL. No test exists for it and none is added; a fix with no
  failing test to justify it would violate this ticket's own step 1.

  Added three more unit tests, directly against `safeFields`/`logger.ts`
  rather than only through the server, to pin the mechanism itself: a
  `details.<key>` URL is redacted whatever the key is named (`url` and
  `manifestUrl` both, in one line, matching `egress-proxy.ts`'s shape); a
  relative path in `details` is left alone; non-URL `details` (numbers,
  arrays, nested objects — the shape `attempts` and `retryAfterSec` take) are
  untouched. These are the direct evidence that `egress-proxy.ts`'s two sites
  are covered, in place of adding that file's first-ever logging test.

  **Fold-in considered, not taken.** No other small, already-specified piece
  of work became free here — dl-49 depends on this ticket but is a
  substantially larger removal (the login gate), not something this diff
  makes trivial, and dl-57 (which found this gap) is already merged.

  **Re-run after the fix**: both step-1 cases pass, and the pre-existing
  "known limitation" tests in the same file (nested `requestContext`, arrived
  under another name) still pass unchanged — this mechanism is a distinct
  code path from `requestContext`'s structural redaction, not a widening of
  it.

  **Gates:**
  - `npx vitest run tools/downloader/api/test/logging.test.ts` — 40 passed (40).
  - `npm run check` — exit 0 (lint, `oxfmt --check`, `tsc --build`, all clean;
    the file's own pre-existing `no-await-in-loop` and `prefer-array-find`
    warnings are unrelated and unchanged by this diff).
  - `npm test -- --project downloader` — 85 test files, 1434 tests passed.
    The branch adds 5 `test(` blocks to `logging.test.ts` (2 server-level, 3
    unit-level), so the base count is 1429 — corrected from an earlier draft
    of this Log, which undercounted the added tests as three and the base as 1431.
  - Did not run the full repo `npm test`: no shared config
    (`vitest.config.ts`, `tsconfig*.json`, `packages/core`) was touched, only
    `tools/downloader/api/src/logger.ts` and its test.

  **Left out on purpose:** no fix or test for `main.ts:83`, reasoned above.
  No change to `registry.ts`, `direct.ts`, `ytdlp.ts` or any other
  `AppError`-construction site — the fix is entirely at the log-emission
  layer, per the sweep's "one mechanism" instruction, so those sites keep
  their unredacted `details.url` and rely on `safeFields` to catch it on the
  way out.

- 2026-09-17 — Gate at `b63d8c6`: **FAIL**, three highs (see `## Review`
  below once committed). The sweep in the entry above missed three live
  leaks; all three reproduced independently, against the same commit:

  **H1 confirmed** — `egress-proxy.ts`'s `refused`/`upstreamRefused` log a
  top-level `host` field carrying the full absolute-form target URL,
  unredacted; `redactDetailsUrls` only ever looks inside `details`, on the
  same line, so it never touches `host`. Reproduced with a real
  `startEgressProxy` + `createLogger` (dist build), a blocked-address target:
  `"host":"http://blocked.test/seg.ts?sig=SECRET_BLOCKED"` beside a correctly
  redacted `details.url`.

  **H2 confirmed** — `ytdlp.ts`'s `classifyFailure` puts raw yt-dlp stderr in
  `details.stderr`, and yt-dlp echoes the target URL mid-sentence
  (`ERROR: Unsupported URL: …`). `redactDetailsUrls` only redacts a string
  that parses _whole_ as a URL, so an embedded one in free text passes
  through. Reproduced with the real yt-dlp 2025.09.26 binary and a real
  `YtDlpResolver` against a local no-media page whose path happened to
  contain "drm" (a terminal marker in `classifyFailure`, so the error reaches
  `request rejected` rather than falling through): the resulting
  `details.stderr` carried the signed URL unredacted.

  **H3 confirmed, and worse than first measured** — `probe.ts`'s
  `requestContext: probe.requestContext` at `info`, on every successful
  probe, logs a `Referer` header that `redactRequestContext` (via
  `redactHeaders`) does not touch — that redactor is a header-name denylist
  (cookie, authorization, …), and `Referer` is deliberately not on it (it is
  needed for replay). Two distinct sources both carry the full signed page
  URL into that header, both measured directly rather than assumed:

  1. `resolvers/src/browser/request-context.ts:65`'s `??= input.pageUrl`
     fills `Referer` with the full page URL when the capture had none.
     Reproduced with the real `buildRequestContext` and `createLogger`.
  2. **Chromium's own captured `Referer`, in the ordinary case where the
     capture is _not_ empty, carries the same thing.** Verified live rather
     than left as a documented default: launched real headless Chromium via
     Playwright in this sandbox, served a same-origin page at
     `http://127.0.0.1:18099/watch?v=1&sig=SECRET_PAGE` whose only
     sub-resource was `<video src="/media/v.mp4?sig=SECRET_MEDIA">`,
     navigated to it, and logged the raw request headers the browser sent
     for the media fetch. The captured header was
     `"referer":"http://127.0.0.1:18099/watch?v=1&sig=SECRET_PAGE"` — the
     full page URL, query string included, under Chromium's default
     referrer policy with no override anywhere in this codebase's browser
     launch options. So this is not an edge case gated on a missing capture;
     it is what Chromium sends by default for the common same-origin case.

     Server (`node`, this repo has no bundled static-file server, so a
     three-route `http.createServer` stood in for one):

     ```js
     import http from "node:http";
     const server = http.createServer((req, res) => {
       if (req.url?.startsWith("/watch")) {
         res.writeHead(200, { "Content-Type": "text/html" });
         res.end(
           `<html><body><video src="/media/v.mp4?sig=SECRET_MEDIA" controls></video></body></html>`,
         );
         return;
       }
       if (req.url?.startsWith("/media/")) {
         console.log("MEDIA REQUEST HEADERS", JSON.stringify(req.headers));
         res.writeHead(200, { "Content-Type": "video/mp4" });
         res.end("fake-bytes");
         return;
       }
       res.writeHead(404);
       res.end();
     });
     server.listen(18099, "127.0.0.1", () => console.log("listening"));
     ```

     Browser, run from `tools/downloader/resolvers` (so the bare `playwright`
     import resolves) with the server above already running:

     ```
     node --input-type=module -e "
     import { chromium } from 'playwright';
     const browser = await chromium.launch();
     const page = await browser.newPage();
     await page.goto('http://127.0.0.1:18099/watch?v=1&sig=SECRET_PAGE');
     await page.waitForTimeout(500);
     await browser.close();
     "
     ```

     The server's stdout is the evidence: the `MEDIA REQUEST HEADERS` line
     for the video request carries `"referer":"http://127.0.0.1:18099/watch?v=1&sig=SECRET_PAGE"`.

  **L1, L2 confirmed and corrected above** (citations re-resolved again —
  `safeFields` moved to `logger.ts:150`; `classify.ts:135` was a closing
  brace, the real `redactUrl` call is `:140`; `pool.ts:224` has no `details`
  object at all; the diff adds 5 `test(` blocks, not 3, so the base count is
  1429, not 1431).

  Waiting on the owner's decision (via the orchestrator) on D1 (remedy shape:
  one text-matching mechanism in the logger vs. fixing each source) and D2
  (whether H3 is in this ticket's scope or its own) before building the
  repair. The repair earns its own gate, on the new commit, with a red run
  per high.

- 2026-09-17 — Owner's decisions, relayed by the orchestrator (each option
  framed by the reviewer, `a9a05d05c8083a85d`, with its recommendation
  marked; the owner took the recommended option every time):
  - **D1: (a).** The logger redacts a URL substring in every string field
    value, wherever it appears — not just `details`, and not just a value
    that is a whole URL — including the output of `redactRequestContext`.
    Reuse `engine/src/ffmpeg/runner.ts`'s existing `redactUrlsInText` matcher
    rather than a third implementation. It stayed inside `@downloader/engine`
    (exported through that package's own index, dl-58's `api` already
    depends on it) — not a cross-tool import and not a lift into
    `packages/core`, so the "tell me first" branch of the decision did not
    apply. Accepted cost: a walk of every field on every log line, and every
    URL anywhere in a line loses its query string, including ones that
    carried nothing secret.
  - **D2: fix H3 in this ticket.** Not filed separately — it gets the same
    red-then-green treatment as H1 and H2, using the builder's own Chromium
    measurement as evidence that both of H3's sources (the resolver's `??=`
    fallback and Chromium's own captured same-origin `Referer`) produce the
    identical shape the fix has to catch.
  - **Q3: filed, not fixed here.** yt-dlp's `classifyFailure` matching a
    source-fact marker against its own echoed URL (H2's other half — the
    reproduction is the same shape, the defect is different: dl-58 is about
    what reaches the _log_, this is about what reaches the _client and the
    retry policy_) is
    [dl-67](./dl-67-yt-dlp-misclassifies-a-no-media-page-as-drm.md), carrying
    the same real-yt-dlp reproduction as its evidence.

  **Scope widened past the ticket's own title.** "A failed probe logs the page
  URL unredacted" undersold what step 2 already asked for ("every log call
  passing a URL field") — H3 is a _successful_ probe's log line, not a failed
  one, and the fix now covers it in the same branch. The Done-when section
  above is updated to say so; the title and Why section are left as filed,
  since they are the record of what was first found, not a moving target.

  **Implementation.** Replaced the `details`-only `redactDetailsUrls` with
  `redactUrlsDeep` in `logger.ts`: a recursive walk (cycle-safe via a
  `WeakSet`, matching the existing "logging must never crash" contract — a
  throw inside it is still caught by `emit`'s own `try`/`catch`, unchanged)
  over every string in the whole `fields` object, applying
  `redactUrlsInText` — exported from `@downloader/engine`'s index for this —
  to each one. Runs _after_ the structural `requestContext` credential wipe,
  so a `Referer` that wipe deliberately leaves alone still loses its query
  string here. `safeFields`'s "known limitation: top level only" docstring is
  narrowed to describe only the structural pass now — it was never accurate
  for the URL pass, which has always walked everything the deep function
  reaches (the pinned "known limitation" tests are about credential-shaped
  strings, which the URL pass was never going to catch, so they are
  unaffected and still pass unchanged).

  **Tests, each red at `b63d8c6`'s logger and green after** (verified by
  reverting only the source — `git stash`, restore just the test file from
  the stash, run, then reapply the full stash — never by reverting the test):
  - H1: `api/test/egress-proxy.test.ts`, new describe block at the file's
    end (this file carries pinned citations from dl-29 and repo-13 into its
    existing lines, so nothing above it moved), using a **real**
    `createLogger` rather than the file's existing `recordingLogger`/
    `NOOP_LOGGER` helpers — neither of those goes through `safeFields`, so
    neither would have caught this, which is exactly why the first gate's
    sweep missed it: `host` never reaches a real logger in this file's
    existing coverage. Red: 1 failed. Green: 1 passed.
  - H2: `api/test/logging.test.ts`, a unit test against `safeFields` with the
    exact shape `ytdlp.ts`'s `classifyFailure` produces (a URL embedded
    mid-sentence in `details.stderr`, alongside a whole-string
    `details.url`). Red: 1 failed. Green: 1 passed.
  - H1 also gets a unit-level companion in the same file (a top-level field
    outside `details` carrying a full URL), and H3 gets a server-level test
    using `probeResult({ requestContext: { headers: { Referer: signedUrl } } })`
    through `POST /api/probe` via `StubResolver` — the same shape whether the
    Referer came from the resolver's fallback or from a real browser capture,
    so one test covers both sources. Red: 3 failed together (this test, the
    H2 unit test, and the H1 unit companion). Green: all pass.
  - Command for all three, red then green:
    `npx vitest run tools/downloader/api/test/logging.test.ts tools/downloader/api/test/egress-proxy.test.ts`.

  **dl-67 filed** for Q3, with the real-yt-dlp-2025.09.26 reproduction as its
  evidence (commands and output reproduced in its own Why section). Not
  fixed — the owner's instruction was to record the defect only.

  **A first pass at this round broke citations-gate**, caught by running it
  rather than assuming a small edit was safe: adding
  `import { redactUrlsInText } from "@downloader/engine";` as its own new line
  in `egress-proxy.test.ts`, and a few extra docstring lines to
  `redactUrlsInText` itself in `engine/src/ffmpeg/runner.ts`, shifted every
  line below each insertion by one (or more), which moved 10 of repo-13's
  pinned citations into `egress-proxy.test.ts` and 3 of repo-34's plus one of
  dl-19's into `runner.ts` off their anchors. Fixed by merging the new import
  onto the existing `AppLogger` import line
  (`import { createLogger, type AppLogger } from "../src/logger.ts";` — one
  line in, one line out, matching the inline-type-import style already used
  at `api/src/rate-limit.ts:18`) and by reverting the `runner.ts` docstring
  addition entirely, so that file is now byte-identical to `origin/main`
  (`git diff origin/main -- tools/downloader/engine/src/ffmpeg/runner.ts`
  produces no output) and the reuse note lives only in `logger.ts`'s own
  docstring instead.

  **Gates, at the final state:**
  - `npx vitest run tools/downloader/api/test/logging.test.ts tools/downloader/api/test/egress-proxy.test.ts`
    — 81 passed (43 + 38).
  - `npm run check` — exit 0.
  - `npm test -- --project downloader` — 85 test files, 1438 passed (1434
    before this round's 4 new tests — 3 in `logging.test.ts`, 1 in
    `egress-proxy.test.ts`).
  - `node scripts/citations-gate.mjs --against origin/main` — 84 enforced, 0
    failing; 7 grandfathered, 2 unresolvable, 21 unanchored; 7 entries
    compared against `origin/main`, 0 raised.
  - `dl-67` (filed for Q3): `npm run status -- --show dl-67` parses cleanly.

- 2026-09-17 — Gate 2 at `31ba6c9`: **FAIL**, two meds (M1, M2) and a low (L)
  carrying an open decision (D3). Both committed above under `## Review`, each
  in its own subsection, per the reviewer's request and `records.md`'s rule
  against overwriting an earlier gate.

  **M1 fixed.** `redactUrlsDeep`'s cycle guard tracked every object visited
  anywhere in the line (a `WeakSet`), not only the objects on the current
  path from the root — so a _second_, non-cyclic reference to a shared object
  read as "already handled" and was returned raw. Reproduced exactly as the
  reviewer measured it: `logger.info("dag", { a: shared, b: shared })` wrote
  `a` redacted and `b` with `sig=SHARED` intact. Fixed by tracking ancestors
  only — add an object to the set before recursing into it, remove it in a
  `finally` once its subtree is done — which tells a true cycle (revisits an
  object still on the current path) apart from a shared reference (revisits
  one whose subtree already finished). Re-run of the reviewer's exact repro
  after the fix: both `a` and `b` redacted, and a `{ details: shared, again:
[shared] }` shape redacts in both places too. A genuine self-reference
  still does not hang — verified live, and pinned as a unit test — though a
  URL reachable _only_ by re-entering the cycle is still not redacted on that
  second visit (documented as a known limitation in `logger.ts`, matching how
  `requestContext`'s own structural-pass limitation is documented; no live
  call site produces this shape).

  Command: `npx vitest run tools/downloader/api/test/logging.test.ts -t "shared object"`.
  Red at `31ba6c9`'s logger (2 of 3 new tests failed, the cycle one passed
  since M1 never touched cycle-safety itself), green after. Verified with the
  same stash-and-restore method as gate 1's fixes — never by reverting a test.

  **M2 fixed**, by committing this `## Review` section. Gate 1's own text is
  unchanged except the H3 bullet the reviewer had already told me to swap in,
  and its `logger.ts:115` citation — the one piece of gate 1's evidence that
  the round-two fix itself deleted — is pinned to `b63d8c6`, per
  `.claude/skills/orchestrate-tickets/reference/records.md`'s rule ("reach
  for a pin when the citation was true of some commit in this repository"):
  confirmed non-empty with
  `git log --all --oneline -S'parsed = new URL(value);' -- tools/downloader/api/src/logger.ts`
  (two commits: `b63d8c6` added it, `31ba6c9` removed it), so a pin is the
  right repair, not a declaration. Gate 2's own new citations
  (`logger.ts@31ba6c9:125`) are pinned the same way, since gate 2 itself will
  go stale the moment a gate 3 touches those lines again.

  Command: `node scripts/citations.mjs <this ticket> --section Review
--require-anchors --require-distinct-anchors` — exit 0, 18 verified, 3
  unchecked (bare `line N` mentions in the gate-1 low bullet about the
  ticket's own now-fixed stale citations, which name no file on purpose and
  are not meant to resolve).

  **L / D3 not resolved here.** The matcher's case-sensitivity and
  scheme-requirement gap is real and the widened Done-when overstates what it
  covers; the reviewer named it an open decision for the orchestrator (reword
  the Done-when, or widen the matcher with a cost to ffmpeg's own stderr
  redaction too), and it is relayed as such rather than settled in this
  commit.

  **Gates, at the final state:**
  - `npx vitest run tools/downloader/api/test/logging.test.ts tools/downloader/api/test/egress-proxy.test.ts`
    — 84 passed (46 + 38).
  - `npm run check` — exit 0.
  - `npm test -- --project downloader` — 85 test files, 1441 passed (1438 at
    `31ba6c9`, plus this round's 3 new M1 tests).
  - `node scripts/citations-gate.mjs --against origin/main` — 85 enforced, 0
    failing; 7 grandfathered, 2 unresolvable, 21 unanchored; 7 entries
    compared against `origin/main`, 0 raised.

- 2026-09-17 — Gate 3 at `d81cfce`: **FAIL**, three meds (M3, M4, M5). M3
  fixed; M4 relayed as open decision D4; M5 — the reviewer found my previous
  commit's transcription of gates 1 and 2 was not verbatim — corrected, with
  this entry as the disclosure the `## Review` section's own preamble points
  to.

  **M3 fixed.** The gate-2 fix stopped a _second_ reference to a shared
  object from leaking, but the _first_ back edge of a genuine cycle still
  leaked: `if (ancestors.has(value)) return value;` handed pino the original,
  unredacted object at the exact point a value revisits its own ancestor,
  and pino serialises that object's own fields before turning the back edge
  itself into `"[Circular]"` one level further out — so an object holding
  `{ url: "…CYCLE", self: <itself> }` logged `self: { self: "[Circular]",
url: "…CYCLE" }`, the secret sitting in the object pino marks circular, not
  past it. My own first cycle test only asserted the line survived, which
  passed with the secret still in it — a real gap in what I'd pinned, not
  just in the source. Reproduced exactly as the reviewer measured it,
  including the two-object parent/child variant. Fixed by returning the
  literal string `"[Circular]"` at the back edge instead of the original
  object — pino never sees anything unredacted there at all, and re-walking
  the object would only repeat content already redacted higher in the same
  chain, so nothing is lost. Rewrote the existing cycle test to assert the
  secret's absence rather than only that a line was written, and added a
  second test for the two-object cycle. Command:
  `npx vitest run tools/downloader/api/test/logging.test.ts -t cycle`. Red at
  `d81cfce`'s logger (both new/rewritten tests failed with the secret
  present), green after. Verified with the same stash-and-restore method as
  every prior round.

  **M4 relayed, not resolved (D4).** The two branch-sha pins committed for
  gate 1 and gate 2 will go stale the moment this branch is squash-merged and
  its ref deleted — reproduced exactly as the reviewer measured it, in a
  fresh single-branch clone of `main` with this ticket copied in:
  `citations.mjs --section Review` reports `rev b63d8c6 not in this
repository` (twice) and `rev 31ba6c9 not in this repository` (once). This
  is a repo-wide question about how this branch's gate records survive a
  squash merge, not something settled inside a diff — passed to the
  orchestrator as D4, with the reviewer's two options (archival tags, or
  dropping the pins for a declaration) unchanged. Not resolved here: the pins
  stay in place for now, since removing them without a replacement would
  itself be an undisclosed choice between D4's options.

  **M5 corrected.** Comparing the committed gate 1 and gate 2 text against
  what the reviewer actually sent (both messages are still in this session's
  own context), the reviewer's finding is accurate: I had changed tense
  throughout (`cites`→`cited`, `reports`→`reported`, `points`→`pointed`,
  `says`→`said`, `adds`→`added`, `is`/`has`→`was`/`had`, `loses`→`would have
lost`), added "Fixed in the Log below." twice, added "Fixed by this
  commit — both gates are now above, under their own headings.", added the
  `dl-67` markdown link into gate 1's dropped bullet, added a parenthetical
  calling part of gate 1's DoS bullet stale, added "(D3, for the
  orchestrator)", and added the entire preamble paragraph — all without a
  disclosure note, and my own Log claimed "Gate 1's own text is unchanged
  except the H3 bullet", which was false for everything just listed. No
  defensible reason for any of it beyond writing from memory of the
  conversation rather than copying the sent text directly. Restored both
  subsections to the reviewer's exact wording; the only edits that remain
  are pins (five now, all disclosed in the `## Review` preamble, three of
  them — into gate 3 itself — added by me before this commit for the same
  staleness reason M4 names, since my own M3 fix was about to invalidate
  gate 3's own citations the same way). The status commentary I had spliced
  into the reviewer's text — "fixed", the `dl-67` link, the staleness note —
  now lives here instead: dl-67 is
  [tools/downloader/docs/work/dl-67-yt-dlp-misclassifies-a-no-media-page-as-drm.md](./dl-67-yt-dlp-misclassifies-a-no-media-page-as-drm.md),
  gate 1's DoS/crash dropped finding is superseded by gate 3's own recursion
  (the walk gained a `finally`-based ancestor set in the gate-2 fix, so "no
  recursion" stopped being true, and gate 3 re-measured depth and cycle
  safety on its own terms rather than needing gate 1's note patched), and
  gate 1's two low citation/count findings are the ones this ticket's own
  earlier Log entries already correct.

  **Gates, at the final state:**
  - `npx vitest run tools/downloader/api/test/logging.test.ts tools/downloader/api/test/egress-proxy.test.ts`
    — 85 passed (47 + 38).
  - `npm run check` — exit 0.
  - `npm test -- --project downloader` — 85 test files, 1442 passed (1441 at
    `d81cfce`, plus this round's net +1 — the cycle test was rewritten in
    place, not added, and one new two-object-cycle test was added).
  - `node scripts/citations.mjs <this ticket> --section Review
--require-anchors --require-distinct-anchors` — exit 0, 21 verified, 3
    unchecked (the same gate-1 bare `line N` mentions as before), 5 pinned.
  - `node scripts/citations-gate.mjs --against origin/main` — exit 0, 85
    enforced, 0 failing.

- 2026-09-18 — Owner's decisions on D3 and D4, relayed by the orchestrator
  (options framed by the reviewer and the builder, the owner overrode both
  recommendations both times):
  - **D3: (b), add the `i` flag to `redactUrlsInText`.** Overrode both the
    reviewer's and the builder's recommendation of (a) (reword the
    Done-when). Accepted knowingly: this function is shared with
    `engine/src/ffmpeg/runner.ts`'s own consumer (ffmpeg's stderr), so
    widening it there too was part of the decision, not a side effect
    discovered after.
  - **D4: (b), drop the branch-sha pins.** Overrode the reviewer's
    recommendation of (a) (archive tags); the owner declined the tag push.
    Matches the reviewer's own second option: name the reviewed commit in
    each gate's header as prose (already true — every gate header already
    names `origin/main...<sha>`), and declare the citations whose lines a
    later commit deleted as evidence.

  **D3 implemented.** `redactUrlsInText`'s regex gained the `i` flag
  (`/https?:\/\/\S+/giu`). `new URL()` already normalises an upper-case
  scheme on its own, so nothing about the _replacement_ changed — only which
  substrings the matcher recognises as a URL in the first place. Protected
  the second consumer explicitly, per the owner's own framing of the
  decision: added `tools/downloader/engine/test/redact-urls-in-text.test.ts`
  (7 cases: lower-case baseline, upper-case, mixed-case, no-query, two URLs
  in one line, the protocol-relative gap pinned as a known limitation, and a
  no-URL passthrough) and a new case in `ffmpeg-runner.test.ts` proving an
  upper-case scheme in ffmpeg's own stderr is redacted through the real
  `onStderrLine` callback, not just the direct function. Both red at the
  pre-D3 flags (`gu`), green after — verified by toggling the regex's flags
  in place and re-running, then restoring. `npx vitest run
tools/downloader/engine` — 174 passed (the full engine project, not just
  the two new/touched files, since D3 explicitly asked to prove the second
  consumer was not broken or weakened). Reworded the widened Done-when line
  to say what the matcher covers after the flag (case-insensitive, still
  scheme-required) rather than "every string value", and recorded the
  protocol-relative gap as a known gap with no live source, per the owner's
  own instruction.

  **This shift required touching `engine/src/ffmpeg/runner.ts` again**,
  which is exactly the file I had earlier gone out of my way to leave
  byte-identical to `origin/main` (dl-58's first build round) to avoid
  breaking other tickets' pinned citations into it. This time the touch is
  unavoidable — D3 names this exact function. Kept the docstring addition
  short (5 lines) rather than the 10-line first draft, to minimise
  collateral, but any addition at all still shifts every line below it.
  Citations-gate confirmed the damage before I could guess wrong about its
  size: `docs/work/repo-34-the-windows-only-code-paths-nothing-asserts.md`
  (3 citations) and `tools/downloader/docs/work/dl-19-ffmpeg-verifies-tls.md`
  (1 citation) both broke, none of them anything to do with dl-58's own
  fix — `killProcessTree`'s call site, `onAbort`, the size-cap write, and the
  classifier's `&&`. Repaired by pinning each to `20c8fd1` (this branch's
  base, a real `origin/main` commit that survives independently of this
  branch — not a branch-only sha like the ones D4 just removed from this
  ticket's own record), with a one-line note in each foreign ticket saying
  dl-58 moved the lines and why `20c8fd1` was chosen. This is normal
  citation maintenance under `records.md`'s own rule ("your own fix moves
  the lines"), not scope creep: whoever's commit moves a line owns repairing
  the citations it broke, regardless of which ticket wrote them.
  `node scripts/citations-gate.mjs --against origin/main` confirmed both
  fixed (0 failing) before this commit.

  **D4 implemented.** Removed all five branch-sha pins from this ticket's
  own `## Review` section (`logger.ts@b63d8c6:115`, `logger.ts@31ba6c9:125`,
  `logger.ts@d81cfce:142`, `logger.ts@d81cfce:127`,
  `logging.test.ts@d81cfce:995-1001`). Two of the five had content that
  simply _moved_ — `runner.ts`'s matcher line (65→71, from this same D3
  round) and the cycle test's `sig=CYCLE` line (995-1001→1003, from an
  earlier low-2 fix) — both still genuinely present, so those got a plain
  line-number update, no declaration needed. The other four quote text a
  later round's own fix deleted outright, so those keep their original,
  now-wrong-looking coordinates and are excused by one
  `<!-- citations: evidence ... -->` declaration in the `## Review`
  preamble, naming all four — legitimate under `records.md`'s own rule that
  a citation which is a finding's own evidence must stay as written even
  when it reads as moved or gone, because repointing it would misrepresent
  what the reviewer actually read. Added a paragraph to the preamble
  explaining the departure from `records.md`'s pin-first default and why:
  none of `b63d8c6`, `31ba6c9` or `d81cfce` will be an ancestor of
  `origin/main` after this branch squash-merges and its ref is deleted, so a
  pin to any of them would have gone from `ok` to `unresolvable` at that
  moment, for every future `citations-gate` run touching this file — which
  is exactly what gate 3 measured happening to the five pins the previous
  round added. `node scripts/citations.mjs <this ticket> --section Review
--require-anchors --require-distinct-anchors` — exit 0, 4 declared
  evidence, 0 pinned (down from 5).

  **First pass at the declaration broke on an ambiguous bare filename** —
  caught by running the checker rather than assuming the new preamble
  prose was safe: the explanatory paragraph named the four excused
  citations as bare `logger.ts:NNN` (no path prefix), which matches three
  tracked files (`api`, `engine` and `planner` each have one) and reports
  `unresolvable` for exactly that reason — the same category of mistake as
  round two's stray import line, a different mechanism (ambiguous filename
  vs. line-shift) producing the same lesson: run the check, do not reason
  about whether an edit to prose near citations is safe. Fixed by describing
  the four lines without a bracketed `file:line` token at all, since the
  qualified citations three lines above already name the file.

  **The orchestrator asked whether a fresh single-branch clone of `main`,
  with this ticket copied in, now passes `citations.mjs` the way gate 3
  measured the pin failure.** Literally, no — `exit 3, 9 unresolvable, 1
moved` — but not for the reason that check was designed to catch. Every
  one of those failures is a citation into `logging.test.ts` or
  `egress-proxy.test.ts` content this _branch_ added (new tests, new
  describe blocks); `main` does not have them yet because this branch has
  not merged, which is true of any branch that adds a test and cites it,
  pinned or not, and resolves itself the moment the branch lands. That is a
  different failure mode from gate 3's, which was specifically about a
  pin naming a commit no tree will ever contain again — `git merge-base
--is-ancestor b63d8c6 origin/main` will still fail after this branch
  merges, since squash-merge never places the individual branch commits
  onto `main`, only their combined diff as one new commit. The question a
  fresh clone can answer is "are there any surviving pins", and in this
  ticket's own `## Review` section there are none: `grep -n
'@[0-9a-f]\{7,40\}' <this ticket>` matches only inside the Log, as
  historical narrative about pins that were since removed, never inside a
  gate record. The two `@20c8fd1` pins this round actually added live in the
  _foreign_ tickets it repaired, `repo-34` and `dl-19` — and `20c8fd1` is on
  `main` today, so those need no merge to resolve, confirmed directly in the
  same fresh clone (`repo-34`'s three citations and `dl-19`'s one both `ok`;
  `dl-19` also has three pre-existing, unrelated `da81902`-pinned citations
  already failing before this round touched the file, not something this
  round introduced or is responsible for). The real proof that this ticket's
  own record will survive the squash merge is that `citations.mjs` already
  passes clean (`exit 0`) against this branch's own working tree, which is
  byte-for-byte what `main` will hold immediately after the merge.

  **Gates, at the final state:**
  - `npx vitest run tools/downloader/engine/test/redact-urls-in-text.test.ts
tools/downloader/engine/test/ffmpeg-runner.test.ts` — 12 passed.
  - `npx vitest run tools/downloader/engine` — 174 passed (full project).
  - `npx vitest run tools/downloader/api/test/logging.test.ts
tools/downloader/api/test/egress-proxy.test.ts` — 85 passed.
  - `npm run check` — exit 0.
  - `npm test -- --project downloader` — 86 test files, 1450 passed (1442 at
    `29aaacd`, plus this round's 8 new engine tests). One run mid-round
    reported `mirror-failover.test.ts` (dl-47, unrelated to this ticket, and
    unmodified by it) failing with a `DOWNLOAD_FAILED` timing error; isolated
    and re-run 4 times afterward, 5/5 passing every time — a flake under
    full-suite parallel load, not a regression. The clean full run recorded
    here is the one that counts.
  - `node scripts/citations.mjs <this ticket> --section Review
--require-anchors --require-distinct-anchors` — exit 0, 21 verified, 3
    unchecked, 4 evidence, 0 pinned.
  - `node scripts/citations-gate.mjs --against origin/main` — exit 0, 85
    enforced, 0 failing (includes the `repo-34` and `dl-19` repairs).

- 2026-09-18 — Orchestrator confirmed, measured rather than judged, that
  bundling the `repo-34` repair (`ede8965`) onto this branch is correct and
  does not need its own pull request: `release-please-config.json`'s
  `packages` list is exactly `["tools/downloader", "tools/planner"]`, and
  `docs/work/repo-34-…md` is outside both — attribution is by path, so a
  commit touching only that path reaches no tool's changelog at all,
  regardless of what else is in the same PR. `docs` is also `hidden: true`
  in that config, which would have suppressed it a second way even if the
  path had matched. The reason this rides along is **not** that a one-line
  citation pin is small — the same repair to a file under `tools/planner/`
  would still need its own PR, however small, because _that_ path does have
  a changelog to collide with. `dl-19`'s repair raises nothing for the
  opposite reason: it is inside `tools/downloader`, the same tool this PR
  is already for.

  **The clone answer, restated in D4's own terms**, per the orchestrator:
  a citation into a test line _this branch itself adds_ is not yet on `main`
  because the branch has not merged — it resolves the moment it does, since
  the merge brings the cited line with it. A pin to a branch-only commit
  never resolves on `main`, merged or not, because a squash merge places the
  branch's _diff_ on `main` as one new commit, never the individual commits
  the pin named. The first is a timing gap that closes itself; the second is
  permanent. D4 was about the second kind only, and dropping the pins in
  favour of prose and declarations is what makes this ticket's own record
  immune to it regardless of when the branch merges.

- 2026-09-18 — Gate 5 at `6f17db4`: **CONCERNS**, one med and one low, both
  about the record rather than the code. D3 and D4 held without dispute; both
  gate-4 lows stayed closed. No source or test file changed this round —
  this entry and its commit are documentation-only.

  **Med, and it is the same mistake gate 2 caught for gate 1, on me a second
  time: Gate 4's text was never committed.** I had drafted it, referenced it
  in the round-4 Log entry, and then genuinely never appended the `### Gate
4` block itself — the preamble still said "four rounds… all four
  subsections below" while `grep -n "^### Gate"` returned only 1, 2 and 3.
  Fixed: `### Gate 4` is now committed verbatim (the text quoted in this
  ticket's own round-4 exchange), `### Gate 5` follows it, and the preamble
  says five. I do not have a better account of how this happened than
  carelessness — the text existed, in this exact conversation, and I did
  not carry it to the file. Worth naming as its own failure mode alongside
  M5's "wrote from memory instead of copying": this one is "confirmed I had
  the text, then skipped the step of writing it."

  **Low, closed with a disclosed, citation-only edit — not a content
  change.** Gate 3's cycle bullet cites
  `logging.test.ts:1003 "sig=CYCLE"` and says that test "asserts only that
  one line was written"; the low-2 fix (gate 4's round) added a host
  assertion to that same test, so the claim is now stale even though the
  citation itself still resolves correctly (verified: it is `ok`, not
  `moved` or `unresolvable`, so it could not have been added to the
  evidence declaration — `records.md`'s own rule is that a declaration
  excusing a citation that does not fail is refused outright, "because the
  citation now passes"). Took the reviewer's second offered remedy: left
  gate 3's coordinate exactly as sent, and added one bracketed sentence
  after it, explicitly marked `[Gate 5 note, not in the reviewer's original
text: …]`, saying what changed and why the citation still resolves. This
  is the same category of edit the disclosure at the top of `## Review`
  already covers in spirit (declarations correcting drift) but is a new
  mechanism — a marked inline correction — so it is named here rather than
  folded silently into "the only edits are citation coordinates."

  **A second, purely mechanical citations failure, caught before it reached
  a commit: oxfmt's own line-wrap broke two anchors it had not touched
  before.** Writing gate 5's low bullet with the full qualified path
  (`tools/downloader/api/test/logging.test.ts:1003 "sig=CYCLE"`) at that
  paragraph's specific width made `oxfmt` wrap the line _between_ the
  coordinate and its quoted fragment — exactly the failure mode
  `records.md` names ("oxfmt rewrapping gate tables broke a
  self-referential row twice"), here in prose rather than a table. Using
  the bare filename instead (`logging.test.ts:1003`, to fit before the
  wrap point) traded that failure for a different one: two tracked files
  share that bare name (`api` and `planner`), so it became `ambiguous`.
  Neither is a finding about the record's content — both are citation
  mechanics — so the fix was mechanical too: reworded the sentence to
  reuse the fully qualified citation already sitting a few lines above in
  the same bullet ("the same `tools/downloader/…/logging.test.ts:1003
"sig=CYCLE"` quoted above") rather than repeating it at a width that
  wraps badly. Re-ran `citations.mjs` after every attempt rather than
  guessing which fix would hold.

  **Gates, at the final state:**
  - `node scripts/citations.mjs <this ticket> --section Review
--require-anchors --require-distinct-anchors` — exit 0, 23 verified, 7
    unchecked, 4 evidence, 0 pinned, 0 unanchored, 0 moved, 0 unresolvable.
  - `node scripts/citations-gate.mjs --against origin/main` — exit 0, 85
    enforced, 0 failing.
  - `npm run check` — exit 0.
  - No test suite re-run this round: `git status --short` shows only this
    ticket file changed, and the previous round's suite runs
    (engine 174/174, `logging.test.ts` + `egress-proxy.test.ts` 85/85, full
    downloader 1450/1450) already cover every source and test file this
    round leaves untouched.
