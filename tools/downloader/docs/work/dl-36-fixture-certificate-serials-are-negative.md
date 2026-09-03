---
id: dl-36
tool: downloader
title: Fixture certificate serial numbers encode as negative integers, which RFC 5280 forbids
kind: fix
status: done
milestone: null
depends_on: []
---

# dl-36 — Fixture certificate serials encode negative

**Packages:** `tools/downloader/api`
(`test/helpers/tls-origin.ts`, `test/helpers/` tests).

## Why

`createFixtureCertificate` builds every TLS fixture certificate in the
downloader's API suite, and sets the serial number like this
(`tools/downloader/api/test/helpers/tls-origin.ts:150-151`, at `1fe5a4d` —
the fix moved these to 176-177):

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
4. The comment at `tls-origin.ts:144-149` (line numbers as at `1fe5a4d`, where
   this line was written; the fix shifted it to 170-175) still says what it says
   now about the dl-21 collision, or the Log says why it changed.

## Review

_Preamble, from the builder. **Both halves of this record are here in one place**
— the short form and the reasoning. That is not where they normally live: the
reasoning usually goes on the pull request thread and only the short form is
committed. **This branch opened no pull request** — no ship authority this
session — so committing the short form alone would have thrown the reasoning
away rather than filed it elsewhere. Nothing was dropped and nothing was
summarised._

_**The citations in this section are pinned to `dab661c`**, the sha the gate
actually reviewed. It is a **pre-squash branch sha** and will not survive a
squash merge; it is kept because it is the only tree in which the reviewer's line
numbers point at the code the reviewer was looking at._

_`node scripts/citations.mjs <this file> --rev dab661c` reports **9/9 resolve**,
and that number is not a clean bill — it is the trap the script's own header
warns about. Resolving means the lines exist, not that they say what the citation
claims. **Four of the nine have their referent in the base `1fe5a4d`, not in
`dab661c`**, because this fix inserted 28 lines above the code the ticket was
written about: the comment moved 144-149 → 170-175 and the assignment 150-151 →
176-177. Two of those four are in the brief above (`## Why` and `Done when` 4)
and are now labelled with the sha they were written against. The other two are
**deliberately left wrong and must stay that way**: the `143-149` in Done-when
4's row below is the reviewer's own evidence for the off-by-one it reports, and
the Log quotes the same bad number as the subject of its note. Correcting either
would delete the finding it is evidence for. The corrected `144-149` is in the
acceptance line above, and why the original author got it wrong is in the Log._

**Gate: PASS** — 2026-09-02 · `1fe5a4d...dab661c` · self-run defect hunt at medium (no `code-review` subagent — I have none — I ran the hunt myself per instruction)

| Done when                                                                                                                                                    | Proof                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Test asserts even-length, leading byte <0x80, round-trip for counters incl. 1,127,128,255,256,4095,4096,32768; fails red against current `padStart` first | **proven** — `api/test/helpers/tls-origin.test.ts:61` and `:73`; red run reproduced independently: 14/23 fail against the reverted body, restored and re-confirmed 23/23 green                                            |
| 2. `npx vitest run tools/downloader/api` passes                                                                                                              | **proven** — re-ran myself: 18 files / 322 passed (base `1fe5a4d`: 17 files / 299 passed; delta +1 file/+23 tests exactly matches the new spec, no other test file touched)                                               |
| 3. `npm run check` passes                                                                                                                                    | **verified by builder, not independently re-run** — nothing I found implicates it                                                                                                                                         |
| 4. Comment at `tls-origin.ts:143-149` unchanged                                                                                                              | **proven** — text identical `1fe5a4d` vs `dab661c`. Ticket's own citation is off by one at the start (143 is `cert.publicKey = keys.publicKey;`; the comment itself is 144-149) — not spent as a finding, per instruction |

- **findings** · self-run hunt at medium returned 0; 0 carried, 0 dropped.
- NFR: security n/a (test-only fixture; correctness-improving) · performance n/a (new spec ~0.5s) · reliability + (removes a latent defect class) · maintainability + (extraction is testable, precedent-consistent with `tls-interception.ts:121-125`).
- What the gate did **not** do: e2e, the container build, the Windows CI matrix, full `npm test` (excluded from this loop per reviewer's brief); an independent re-run of `npm run check`/`npm run format`; extending the sweep past the spec's own 70000 bound; a real HTTPS handshake through `TlsOrigin` consuming a generated cert (called `createFixtureCertificate` directly instead, including 128 real 2048-bit keypairs to reach counter 128).

### Reasoning and reproductions

**1. Red-run claim (b).** Positive control first: `npx vitest run tools/downloader/api/test/helpers/tls-origin.test.ts` on the unmutated tree → `Tests 23 passed (23)`. Then replaced `fixtureSerialNumberHex`'s body with the old `return counter.toString(16).padStart(2, "0");` and re-ran the same command → `Tests 14 failed | 9 passed (23)`, sweep test reporting `count: 41201, first: [128,129,130,131,132]` — matches the ticket's Log exactly. Restored from a file-copy backup (a `trap` would not have survived across separate Bash tool calls in this harness — each call is a fresh shell), `touch`ed the file, confirmed `git status --porcelain` was empty, re-ran: 23/23 green again.

**2. The nine that don't go red, enumerated (`--reporter=verbose`):**

- `counter 1 encodes as a positive integer` — control, value unaffected either encoding
- `counter 127 encodes as a positive integer` — control, unaffected (boundary below 128)
- `counter 4096 encodes as a positive integer` — control, unaffected (hex `"1000"` already even-length, leading byte `0x10`)
- `counter 1 survives forge's DER writer` — control
- `counter 127 survives forge's DER writer` — control
- `counter 4096 survives forge's DER writer` — control
- `counter 256 survives forge's DER writer` — not a control: this is the odd-length case, passing because `forge.util.hexToBytes` left-pads odd-length hex before the DER write, so the odd-length defect never reaches the DER bytes. This is the dl-33 correction as a test result — and the paired exact-hex test for the same counter _does_ go red, so the pair distinguishes "harmless" from "the real defect" rather than masking it.
- `counter 4095 survives forge's DER writer` — same as 256
- `counter 65536 survives forge's DER writer` — same as 256

None of the 9 passes for a reason unrelated to what it claims: 3 are legitimate below-threshold controls that would catch a regression (exact-hex `.toBe`), and 6 split into 3 controls and 3 intentional demonstrations of the odd-length non-issue.

**3. Call-site wiring, verified past the unit level.** Static: `cert.serialNumber = fixtureSerialNumberHex(serialCounter);` at `api/test/helpers/tls-origin.ts:177`. Dynamic: called `createFixtureCertificate` 128 times in sequence against the fixed tree, parsed the PEM with `node:crypto`'s `X509Certificate`: `serialNumber = "80"` (positive). Mutated back to the old body, repeated the same 128-call sequence: `serialNumber = "-80"` — matches the ticket's Log claim exactly.

**4. Counter coverage, enumerated not sampled.** `CASES` at `tls-origin.test.ts:28-38` has all 8 required counters (1, 127, 128, 255, 256, 4095, 4096, 32768) plus 3 extra. Every case runs both `test.each` blocks — `:61` asserts exact hex, even length, leading byte <0x80, round-trip; `:73` asserts the DER round-trip plus signed two's-complement read-back. All three requested properties present for every required counter.

**5. Both extra claims reproduced independently, same numbers:**

- `derOf("0080")` → `02020080` (`02 02 00 80`) — forge does not strip the `00` prefix. Confirmed.
- Old encoding: `oldHex(255)="ff"`, `oldHex(65535)="ffff"`. `derOf("ff")` → `0201ff`, `derOf("ffff")` → `0201ff` — same DER, a genuine collision. Checked one step further: `hexToBytes("ffff")` itself returns `ffff` unchanged (no pre-minimization), so the collapse happens inside `forge.asn1.toDer` when writing — it strips a redundant leading `0xff` (sign-extension) but never inserts a missing `00` needed to flip a value positive. That asymmetry is why prefixing `00` yourself is the only fix that works.

**6. dl-33 correction, reproduced.** `hexToBytes("fff")` → `0fff`, `hexToBytes("100")` → `0100`, `hexToBytes("abcde")` → `0abcde` — match the ticket's Log numbers exactly.

**7/8.** Done-when 3 (`npm run check`) taken as reported, not independently re-run — flagged unverified-by-me above. Ticket edit checked: `status: done`, dated Log entries with actual numbers, no `/tmp` paths cited (`grep -n "/tmp"` on the ticket file: no matches), commit subject validated with exit 0 via `node scripts/commit-message.mjs --text "fix(downloader): encode fixture certificate serials as positive integers (dl-36)"`.

No disagreement, nothing unresolved on my side.

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

- **2026-09-02** — Built on local `dl-36-orchestrated` (base had no remote;
  branched off the local ref rather than `origin/`). The encoding is now
  `fixtureSerialNumberHex`, exported from
  `tools/downloader/api/test/helpers/tls-origin.ts` and asserted in
  `test/helpers/tls-origin.test.ts`. The dl-21 comment at the call site is
  untouched.

  **The brief's reproduction table reproduces exactly, and its correction of
  dl-33 holds.** Both were re-run here before building rather than taken on
  trust: every row of the table matched byte for byte through
  `forge.asn1.toDer`, and `hexToBytes` does left-pad — `"fff"` → `0f ff`,
  `"abcde"` → `0a bc de`. The sign bit is the whole defect, as the ticket says.

  **Two things the brief did not have, both of which the fix depended on.**

  First, the fix only works because **forge's DER writer does not minimise the
  `00` prefix back off**: `derOf("0080")` is `02 02 00 80`, not `02 01 80`. That
  was the one way this fix could have silently not worked, and it is the reason
  the new test goes through forge's writer rather than asserting hex alone.

  Second, "Node's `X509Certificate` parses the certificates cleanly either way"
  is true only in the sense that nothing throws. It **reports the negative**:
  generating real certificates at counters 128/255/32768 gives
  `serialNumber = -80 / -01 / -8000` before the fix and `80 / FF / 8000` after.
  Cosmetic still holds — 9 call sites, per-process counter — but the defect was
  observable, not merely notional.

  And a consequence worth recording, because it is the collision the dl-21
  comment calls "wrong on its own terms" arriving by another route: under the
  old encoding **counters 255 and 65535 produce identical DER**, `02 01 ff`.
  Forge minimises the redundant leading `ff` of a negative integer, so two
  different counters become the same serial. Fixed encoding keeps them
  distinct (`00 ff` vs `00 ff ff`).

  **Red run, and exactly which one.** Acceptance line 1 was run two ways, since
  the extraction is itself part of the fix and "the unfixed source" is ambiguous
  once the function exists. Against the _literally_ unfixed file
  (`git checkout --` on the helper, new test kept) all 23 tests fail with
  `TypeError: fixtureSerialNumberHex is not a function` — a missing symbol, which
  proves nothing about encoding. So the meaningful red is the second: the
  extracted function with its **old body** restored
  (`counter.toString(16).padStart(2, "0")`), which fails 14 of 23 on values —
  `expected '80' to be '0080'`, `expected '020180' to be '02020080'`, and 41201
  violations in the sweep, first at 128. Both runs were executed; neither is
  reasoned.

  One outcome from that red is worth keeping, because it is the dl-33 correction
  restated as test results: counters **256, 4095 and 65536 fail only the
  even-length assertion and pass the DER round-trip**. The odd-length hex really
  is harmless, exactly as this ticket claimed against dl-33.

  **Nothing to fold in, and here is what was checked.**
  `api/src/tls-interception.ts:121-125` already prefixes `00` and its comment
  already states this rule — production code knew it; only the test helper did
  not. So the fix makes the helper consistent with an existing precedent rather
  than introducing one, and there is no second site to correct. `serialNumber`
  appears nowhere else in `tools/` or `packages/`.

  Sweep bound is 70000 rather than the table's 32768 so the second affected
  range (32768–65535) is covered on both sides.

  Gates, all green:
  `npx vitest run tools/downloader/api/test/helpers/tls-origin.test.ts` — 23
  passed, 2.0 s wall; `npx vitest run tools/downloader/api` — 18 files, 322
  passed, 35.3 s wall; `npm run check`; `npm run format`. Iteration was on the
  single spec rather than the directory throughout, which is the difference
  between 2 s and 35 s a run.

- **2026-09-02, after the gate** — Three fold-ins, none of which changes the
  code: the gate passed with zero findings and `dab661c` is untouched by this
  entry.

  **`Done when` 4's own citation was wrong, and the interesting part is why.**
  It read `tls-origin.ts:143-149`; the comment is **144-149**. Corrected above.
  Filing that as its own ticket would have cost an intake slot, a dispatch, a
  gate, a pull request and a merge for one digit, paid by someone with none of
  this context — this branch had the file open, so it was free here.

  But the mechanism is worth more than the digit. The **same ticket cites
  `150-151` for the assignment and that is exactly right** (at `1fe5a4d`, 150 is
  `serialCounter += 1;` and 151 is the `cert.serialNumber` line), and the author
  quoted the comment's _text_ accurately in the same paragraph. So the file was
  genuinely open and genuinely read. What went wrong was arithmetic: the comment
  is **exactly six lines** (`sed -n '144,149p' | wc -l` → 6), and the cited start
  is `149 - 6` — the end anchor minus the length, missing the `+ 1` an inclusive
  range needs.

  That prediction is exact, and it rules out the other obvious explanation: had
  the author cited the window they viewed through (`sed -n '143,151p'`, or a
  Read offset), the cited **end** would have been 151. It is 149. So the end was
  derived correctly from the known-good 150, and the start was computed backwards
  from it rather than read off the file.

  **The rule that generalises: cite what you read, never compute one citation
  from another.** A comment block is unusually exposed to this, because it has no
  unique symbol to anchor a `grep -n` on and so invites the subtraction. The text
  survived because it was copied; the number failed because it was derived.

  **The collision has a mechanism too**, and this is the reviewer's, reproduced
  in its words rather than paraphrased: `hexToBytes("ffff")` returns `ffff`
  unchanged, so the collapse to one byte happens inside `forge.asn1.toDer` itself
  when writing the INTEGER — "it strips a redundant leading `0xff`
  (sign-extension) but does _not_ insert a missing `00` needed to flip a value
  positive. That asymmetry is exactly why prefixing `00` yourself is the only fix
  that works." The 2026-09-02 entry above records the collision as an observed
  fact; this is why it happens, and it is the reason the fix could not have been
  left to the writer.

  **The citation checker passed and was still hiding three wrong citations**,
  which is the second thing worth carrying out of this ticket.
  `node scripts/citations.mjs <this ticket> --rev dab661c` reports **9/9
  resolve**. That is not a clean bill: this fix inserted 28 lines above the code
  the brief was written about, so the comment moved **144-149 → 170-175** and the
  assignment **150-151 → 176-177**. Every one of those citations still resolves
  under the pin — to a function signature and to an unrelated doc comment
  respectively. A dangling citation announces itself; one that lands on plausible
  neighbouring code does not, and that is the failure the script's own header
  calls "worse than a dangling one".

  So **the count is not the check**. Four of the nine citations have their
  referent in `1fe5a4d` rather than `dab661c`. Two were labelled with the sha
  they were written against; the other two are evidence for the off-by-one
  finding and were deliberately left wrong. Verifying the pin by comparing
  totals — 9/9 here, 9/9 after — would have shown no difference at any point in
  that work.

  **Who ran what, since the gate split one check.** `npm run check` was run by
  this session and not re-run by the reviewer; the full API suite, the red run
  and every numeric claim in the entry above were run by both of us
  independently and matched. The reviewer additionally measured the base
  (`1fe5a4d`) at 17 files / 299 tests against this branch's 18 / 322 — a delta of
  exactly the new file, which is the check this session had not thought to make.
