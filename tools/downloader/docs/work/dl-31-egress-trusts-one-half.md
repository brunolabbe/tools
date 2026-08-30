---
id: dl-31
tool: downloader
title: The operator's CA reaches ffmpeg and the proxy, but never the dispatcher
kind: fix
status: ready
milestone: null
depends_on: [dl-27]
---

# dl-31 — half the egress trusts the operator's root and half does not

**Packages:** `api` (`dispatcher.ts`, `server.ts`, `config.ts`, `api/test`).

## Why

An operator whose origins chain to a private root — a corporate TLS-inspecting
middlebox, an internal CDN — sets `FFMPEG_CA_FILE`. On `origin/main` today that
value reaches exactly one consumer:

- [`server.ts:142`](../../api/src/server.ts) → the engine's `tlsCaFile`, which
  becomes ffmpeg's `-ca_file`.

And it reaches the undici dispatcher **nowhere**.
[`dispatcher.ts:94`](../../api/src/dispatcher.ts) has the option and says what it
is for — `requestTls?: { ca: string }`, documented _"Injected for the same reason
`resolve` is… Unset in production, where the system trust store is the right
answer."_ [`server.ts:75-78`](../../api/src/server.ts) builds the dispatcher with
`guard` and `proxyUrl` and nothing else, so the only code that ever passes
`requestTls` is `api/test/proxied-https.test.ts:579`.

So on such a deployment the tool **half works, and the halves are the confusing
way round**: an ffmpeg download succeeds while the probe that set it up fails on
trust. The comment is not wrong about the intent — the system store _is_ the
right default — it is that `FFMPEG_CA_FILE` is the operator saying "and also
this one", and only one client hears it.

**This is pre-existing and nothing has to have changed for it to bite**: the
direct resolver has always fetched manifests through `GuardedFetch`.
[dl-30](./dl-30-measure-a-rendition.md) widens the blast radius rather than
creating it — its size probes now reach _segment_ origins through the same
fetch, so a deployment where only the segment CDN chains to the private root can
newly hit it.

**What [dl-27](./dl-27-verify-segment-origins.md) changes about this, and why
this ticket waits for it.** dl-27 gives `FFMPEG_CA_FILE` a _second_ consumer —
the terminating egress proxy reads it as `caFile` and merges it for origin
verification. Two consequences, and both are the reason `depends_on` names it:

1. **It already solves the trap this fix would otherwise walk into**, and says so
   in a comment worth reading before writing any of this: passing `ca` at all
   **replaces** Node's system store exactly as `-ca_file` does in ffmpeg, so an
   operator root handed over on its own fails every public origin. Its answer is
   `[...tls.rootCertificates, operatorCa]`. Building this before dl-27 lands
   means a second CA-merge in a second place, diverging from the first.
2. **It makes the name wrong rather than merely narrow.** Once `FFMPEG_CA_FILE`
   configures a proxy that is not ffmpeg, it is already the operator's egress
   root under a name that says otherwise. That turns "should the dispatcher read
   it too?" into a naming decision rather than a one-line wiring change, and
   Build 1 is where that gets settled.

## Build

1. **Settle the name first, because it decides the rest.** Two options, and this
   ticket should not be started until one is chosen:
   - **Keep `FFMPEG_CA_FILE` and add the third consumer.** One line in
     `server.ts`, no migration, no documentation churn. The cost is a variable
     named for ffmpeg that configures ffmpeg, a proxy and undici — a name that
     will mislead every operator who reads it after this.
   - **Introduce `EGRESS_CA_FILE`, with `FFMPEG_CA_FILE` as a deprecated alias
     that still works and warns at boot.** Names the thing it now is. Costs a
     config entry, a fallback, a boot warning, and a line in the README. This is
     the recommended one _if_ dl-27 has landed, because dl-27 is what makes the
     old name actively wrong.

2. **Widen `requestTls` to carry the merge.** It is typed `{ ca: string }`
   ([`dispatcher.ts:94`](../../api/src/dispatcher.ts)) and the merged form is an
   array, so this becomes `{ ca: string | string[] }`. Check the undici version
   pinned here accepts an array on `connect.ca` before relying on it — Node's
   `tls.connect` does, and undici forwards, but confirm rather than assume.

3. **Read the file once, at boot, and share it.** `server.ts` already reads it
   for dl-27's proxy; a second `readFile` of the same path in the same function
   is the kind of duplication that later drifts into two different error
   behaviours. Decide there whether an unreadable `FFMPEG_CA_FILE` is fatal —
   today it is silently ignored by the dispatcher because nothing reads it, and
   whatever dl-27 does with an unreadable one is the precedent to match.

4. **Do not reach for the alternatives.** `NODE_TLS_REJECT_UNAUTHORIZED=0` and
   an agent with `rejectUnauthorized: false` both turn off the check this ticket
   exists to make work, repo-wide and invisibly. If the fix seems to need
   either, it is the wrong fix.

## Done when

1. With `FFMPEG_CA_FILE` (or its successor) set to a fixture root, a
   `GuardedFetch` request to an origin signed by that root **succeeds**, proven
   by a test — the failure it replaces should be demonstrated first, so the test
   is known to be able to fail.
2. With the same variable set, a request to an origin signed by a _public_ root
   still succeeds — the merge, not the replacement. This is the regression the
   trap in the Why produces, and it is the one a fix will actually cause.
3. With the variable unset, the dispatcher passes no `requestTls` at all and
   behaviour is byte-for-byte what it is today, proven by a test.
4. Whichever name Build 1 chose is what the README and `.env.example` document,
   and if an alias was kept, a boot warning names it.
5. `npm run check` and `npm test -- --project downloader` pass.

## Log

- **2026-08-30** — Filed from dl-30, and the provenance matters because none of
  it is mine. **The asymmetry was found by dl-27's builder**, in the course of
  answering an unrelated question dl-30 had asked about egress; it reached me
  through that session's orchestrator (`tools-6c`), **explicitly relayed as
  unverified** — that session had not confirmed it either.

  **What I then verified myself, against `origin/main` at `6b6c785`**, rather
  than against the relay: `requestTls` exists at `dispatcher.ts:94` and is
  documented "Unset in production"; `server.ts:75-78` constructs the dispatcher
  without it; `server.ts:142` routes `ffmpegCaFile` to the engine alone; and the
  only `requestTls` caller in the tree is `api/test/proxied-https.test.ts:579`.
  So the mechanism is confirmed by reading.

  **What is still unverified, and should be the first thing done here.** No
  deployment with a private root was exercised — the dev container has no
  network — so the _symptom_ (a probe failing on trust while an ffmpeg download
  succeeds) is inferred from the wiring and has not been observed. Nothing in
  the suite fails today because of it, which is why Done-when 1 asks for the
  failure to be demonstrated before the fix.

  One correction to how this was nearly filed: the first pass at verifying it
  read `tools/downloader/api/src/*.ts` from the shared checkout, which was
  sitting detached on dl-27's tree — so it was reading dl-27's changes and
  believing them to be `main`. The lines above happen to be identical in both,
  so the conclusion survived, but the method did not, and the numbers here are
  re-read from `origin/main` with `git show`. Worth knowing in a repo where
  several sessions share one checkout: `git show origin/main:<path>` is the
  cheap way to be sure what you are reading.
