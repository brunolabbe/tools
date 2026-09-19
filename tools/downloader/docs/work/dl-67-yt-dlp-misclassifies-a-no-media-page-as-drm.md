---
id: dl-67
tool: downloader
title: An echoed URL containing "drm" makes yt-dlp's stderr classify as DRM_PROTECTED
kind: fix
status: done
milestone: null
depends_on: []
difficulty: standard
---

# dl-67 — yt-dlp misclassifies a no-media page as DRM_PROTECTED

## Why

Found by `a9a05d05c8083a85d` while gating [dl-58](./dl-58-a-failed-probe-logs-the-page-url-unredacted.md)
(H2), and reproduced independently by the builder with the real `yt-dlp`
2025.09.26 binary against a local server. Filed rather than fixed here, on the
owner's instruction — dl-58's fix is about what reaches the _log_, and this is
a misclassification in what reaches the _client and the retry policy_, a
different defect the same reproduction happened to surface.

`resolvers/src/resolvers/ytdlp.ts:906`'s `classifyFailure` lowercases yt-dlp's
stderr and matches source-fact markers against the whole of it, including the
URL yt-dlp echoes back in its own error line. When that URL's _text_ — not its
meaning — contains one of those markers, the page is classified as if the
marker described the source, even though it was never in yt-dlp's diagnosis at
all: it was in the address the caller happened to submit.

**Reproduced 2026-09-17**, from the worktree on `dl-58-redact-probe-error-url`
at `b63d8c6`, against the real `yt-dlp` 2025.09.26 binary
(`/usr/local/bin/yt-dlp`) and a real `YtDlpResolver`. A local server served a
media-less HTML page at a URL whose _path_ happens to contain the string
`drm` — nothing about the page itself is DRM-protected:

```bash
# terminal 1 — a page with no media, at a URL containing "drm"
python3 -c "import http.server as h
class H(h.BaseHTTPRequestHandler):
  def do_GET(s):
    s.send_response(200); s.send_header('Content-Type','text/html'); s.end_headers()
    s.wfile.write(b'<html>x</html>')
h.HTTPServer(('127.0.0.1',18081),H).serve_forever()"
```

```js
// terminal 2, from tools/downloader/api after `npm run build`
node --input-type=module -e "
import { AppError } from '@downloader/contract';
import { YtDlpResolver } from '@downloader/resolvers';
try {
  await new YtDlpResolver({enabled:true}).resolve(
    new URL('http://127.0.0.1:18081/drm/watch?v=1&sig=SECRET123'),
    {signal:new AbortController().signal, timeoutMs:30000},
  );
} catch (e) {
  const a = AppError.from(e);
  console.log(a.code, JSON.stringify(a.details));
}
"
```

Output:

```text
DRM_PROTECTED {"url":"http://127.0.0.1:18081/drm/watch?[redacted]","exitCode":1,"stderr":"ERROR: Unsupported URL: http://127.0.0.1:18081/drm/watch?v=1&sig=SECRET123\n"}
```

yt-dlp's actual stderr is `ERROR: Unsupported URL: <the URL we gave it>` — it
never inspected the page for DRM at all; the binary exited because it does not
recognise a bare HTML page as a supported extractor, which is an ordinary
`NO_MEDIA_FOUND` case (the registry would try the next tier). But `stderr`
lowercased contains `.../drm/...` from the echoed URL, and `classifyFailure`'s
first branch below the certificate check matches any occurrence of `"drm"` in
the whole stderr text and returns the terminal, non-retryable `DRM_PROTECTED`
— see `ytdlp.ts`'s own docblock above `classifyFailure`, which explains _why_
a certificate failure is checked first but does not anticipate the source text
being the caller's own input rather than yt-dlp's diagnosis.

**Consequences, both real:** the registry stops the chain on a terminal code
(`registry.ts`'s fallthrough rule is `NO_MEDIA_FOUND` only), so a page that a
later tier (browser) might have handled is never tried; and the user is told
the video is DRM-protected and unrecoverable, when the actual fact is that
yt-dlp does not support that URL shape at all.

**Conditions**: the yt-dlp tier enabled, and the submitted URL's text
containing one of `classifyFailure`'s source-fact markers (`drm`,
`members-only`, `geo-restricted`, …; see the marker lists above `classifyFailure`
in `ytdlp.ts`) anywhere — including inside a base64-encoded signature, where it
can appear by chance rather than by the operator's or attacker's design.

## Build

**Question**: which shape fixes `classifyFailure`'s marker match reading the
caller's own request URL as a fact about the source?

**Options**:

1. Mask the request URL: match markers against stderr minus any substring
   that exactly equals the request URL or its redacted form.
2. Strip yt-dlp's echo lines, such as `Unsupported URL: <url>`, before
   matching.
3. Hold dl-67 — file the fix separately, ship nothing here.

**Chosen: (1), mask the request URL** — the owner, 2026-09-19. Reason: it does
not depend on yt-dlp's undocumented, version-specific catalogue of echoing
messages, where (2) does.

**The cost that comes with (1), carried into `Done when` below**: a marker
inside the URL's path survives the mask if yt-dlp echoes the URL in a
different encoding from the one submitted. Implemented as `maskRequestUrl` in
`resolvers/src/resolvers/ytdlp.ts`, which strips two forms of the request URL
from stderr before marker matching: the exact `url.href`, and
`decodeUnreservedEscapes(url.href)`, a same-file function that decodes only a
percent-escape whose byte is an RFC 3986 §6.2.2.2 unreserved character. That
second form is **measured against the real binary**, 2025.09.26, 2026-09-19:
yt-dlp decodes exactly those escapes in the URL it echoes and leaves every
other one — `%20`, `%2f`, `%3F`, a multi-byte UTF-8 escape — as given. (An
earlier draft used `decodeURI`, whose behaviour is close enough to look right
and disagrees with the real binary on exactly those cases; the ticket's own
gate caught it before this cost paragraph or the fixture's "measured" comment
had been checked against anything real — see the 2026-09-19 gate Log entry.)
Anything outside those two forms — a case fold on a punycode host, a query
re-ordering by an intermediate redirect, a yt-dlp version that normalises
differently, a `redactUrl` form the owner chose to drop (see the third
decision below) — is a known, disclosed gap, not an oversight. **The exact
`url.href` form is insurance against an echo path this build did not
measure, not something the measured binary's own `Unsupported URL` line
needs**: that line always normalises unreserved escapes, so for a URL
carrying one, `decodeUnreservedEscapes` alone already matches what it
actually prints — a second gate finding corrected a test comment that had
claimed otherwise.

**Second question, narrower, on top of the first**: a gate on (1) found the
encoding-normalisation attempt inside `maskRequestUrl` used `decodeURI`,
which does not match what yt-dlp actually decodes. Two remedies, both inside
the mask mechanism from the first decision — this does not reopen it:

1. Model the measured decode: replace `decodeURI` with a function
   implementing yt-dlp's real, measured behaviour (RFC 3986 §6.2.2.2
   unreserved-escape decoding only).
2. Keep the code as it stood and disclose the gap instead: state plainly
   that the encoding variant is unmeasured and drop the claim that it is
   proven.

**Chosen: (1), model the measured decode** — the owner, 2026-09-19, put to
them by the orchestrator with `AskUserQuestion`; both the orchestrator and
the reviewer had recommended (1) and the owner's choice overrode neither.
Built as `decodeUnreservedEscapes`, ahead of the owner's answer — the answer
came after the build, not before it; see the Log.

**Third question, on the `redactUrl` form left over from the first
decision's wording**: keep it, documented as dead, or drop it?

1. Drop it.
2. Keep it, documented as dead against real yt-dlp on this call's current
   path.

**Chosen: (1), drop it** — the owner, 2026-09-19, put to them by the
orchestrator with `AskUserQuestion`, overriding the builder's and the
reviewer's lean toward (2). The orchestrator's question told the owner the
form existed only because the first decision's own option text said "or its
redacted form", not because of a measured need. Removed from
`maskRequestUrl`, its docblock, and the now-unused `redactUrl` import.

## Done when

- A test reproduces this with the real spawn path (the existing
  `resolvers/test/ytdlp.test.ts` fixture-binary pattern, not a live `yt-dlp`
  install) and fails on `origin/main`.
- Whichever fix is chosen makes that test pass without breaking
  `ytdlp.test.ts`'s existing marker-classification coverage (certificate,
  auth, age-gate, geo, bot-challenge — all still classify correctly when the
  marker is genuinely in yt-dlp's own diagnosis, not just in the echoed URL).
- `npm run check` and `npm test -- --project downloader` are green.

## Log

- 2026-09-17 — Filed on the owner's instruction, alongside
  [dl-58](./dl-58-a-failed-probe-logs-the-page-url-unredacted.md), whose gate
  surfaced this as a dropped finding (real defect, out of that ticket's
  range). Not fixed here.
- 2026-09-19 — Owner chose Build option (1), mask the request URL; recorded
  above. Fixed in `resolvers/src/resolvers/ytdlp.ts`: a new `maskRequestUrl`
  strips five forms of the request URL from stderr before `classifyFailure`
  lowercases it and matches source-fact markers — the exact `url.href`, its
  `redactUrl` form, a trailing-slash toggle, and both `decodeURI` and
  `encodeURI` of it (see the gate entry below for why three of those five
  were wrong or dead and were later replaced). Three tests added at the end
  of
  `resolvers/test/ytdlp.test.ts`, plus three new fake-binary modes
  (`unsupported-echo`, `unsupported-echo-decoded`, `drm-and-url-echo`) in
  `fake-ytdlp.mjs`: the reproduction (a `drm`-containing request URL no
  longer forces `DRM_PROTECTED` — proven red against `origin/main` by
  temporarily reverting `ytdlp.ts` to the `origin/main` copy and re-running
  just the new tests: 2 of 3 failed there, the third — a genuine diagnosis
  alongside the echoed URL still winning — does not depend on the fix and
  passed both before and after, as expected), a check that a genuine marker
  elsewhere in stderr still classifies correctly when the URL also happens to
  carry the word, and the one encoding variant the ticket's Done-when asks to
  be proven (a percent-escaped marker in the URL's path, decoded before
  yt-dlp echoes it back).
  **The ticket's Build section had two shapes "weighed", not chosen**; this
  entry replaces that with the owner's actual decision and its cost, in the
  ticket's own question/options/choice form, per the dispatch instruction.
  **The Done-when's own text is wrong**, not just the Build section:
  "age-gate, geo, bot-challenge" names classifications `classifyFailure` does
  not have (its branches are TLS, DRM, AUTH, GEO, RATE_LIMITED) — caught by
  the gate, not fixed here since it predates this ticket and RATE_LIMITED's
  own missing test is a pre-existing gap outside this ticket's range.
  **Fold-in considered and declined**: nothing else in `ytdlp.ts` reads
  unmasked stderr for a classification decision, so there was no adjacent
  free work to fold in.
  Verification: `npx vitest run tools/downloader/resolvers/test/ytdlp.test.ts`
  — 63/63 passed (60 pre-existing + 3 new) with the fix; `npm run check`
  green; `npm test -- --project downloader` — 86 files, 1460/1460 passed.
- 2026-09-19 — Gate (Opus, builder Sonnet) on `1d4e38c` returned CONCERNS: one
  med (also copied to the orchestrator as an open decision), four lows. The
  med, reproduced and confirmed against the real `/usr/local/bin/yt-dlp`
  2025.09.26: the `decodeURI` encoding variant does not model what yt-dlp
  actually does. Live measurement — a loopback URL with a mix of unreserved
  and reserved/multi-byte percent-escapes — showed yt-dlp decodes only the
  unreserved ones (RFC 3986 §6.2.2.2) and leaves the rest (`%20`, `%2f`,
  `%3F`, a UTF-8 escape) alone; `decodeURI` decodes those too, so it
  disagreed with the real binary and the test proving it was circular
  (fixture and production both called the same JS built-in, proving nothing
  about yt-dlp). The fixture's "measured" comment was also false: nothing
  measured that specific transform. **Built the reviewer's recommended
  remedy (a) immediately**, reasoning at the time that it was a correction
  inside the owner's chosen mechanism rather than a live open decision, since
  (a) looked strictly better than (b) to both the reviewer and me. **That
  reasoning was wrong to act on, not wrong on the merits**: the reviewer's
  own agent definition does not let a reviewer/builder pair settle an open
  decision between them even where one option looks dominant, and it had
  already sent this to the orchestrator as one in the same pass it sent it
  to me. The orchestrator put it to the owner with `AskUserQuestion`; see the
  next Log entry for the answer, which came after this build, not before it.
  Replaced `decodeURI`/`encodeURI`/the trailing-slash toggle with
  `decodeUnreservedEscapes`, a new function implementing exactly the
  measured RFC 3986 §6.2.2.2 behaviour; reworked the fixture mode
  (`unsupported-echo-unreserved-decode`) to model the same real behaviour and
  cited the actual measurement command/output in its comment; rewrote the
  encoding-variant test around a mixed reserved/unreserved-escape URL
  matching the live measurement.
  The four lows were also addressed: dropped the trailing-slash toggle and
  `encodeURI` (both dead against real yt-dlp per the gate's mutation testing,
  and `encodeURI`'s own justification admitted no case existed); fixed
  `.split(candidate).join("")` to `.join(" ")` so stripping a substring
  cannot fuse the text on either side into an accidental marker, with a new
  regression test; corrected this Log's earlier claim that `drm-and-url-echo`
  was an existing mode extended (it was new, like the other two); and added
  the Done-when correction above. Re-verified after the fix: the two live
  URLs the gate used to demonstrate the med (`d%72m/...` and the
  `%41%7e%2d%5f%2e/.../a=%64rm...` mix) both now classify `NO_MEDIA_FOUND`
  against the real binary; mutation-tested each of the three remaining
  candidate forms (`href`, `redactUrl`, `decodeUnreservedEscapes`) by
  removing each in turn and re-running the spec — `href` and
  `decodeUnreservedEscapes` are now killed (a new test added specifically to
  kill `href`, since the gate found it was previously covered only by
  accident); `redactUrl` remains unkilled, disclosed in the Build section as
  unreachable through this call's current path and kept only because the
  owner's decision names it by name.
  Verification after the fix: `npx vitest run
tools/downloader/resolvers/test/ytdlp.test.ts` — 65/65 passed; re-ran the
  red-on-`origin/main` check with the corrected spec — **3 of 65 failed**
  against the unfixed source (the reproduction, the encoding-variant test,
  and the exact-href test), not the 2 an earlier version of this entry
  claimed before a re-count; `npm run check` green; `npm test -- --project
downloader` — 86 files, 1462/1462 passed.
- 2026-09-19 — Owner answered the second Build decision (put to them by the
  orchestrator with `AskUserQuestion`, after the fix above had already been
  built): chose (1), model the measured decode — the same remedy the
  reviewer recommended and the one already built, overriding neither
  recommendation. Recorded above, next to the original mask decision. The
  `redactUrl` question stays open — not this build's to settle — left
  exactly as built, documented as dead against real yt-dlp on this call's
  current path.
- 2026-09-19 — A re-gate of `645c23b` returned one more record-accuracy med
  and three lows, all on the ticket text rather than the code: the gate Log
  entry above still read as if the builder, not the owner, had settled the
  encoding-fix decision; the exact-href test's comment described an echo
  shape the measured binary does not produce for that URL; the red-on-
  `origin/main` count was off by one; and an earlier in-place Log edit had
  understated what `1d4e38c` actually shipped (three forms instead of the
  five it shipped). All four fixed in place, above.
- 2026-09-19 — Owner answered the third Build decision (put to them by the
  orchestrator with `AskUserQuestion`): chose (1), drop the `redactUrl` form
  — overriding the lean toward keeping it, documented as dead, that both the
  builder and the reviewer had. Recorded above. Removed
  `redactUrl(url.href)` from `maskRequestUrl`'s candidate set, its mention
  from that function's docblock, and the now-unused `redactUrl` import from
  `resolvers/src/resolvers/ytdlp.ts`. `maskRequestUrl` now strips two forms:
  the exact `url.href` and `decodeUnreservedEscapes(url.href)`. Reworded the
  exact-href test's comment, which had referenced the dropped form, to speak
  only of the two forms that remain.
  Verification: `npx vitest run tools/downloader/resolvers/test/ytdlp.test.ts`
  — 65/65 passed with `redactUrl` removed (nothing in the suite depended on
  it, consistent with it having been dead); `npm run check` and `npm test --
project downloader` results in the final report.
