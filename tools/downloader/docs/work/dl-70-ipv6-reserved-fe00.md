---
id: dl-70
tool: downloader
title: The SSRF guard still admits fe00::/9, between unique-local and link-local
kind: fix
status: ready
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
