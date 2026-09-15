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

**Packages:** `api` (`ssrf.ts`, and a new spec).

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
`api/src/dispatcher.ts:143` "export function createPinningLookup" is a `lookup`,
and `net.connect` skips `lookup` for an IP literal. Measured: a `lookup` that
throws was called 0 times for `::ffff:127.0.0.1`, and the socket connected.
The egress proxy passes the same `lookup` to `net.connect`, so it has the same
gap. For a literal, the only defence is the check at
`api/src/ssrf.ts:285` "if (isBlockedAddress(literal))".

## Build

1. Reproduce first, red on `origin/main`: a unit case on `isBlockedAddress` and
   `assertAllowed`, and one end-to-end case through the real pinned dispatcher to
   a loopback-only server. Commit the spec first.
2. Classify by the parsed address, not its spelling. Judge every IPv6 form that
   embeds an IPv4 address by the IPv4 rules: mapped `::ffff:0:0/96`, compatible
   `::/96` and SIIT `::ffff:0:0:0/96`, in every spelling. For NAT64, 6to4 and
   Teredo, apply the embedded rule or raise an open decision. Public embedded
   addresses stay allowed.
3. Show every entry point refuses a mapped-loopback URL: `POST /api/probe`, job
   creation, a redirect hop, the egress proxy's CONNECT path, and thumbnails.
4. Measure, but do not build, a connect-time literal check in the dispatcher.

## Done when

- The spec fails on `origin/main` and passes on the branch, and the Log records
  both runs.
- Every spelling in step 2 is covered, including public controls.
- A test through each entry point in step 3 refuses the mapped-loopback URL.
- Reverting each part of the fix turns a named test red.
- `npm run check` and `npm test -- --project downloader` are green.

## Log

- 2026-09-15 — Filed and fixed in one branch, `dl-60-guard-embedded-ipv4`, off
  `origin/main` `95c6403`.

  **The spec** is `api/test/embedded-ipv4.test.ts`, committed alone first. On
  `origin/main`'s source it ran **14 failed, 5 passed of 19**. The 5 that passed
  are the controls: public embedded addresses allowed, the native IPv6 rules,
  `URL`'s canonical form, and a zone id rejected as `INVALID_URL`. Every failure
  was an assertion about the defect, not a setup error. For example, the
  redirect test fetched `/secret` over the pinned dispatcher, and the CONNECT
  test got a 200 tunnel. With the fix it runs **19 passed of 19**. After the red
  commit, one more public control was added (`::ffff:808:808%eth0`). It passes on
  `origin/main` too, so the recorded red still holds.

  **The fix.** `v6Groups` now parses every spelling to eight numbers. It rewrites
  a dotted tail as two hex groups, strips a zone id, folds case, and refuses
  anything malformed, which blocks it. `embeddedV4` then reads the IPv4 address
  out of the value:

  | Range                  | IPv4 address judged                                        |
  | ---------------------- | ---------------------------------------------------------- |
  | `::ffff:0:0/96` mapped | low 32 bits                                                |
  | `::ffff:0:0:0/96` SIIT | low 32 bits                                                |
  | `::/96` compatible     | low 32 bits (`::` and `::1` fall in 0.0.0.0/8, so blocked) |
  | `64:ff9b::/32` NAT64   | low 32 bits, as before this ticket                         |
  | `2002::/16` 6to4       | bits 16–47                                                 |
  | `2001::/32` Teredo     | the server address, and the bit-inverted client address    |

  If any address it yields is blocked, the IPv6 address is blocked. This runs
  before the native rules, which are unchanged.

  **Entry points.** Every `assertAllowed` and `isBlockedAddress` call under
  `api/src` goes through the one fixed function: `routes/probe.ts`,
  `routes/jobs.ts`, `jobs/orchestrator.ts`, `guarded-fetch.ts`,
  `egress-proxy.ts` (two calls), `thumbnails.ts`, `dispatcher.ts`, and the
  re-export in `index.ts`. Each call site has its own test in the spec, and each
  test was proven by deleting that call site.

  **Mutations, 19 of 19 red**, each applied alone and restored:
  - Each `embeddedV4` branch removed (mapped, SIIT, compatible, NAT64, 6to4,
    Teredo) turns its range's test red. Removing the mapped branch also turns
    every entry-point test red.
  - Teredo without the inversion turns a public control red, and so does Teredo
    ignoring the server address.
  - Dropping the dotted-tail rewrite, the zone strip or the case fold turns
    "a public embedded address stays allowed" red. Each of those fails closed
    rather than open, so only the public controls can catch them.
  - Ignoring `embeddedV4`'s result turns 15 tests red.
  - Deleting the call in `routes/probe.ts`, `routes/jobs.ts`, the orchestrator,
    `thumbnails.ts`, or either call in `egress-proxy.ts` turns exactly that
    entry point's test red. Deleting it in `guarded-fetch.ts` turns the redirect
    test and the pinned-dispatcher test red.

  **Reachability in this sandbox**, connecting to a server on `127.0.0.1`: the
  mapped form connected. Compatible, SIIT, NAT64, 6to4 and Teredo each returned
  `ENETUNREACH`, so none of them reaches loopback without a translator or relay
  on the path. They are blocked anyway, because a deployment can have one. The
  production host was not measured.

  **What the brief had right, and one thing it understated.** The root cause is
  as the brief stated. The brief listed mapped and compatible hex forms. SIIT
  hex (`::ffff:0:7f00:1`), 6to4 (`2002:7f00:1::`) and Teredo were also allowed
  on `origin/main`. NAT64 was already judged by its embedded address.

  **Fold-in.** `dl-60` is added to
  [dl-49](./dl-49-open-without-a-login.md)'s `depends_on`. Opening the tool
  without a login must not land before this does.

  **Open decisions**, raised with the dispatching session rather than settled
  here:
  1. Whether the pinned dispatcher and the egress proxy should also check a
     literal at connect time, as a second layer behind `ssrf.ts`. It was
     measured, not built.
  2. Whether local-use NAT64 `64:ff9b:1::/48` should be blocked outright instead
     of read with the `/96` layout. The IANA registry marks it not globally
     reachable, and an operator can embed the IPv4 address at other offsets.
  3. Whether Teredo and 6to4 should be blocked outright rather than judged by
     their embedded address.
