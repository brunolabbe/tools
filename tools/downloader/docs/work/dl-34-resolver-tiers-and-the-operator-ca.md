---
id: dl-34
tool: downloader
title: The resolver tiers cannot reach the operator's CA, and misreport it when they hit it
kind: work-package
status: ready
milestone: null
depends_on: []
difficulty: hard
---

# dl-34 — Chromium and yt-dlp on a private-root deployment

**Packages:** `resolvers` (`browser/pool.ts`, `resolvers/browser.ts`,
`browser/classify.ts`, `resolvers/ytdlp.ts`), `api` (`config.ts`, `server.ts`).

## Why

An operator deploying behind a corporate TLS-inspecting proxy, or against an
internal CDN with a private root, has one setting for it: `FFMPEG_CA_FILE`
(`egressCaFile` after dl-31). It reaches **ffmpeg only**. The two resolver tiers
that actually load the page — Chromium and yt-dlp — are given no route to that
trust anchor at all, and when they consequently fail they report it as something
else entirely.

Two halves, filed as one ticket because an operator meets them as one event and
fixing either alone leaves the report misleading.

### Half one — no route to the anchor

This is **not** an oversight. It is dl-27's tunnel-versus-terminate split working
as designed, and `downloader/api/src/server.ts:96-104` says so in the first person:

> Chromium and yt-dlp verify their own connections without being asked, so they
> keep the one above: a `CONNECT` is tunnelled, the origin's own certificate
> reaches them, and nothing needs a trust-store change.

That sentence is true for a **public** origin. It is false for an origin whose
certificate chains to a root only the operator has, which is exactly the
deployment `FFMPEG_CA_FILE` exists to serve. So the tool has a setting for
"trust this root" that half the pipeline cannot see, and the design note that
justifies the gap does not mention the case.

### Half two — and neither tier can name the failure

Both tiers can _see_ a certificate error and both discard it:

- `classifyNavigationError` (`resolvers/src/browser/classify.ts:149`)
  passes an `AppError` straight through, has one `/timeout/i` branch, and
  returns a blanket `UNREACHABLE` for everything else — including a Chromium
  navigation failure that names the cause.
- `classifyFailure` (`resolvers/src/resolvers/ytdlp.ts:622`)
  string-matches stderr for DRM, sign-in, geo and 429, then falls back to
  `NO_MEDIA_FOUND` — documented as deliberate, so that a broken extractor
  degrades to the browser tier rather than failing the request. A certificate
  refusal takes that same fallback.

So on a private-root deployment the operator is told **"No downloadable video
stream was found on that page"** for a trust-store problem. That is the worst
available sentence: it points at the source, invites a retry, and hides the one
setting that would fix it.

**Not the same defect, do not sweep them in.** `resolvers/src/size-probe.ts:74`
and `resolvers/src/size-probe.ts:98` also swallow a failure to `undefined`, and
`resolvers/src/size-sample.ts:371` swallows one to `unchanged` — the declared
estimate it started from. Different values, same intent, and it is correct and
documented at
`resolvers/src/size-probe.ts:7-11`: "a probe that fails the whole resolve because a CDN would
not answer a HEAD is a regression, and it would be one on the _common_ path".
Those are size estimates degrading to a declared value. This ticket is about a
_verdict_ being wrong, which is a different thing.

## Build

1. **Give the tiers the anchor.** Chromium takes `NODE_EXTRA_CA_CERTS` for its
   Node-side fetches but its own network stack does not read it; the flag it
   honours and the one yt-dlp honours (`--ca-certificate`, or `SSL_CERT_FILE` /
   `REQUESTS_CA_BUNDLE` on its Python stack) are different mechanisms. Decide per
   tier and record which, because they are not interchangeable — and see the
   decision below, which may make this moot for Chromium.
2. **Classify a certificate failure as `TLS_VERIFICATION_FAILED`** in both
   classifiers. The code already exists in the taxonomy and already maps to 502
   in `api/src/http-errors.ts`, so this costs no new code and no new status.
   The copy must name the setting.
3. **Say it at boot too**, next to the existing `egress configured` line: an
   operator who set a CA file should be told which components it reaches.

## Done when

1. A resolver meeting a certificate it cannot verify raises
   `TLS_VERIFICATION_FAILED`, not `UNREACHABLE` and not `NO_MEDIA_FOUND` —
   proven for both tiers against a fixture, not a live origin.
2. An operator-supplied root reaches whichever tiers step 1's decision says it
   should, proven end to end against a locally-issued certificate.
3. `npm run check` and `npm test -- --project downloader` pass.

## Open decision, for whoever picks this up

**Should Chromium get the operator's root at all, or should it move to the
terminating proxy?** dl-27 already built a proxy that terminates TLS and mints
leaves from a generated root; ffmpeg is on it. Putting the tiers on it too would
give them the operator's trust for free and delete this ticket's half one — at
the cost of every HTTPS page Chromium loads passing through this process in
plaintext, which `downloader/api/src/server.ts:96-104` explicitly declined. Recommended: **do not
move Chromium**; fix the classification (half two) first, since it is cheap,
strictly an improvement, and independent — then take half one as its own
decision with the operator's deployment in front of you.

## Provenance of the claims above

Filed from dl-29's coordinator, relaying dl-31's post-PR gate. Because a ticket
carries a reproduction, every citation was re-resolved here before it was
written down. **The relayed paths did not resolve as given** — they named
`browser/pool.ts` and `ytdlp.ts` unqualified, and this repo has two
`size-probe.ts` and two `pool.ts`. The paths above are tool-rooted.

**Verified in this worktree, at `origin/main` + dl-29:**

- `grep -rnE "ca-certificate|ignore-certificate-errors|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE|REQUESTS_CA_BUNDLE|CURL_CA_BUNDLE|NSS" tools/downloader --include=*.ts`
  (excluding `dist`) → **exit 1, zero hits.**
- `chromium.launch()` at `resolvers/src/browser/pool.ts:256-268` passes exactly
  `headless`, `args`, `proxy`. No `env`, no certificate flag.
- `BASE_ARGS` at `resolvers/src/browser/pool.ts:117-126` — seven flags, none
  about certificates.
- `browser.newContext()` at `resolvers/src/resolvers/browser.ts:148` does
  **not** set `ignoreHTTPSErrors`.
- yt-dlp's `spawn()` at `resolvers/src/resolvers/ytdlp.ts:516-523` passes
  `shell: false`, `windowsHide`, `detached`, `stdio` — **no `env` at all**, so
  the child inherits this process's environment and nothing tier-specific is
  set.
- Both classifiers read exactly as described above.
- `downloader/api/src/server.ts:96-104`'s comment is quoted verbatim.
- The `size-probe` / `size-sample` exclusion is verified, including the docblock
  that makes it deliberate.

**Inherited and NOT verified here** — no browser and no yt-dlp binary was run:

- That Chromium surfaces the failure as `net::ERR_CERT_AUTHORITY_INVALID` and
  that yt-dlp says `CERTIFICATE_VERIFY_FAILED`. Both are plausible and neither
  was observed. **Build step 2 depends on the exact strings, so reproduce them
  before matching on them.**
- That a private-root deployment fails at all in the way described. The argument
  is from the code paths above, not from a running deployment.

## Log

- **2026-09-01** — Filed from dl-29's branch, alongside dl-35, on the precedent
  of dl-32/dl-33 riding dl-23's. Not folded into dl-29: it is a different tool
  area, it carries an open architectural decision, and dl-29 was explicitly told
  to stay out of `config.ts` while dl-31 was in gate.
