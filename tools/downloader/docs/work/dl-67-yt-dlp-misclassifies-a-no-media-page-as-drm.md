---
id: dl-67
tool: downloader
title: An echoed URL containing "drm" makes yt-dlp's stderr classify as DRM_PROTECTED
kind: fix
status: ready
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

Not scoped here — the owner asked for the reproduction to be recorded, not the
fix. Two shapes worth weighing when this is picked up, neither chosen:

- Strip the echoed command/URL from `stderr` before matching markers against
  it — yt-dlp's `Unsupported URL: <url>` (and similar lines that echo the
  input) are the ones known to carry it; matching against the tail after any
  such echo would need the exact set of yt-dlp messages that quote it back,
  which is undocumented and versioned by the yt-dlp release.
- Match markers against everything _except_ whichever substring exactly
  reproduces the request URL (or its redacted form) — cheaper to reason about
  than yt-dlp's message catalogue, but a marker inside the _path_ survives
  this if the path text differs even slightly from the submitted URL's
  encoding.

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
