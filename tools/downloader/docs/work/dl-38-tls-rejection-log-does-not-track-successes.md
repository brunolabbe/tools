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

- **2026-09-05** — Port-keying follow-up, after the gate passed and the owner
  read the residual the entry above disclosed. **The owner chose to fix it here
  rather than file it or leave it recorded**, against the builder's own
  recommendation. Recorded as a decision that went the other way, because the
  reasoning that lost is the part a future reader needs.

  **The objection that was on the record, and that the gate independently
  confirmed:** `key()` never touches port, `parseAuthority` strips the port
  before every callback fires, and `resolvers.ts` queries with `url.hostname`,
  which never carries a port in the WHATWG model — so the port genuinely is not
  available at the query site, and `URL.port` is the empty string for a default
  port where a `CONNECT` authority always carries an explicit one. Keying
  everything by `host:port` would have fixed `:443`-good/`:8443`-bad by
  **losing** the page-on-`:443`/media-refused-on-`:8443` reattachment, which is
  dl-34's own sentence. That objection was right about uniform keying and wrong
  to conclude the fix was unaffordable.

  **What the objection missed, and what shipped instead.** The three maps do not
  answer the same question, so they should not share a key. The conflict maps
  ask _could this outcome have been the caller's own connection?_ — and a
  connection to `:443` that worked cannot have been the connection to `:8443`
  that was refused. The certificate map asks _is this host's trust broken?_,
  which is worth carrying across ports. So:

  - `#otherFailures` and `#successes` are keyed by `host|port`;
    `recordOtherFailure` and `recordSuccess` take a port, and
    `EgressProxyOptions.onOtherConnectFailure` / `onConnectEstablished` carry
    one to all seven call sites.
  - `#certificates` keeps its host-only key and `record` keeps its signature.
  - `since(host, port, at)` scopes only the two conflict lookups by port.
  - A new exported `portFor(url)` does the derivation `resolvers.ts` needs, so
    the two sides agree on an ordinary `https://host/`.

  **The property that makes this safe to land after a PASS, stated rather than
  implied:** narrowing a conflict's key can only shrink the set of recorded
  outcomes that count against a reattachment, never grow it. So `since`
  reattaches **at least as often as it did before any conflict tracking
  existed** — no verdict dl-34 or dl-37 delivers today stops being delivered,
  and every behaviour change is a spurious suppression removed.
  `"a certificate refusal is still carried across ports"` is that property as a
  test.

  **Red before, green after, mutated at the decision rather than at the API.**
  Replacing `endpoint(host, port)` with `key(host)` — every signature intact, so
  the failures are behavioural and not `TypeError`s — fails 3 of the 5 new
  port tests: the two that encode the owner's requirement, each with
  `expected undefined to be 'DEPTH_ZERO_SELF_SIGNED_CERT'`, plus the eviction
  one. The other two pass in both states **on purpose** — they are the guards
  that must hold either way (dl-38's own suppression for the caller that asked
  about `:443`, and the certificate carried across ports). Restored: 81/81
  across the three files.

  One test was rewritten mid-flight for being unfalsifiable:
  `"the two ports are two entries"` originally used `max: 2` and asserted both
  callers suppressed, which is true under host-keying too. It now uses `max: 1`
  and asserts the `:443` caller gets its reattachment **back** after the `:8443`
  entry evicts it — which host-keying cannot produce. Caught by running the
  mutation, not by reading it.

  **Why the two Log claims the gate corrected travelled uncounted when the rest
  of this branch did not**, since it is the transferable part: every claim I
  measured deliberately, I measured with a command whose whole output was the
  answer — a named test read off `--reporter=verbose`, a mutation run to a
  single assertion. The two wrong claims were the two I wrote from **memory of a
  command's tail** rather than from its tally: the failure count came from a
  two-file run I later described as if it had been the three-file one, and the
  "all read TypeError" shape came from the last screenful of a scrolling log.
  Neither was a claim I set out to verify, which is exactly why neither got
  verified. The rule that would have caught both: **a number in a report is a
  claim and needs its own command**, and `| tail` is not that command.

  **Still not measured:** no test drives two genuinely concurrent probes through
  a real load-balanced origin, and none drives one hostname answering on two
  real ports end to end through a tier. Both port cases are proven at
  `TlsRejectionLog` and at the proxy hooks that feed it, not through a live
  browser.

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
  the new tests against base `4a4cc4f`'s source, with the tip's tests kept,
  gives **10 failures in three shapes** — 6 `TypeError: log.recordSuccess is not
a function` in `tls-rejections.test.ts`, 2 in `resolvers.test.ts` surfacing as
  `AppError { code: 'INTERNAL' }` because the wrapper catches and wraps the same
  TypeError, and 2 plain assertion mismatches in `egress-proxy.test.ts`
  (`expected [] to deeply equal [ 'trusted.test:<port>' ]`) with no TypeError at
  all, base `egress-proxy.ts` predating the option entirely. Whatever the
  shapes, it is still a red that proves only that a surface was absent. **This
  entry first said "8 failures that all read `TypeError`", which was wrong twice
  over** — that count came from a two-file run that never included
  `egress-proxy.test.ts`, and the shape came from reading the tail of a
  scrolling log instead of tallying it. The gate caught both and the numbers
  above are a re-run of its exact command. The red that proves the _defect_ was
  taken separately, by
  keeping the plumbing and deleting only the two lines in `since` that consult
  `#successes`: `resolvers.test.ts`'s
  `"a concurrent success on the same host blocks reattachment (dl-38)"` then
  fails with `expected AppError: TLS_VERIFICATION_FAILED to match object
{ code: 'NO_MEDIA_FOUND' }`, which is the ticket's scenario stated as an
  assertion. Both runs are in the gate record. The new `onConnectEstablished`
  proxy test was checked the same way — deleting the hook call in the terminate
  path fails it with `expected [] to deeply equal [ 'trusted.test' ]`.

  **Over-suppression guards, because a test that suppresses too much is still
  green if it only asserts "did not reattach".** **Four** of the new tests
  assert reattachment **still happens**: three directly against
  `TlsRejectionLog` — a success before the caller's window (without which every
  host that has ever worked would become permanently unenrichable, the feature
  silently off), a success on a different host, and an evicted success entry —
  and one through `namingRefusedOrigins`,
  `"a success on another host leaves the reattachment alone (dl-38)"`. **This
  entry first said five, "the two `page.example` cases through
  `namingRefusedOrigins`"**; only one of the two `page.example` tests goes
  through that wrapper, the other exercises `TlsRejectionLog` directly, so the
  count was one too high and one of the two was filed under the wrong layer.
  The gate caught it; `grep -n "page.example" tools/downloader/api/test/*.test.ts`
  returns exactly two lines and settles it.

  **What the brief had wrong, or rather did not know:** nothing material. The
  proposed mechanism survived contact with the code; the `establish()` /
  `onEstablished` call sites are where it said they were. Option 3 was not
  taken and `REATTACHABLE_CODES` in `resolvers.ts` is untouched, so dl-34's
  yt-dlp case is unaffected.

  **What this first shipped knowingly leaving open, in the safe direction.** A
  host was keyed without its port, so a healthy `:443` and a broken `:8443` on
  one hostname read as one host with two outcomes and the genuine refusal on the
  second was suppressed rather than reattached. It was disclosed here and in
  `tls-rejections.ts`'s header with a recommendation to leave it documented.
  **The owner chose to fix it on this branch instead — see the entry below.**

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
