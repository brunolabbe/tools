---
id: dl-38
tool: downloader
title: The tiers' TLS-rejection correlation cannot see a concurrent success, only a concurrent failure
kind: fix
status: ready
milestone: null
depends_on: []
---

# dl-38 — a healthy backend's own success is invisible to the correlation

**Packages:** `api` (`tls-rejections.ts`, `egress-proxy.ts`, `resolvers.ts`).

## Why

[dl-37](./dl-37-tiers-move-onto-the-terminating-proxy.md) built
`TlsRejectionLog` to reattach `TLS_VERIFICATION_FAILED` onto a tier's own
`UNREACHABLE` / `NO_MEDIA_FOUND` when this proxy refused a certificate for the
same host inside the caller's window. Because one proxy serves every download
and nothing in a request identifies the caller
(`egress-proxy.ts`'s own header), the correlation is host-and-window, not
call-by-call — and a gate on dl-37 found that two concurrent probes of one host
can produce **different** outcomes the tier cannot tell apart (Chromium reports
the identical `net::ERR_TUNNEL_CONNECTION_FAILED` for a policy block, a dead
upstream, a leaf-issuance failure and a genuine certificate refusal — measured,
`egress-proxy.test.ts`'s `"a policy block, a leaf failure, a dead upstream and
two certificate refusals are one message"`).

dl-37 closed that by tracking **outcome kind**:
`TlsRejectionLog.recordOtherFailure` files every non-certificate refusal too,
and `since` refuses to reattach when both a certificate refusal and a
non-certificate one were recorded for a host in the same window. That closes
the case the gate measured completely.

**What it does not close, named in `tls-rejections.ts`'s own docblock rather
than discovered later:** a **success** is never recorded anywhere. Consider one
hostname load-balanced across two backends, one serving a broken certificate
and one healthy:

1. Job A connects, lands on the broken backend. The proxy refuses the
   `CONNECT`, `record()` files a genuine certificate rejection for the
   hostname.
2. Job B connects concurrently, lands on the healthy backend. TLS completes
   cleanly. The tier then does its own work and legitimately concludes
   `NO_MEDIA_FOUND` — no extractor for the page, nothing to do with
   certificates.
3. Job B's own `resolve()` throws `NO_MEDIA_FOUND`.
   `namingRefusedOrigins` asks `rejections.since(hostname, startedAt)`, finds
   Job A's genuine certificate rejection inside the window, finds **no**
   non-certificate outcome recorded for the same host (there is none — Job B's
   own connection never failed at the proxy at all), and reattaches
   `TLS_VERIFICATION_FAILED` onto a verdict that had nothing to do with TLS.

This is the same underlying gap dl-37's outcome-kind tracking already accepted
as a trade — a real refusal on one backend is not evidence about a different,
healthy backend's own outcome — surfacing through the tier's own success path
rather than through another proxy-side refusal. It is narrower than the
gap dl-37 closed: it needs a load-balanced or otherwise inconsistently-answering
origin, two concurrent probes landing on different backends, and the healthy
one's own extraction to legitimately fail on its own terms in the same window
a sibling connection was cert-refused.

## Build

One of, in order of how much of `tls-rejections.ts`'s surface each costs —
**pick one and record why in the Log**, this is the ticket's own decision to
settle, not answered here:

1. **Do nothing beyond documenting it** (what dl-37 already did). The
   `TlsRejectionLog` docblock already names this precisely; this ticket exists
   so the gap is tracked as a decision rather than rediscovered as a surprise.
   Closing it requires recording successes too, which dl-37's Log calls "a
   materially larger surface for a narrower edge case than the one this file
   already closes precisely" — this step asks whether that trade still holds
   once someone has looked at it with fresh eyes and, ideally, a production
   signal (has this ever actually been observed, or only reasoned about?).
2. **Record successes too.** A third map, `#successes: Map<string, number>`,
   touched wherever `establish()` (the tunnelling path) or `terminateTls`'s
   `onEstablished` fires. `since` would then require **zero** non-certificate
   outcomes of _either_ kind (failure or success) recorded for the host in the
   window before reattaching — which is materially closer to "suppress on any
   concurrent request", the alternative dl-37's Log names and rejects for
   over-suppressing the common good case (two genuine failures on one broken
   origin, probed twice). Whoever builds this has to show it does not
   regress that case — a test exists for it already
   (`tls-rejections.test.ts`'s `"two genuine certificate refusals on one host,
with no other outcome, both enrich"`) and must stay green.
3. **Narrow the reattachment instead of widening the tracking**: only reattach
   when the _tier's own error_ independently suggests a connection-layer
   problem (e.g. restrict to `UNREACHABLE` and drop `NO_MEDIA_FOUND` from
   `REATTACHABLE_CODES` in `resolvers.ts`), on the theory that `NO_MEDIA_FOUND`
   is disproportionately likely to be a legitimate "found nothing" rather than
   a masked connection failure. This is a **behaviour change dl-34 would care
   about**: dl-34's whole point was that yt-dlp's generic fallthrough
   (`NO_MEDIA_FOUND`) was hiding a genuine trust failure, so narrowing this
   reattachment away from yt-dlp specifically risks reopening exactly the
   sentence dl-34 exists to have deleted, for the tier dl-34 built first. Only
   worth it if the load-balanced-origin scenario turns out to be common enough
   in practice to outweigh that.

## Done when

- The chosen remedy (or the explicit decision to do nothing beyond the existing
  docblock) is recorded with its reasoning in the Log.
- If code changes: a test reproduces the load-balanced-origin scenario above
  (one backend cert-refused, one backend's own probe legitimately reaching
  `NO_MEDIA_FOUND` concurrently) red before the fix, green after.
- `tls-rejections.test.ts`'s existing suite, including
  `"two genuine certificate refusals on one host, with no other outcome, both
enrich"`, stays green — a fix here must not regress the case dl-37 built the
  outcome-kind split to protect.
- `npm run check` and `npm test -- --project downloader` pass.

## Log

- **2026-09-05** — Filed from dl-37's gate exchange. The reviewer
  (`a2250d43499fa92f1`) named the success/`NO_MEDIA_FOUND` variant of the
  load-balanced-origin residual while reviewing dl-37's shipped outcome-kind
  design; the builder agreed it is real and extended `tls-rejections.ts`'s own
  docblock with it before filing this. Id picked by the documented union of two
  lists: `git ls-tree origin/main tools/downloader/docs/work/` tops out at
  `dl-37`, and a tree-wide grep for `\bdl-[0-9]+\b` adds only the `dl-999`
  dangling-`depends_on` sentinel — not a reservation, per dl-36's and dl-37's
  own Logs recording the identical check. Filed alongside
  [dl-39](./dl-39-real-yt-dlp-tls-coverage-in-ci.md), which is unrelated but
  shares a filing moment.
