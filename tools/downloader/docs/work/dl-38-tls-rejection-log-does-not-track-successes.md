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

- **2026-09-05** — Built. **Option 2, chosen by the repo owner** after all three
  were put to them with their costs; not a formality, since option 1 (do
  nothing) is what dl-37 had already done by documenting the gap and was the
  cheap answer available. Recorded here as the ticket's Build section asks.

  **What shipped.** A third outcome, not a third failure kind.
  `TlsRejectionLog.recordSuccess` and a `#successes` map beside the other two,
  fed by a new `EgressProxyOptions.onConnectEstablished` hook that
  `egress-proxy.ts` fires at both points a `CONNECT` can succeed — the
  tunnelling `establish()` and `terminateTls`'s `onEstablished`, which is the
  route the ticket proposed and which the call sites bore out. `since` now
  declines when an outcome of **any** of the three kinds other than the
  certificate refusal itself landed in the caller's window. `server.ts` wires
  the hook into `tierRejections` beside the two that were already there.

  **Two things the brief left to the builder, decided here.**

  - **`terminateTls`'s `onEstablished` is the right moment, not the socket
    opening.** It runs only after the origin handshake verified _and_ a leaf was
    issued, so it means "this proxy accepted this host's certificate" rather
    than "a socket opened". The `onUnavailable` path — origin verified, leaf
    could not be issued — is the one place those two come apart, and it is a
    failure; `egress-proxy.test.ts`'s existing leaf test now asserts the success
    hook stays silent there.
  - **A successful plain-HTTP request is deliberately _not_ a success.** The
    ticket did not raise it and the naive reading of "record successes" would
    include it. It must not: the absolute-form handler never meets a
    certificate, so counting it would suppress reattachment for the ordinary
    `http://host/` → `https://host/` redirect that is then genuinely
    cert-refused — reopening the exact sentence dl-34 exists to have deleted.
    `onOtherConnectFailure` already leaves that handler alone for the same
    reason, so this is the existing shape rather than a new asymmetry.

  **Why this is not the "suppress on any concurrent request" rule dl-37
  rejected**, which is the whole risk the Build section names. That rule counts
  _requests_; this one counts outcomes that disagree. dl-37's common case — one
  broken private-root origin probed twice concurrently — records two
  certificate refusals and nothing else, so both still enrich.
  `"two genuine certificate refusals on one host, with no other outcome, both
enrich"` is that case and was run green, by name, with its output read
  (`tls-rejections.test.ts` 35/35).

  **Red before, green after, and one honest note about the first red.** Running
  the new tests with the whole change stashed gives 8 failures that all read
  `TypeError: log.recordSuccess is not a function` — a red that proves only that
  a method was absent. The red that proves the _defect_ was taken separately, by
  keeping the plumbing and deleting only the two lines in `since` that consult
  `#successes`: `resolvers.test.ts`'s
  `"a concurrent success on the same host blocks reattachment (dl-38)"` then
  fails with `expected AppError: TLS_VERIFICATION_FAILED to match object
{ code: 'NO_MEDIA_FOUND' }`, which is the ticket's scenario stated as an
  assertion. Both runs are in the gate record. The new `onConnectEstablished`
  proxy test was checked the same way — deleting the hook call in the terminate
  path fails it with `expected [] to deeply equal [ 'trusted.test' ]`.

  **Over-suppression guards, because a test that suppresses too much is still
  green if it only asserts "did not reattach".** Five of the eleven new
  assertions assert reattachment **still happens**: a success before the
  caller's window (without which every host that has ever worked would become
  permanently unenrichable — the feature silently off), a success on a different
  host, an evicted success entry, and the two `page.example` cases through
  `namingRefusedOrigins`.

  **What the brief had wrong, or rather did not know:** nothing material. The
  proposed mechanism survived contact with the code; the `establish()` /
  `onEstablished` call sites are where it said they were. Option 3 was not
  taken and `REATTACHABLE_CODES` in `resolvers.ts` is untouched, so dl-34's
  yt-dlp case is unaffected.

  **What is knowingly left open, in the safe direction.** A host is keyed
  without its port, so a healthy `:443` and a broken `:8443` on one hostname now
  read as one host with two outcomes and the genuine refusal on the second is
  suppressed rather than reattached. Keying by port would need `resolvers.ts` to
  pass one, and `URL.port` is empty for a default port where a `CONNECT`
  authority always carries one — so a fix for the rarer case risks never
  matching in the common one. Named in `tls-rejections.ts`'s header rather than
  left to be rediscovered. Not filed: it carries no reproduction and no
  decision, and it fails the way the whole file argues for — a suppressed
  enrichment is the pre-dl-37 experience, a wrong one would be new.

  **Not measured here:** no test drives two genuinely concurrent probes through
  a real load-balanced origin. The reproduction is at the two seams that own the
  decision (`TlsRejectionLog` and `namingRefusedOrigins`) plus the proxy hook
  that feeds them; a real load balancer alternating backends is not something
  this suite can build, and dl-37's own coverage of the sibling case has the
  same shape.

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
