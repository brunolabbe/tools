---
id: dl-60
tool: downloader
title: The SSRF guard allows an IPv6 literal that embeds a private IPv4 address
kind: fix
status: done
milestone: M5
depends_on: []
---

# dl-60 — An IPv6 literal that embeds an IPv4 address is judged by that address

**Packages:** `api` (`ssrf.ts`, `dispatcher.ts`, `egress-proxy.ts`, and a new
spec).

## Why

The guard refused `http://127.0.0.1/` and allowed `http://[::ffff:127.0.0.1]/`,
which is the same socket. It also allowed `http://[::ffff:169.254.169.254]/`,
the cloud metadata address, and `http://[::127.0.0.1]/`.

**Reproduced on 2026-09-15** against `origin/main` `95c6403`'s build:

- `isBlockedAddress("::ffff:7f00:1")`, `("::ffff:a9fe:a9fe")`,
  `("::ffff:a00:1")`, `("::7f00:1")` and `("::ffff:0:7f00:1")` all returned
  `false`. The dotted spellings `::ffff:127.0.0.1` and `::127.0.0.1` returned
  `true`.
- WHATWG `URL` rewrites an embedded IPv4 address as hex groups:
  `new URL("http://[::ffff:127.0.0.1]/").hostname` is `[::ffff:7f00:1]`. So a
  URL can only ever reach the guard in the spelling it did not recognise, and
  `createSsrfGuard().assertAllowed` allowed all three URLs above.
- **It was reachable.** Through `createEgressDispatcher({ guard })` in `pinned`
  mode, the production default, a server bound only to `127.0.0.1` answered
  `http://[::ffff:127.0.0.1]:<port>/` with 200. The same held for a redirect
  hop to that URL, for a CONNECT tunnel through the egress proxy, and for a
  queued job, which ran to `completed`.

**Root cause.** The only embedded-IPv4 rule was a textual one, matching a dotted
tail, at `api/src/ssrf.ts@95c6403:137` "const mapped =". The hex spelling fell
through to the native IPv6 rules, which saw a first group of `0` and allowed it.

**Nothing behind it caught this.** The pinning connector at
`api/src/dispatcher.ts@95c6403:143` "export function createPinningLookup" is a
`lookup`, and `net.connect` skips `lookup` for an IP literal. Measured: a
`lookup` that throws was called 0 times for `::ffff:127.0.0.1`, and the socket
connected. The egress proxy passed the same `lookup` to `net.connect`, so it
had the same gap. For a literal, the only defence was the check at
`api/src/ssrf.ts@95c6403:244` "if (isBlockedAddress(literal))".

## Build

1. Reproduce first, red on `origin/main`: a unit case on `isBlockedAddress` and
   `assertAllowed`, and one end-to-end case through the real pinned dispatcher to
   a loopback-only server. Commit the spec first.
2. Classify by the parsed address, not its spelling. Judge every IPv6 form that
   embeds an IPv4 address by the IPv4 rules: mapped `::ffff:0:0/96`, compatible
   `::/96`, SIIT `::ffff:0:0:0/96` and well-known NAT64 `64:ff9b::/96`, in every
   spelling. Public embedded addresses stay allowed.
3. Refuse Teredo `2001::/32`, 6to4 `2002::/16` and local-use NAT64
   `64:ff9b:1::/48` whatever they embed (decision 2 below).
4. Check IP literals at connect time too, in the pinned dispatcher and at the
   egress proxy's connects, with a `BLOCKED_TARGET` whose `details.reason`
   differs from the lookup path's (decision 1 below).
5. Show every entry point refuses a mapped-loopback URL: `POST /api/probe`, job
   creation, the orchestrator, a redirect hop, the egress proxy's CONNECT path,
   and thumbnails.

## Done when

- The spec fails on `origin/main` and passes on the branch, and the Log records
  both runs.
- Every spelling in step 2 is covered, including public controls.
- The three ranges in step 3 are refused with a public payload, and their
  neighbouring ranges are not.
- Each layer refuses on its own: with the pre-flight check removed the
  connect-time check still refuses, and the reverse. The Log records the
  per-connection cost.
- Every `assertAllowed` and `assertAllAllowed` call site has a test that turns
  red when that call is removed.
- `npm run check` and `npm test -- --project downloader` are green.

## Decisions

Both answered by the owner on 2026-09-15, through the dispatching session.

1. **Should the pinned dispatcher also check IP literals at connect time?**
   Options: file a follow-up ticket; build it in dl-60; keep the pre-flight
   check as the only defence for literals. The builder and the dispatching
   session both recommended a follow-up ticket. **The owner chose to build it in
   dl-60, overriding that recommendation.** The accepted cost is about 15 lines
   in `dispatcher.ts` and 30 in `egress-proxy.ts`, plus the per-connection cost
   measured in the Log.
2. **Teredo, 6to4 and local-use NAT64: judge them by their embedded address, or
   block them outright?** The builder recommended judging them by the embedded
   address. **The owner chose to block all three ranges, overriding that
   recommendation.** The accepted cost is that a public site served only over
   Teredo or 6to4 is refused. Well-known NAT64 `64:ff9b::/96` was not part of
   the question and is still judged by its embedded address.

## Review

### Gate 1 — `f43135f`

**Gate: CONCERNS** — 2026-09-15 · `95c6403...f43135f` · defect hunt run directly (ticket-reviewer subagent, no `code-review` delegate)

| Done when                                                                               | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The spec fails on `origin/main` and passes on the branch, and the Log records both runs | verified — reran `embedded-ipv4.test.ts` at `95c6403`: 14 failed / 5 passed of 19 (matches Log); at `f43135f`: 19 passed of 19.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Every spelling in step 2 is covered, including public controls                          | proven — `embedded-ipv4.test.ts:146 "IPv4-mapped (::ffff:0:0/96)"`, `embedded-ipv4.test.ts:182 "SIIT IPv4-translated"`, `embedded-ipv4.test.ts@f43135f:133 "NAT64 (64:ff9b::/96 and 64:ff9b:1::/48)"`, `embedded-ipv4.test.ts:236 "a public embedded address stays allowed"` ✓, plus verified independently — see the report above.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| A test through each entry point in step 3 refuses the mapped-loopback URL               | proven for `probe.ts:48` "const url = await context.guard.assertAllowed(rawUrl);", `probe.ts:134` "await context.guard.assertAllAllowed(urlsInProbeResult(probe).mustPass);", `jobs.ts:53` "await context.guard.assertAllowed(parsed.data.url);", `guarded-fetch.ts:152` "await guard.assertAllowed(currentUrl);", `egress-proxy.ts:472` "await guard.assertAllowed(target);", `egress-proxy.ts:554` "await guard.assertAllowed(`https://${target}`);", `thumbnails.ts:249` "await guard.assertAllowed(url);", `jobs/orchestrator.ts:347` "const url = await guard.assertAllowed(sourceUrl);" — each isolated by deletion. **`jobs/orchestrator.ts:220` "await guard.assertAllAllowed(urlsInProbeResult(probe).mustPass);" is not exercised by any test** — see med finding. |
| Reverting each part of the fix turns a named test red                                   | verified for the 8 entry-point deletions above plus 2 core mutations (ignoring `embeddedV4`'s result, dropping the Teredo inversion); the remaining ~11 branch-removal mutations the Log claims were not individually re-run.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `npm run check` and `npm test -- --project downloader` are green                        | verified — `npm run check` exit 0; `npm test -- --project downloader` → 76 files, 1284 tests, all passed, matching the Log.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

- **med** · `jobs/orchestrator.ts:220` "await guard.assertAllAllowed(urlsInProbeResult(probe).mustPass);" — a live SSRF check on the resolver's own output, dl-60's stated second attack surface — has no test anywhere in the repo. Commenting it out and running `npm test -- --project downloader` still passes all 76 files / 1284 tests, 0 failures. The Log's claim "Each call site has its own test in the spec, and each test was proven by deleting that call site" is false for this file: it has two call sites, `:220` "await guard.assertAllAllowed(urlsInProbeResult(probe).mustPass);" and `jobs/orchestrator.ts:347` "const url = await guard.assertAllowed(sourceUrl);" (the `sourceUrl` re-check, which _is_ tested by `embedded-ipv4.test.ts:461 "the orchestrator's re-check, for a row that never went through the route"`), and only one is covered. Not a live hole — a probe (benign `sourceUrl`, a `StubResolver` whose variant is the mapped-loopback literal, run through `context.orchestrator.run`) shows the guard refuses it correctly (`status: "failed"`, `error.code: "BLOCKED_TARGET"`, resolver called once, engine never called), because the call delegates to the same fixed, exhaustively-verified `isBlockedAddress`. The defect is in the ticket's own audit trail overstating its coverage, not in the guard.
- **findings** · 1 returned, 1 carried, 0 dropped.
- NFR: security — see above; the judging function itself is exhaustively re-verified (299 generated spellings, 0 mismatches, both directions, both commits). performance n/a — a handful of integer comparisons per check. reliability n/a — no change to timeouts or retries. maintainability ✓ — `embeddedV4` is one small function, each branch commented with its RFC citation.

**Disposition.** Fixed in `faebe96`. The test "the orchestrator's check on the
re-probe's own output" covers the orchestrator's `assertAllAllowed` call. The
builder reproduced the gap first: with that call a no-op and the spec excluded,
75 files and 1265 tests passed.

**Transcription note (builder).** Transcribed from the gate's message on
`f43135f`. What was altered: every line number was re-resolved against the tip.
The spec citations moved from lines 86, 122, 157 and 319 to 146, 182, 236 and
461, and the CONNECT call in the egress proxy from line 537 to 554. The NAT64
test was renamed in round 2, so its citation is pinned to `f43135f`. Citations
that had no anchor now carry the text of the line they cite. Bare file names
and one shorthand became qualified paths, so the citation gate can check them.
No finding, verdict or figure was changed.

## Log

- 2026-09-15 — Filed and fixed in one branch, `dl-60-guard-embedded-ipv4`, off
  `origin/main` `95c6403`.

  **Round 1.** The spec, `api/test/embedded-ipv4.test.ts`, was committed alone
  first. On `origin/main`'s source it ran **14 failed, 5 passed of 19**. The 5
  that passed were the controls. Every failure was an assertion about the
  defect, not a setup error. For example, the redirect test fetched `/secret`
  over the pinned dispatcher, and the CONNECT test got a 200 tunnel. The round-1
  fix passed 19 of 19.

  **Round 2**, after the owner answered both decisions and the gate returned one
  finding, grew the spec to 28 tests. Run against `origin/main`'s `ssrf.ts`,
  `dispatcher.ts` and `egress-proxy.ts`, it gave **22 failed, 6 passed of 28**.
  - **The 22 failures.** One is a `TypeError`: "blockedLiteral refuses a
    blocked literal and nothing else" calls a function that does not exist
    there. The file still loads, because Vitest leaves a missing named export
    `undefined`. Twenty are assertions that the old guard allowed something it
    must refuse. The last is "well-known NAT64 (64:ff9b::/96) is judged by what
    it embeds": the old parser read `64:ff9b::8.8.8.8` as unparsable and
    wrongly blocked it.
  - **The 6 passes are all controls:** "`URL` canonicalises an embedded IPv4
    address into hex groups", "a zone id cannot reach the guard through a URL
    at all", "allows an IPv6 literal embedding a public IPv4 address", "the
    neighbours of those ranges are not caught by them", "the native IPv6 rules
    are unchanged", and "a public embedded address stays allowed".

  With the fix, all 28 pass. An earlier draft of this entry said the file would
  not load, and that the round-1 run stood in for this one. That was a guess,
  not a measurement, and the gate disproved it by running the spec.

  **The address rule.** `v6Groups` parses every spelling to eight numbers. It
  rewrites a dotted tail as two hex groups, strips a zone id, folds case, and
  refuses anything malformed, which blocks it. Then:
  - Teredo `2001::/32`, 6to4 `2002::/16` and local-use NAT64 `64:ff9b:1::/48`
    are refused outright.
  - Mapped, SIIT and compatible addresses, and the rest of `64:ff9b::/32`, are
    judged by their low 32 bits as IPv4. That is how NAT64 was read before this
    ticket. `::` and `::1` come out as 0.0.0.x, so they stay blocked.
  - Everything else falls to the native IPv6 rules, which are unchanged.

  **The connect-time check.** `blockedLiteral` in `dispatcher.ts` returns a
  `BLOCKED_TARGET` with reason `blocked-literal-at-connect` for a blocked IP
  literal the guard does not exempt, and null for anything else. A name stays
  with `createPinningLookup`, whose reason is
  `resolved-to-blocked-address-at-connect`. `createPinningConnector` wraps
  undici's `buildConnector` with it, so the `Agent` keeps its defaults. The
  egress proxy calls it before its CONNECT `net.connect` and before its
  absolute-form `http.request`, which reaches `net.connect` the same way. In
  chained mode the upstream connects, so neither check applies there.

  **Its cost, measured on this machine.** The check alone takes 49 ns for an
  exempt literal, 132 ns for a name, 1.9 µs for a public IPv6 literal, and
  8.1 µs for a refusal, most of which is building the `AppError`. End to end,
  with a new connection per request through a pinning `lookup`, the wrapped and
  plain connectors could not be told apart: 682/547, 508/491 and 462/461 µs
  across three alternating rounds.

  **Every call site and the test that covers it.** Each row was proven by
  replacing that call with a no-op, which turned exactly the named test red:
  - `routes/probe.ts`, `assertAllowed` on the page URL: "POST /api/probe".
  - `routes/probe.ts`, `assertAllAllowed` on the probe's media: "POST
    /api/probe, when the resolver's media URL is the mapped literal".
  - `routes/jobs.ts`, `assertAllowed`: "POST /api/jobs".
  - `jobs/orchestrator.ts`, `assertAllowed` on the source URL: "the
    orchestrator's re-check, for a row that never went through the route".
  - `jobs/orchestrator.ts`, `assertAllAllowed` on the re-probe's output: "the
    orchestrator's check on the re-probe's own output". The gate found this call
    site had no test anywhere: with it a no-op, the whole downloader suite
    passed. Round 1's Log wrongly claimed a test for every call site.
  - `guarded-fetch.ts`, the per-hop check: "a redirect hop in guarded-fetch,
    with no dispatcher behind it".
  - `egress-proxy.ts`, the CONNECT and absolute-form `assertAllowed` calls,
    each removed separately: "the egress proxy's pre-flight check, chained,
    where there is no connect-time check".
  - `thumbnails.ts`, `assertAllowed`: "thumbnails".
  - `dispatcher.ts`, the connector's literal check: "the bare pinned dispatcher
    refuses the literal, with no pre-flight check at all".
  - `egress-proxy.ts`, the CONNECT and absolute-form literal checks, each
    removed separately: "the egress proxy refuses the literal at connect when
    its pre-flight check was fooled".

  `createPinningLookup`'s own `isBlockedAddress` call never sees a literal, so
  this spec does not cover it. The gate measured it: deleting that call turns 6
  tests red in `dispatcher.test.ts`. `index.ts` only re-exports.

  **The two layers are independent**, measured by mutation. Removing the
  pre-flight literal check turns 10 tests red. The three tests named "both
  layers" stay green: the guarded fetch through the pinned dispatcher, the
  redirect hop through it, and the egress proxy's CONNECT and absolute-form
  paths. Removing every connect-time check turns only the 2 tests that bypass
  the pre-flight check red, and the three stay green. Removing both turns all
  three red, 15 tests in total.

  **Mutations, 30 of 30 red**, each applied alone and restored. Besides the call
  sites and layers above:
  - Removing any of the mapped, SIIT, compatible or NAT64 branches turns its
    range's test red.
  - Not refusing Teredo, 6to4 or local-use NAT64 turns the transition-range
    tests red. So does skipping the transition check altogether.
  - Widening Teredo to `2001::/16`, or the local-use rule to all of
    `64:ff9b::/32`, turns "the neighbours of those ranges are not caught by
    them" red.
  - Dropping the dotted-tail rewrite, the zone strip or the case fold turns a
    public control red. Each of those fails closed, so only the public controls
    can catch them.
  - Ignoring the exemption in `blockedLiteral` turns 4 tests red.

  **Reachability in this sandbox**, connecting to a server on `127.0.0.1`: the
  mapped form connected. Compatible, SIIT, NAT64, 6to4 and Teredo each returned
  `ENETUNREACH`. The production host was not measured.

  **What the brief understated.** SIIT hex (`::ffff:0:7f00:1`), 6to4
  (`2002:7f00:1::`) and Teredo were also allowed on `origin/main`. NAT64 was
  already judged by its embedded address. A zone id cannot reach the guard
  through a URL, because `URL` rejects it.

  **Fold-in.** `dl-60` is added to
  [dl-49](./dl-49-open-without-a-login.md)'s `depends_on`. Opening the tool
  without a login must not land before this does. `repo-1`'s two `ssrf.ts`
  citations, and `repo-13`'s six into `egress-proxy.ts` and `dispatcher.ts`, are
  pinned to `95c6403`, because this change moves those lines.
