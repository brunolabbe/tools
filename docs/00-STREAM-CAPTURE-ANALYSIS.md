# How video actually gets delivered — and how to catch it

This is the research step you asked for. Everything downstream (architecture,
roadmap, agent briefs) follows from what is in this document. Read it first.

---

## 1. The core problem

You cannot download a video by reading `<video>.src` off the page.

Modern players use **Media Source Extensions (MSE)**. JavaScript fetches media
in chunks, appends them to a `SourceBuffer`, and hands the player an in-memory
object. What lands in the DOM is:

```html
<video src="blob:https://example.com/6c1f0e2a-…"></video>
```

A `blob:` URL is a pointer into the browser's own memory. It is meaningless
outside that tab, cannot be fetched by a server, and expires with the page.

**Therefore: the stream must be caught at the network layer, not the DOM.**
The bytes have to cross the network, so the manifest and segment requests are
always observable — that is the leverage point the whole system is built on.

---

## 2. The four delivery shapes

| Shape           | Signature                                | How to download                                                                |
| --------------- | ---------------------------------------- | ------------------------------------------------------------------------------ |
| **HLS**         | `.m3u8`, `application/vnd.apple.mpegurl` | Parse master → pick variant → fetch segments → concat/remux                    |
| **DASH**        | `.mpd`, `application/dash+xml`           | Parse manifest → **separate** audio + video adaptation sets → fetch both → mux |
| **Progressive** | `.mp4`/`.webm` + `Accept-Ranges: bytes`  | Ranged GET, resumable. The easy case.                                          |
| **Proprietary** | RTMP, Smooth Streaming, custom           | Hand the URL to ffmpeg and hope. Long tail; deprioritise.                      |

### HLS in one paragraph

A **master playlist** lists variant streams by bandwidth and resolution
(`EXT-X-STREAM-INF`). Each variant is a **media playlist** listing segments
(`EXT-X-EXTINF` + a URI, typically 2–10 s of `.ts` or fragmented MP4). Audio may
be in-band, or split out via `EXT-X-MEDIA:TYPE=AUDIO` groups — in which case you
must fetch the audio playlist separately and mux. `#EXT-X-ENDLIST` present means
VOD; absent means live.

### DASH in one paragraph

XML. `AdaptationSet` per media type, `Representation` per quality. Segments are
addressed by `SegmentTemplate` (`$Number$`/`$Time$` substitution), `SegmentList`,
or a `SegmentBase` byte-range index. Audio and video are **almost always
separate** — muxing is mandatory, not optional. `type="dynamic"` means live.

---

## 3. Encryption: the distinction that defines project scope

These look superficially similar and are completely different things.

### Transport encryption — **in scope**

HLS `EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x…`. The decryption key is
fetched over HTTPS from a URI named in the manifest, using the same session
credentials as everything else. There is no device binding and no licence
protocol. **ffmpeg handles this natively** — point it at the playlist with the
right headers and it just works. Treat it as ordinary transport, because it is.

### DRM — **out of scope, permanently**

Widevine, PlayReady, FairPlay. The player uses Encrypted Media Extensions to
negotiate with a licence server; keys are bound to a device certificate and held
in a secure decryption module. Getting content keys out means defeating that
scheme, which is circumvention of a technological protection measure — the thing
DMCA §1201 and the EU Copyright Directive Art. 6 specifically prohibit,
independent of whether the underlying copying would be fair use.

**So the design decision is:** detect it, name it, stop. `DRM_PROTECTED` is a
first-class terminal error with a clear user-facing message, not a bug to fix
later. Do not add a "just try anyway" path.

Detection signatures resolvers must implement:

- **DASH** — `<ContentProtection>` with a known system UUID:
  - Widevine `edef8ba9-79d6-4ace-a3c8-27dcd51d21ed`
  - PlayReady `9a04f079-9840-4286-ab92-e65be0885f95`
- **HLS** — `EXT-X-KEY`/`EXT-X-SESSION-KEY` with `METHOD=SAMPLE-AES` and a
  `URI="skd://…"` (FairPlay) or a `KEYFORMAT` of `urn:uuid:edef8ba9-…` (Widevine)
- **Runtime** — the page calls `navigator.requestMediaKeySystemAccess(...)`.
  Hooking this in an init script is the most reliable detector of all, because it
  fires regardless of manifest format.

This boundary costs you Netflix, Disney+, Prime and Spotify. It leaves the
enormous majority of the web — news sites, education platforms, conference
recordings, social video, self-hosted players, most embeds — fully in scope.

---

## 4. Capture mechanisms, and how they combine

There are two mechanisms. Only one of them can meet the goal; the other is an
optimisation layered on top of it.

### Mechanism A — site-specific extractors (`yt-dlp`)

`yt-dlp` maintains hand-written extractors for ~1800 sites. It knows each site's
private JSON API, so it gets clean titles, correct variant lists, subtitles and
chapters with no browser involved.

- **Cost:** ~2 s per probe, low memory
- **Wins:** accuracy, metadata quality, actively maintained
- **Loses:** Python runtime dependency; needs frequent updates; **zero coverage
  for any site nobody has written an extractor for**

That last point is disqualifying on its own, so state it plainly: **an
extractor-only system cannot be this product.** Its failure on an unknown site is
not degraded quality, it is no answer at all — and "sites nobody has written code
for" is exactly the set the project exists to serve. Extractors are a speed
optimisation for the well-trodden case. They are never the foundation, and the
system must remain fully functional with `yt-dlp` absent entirely.

### Mechanism B — headless browser network sniffing (Playwright)

Drive a real Chromium, let the page's own player do the work, and watch what it
requests. This is the generic path and the reason the project can claim "any
website".

```ts
// The shape of it. Full implementation is WP-2.
const hits: NetworkHit[] = [];

page.on("request", (req) => {
  const url = req.url();
  if (/\.(m3u8|mpd)(\?|$)/i.test(url) || /\.mp4(\?|$)/i.test(url)) {
    hits.push({ url, headers: req.headers(), resourceType: req.resourceType() });
  }
});

// Content-Type is more reliable than the file extension — plenty of CDNs
// serve manifests from extensionless, signed, or query-only URLs.
page.on("response", (res) => {
  const type = res.headers()["content-type"] ?? "";
  if (/mpegurl|dash\+xml/i.test(type)) {
    hits.push({ url: res.url(), headers: res.request().headers(), resourceType: "manifest" });
  }
});

await page.goto(target, { waitUntil: "domcontentloaded" });
await triggerPlayback(page); // click play, scroll, dismiss consent banners
await waitForQuiet(page, 3000);
```

- **Cost:** ~10–20 s per probe, ~300 MB RAM per browser context
- **Wins:** works on sites nobody has ever seen before; naturally collects the
  exact headers the CDN expects
- **Loses:** slow, resource-hungry, defeated by aggressive bot detection,
  and it needs playback actually to start

### Combining them — the resolver registry

Mechanism B is the foundation. Mechanism A sits in front of it as a fast path:

```
priority 10  ┌─ site-specific handwritten resolvers (add as needed)  ─┐ optional
priority 20  ├─ yt-dlp adapter          ← fast path, ~90% of traffic ─┘ fast paths
priority 50  ├─ browser sniffer         ← THE FOUNDATION: any site, always present
priority 90  └─ direct-URL resolver     ← the URL *is* a manifest or media file
```

First usable answer wins. `NO_MEDIA_FOUND` falls through to the next resolver;
`DRM_PROTECTED` and `AUTH_REQUIRED` stop the chain, because those are true facts
about the source and retrying with a different technique only burns time.

Read the diagram bottom-up to see why this is safe: **delete every optional tier
and the system still works**, just slower on well-known sites. That is the test
for whether the layering is right. Coverage is a property of the sniffer alone;
the extractor tiers only ever buy latency and metadata quality, and their
breakage — extractors break constantly as sites redesign — degrades a site to
the slow path instead of taking it dark.

---

## 5. The part that will actually break: request context

More capture attempts fail here than anywhere else in the pipeline.

A manifest URL captured in the browser and then fetched from bare `curl` will
very often return 403. The CDN is checking things the browser sent implicitly:

- **`Referer`** — the single most common gate
- **`Origin`** — CORS-adjacent checks
- **`User-Agent`** — must match the client that got the signed URL
- **`Cookie`** — session or CDN-token cookies
- **Signed query params** — `?token=…&expires=…`, HMAC'd against path + client
  IP, and frequently valid for only **30–300 seconds**

Three consequences that shape the architecture:

1. **Capture headers at probe time and replay them on every segment fetch** —
   not just the manifest. Store them in `RequestContext`.
2. **Always re-probe immediately before downloading.** A probe result more than a
   minute old is a liability, not a cache. This is why `probing` is a distinct
   job state rather than something the API does once up front.
3. **Signed URLs are often IP-bound.** If the probe browser and the download
   worker have different egress IPs, downloads 403 while the probe looked fine.
   Route both through the same egress, or run them in the same container.

---

## 6. Assembling the file

Use ffmpeg. Do not hand-roll segment concatenation — you will get timestamp
drift, broken seeking, and A/V desync on any stream with discontinuities.

```bash
# HLS, incl. AES-128, with replayed context. Stream-copy: no re-encode.
ffmpeg -headers $'Referer: https://site/\r\nUser-Agent: Mozilla/5.0 …\r\n' \
       -i "https://cdn/master.m3u8" \
       -c copy -bsf:a aac_adtstoasc -movflags +faststart out.mp4

# DASH with split tracks: two inputs, explicit stream mapping.
ffmpeg -i video.mp4 -i audio.m4a -c copy -map 0:v:0 -map 1:a:0 out.mp4
```

Non-obvious flags that will cost an agent an afternoon each:

- `-c copy` — **always** stream-copy. Re-encoding is 50× slower and lossy. Only
  transcode when the container genuinely cannot hold the codec.
- `-bsf:a aac_adtstoasc` — required when moving AAC out of MPEG-TS into MP4.
  Omit it and you get a file that plays audio in VLC and nowhere else.
- `-movflags +faststart` — moves the `moov` atom to the front so the file streams
  in a browser instead of requiring a full download before playback.
- `-map` — without it, ffmpeg picks one stream per type by its own rules and
  silently drops the rest.

Parse progress from ffmpeg's stderr (`-progress pipe:1 -nostats` gives clean
`key=value` lines: `out_time_us`, `total_size`, `speed`). Percentage = processed
time ÷ known duration; when duration is unknown, report indeterminate rather than
inventing a number.

---

## 7. Failure modes to design for from day one

| Failure             | Signal                            | Response                                                          |
| ------------------- | --------------------------------- | ----------------------------------------------------------------- |
| DRM                 | EME call / manifest UUID          | `DRM_PROTECTED`, stop                                             |
| Bot challenge       | Cloudflare interstitial, 403 HTML | `BOT_CHALLENGE`; stealth flags help, nothing is reliable          |
| Geo-block           | 403 + region JSON                 | `GEO_BLOCKED`; optional proxy                                     |
| Login wall          | redirect to `/login`              | `AUTH_REQUIRED`; optional operator cookie jar                     |
| Signed URL expiry   | 403 mid-download                  | `VARIANT_GONE` → re-probe → resume                                |
| Live stream         | no `ENDLIST` / `type="dynamic"`   | require explicit `liveDurationSec`                                |
| Player never starts | no media requests in 20 s         | `NO_MEDIA_FOUND`; try consent-banner dismissal first              |
| Enormous file       | 8-hour 4K manifest                | `SIZE_LIMIT_EXCEEDED` before downloading, from bitrate × duration |

---

## 8. Operational realities

Because this service fetches URLs on a user's behalf, three things are not
optional:

- **SSRF guard.** Resolve the hostname and reject loopback, private, link-local
  and metadata addresses (`169.254.169.254` above all) — re-checking after every
  redirect, not just on the input. Without this the service is an open proxy into
  your own network.
- **Resource caps.** Browser contexts leak; ffmpeg processes hang. Cap
  concurrency, set hard timeouts on every stage, and kill process trees on
  cancel.
- **Retention.** Files expire and get collected. Download links are opaque
  capability tokens, not guessable job ids.

One non-technical note, stated once: this tool will faithfully do what it is
pointed at, and what is legal to download depends on the content and the site's
terms — that is a decision for whoever operates it. The DRM boundary in §3 is the
one place where that judgement is encoded in the code rather than left to the
operator, because it is the one line that is legally bright.

---

## Sources

- [How to Find the M3U8 URL of Any Stream (DevTools, 2026)](https://getvidora.com/blog/find-m3u8-url/)
- [Playwright Network Interception and Mocking](https://qaskills.sh/blog/playwright-network-interception-mocking-guide)
- [How to Handle Playwright Network Interception](https://oneuptime.com/blog/post/2026-02-02-playwright-network-interception/view)
- [How to capture background requests and responses in Playwright](https://scrapfly.io/blog/answers/how-to-capture-xhr-requests-playwright)
- [HTTP Live Streaming — Wikipedia](https://en.wikipedia.org/wiki/HTTP_Live_Streaming)
