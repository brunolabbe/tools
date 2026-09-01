---
id: dl-36
tool: downloader
title: Fixture certificate serial numbers encode as negative integers, which RFC 5280 forbids
kind: fix
status: ready
milestone: null
depends_on: []
---

# dl-36 — Fixture certificate serials encode negative

**Packages:** `tools/downloader/api`
(`test/helpers/tls-origin.ts`, `test/helpers/` tests).

## Why

`createFixtureCertificate` builds every TLS fixture certificate in the
downloader's API suite, and sets the serial number like this
(`tools/downloader/api/test/helpers/tls-origin.ts:150-151`):

```ts
serialCounter += 1;
cert.serialNumber = serialCounter.toString(16).padStart(2, "0");
```

**A DER `INTEGER` is signed and two's-complement**, so a leading byte with its
high bit set is a negative number. RFC 5280 §4.1.2.2 requires the serial to be a
_positive_ integer. `padStart(2, "0")` guarantees an even-length hex string for
counters 1–255 but does nothing about the sign bit, so every counter whose
leading byte is `0x80` or above encodes negative.

This was found and correctly ruled out as the cause of
[dl-33](./dl-33-tls-fixture-certificates-fail-under-contention.md) — _"Worth
fixing on its own terms; not this bug"_ — and is filed here so it is not lost
with that ticket's decision.

## Reproduction

Measured in this worktree, encoding each counter's hex through `node-forge`'s own
ASN.1 writer — the same path `forge.pki.createCertificate()` takes:

| counter   | hex    | DER bytes     | reads as   |
| --------- | ------ | ------------- | ---------- |
| 1         | `01`   | `02 01 01`    | 1          |
| 127       | `7f`   | `02 01 7f`    | 127        |
| **128**   | `80`   | `02 01 80`    | **−128**   |
| **200**   | `c8`   | `02 01 c8`    | **−56**    |
| **255**   | `ff`   | `02 01 ff`    | **−1**     |
| 256       | `100`  | `02 02 01 00` | 256        |
| 4095      | `fff`  | `02 02 0f ff` | 4095       |
| 4096      | `1000` | `02 02 10 00` | 4096       |
| **32768** | `8000` | `02 02 80 00` | **−32768** |

So the rule is the **high bit of the leading byte**, and the affected ranges are
128–255, 32768–65535, and every higher range with the same property.

### One thing dl-33 got wrong, and it narrows the fix

dl-33's note says `padStart(2, …)` _"leaves an odd-length hex string for counters
256–4095"_, and treats that as a second half of the defect. **It does not
manifest.** `forge.util.hexToBytes` left-pads an odd-length string:

```
hexToBytes("fff") -> 0f ff
hexToBytes("100") -> 01 00
```

Both rows are in the table above and both read back correctly. The odd-length
case is harmless; **the sign bit is the whole defect.**

### It is cosmetic today, and that is worth stating plainly

The counter is module-level and resets per process, and the suite has **9
`createFixtureCertificate` call sites** — so a real run never approaches 128 and
no test observes a negative serial. Node's `X509Certificate` parses the
certificates cleanly either way; nothing rejects them. This is a
correctness-on-its-own-terms fix to a test helper, not a live failure, and the
ticket exists because the reproduction is the deliverable.

## Build

1. **Encode the counter as a positive DER `INTEGER`** in
   `tools/downloader/api/test/helpers/tls-origin.ts`. Two conditions, not one:
   the hex string must be even-length, **and** its leading byte must have the
   high bit clear — prefix a `00` byte when it does not. That is the standard
   encoding rule and it is what `padStart(2, "0")` was reaching for.
2. **Keep the comment above the assignment true.** It currently explains why
   distinct serials are _not_ load-bearing for the dl-21 collision, and a mutation
   run proved it. That reasoning is unchanged by this fix; do not delete it, and
   do not let the new code imply the serial matters more than it does.
3. **Test the encoder, not the certificate.** The value under test is a hex
   string, so the cheapest true assertion is over the counter values in the
   reproduction table — not nine generated 2048-bit keypairs, which is slow and
   proves less. If the encoding needs extracting to a named function to be
   testable, extract it; that is a test helper, not a contract.
4. Assert both properties for every case: **even length**, and **leading byte
   below `0x80`** — and that the value still round-trips to the counter it came
   from, so a fix that pads correctly but changes the number is caught.

## Done when

1. A test asserts, for counters spanning the reproduction table above (at least
   1, 127, 128, 255, 256, 4095, 4096, 32768), that the serial hex is even-length,
   has a leading byte below `0x80`, and parses back to the counter. It fails
   against the current `padStart(2, "0")` — run it red first and say so.
2. `npx vitest run tools/downloader/api` passes.
3. `npm run check` passes.
4. The comment at `tls-origin.ts:143-149` still says what it says now about the
   dl-21 collision, or the Log says why it changed.

## Log

- **2026-09-01** — Filed off `origin/main@7fe18af`. The defect was found and ruled
  out by dl-33's investigation; the reproduction above is this session's own,
  measured through `node-forge`'s ASN.1 writer rather than reasoned from the
  source, and it **corrects dl-33 on one point**: the odd-length hex it flags for
  counters 256–4095 is handled by `forge.util.hexToBytes`, which left-pads, so the
  sign bit is the entire defect and the fix is narrower than dl-33 implies.

  Also measured while filing, and the reason the ticket says "cosmetic" out loud:
  9 call sites, a per-process counter, so nothing in a real run reaches 128.

  **No `difficulty` field**, though repo-17 adds one: that parser change has not
  merged, so a ticket carrying the field fails `npm run status` for everyone on
  `main` — measured here, the filing was written with `difficulty: standard` and
  rejected by file and line. Add it when repo-17 lands, or leave it off: absent
  means the builder inherits, which is the answer for this ticket anyway.

  `dl-36` confirmed free: `tools/downloader/docs/work/` tops out at `dl-35`, a
  grep for `dl-<n>` across the tree adds only `dl-999` (a `scripts/status.mjs`
  fixture), and no remote branch or pull request in any state names `dl-36`.
