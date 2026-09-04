---
id: dl-37
tool: downloader
title: Move Chromium and yt-dlp onto the terminating egress proxy
kind: work-package
status: ready
milestone: null
depends_on: []
difficulty: hard
---

# dl-37 — the resolver tiers get the operator's trust, by moving proxies

**Packages:** `api` (`server.ts`, `egress-proxy.ts`, `tls-interception.ts`),
`resolvers` (`browser/pool.ts`, `resolvers/ytdlp.ts`).

This is **half one of [dl-34](./dl-34-resolver-tiers-and-the-operator-ca.md)**,
filed separately when dl-34 closed on its built half. dl-34 has the full
reproduction and the operator-facing symptom; this ticket has the decision, its
cost, and what a builder must not repeat. Read dl-34's `## Why` first — it is
not copied here.

## Why

An operator whose origins chain to a private root sets `EGRESS_CA_FILE`. It
reaches this process's own fetches, ffmpeg, and the egress proxy that verifies
on ffmpeg's behalf. It does **not** reach Chromium or yt-dlp, which are handed a
_tunnelling_ proxy and verify against their own trust stores — stores nothing in
this repo writes to. So the two tiers that actually load the page fail on a
deployment the setting exists to serve.

Since dl-34 they at least **say so**: both tiers now raise
`TLS_VERIFICATION_FAILED` with a hint naming the setting, and boot warns which
components the CA file reaches. That is the whole of what naming can do. This
ticket is the part that makes it work.

## The decision, answered 2026-09-03 — not open

**Move both resolver tiers onto dl-27's terminating proxy.** dl-27 already built
a proxy that terminates TLS and mints leaves from a generated root, and ffmpeg
is on it; putting the tiers on it too gives them the operator's trust for free,
with no per-tier trust-anchor flag at all.

**Superseded, and do not build it: the per-tier anchor.** dl-34's Build step 1
described wiring each tier to the operator's root directly — `NODE_EXTRA_CA_CERTS`
for Chromium's Node-side fetches, `--ca-certificate` or `SSL_CERT_FILE` /
`REQUESTS_CA_BUNDLE` for yt-dlp's Python stack. Those are three different
mechanisms with three different failure modes, and the user chose the proxy move
instead. They are recorded here only so nobody rediscovers them and builds one.

### The cost that came with the answer

This is the part that must survive into the implementation, because the branch
that does this work has to **rewrite a decline that is still in the tree**:

- **Every HTTPS page Chromium loads would cross this process in plaintext.**
  [`downloader/api/src/server.ts:118-130`](../../api/src/server.ts) says so in
  the first person and refuses on exactly that ground: _"a `CONNECT` is
  tunnelled, the origin's own certificate reaches them, and nothing needs a
  trust-store change… Pointing the tiers at this one instead would break every
  HTTPS page Chromium loads, for no gain it does not already have."_ The last
  clause is what the decision overrules — there **is** a gain, and it is the
  private-root deployment. The rest of it is a live objection. **Meet it in that
  comment**, rather than deleting the comment and leaving the next reader to
  wonder what was traded.

- **The exposure is larger than dl-27's ffmpeg case on _breadth_, not on
  cookies.** This distinction cost two review rounds on dl-34 and the wrong
  version is the intuitive one, so it is written down: a captured session cookie
  **already** crosses this process in plaintext today, through ffmpeg's own
  terminating proxy, by default. `tools/downloader/CLAUDE.md:115` requires
  `RequestContext` replayed on every fetch unconditionally, segments included;
  [`engine/src/ffmpeg/args.ts:162`](../../engine/src/ffmpeg/args.ts) calls
  `buildRequestContextArgs` on every invocation with no gate; `Cookie` and
  `Authorization` are absent from that function's `DROPPED_HEADERS`
  ([`engine/src/ffmpeg/headers.ts:28-42`](../../engine/src/ffmpeg/headers.ts));
  and `ffmpegTlsIntercept` defaults to `true`
  ([`downloader/api/src/config.ts:377`](../../api/src/config.ts)). What is
  genuinely new is **breadth of resources**: a whole rendered page — its
  scripts, its subresources, whatever third-party origins it talks to — against
  a handful of manifest and segment URLs a `ProbeResult` names. Argue the move
  on that. **Do not write "and now cookies pass through this process", which is
  false.**

## Build

1. **Point the tiers at the terminating proxy instead of the tunnelling one.**
   `server.ts` builds both today (`tierProxy` and, when interception is on,
   `ffmpegProxy`); the tiers take `tierProxy.url` via `egressProxyUrl`. What
   this step must settle and record: whether the tiers share ffmpeg's proxy
   instance or get their own, and what happens when `FFMPEG_TLS_INTERCEPT=false`
   — there is no terminating proxy at all in that configuration, so the tiers
   need a defined answer rather than an undefined one.
2. **Give Chromium and yt-dlp the generated root.** They must trust the leaf the
   proxy mints, which is a different problem from trusting the operator's root
   and is the one thing the decision does not make free. **Show it working
   rather than assuming it**: dl-34 established that Chromium in this container
   has no reachable trust store to write to without `certutil`, which is not
   installed — so the mechanism here is unproven and finding it is part of the
   work, not a detail.
3. **Rewrite the decline** at `downloader/api/src/server.ts:118-130` so it states the new
   arrangement and the cost, per the section above.
4. **Update the documentation that this changes**: `.env.example` and
   `01-ARCHITECTURE.md` both currently say `EGRESS_CA_FILE` does **not** reach
   Chromium or yt-dlp, and dl-34's boot warning says the same thing at every
   start. All three become wrong the moment this lands.

## Done when

1. A resolver tier meeting an origin signed by an operator-supplied root
   **succeeds**, proven end to end against a locally-issued certificate — the
   `Done when 2` dl-34 could never prove, since it was never built there.
2. A tier meeting a certificate that genuinely does not verify still raises
   `TLS_VERIFICATION_FAILED`, so dl-34's half two is not regressed by this. Its
   tests exist and must stay green.
3. Chromium loading an ordinary **public** HTTPS page still works with the
   generated root in place — the merge, not the replacement. dl-31 hit the same
   trap on the undici side and its answer was `[...tls.rootCertificates,
operatorCa]`; the failure mode is that an operator root handed over on its
   own fails every public origin.
4. The boot line, `.env.example` and `01-ARCHITECTURE.md` say what is true after
   this change, not before it.
5. `npm run check` and `npm test -- --project downloader` pass.

## Log

- **2026-09-04** — Filed on dl-34's branch as it closed, carrying dl-34's
  answered decision rather than re-opening it. dl-34 could not stay `ready` to
  hold this work: `status: ready` plus a `## Review` gate record is a state
  `scripts/status.mjs` rejects with a non-zero exit, and PR #142 went red on it.
  So the unbuilt half becomes its own ticket, which is also the honest shape —
  it has a decision and a cost of its own.

  **Id picked by the documented union of two lists**, not by incrementing.
  `git ls-tree origin/main tools/downloader/docs/work/` tops out at `dl-36`, and
  a tree-wide grep for `\bdl-[0-9]+\b` adds only `dl-999`, which is
  `scripts/status.mjs`'s dangling-`depends_on` sentinel in dl-25 and dl-36 and
  not a reservation — dl-36's own Log records the same check and the same
  conclusion. Highest of both is 36, so this is 37.

  **The `server.ts` citation here is `118-130`, and dl-34's `96-104` was already
  wrong at `origin/main`.** Verified with `git show origin/main:…` rather than
  against this branch, so it is not something dl-34's own changes moved: line 96
  is the dispatcher construction and the tunnel-versus-terminate comment runs
  118 to 130. `scripts/citations.mjs` passes the old form — a citation whose
  content moved still resolves, which the tool says of itself. Worth the line
  because this is the single citation a builder of this ticket must follow.

  **Not decided here, deliberately:** whether the tiers share ffmpeg's proxy
  instance or get their own, and what `FFMPEG_TLS_INTERCEPT=false` means for
  them. Both are Build step 1's to settle with the code in front of it; naming
  them as open is not the same as leaving the ticket's own decision open, which
  is answered above.
