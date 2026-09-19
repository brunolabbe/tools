---
id: dl-63
tool: downloader
title: The SSRF guard admits several native IPv6 special-purpose ranges
kind: fix
status: done
milestone: M5
depends_on: []
---

# dl-63 — Native IPv6 special-purpose ranges the URL guard still admits

**Packages:** `api` (`ssrf.ts`).

**Related:** dl-60 (merged, `cbfdbba`, PR #252) fixed the guard for IPv6 forms
that _embed_ an IPv4 address — mapped, SIIT, compatible, well-known NAT64, and
the three transition ranges (Teredo, 6to4, local-use NAT64) it chose to refuse
outright. This ticket is the rest: _native_ IPv6 ranges, addressed as IPv6 all
the way, that `isBlockedV6` in `tools/downloader/api/src/ssrf.ts` does not
recognise at all. See dl-60's own ticket for what it fixed and why; it is not
repeated here.

## Why

`isBlockedAddress`'s native-IPv6 branch only refuses unique-local (`fc00::/7`),
link-local (`fe80::/10`) and multicast (`ff00::/8`). IANA's IPv6
special-purpose registry lists several more ranges marked not globally
reachable — documentation prefixes, a discard-only block, a benchmarking
block, a segment-routing block, an unallocated slice of the IETF protocol
assignment space — plus one deprecated range (`fec0::/10`, RFC 3879) that
predates the registry and was never added to it. None of these are refused
today. A hostile page can hand the resolver a URL whose host is a bracketed
literal in one of these ranges, or a name that resolves there, and the guard
lets it through.

## What was measured

**Registry fetched 2026-09-15** against `origin/main` `49515ba` (dl-60's fix,
`cbfdbba`, is an ancestor of this commit):

- `https://www.iana.org/assignments/iana-ipv6-special-registry/iana-ipv6-special-registry-1.csv`
  — HTTP 200, **25 data rows** (26 lines including the header; two rows carry
  an embedded newline in their RFC column, which is why a raw `wc -l` reads 28).
- `https://www.iana.org/assignments/ipv6-address-space/ipv6-address-space-1.csv`
  — HTTP 200, fetched only to confirm the `ff00::/8` Multicast entry, which is
  in the _address space_ registry rather than the special-purpose one.
- `fec0::/10` is in neither. Confirmed instead against RFC 3879 §2/§6 directly
  (`https://www.rfc-editor.org/rfc/rfc3879.txt`): "This document formally
  deprecates the IPv6 site-local unicast prefix ... FEC0::/10 ... IANA is
  requested to mark the FEC0::/10 prefix as 'deprecated'." No Globally
  Reachable column exists for it because it was never in the machine-readable
  registry; treated as not globally reachable on the strength of that text.

**Command:** `npm run build`, then a script loading
`tools/downloader/api/dist/ssrf.js` and calling `isBlockedAddress(addr)` and
`createSsrfGuard({ lookup: async () => { throw new Error(...) } }).assertAllowed(`https://[${addr}]/`)`
for the first address and one mid-range address of every registry row, plus
`fec0::/10` and `ff00::/8`. The throwing `lookup` proves DNS was never called
— every one of these addresses reaches the guard as a bracketed literal, so
the resolver path is irrelevant to this ticket.

### Full measurement table

| Range                                                    | Purpose                                                 | Globally reachable (IANA)                                         | Guard result                    | Connect result               |
| -------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------- | ---------------------------- |
| `::1/128`                                                | Loopback                                                | False                                                             | **blocked**                     | not tested — already blocked |
| `::/128`                                                 | Unspecified                                             | False                                                             | **blocked**                     | not tested — already blocked |
| `::ffff:0:0/96`                                          | IPv4-mapped                                             | False (per-embedded-address)                                      | judged by embedded IPv4 (dl-60) | not applicable               |
| `64:ff9b::/96`                                           | NAT64, well-known                                       | True (per-embedded-address)                                       | judged by embedded IPv4 (dl-60) | not applicable               |
| `64:ff9b:1::/48`                                         | NAT64, local-use                                        | False                                                             | **blocked** (dl-60, outright)   | not tested — already blocked |
| `100::/64`                                               | Discard-Only                                            | False                                                             | **allowed**                     | ENETUNREACH (see below)      |
| `100:0:0:1::/64`                                         | Dummy IPv6 Prefix (RFC 9780, new 2025-04)               | False                                                             | **allowed**                     | ENETUNREACH                  |
| `2001::/23` general space (outside the carve-outs below) | IETF Protocol Assignments                               | False [1]                                                         | **allowed**                     | ENETUNREACH                  |
| `2001::/32`                                              | Teredo                                                  | N/A [2]                                                           | **blocked** (dl-60, outright)   | not tested — already blocked |
| `2001:1::1/128`                                          | PCP Anycast                                             | True                                                              | allowed (correct — reachable)   | not tested                   |
| `2001:1::2/128`                                          | TURN Anycast                                            | True                                                              | allowed (correct — reachable)   | not tested                   |
| `2001:1::3/128`                                          | DNS-SD Anycast                                          | True                                                              | allowed (correct — reachable)   | not tested                   |
| `2001:2::/48`                                            | Benchmarking                                            | False                                                             | **allowed**                     | ENETUNREACH                  |
| `2001:3::/32`                                            | AMT                                                     | True                                                              | allowed (correct — reachable)   | not tested                   |
| `2001:4:112::/48`                                        | AS112-v6                                                | True                                                              | allowed (correct — reachable)   | not tested                   |
| `2001:10::/28`                                           | Deprecated (ex-ORCHID, terminated 2014-03)              | _(blank)_                                                         | **allowed**                     | ENETUNREACH                  |
| `2001:20::/28`                                           | ORCHIDv2                                                | True                                                              | allowed (correct — reachable)   | not tested                   |
| `2001:30::/28`                                           | Drone Remote ID Entity Tags                             | True                                                              | allowed (correct — reachable)   | not tested                   |
| `2001:db8::/32`                                          | Documentation                                           | False                                                             | **allowed**                     | ENETUNREACH                  |
| `2002::/16`                                              | 6to4                                                    | N/A [3]                                                           | **blocked** (dl-60, outright)   | not tested — already blocked |
| `2620:4f:8000::/48`                                      | AS112 Direct Delegation                                 | True                                                              | allowed (correct — reachable)   | not tested                   |
| `3fff::/20`                                              | Documentation                                           | False                                                             | **allowed**                     | ENETUNREACH                  |
| `5f00::/16`                                              | Segment Routing (SRv6) SIDs                             | False                                                             | **allowed**                     | ENETUNREACH                  |
| `fc00::/7`                                               | Unique-Local                                            | False [4]                                                         | **blocked** (native rule)       | not tested — already blocked |
| `fe80::/10`                                              | Link-Local                                              | False                                                             | **blocked** (native rule)       | not tested — already blocked |
| `fec0::/10`                                              | Site-Local (deprecated, RFC 3879; not in the registry)  | not verified against the live registry — RFC 3879 says deprecated | **allowed**                     | ENETUNREACH                  |
| `ff00::/8`                                               | Multicast (address-space registry, not special-purpose) | not applicable — no reachability column                           | **blocked** (native rule)       | not tested — already blocked |

Rows in **bold "allowed"** are the gap this ticket files. Everything else is
already correctly handled — including the `2001::/23` carve-outs, which the
registry marks separately reachable and the guard correctly leaves open by not
matching them against anything.

### Reachability

For every allowed, not-globally-reachable range, one connect attempt was
tried from this container to a representative address, port 80, 3-second
timeout: `100::1`, `100:0:0:1::1`, `2001:1ff::1`, `2001:2::1`, `2001:db8::1`,
`3fff::1`, `5f00::1`, `fec0::1`, `2001:10::1`. **Every one returned
`ENETUNREACH`.** That is not evidence about these ranges specifically: the
same container also gets `ENETUNREACH` connecting to `2001:4860:4860::8888`
(Google's public DNS, port 443), and `ip -6 addr show` lists only `::1/128` —
this container has no IPv6 route at all. **This does not claim anything about
production reachability**, which dl-60's own Log noted was not measured
either. The command and its output are reproducible with the script left at
`/tmp/claude-1000/.../scratchpad/dl-63/measure.mjs` (not checked in; the
transcript above is the record).

## The decision

**dl-63: which native IPv6 ranges should the URL guard block?** All are
IPv6-native (no embedded IPv4, so dl-60's fix does not touch any of them).
Asked of the repository owner with `AskUserQuestion` on 2026-09-17, as the
three shapes below.

**(a) Block every range IANA marks not globally reachable, exactly.** That
means adding `100::/64`, `100:0:0:1::/64`, `2001:2::/48`, `2001:db8::/32`,
`3fff::/20`, `5f00::/16`, `fec0::/10`, and `2001::/23` — but `2001::/23`
cannot be blocked as a flat range without also refusing the seven
already-reachable sub-allocations living inside it (`2001:1::1-3`,
`2001:3::/32`, `2001:4:112::/48`, `2001:20::/28`, `2001:30::/28`). Doing this
correctly means a nested rule — block `2001::/23` except those seven
carve-outs — which drifts every time IANA adds or reclassifies an allocation
inside it (it added the DNS-SD anycast address in 2024 and the Drone Remote ID
block in 2022; nothing here would notice a future one). **Cost: the most
code, and the only option with an ongoing maintenance obligation tied to a
registry this repo does not poll.**

**(b) Block only the stable, well-known ranges, and leave the volatile ones
alone.** Block `fec0::/10`, `100::/64`, `2001:db8::/32`, `3fff::/20`,
`2001:2::/48`, `5f00::/16` — all fixed-shape, none carrying carve-outs — and
leave `2001::/23`'s general space, the brand-new `100:0:0:1::/64` dummy prefix
(RFC 9780, allocated five months ago), and the terminated, blank-reachability
`2001:10::/28` unblocked. **Cost: cheapest to implement and to keep correct,
but leaves three ranges open, one of which (`2001::/23`'s general space) is
the largest of any range measured here** — the two carved-out /128s aside, it
is 2^105 addresses.

**(c) A named, flat list, including `2001::/23` as a whole** — accepting that
the seven reachable sub-allocations (PCP, TURN and DNS-SD anycast, AMT,
AS112-v6, ORCHIDv2, Drone Remote ID tags) would be refused too. None of them
are host addresses a video or media resolver would plausibly point at — they
are anycast service addresses for unrelated protocols. **Cost: the same
maintenance obligation as (a) has for new IANA allocations _outside_
`2001::/23`, but none of the nesting complexity inside it — one flat list,
one pass through `isBlockedV6`.** The accepted risk is refusing a legitimate
fetch to one of those seven addresses, which this ticket has not verified
never happens (no media host was checked against any of them).

**Recommended: (c).** It closes every measured gap in one pass, with the
guard's existing default-deny shape (unique-local, link-local and multicast
are already flat ranges, not carve-out-aware), and the seven addresses it
would over-block are not plausible media origins. This has not been checked
against real traffic; that is the caveat the option costs, named rather than
buried in the choice.

**Chosen: (c), by the repository owner, on 2026-09-17 — matching this
ticket's own recommendation, which overrode nobody.** The cost named above is
carried forward rather than discovered later: the seven reachable
sub-allocations inside `2001::/23` (PCP, TURN and DNS-SD anycast, AMT,
AS112-v6, ORCHIDv2, Drone Remote ID) are refused too, unverified against real
media traffic, and a new IANA allocation outside `2001::/23` still needs a
manual addition here — this option carries the same registry-drift
obligation option (a) has for everything _outside_ `2001::/23`, just none of
the nesting complexity inside it.

**What (c) includes, resolved rather than left to infer.** The two paragraphs
above this one disagree with each other on `2001:10::/28`: one says
"`fec0::/10` and `2001:10::/28` ... are straightforward additions under any
of the three and are not really in question", the other calls
`2001:10::/28` one of "the two very new/edge entries" the live decision is
about. **That was ambiguous before an option was chosen, and is flagged
here rather than quietly resolved** — but choosing (c) makes it moot: `2001:10::/28`'s second hextet (`0x0010` = 16) falls inside `2001::/23`
(hextet range `0x0000`–`0x01FF`), so blocking `2001::/23` "as a whole" with
no carve-outs blocks it structurally, regardless of which sentence above was
meant. `2001:2::/48` is inside `2001::/23` the same way (hextet `0x0002`).
`100:0:0:1::/64` is not a sub-range of anything else measured here (its top
hextet is `0100`, wholly outside `2001::/23`), so it needs its own explicit
entry — included under (c) because the recommendation's own words are "it
closes every measured gap in one pass", and `100:0:0:1::/64` is a measured
gap (row 2 of the table above). So (c), as chosen, blocks every bold
"allowed" row in the measurement table above, with `2001::/23` collapsing
three of those rows (`2001:2::/48`, `2001:10::/28`, and the general space
itself) into one rule.

## Build

`isBlockedV6` in `tools/downloader/api/src/ssrf.ts` gains flat native-IPv6
ranges, alongside the existing unique-local/link-local/multicast rules — no
carve-outs, per (c):

- `100::/64` (Discard-Only)
- `100:0:0:1::/64` (Dummy IPv6 Prefix, RFC 9780)
- `2001::/23` (IETF Protocol Assignments, blocked as a whole — this alone
  covers `2001:2::/48` Benchmarking, `2001:10::/28` deprecated ORCHID, and the
  seven reachable sub-allocations named above, all refused)
- `2001:db8::/32` (Documentation)
- `3fff::/20` (Documentation)
- `5f00::/16` (Segment Routing, SRv6 SIDs)
- `fec0::/10` (Site-Local, deprecated, RFC 3879)

## Done when

- A unit table over every range added to `isBlockedV6` under (c) — `100::/64`,
  `100:0:0:1::/64`, `2001::/23`, `2001:db8::/32`, `3fff::/20`, `5f00::/16`,
  `fec0::/10` — proving a public neighbour of each stays allowed and the range
  itself is blocked.
- A regression proving the seven previously-reachable `2001::/23`
  sub-allocations (`2001:1::1`, `2001:1::2`, `2001:1::3`, `2001:3::1`,
  `2001:4:112::1`, `2001:20::1`, `2001:30::1`) are now blocked too, since (c)
  takes no carve-outs — the accepted over-block, proven rather than assumed.
- `npm run check` and `npm test -- --project downloader` green.

## Log

- 2026-09-15 — Filed off `origin/main` `49515ba` (dl-60's fix `cbfdbba` is an
  ancestor). Measured `isBlockedAddress` and `assertAllowed` against every row
  of IANA's IPv6 special-purpose registry (25 rows, fetched live, HTTP 200)
  plus `fec0::/10` (RFC 3879, not in the registry) and `ff00::/8` (already
  blocked, confirmed via the IPv6 address-space registry rather than the
  special-purpose one). Eight ranges are admitted that IANA marks not globally
  reachable: `100::/64`, `100:0:0:1::/64`, `2001::/23`'s general space,
  `2001:2::/48`, `2001:db8::/32`, `3fff::/20`, `5f00::/16`, and `fec0::/10`;
  `2001:10::/28` (terminated, blank reachability) is admitted too and noted
  separately. Every connect attempt to a representative address in an admitted
  range returned `ENETUNREACH` — but so did a connect to a known-public IPv6
  address, because this container has no IPv6 route at all (`ip -6 addr show`
  lists only `::1/128`), so that result is about the sandbox, not about any of
  these ranges; not claimed as evidence either way.
- 2026-09-17 — Owner chose **(c)** via `AskUserQuestion`, matching this
  ticket's own recommendation (nobody's recommendation was overridden). Moved
  to `ready`. Rewrote the decision section to resolve which ranges (c) covers:
  every bold "allowed" row in the measurement table, since `2001:10::/28` and
  `2001:2::/48` are structurally sub-ranges of `2001::/23` and the
  recommendation's own words are "closes every measured gap in one pass".
  Flagged rather than silently resolved: the ticket's own decision text had
  two sentences that disagreed about whether `2001:10::/28` was settled or
  still open, which choosing (c) makes moot. `Build` and `Done when` rewritten
  to name the concrete ranges and the regression on the seven over-blocked
  reachable sub-allocations.
- 2026-09-19 — Built option (c) off `origin/main` `fb15bc9`. `isBlockedV6` in
  `api/src/ssrf.ts` now reads one flat `BLOCKED_V6` table, the same shape as
  `BLOCKED_V4`: the seven ranges in Build plus the three native rules it
  already had (unique-local, link-local, multicast), folded into the table
  rather than left as a second style beside it. No carve-outs; the transition
  ranges and embedded-IPv4 rules from dl-60 still run first, unchanged.
  - **Tests** are a new file, `api/test/native-ipv6-ranges.test.ts`, rather
    than additions to `ssrf.test.ts`, following dl-60's `embedded-ipv4.test.ts`
    and so that no gate record's line citation into either existing file moves.
    Each range is tested at its first address, one in the middle and its last,
    with the address just past each edge allowed. The seven over-blocked
    allocations are asserted refused through both `isBlockedAddress` and
    `assertAllowed`. One address per range is also checked through
    `assertAllowed` as a bracketed literal (the lookup throws, so no DNS), through
    `dispatcher.ts`'s `blockedLiteral`, and through a name that resolves into
    one of the ranges.
  - **Red run, done against the unfixed source:** with the new spec in place
    and `ssrf.ts` untouched, 13 of 14 tests failed and the one that passed was
    the public-address control. That is the check itself, not a substitute.
  - **Mutation:** every new prefix length was moved by one in each direction
    (14 mutants, script not checked in). 11 turned the spec red. The 3 that
    stayed green are equivalent mutants, where no address can tell the two
    apart. `100::/63` and `100:0:0:1::/63` each cover exactly the union of the
    two adjacent /64s. `fec0::/9` is `fe80::/9`, which is link-local plus
    site-local, already blocked by the next row.
  - **What the brief had wrong, or left unsaid.** (1) It did not notice that
    one of dl-60's tests asserts the opposite of (c):
    `embedded-ipv4.test.ts`'s "the neighbours of those ranges are not caught by
    them" allowed `2001:1::1` as Teredo's public neighbour, and that address is
    PCP Anycast, one of the seven that (c) now refuses. The test would have gone
    red. It now uses `2001:200::1`, the first address past `2001::/23`, and was
    rewritten in place, keeping its line count, so dl-60's gate citations into
    that file do not move. That test's comment also named `64:ff9b:2::/48` as
    the neighbour, but the address it lists, `64:ff9b::808:808`, is in
    `64:ff9b::/96`. The comment was corrected in the same edit. (2) `fec0::/10`
    has no allowed neighbour. Link-local sits directly below it and multicast
    directly above, so everything from `fe80::` to the top of the address space
    is refused, and a separate test asserts that contiguity. The allowed address
    its row uses instead is `fbff:ffff:…`, which is below unique-local. This
    entry first said `fc00::/6` was refused end to end. That was wrong, and the
    gate caught it (see below). (3) `100::/64` has a
    blocked range directly above it (the dummy prefix), so its upper neighbour
    is `100:0:0:2::`. The neighbours of `100::/64`, `100:0:0:1::/64`,
    `5f00::/16` and `3fff::/20` sit in IETF-reserved or unallocated space, not
    public space. They are allowed by this guard, and that is what a neighbour
    has to show to prove a prefix length. Real public addresses are covered by
    their own test (Google and Cloudflare DNS, and `2001:200::1`).
  - **Not measured:** production IPv6 reachability, and whether any real media
    host sits in one of the seven over-blocked allocations. Both are unmeasured
    here for the reasons already given in this ticket.
  - **Fold-in:** nothing free was found. No doc outside `docs/work/` lists the
    native IPv6 ranges (`grep` for `fc00::/7`, `fe80::/10` and `unique-local`
    over the tool docs, `docs/` and `.claude/` came back empty), so there was
    no prose to bring up to date.
  - **One citation moved, and was re-pointed:** `scripts/citations-gate.mjs
--against origin/main` failed dl-57's gate record, whose citation of
    `ssrf.ts:306 "That address could not be resolved."` now sits at line 338
    because the table was inserted above it. The line number in dl-57 was
    updated and nothing else was touched. After that the gate reported
    `89 enforced, 0 failing`, exit 0.
- 2026-09-19 — Gate 1 (ticket-reviewer) passed with one low finding, which
  reproduced here. `fe00::/9` (IANA "Reserved by IETF") lies between
  unique-local and link-local and is not in `BLOCKED_V6`. Checked against the
  built `dist/ssrf.js`: `isBlockedAddress` returns `false` for `fe00::`,
  `fe00::1` and `fe7f:ffff:…:ffff`, and `true` for `fdff:ffff:…:ffff` and
  `fe80::`. So the claim this Log and the test comment made, that `fc00::/6` is
  refused end to end, was false. Both now describe the actual coverage: from
  `fe80::` up is contiguous, and unique-local stands alone. The test was renamed
  to match. Its assertions did not change, because every address it listed was
  already correct. `fe00::/9` itself was not blocked here, because it is not
  one of option (c)'s named ranges and was never measured against the registry.
  Whether to block it is left as an open decision for the orchestrator. It is
  not settled here.
