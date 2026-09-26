---
id: dl-70
tool: downloader
title: The SSRF guard still admits fe00::/9, between unique-local and link-local
kind: fix
status: done
milestone: M5
depends_on: [dl-63]
---

# dl-70 — `fe00::/9` is still admitted by the URL guard

**Packages:** `api` (`ssrf.ts`).

**Related:** dl-63 built option (c), a single flat `BLOCKED_V6` table in
`tools/downloader/api/src/ssrf.ts` with no carve-outs. The owner chose that
option on 2026-09-17. This ticket extends the same table and keeps the same
shape. It does not reopen (c).

## Why

`fe00::/9` (`fe00::` to `fe7f:ffff:ffff:ffff:ffff:ffff:ffff:ffff`, about 2^119
addresses) sits between unique-local (`fc00::/7`) and link-local (`fe80::/10`).
IANA's IPv6 address-space registry lists it as reserved by the IETF. It is not
in dl-63's list, because dl-63 measured the special-purpose registry, and this
range lives in the address-space registry instead. dl-63's gate caught the gap.
A first draft of dl-63 claimed `fc00::/6` was refused end to end, and it is
not. Everything from `fe80::` to the top of the address space is refused, and
unique-local is refused, but the range between the two is not.

A hostile page can hand the resolver a bracketed literal in this range, or a
name that resolves into it, and the guard lets it through. No legitimate media
origin is expected there, but that is the claim this ticket has to measure
rather than assume.

## Reproduction

Measured on PR #273's head `569ecbb`, which is dl-63's branch rebased onto
`origin/main` `4463431`, after `npm run build`:

```sh
node -e "import('./tools/downloader/api/dist/ssrf.js').then(m => { for (const a of ['fe00::', 'fe00::1', 'fe7f:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'fe80::']) console.log(a, m.isBlockedAddress(a)) })"
```

```text
fe00:: false
fe00::1 false
fe7f:ffff:ffff:ffff:ffff:ffff:ffff:ffff false
fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff true
fe80:: true
```

## The decision

**Settled: file this ticket, and do not block the range in dl-63's branch.**
The owner chose this on 2026-09-19 through `AskUserQuestion`, relayed by the
orchestrator. The other options were to add the range to PR #273 immediately,
or to leave the gap recorded in dl-63's Log. Filing the ticket was what both
the builder and the reviewer recommended.

The rule for blocking is the one dl-63 applied to its seven ranges. Block the
range if the registry says it is not a globally reachable allocation.

## Build

1. **Measure first.** Fetch
   `https://www.iana.org/assignments/ipv6-address-space/ipv6-address-space-1.csv`
   and record the row covering `fe00::/9`: its designation, its RFC and its
   notes. Also confirm that nothing in
   `https://www.iana.org/assignments/iana-ipv6-special-registry/iana-ipv6-special-registry-1.csv`
   falls inside `fe00::/9` and is marked globally reachable. WebFetch is
   blocked in the container, so use `curl`, or ask for the firewall to be
   opened. Record the HTTP status, the row count and the fetch date, as dl-63
   did.
2. **If the range checks out** (reserved, and nothing inside it is globally
   reachable), add `["fe00::", 9]` to `BLOCKED_V6` with a comment naming the
   registry row. Leave everything else in the table as it is.
3. **If it does not check out,** do not block it. Write down what the registry
   says and bring the case back as a decision.

## Done when

- The registry measurement is recorded in this ticket's Log: the URL, the HTTP
  status, the fetch date, and the `fe00::/9` row as it reads. The Log also
  records the special-purpose-registry check for anything reachable inside the
  range.
- If the range is blocked: a test in
  `tools/downloader/api/test/native-ipv6-ranges.test.ts`, appended at the end of
  its describe block, asserts that `fe00::`, a middle address and
  `fe7f:ffff:ffff:ffff:ffff:ffff:ffff:ffff` are refused, and that `fbff:ffff:…`
  below unique-local stays allowed. It must first be run red against the
  unfixed source. The same file's comment about `fe00::/9` (the one saying it is
  "not listed") is updated, and so is the `fec0::/10` row comment that calls it
  undecided.
- `npm run check` and `npm test -- --project downloader` green.

## Log

- 2026-09-19 — Filed by dl-63's builder on the owner's instruction, relayed by
  the orchestrator. The reproduction above was re-run at `569ecbb` just before
  filing.
- 2026-09-26 — Built on `origin/main` `a1a417b`. **Build step 1, the registry
  measurement, is not done: IANA is unreachable from the container.** So the
  first `Done when` line is unmet, and this ticket stays `ready`.
  - Both registry fetches time out at the firewall. The address-space CSV,
    `curl -sS -m 30 -w "%{http_code}" https://www.iana.org/assignments/ipv6-address-space/ipv6-address-space-1.csv`,
    printed `curl: (28) Connection timed out after 30000 milliseconds` and
    `000`, at 2026-09-26 21:15 UTC. The special-purpose CSV printed the same
    thing with `-m 10`. WebFetch also failed, with no output. `www.iana.org` is
    not in `.devcontainer/allowed-domains.txt`, and `raw.githubusercontent.com`
    is.
  - The only evidence here is second-hand, and it is not the registry. CPython's
    `Lib/ipaddress.py` on `main`, fetched from `raw.githubusercontent.com` with
    HTTP 200 and 84240 bytes, lists `IPv6Network('FE00::/9')` in
    `_reserved_networks`, at its line 2477. Neither of the ticket's two claims
    is confirmed by that: not the row's designation, RFC and notes, and not that
    nothing globally reachable lies inside the range.
  - The code is built as step 2 describes, so that a measurement which checks
    out needs only this Log and the frontmatter. `["fe00::", 9]` is in
    `BLOCKED_V6`. Its row comment names the registry but no RFC, because none
    was measured. If the measurement does not check out, step 3 applies and
    this code comes out again.
  - The test is red before the fix and green after it. The test
    `fe00::/9, reserved by the IETF, closes the gap` is appended at the end of
    the describe block in `api/test/native-ipv6-ranges.test.ts`. Against the
    unfixed source,
    `npx vitest run tools/downloader/api/test/native-ipv6-ranges.test.ts` gave
    `1 failed | 14 passed (15)`, with `AssertionError: fe00::: expected false to be true`.
    The loop stops at the first address. So the unfixed build was also measured
    directly, with `isBlockedAddress` on `dist/ssrf.js`: `fe00::`, `fe40::1`,
    `fe7f:ffff:…:ffff` and `fbff:ffff:…:ffff` each returned `false`, and
    `fe80::` returned `true`. After the fix the same spec gave
    `15 passed (15)`.
  - The two test comments are updated: the `fec0::/10` row's "undecided"
    comment, and the "not listed" comment in the end-to-end test. The end-to-end
    test's name is unchanged, because it is still true.
  - Citations. Adding the row moved dl-57's `## Review` citation of
    `api/src/ssrf.ts` from `:338` to `:340`, and it is repointed. The same line
    stayed where it was. dl-63's gate record cited the "not listed" comment,
    which this change rewrites. It is pinned to `a1a417b`, a `main` commit,
    where that line still reads as the record quotes it.
  - Fold-in: none. The same sweep found older Log citations of `ssrf.ts` that
    were already stale on `main` before this branch: in `repo-1`, `dl-29`,
    `dl-31`, and dl-63's own Log at `:306`. None of them is under a `## Review`,
    and repointing history that no ticket asks to be repointed is not
    already-specified work.
- 2026-09-26 — **Build step 1 is measured, and the range checks out.** The
  owner opened the container firewall; the orchestrator relayed that the
  owner chose this over waiving the line or allowlisting `iana.org`. So the
  entry above, which says this ticket stays `ready`, describes `e1fcc47` and
  is superseded here. Fetched at 2026-09-26 21:29 UTC:
  - `https://www.iana.org/assignments/ipv6-address-space/ipv6-address-space-1.csv`
    returned HTTP 200, 2093 bytes, **20 data rows** (counted by a quote-aware
    CSV parse, since the `2000::/3` notes span five lines). The row as it
    reads, with an empty Notes column:
    `fe00::/9,Reserved by IETF,[RFC3513][RFC4291],`. Its neighbours are
    `fc00::/7,Unique Local Unicast,[RFC4193]` and
    `fe80::/10,Link-Scoped Unicast,[RFC3513][RFC4291]`.
  - `https://www.iana.org/assignments/iana-ipv6-special-registry/iana-ipv6-special-registry-1.csv`
    returned HTTP 200, 2289 bytes, **25 data rows**, the same count dl-63
    measured. **None of them lies inside `fe00::/9`.** The same parse,
    filtering on a first group from `fe00` to `fe7f`, returned `[]`. The
    nearest rows are `fc00::/7` (Unique-Local, Globally Reachable `False [4]`)
    and `fe80::/10` (Link-Local Unicast, Globally Reachable `False`). So
    nothing in the range is a globally reachable allocation.
  - By the rule dl-63 applied, the range is blocked: it is reserved, and
    nothing inside it is reachable. The `BLOCKED_V6` row comment now names
    the two RFCs the row cites. `status: done`.
  - What the brief had wrong: it asked for the row's "notes", and there are
    none. It named one RFC to record, and the row cites two, RFC 3513 and the
    RFC 4291 that obsoletes it. And the measurement needed a host that is not
    in `.devcontainer/allowed-domains.txt`, which the brief anticipated but
    no subagent can act on.
