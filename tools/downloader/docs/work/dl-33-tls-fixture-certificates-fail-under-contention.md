---
id: dl-33
tool: downloader
title: TLS fixture certificates fail to parse under contention, and it is not one test
kind: fix
status: ready
milestone: null
depends_on: []
---

# dl-33 — `ERR_OSSL_ASN1_ILLEGAL_PADDING` under load, in two specs and on two platforms

## Why

CI has an intermittent failure that blocks merges and clears on its own. It was
reported as one flaky test — `two-origin-tls.test.ts`, the case
`"the same download succeeds when the proxy trusts both origins"` — but checking
the sightings shows a wider shape, and filing it as one test would send the next
agent to the wrong file.

**Every sighting shares one error: `ERR_OSSL_ASN1_ILLEGAL_PADDING`**, a
certificate _parsing_ failure. It has now been seen in **two different specs**,
on **two different operating systems**, and in both cases only when the machine
was busy. What the two specs share is
[`api/test/helpers/tls-origin.ts`](../../api/test/helpers/tls-origin.ts)'s
`createFixtureCertificate`.

The spec belongs to [dl-27](./dl-27-verify-segment-origins.md), which added the
failing case. Filed alongside [dl-32](./dl-32-the-job-list-has-no-caller.md) from
dl-23's gate rounds; the two are unrelated except in provenance.

## The reproduction

Four sightings. Numbers 3 and 4 were verified directly against the GitHub
Actions logs while writing this; 1 and 2 are relayed from repo-5's session and
are marked as such.

**1 — Local, under load (relayed).** repo-5's builder, during a 187-second
full-project run with three sibling agents on the same box:
`Hook timed out in 60000ms`, `Test timed out in 120000ms`, and four
`ERR_OSSL_ASN1_ILLEGAL_PADDING` errors. The spec then passed alone in 4.4 s, and
a full re-run of the project was green in 40 s.

**2 — Five attempts that could not reproduce it (relayed).** repo-5's gate ran
the spec alone three times at its branch tip and twice at `origin/main`, all
green, plus the full downloader project and full `npm test` green at both
commits. It called this _"reproduced-then-not"_ rather than "unrelated", which
sighting 4 vindicates.

**3 — CI, Windows, `two-origin-tls.test.ts` (verified).** Run
[33348060111](https://github.com/brunolabbe/tools/actions/runs/33348060111), PR
#121, branch `pl-36` at `fc91c93`. `test (windows-latest)` failed;
`test (ubuntu-latest)`, `check`, `planner`, `security` and `pr-title` all passed.
The same three-part signature as sighting 1, and **four**
`ERR_OSSL_ASN1_ILLEGAL_PADDING` errors again:

```
❯ tools/downloader/api/test/two-origin-tls.test.ts (9 tests | 1 failed) 182005ms
  × the same download succeeds when the proxy trusts both origins  120007ms
Error: Hook timed out in 60000ms.        ❯ two-origin-tls.test.ts:123:1
Error: Test timed out in 120000ms.       ❯ two-origin-tls.test.ts:360:3
Error: error:068000DD:asn1 encoding routines::illegal padding
Serialized Error: { opensslErrorStack: [ 'error:0488000D:PEM routines::ASN1 lib',
  'error:0688010A:asn1 encoding routines::nested asn1 error', … ] }
```

`pl-36` touches 12 files and **all 12 are under `tools/planner/`**, so it cannot
be a regression from that branch.

**4 — CI, Ubuntu, a _different_ spec (verified, and new).** Run
[33335732729](https://github.com/brunolabbe/tools/actions/runs/33335732729), on
`release-please--branches--main--components--downloader`. `test (ubuntu-latest)`
failed in **`tls-interception.test.ts`**, case
`"it chains to the root, which is what a client with only the root can check"`,
with the same `ERR_OSSL_ASN1_ILLEGAL_PADDING` — while `two-origin-tls.test.ts`
passed in that same run, 9 tests in 2.2 s.

This sighting is why the ticket is not about one test. `tls-interception.test.ts`
imports `createFixtureCertificate` from the same helper. Two specs, two operating
systems, one error.

### Frequency

Counted over CI runs at or after `ec1dd6b` (dl-27's merge, which took the spec
from 6 tests to 9), excluding cancelled runs: **2 failures in 23 runs, ≈ 9%**.
Both failures are `ERR_OSSL_ASN1_ILLEGAL_PADDING`; there were no other CI
failures in the window. `main` itself: 4 runs, 0 failures.

Before that merge the spec ran 6 tests in ~12 s on Windows. In sighting 3 it ran
9 tests and the _file_ took 182 s. Whether dl-27's tests introduced a defect or
merely made an existing one likely enough to see is open, and is the first thing
worth settling.

### Not retried

The failing job in sighting 3 **has not been re-run**. `gh run rerun` was refused
with `Resource not accessible by personal access token` — a token scope limit in
this environment, not a deny rule. I did not re-test that refusal myself, because
triggering CI on another branch's pull request is not this session's to do.

**So whether the failure clears on a re-run is unknown, not resolved**, and it is
the first thing the assignee should find out. It matters directly to the options
below: "accept it and re-run on red" is only viable if a re-run actually clears
it, and nobody has established that.

## Hypotheses

Named as hypotheses. One has been tested and is **ruled out** — recorded so the
next person does not spend the same hour.

- **Ruled out: the serial number.** `createFixtureCertificate` sets
  `cert.serialNumber = serialCounter.toString(16).padStart(2, "0")` from a
  module-level counter. That looked like the answer — `padStart(2, …)` leaves an
  odd-length hex string for counters 256–4095, and sets the DER INTEGER's high
  bit for 128–255 — and a worker handling more files under load would climb past
  those thresholds, which would explain "only under contention". **It does not
  reproduce.** Generating certificates at counters 1, 15, 16, 127, 128, 129, 200,
  255, 256, 257, 4095, 4096 and 32768 and parsing each with Node's
  `X509Certificate` gives a clean parse every time. It did surface a real but
  cosmetic wart: counters 128–255 and 32768+ produce _negative_ serials (`-80`,
  `-01`, `-8000`), which RFC 5280 forbids. Worth fixing on its own terms; not
  this bug.
- **Not supported by the code: fixture files colliding across workers.** Each
  certificate gets its own `fs.mkdtemp` directory, so there is no shared path for
  two workers to race on. A `cleanup()` racing a reader would give `ENOENT`, not
  an ASN.1 error.
- **Still open: a PEM read while empty or truncated.** The OpenSSL stack says
  `PEM routines::ASN1 lib` followed by nested ASN.1 errors, which is what parsing
  an incomplete PEM looks like. Where a PEM crosses a boundary without an
  intervening `await` on the write is the place to look — including the
  interception root CA in `tls-interception.ts`, which is the common element in
  sighting 4.
- **Still open: an orphaned child holding a port on Windows.** The hook that
  times out is `afterAll` (line 123), not `beforeAll` — verified from the stack
  in sighting 3. A cleanup blocking for 60 s fits this repo's own standing rule
  that a bare `child.kill()` orphans children on Windows and `taskkill /T /F` is
  required. This would explain the timeout half but not the ASN.1 half, and
  sighting 4 was on Ubuntu, so at most it is a second, separate problem.

## The decision this ticket must force

An intermittent CI failure at roughly 9% is a real tax on every branch, and the
four options are not equivalent. **This is the user's call and is deliberately
not ranked**, because it turns on how much the team is willing to spend chasing
a bug that has already resisted five reproduction attempts.

**Option A — find and fix the underlying race.** Settle the open hypotheses
above, starting with whether a PEM is read before its write completes.
_Cost:_ open-ended. It has failed to reproduce on demand five times, so this may
mean instrumenting CI and waiting for it, which is slow and frustrating. It is
also the only option that actually removes the failure.

**Option B — raise the timeouts.** `SLOW` is 120 s and the hook limit is 60 s.
_Cost:_ cheap and dishonest. It would hide the timeout half and do nothing about
`ERR_OSSL_ASN1_ILLEGAL_PADDING`, which is the error that actually recurs, and a
longer timeout on a 182-second file makes a red build slower to discover.

**Option C — quarantine the affected specs from the Windows matrix.**
_Cost:_ Windows is where dl-19's and dl-27's process-tree and trust-store work is
most likely to break, so it removes coverage exactly where it is most load-
bearing. It also does not help: sighting 4 was on Ubuntu.

**Option D — accept it and re-run on red.**
_Cost:_ roughly one wasted CI cycle per eleven runs, paid by whoever is merging,
plus the standing cost of a suite people stop trusting. **And it is not yet known
to work** — see "Not retried" above.

## Build

Nothing until the decision is taken. Whichever way it goes, step one is the same
and is worth doing regardless: **re-run job `33348060111` and record whether it
goes green**, because that single fact separates Option D from a dead end and
narrows the hypotheses.

Traps worth knowing in advance:

- **Do not scope this to `two-origin-tls.test.ts`.** Sighting 4 is a different
  spec. The shared surface is `createFixtureCertificate`, and a fix that only
  touches the one spec will look like it worked.
- **The afterAll hook is the one that times out**, not the setup. Reading the
  beforeAll first is the natural mistake.
- **`SLOW` is a per-test timeout of 120 s and the hook limit is 60 s.** The file
  took 182 s on Windows in sighting 3, so any instrumentation added here has to
  fit inside a budget that is already close to its ceiling.

## Done when

1. The decision above is recorded, naming the option taken and why the others
   were not.
2. Whether run `33348060111` clears on a re-run is recorded either way.
3. If a fix lands: the failure mode is reproduced first — under artificial
   contention if necessary — so the fix is verified against a red test rather
   than against a run that happened to pass.
4. If no fix lands: the ticket closes `dropped` with the reasoning, rather than
   sitting open as a known-bad the board slowly stops reading.

## Log

- **2026-08-31** — Filed at the user's request, from three sightings relayed by
  the coordinator. Two of those were verified directly against the Actions logs
  while writing this, and doing so turned up a **fourth**: run `33335732729`,
  `tls-interception.test.ts` on **Ubuntu**, same `ERR_OSSL_ASN1_ILLEGAL_PADDING`,
  in a run where `two-origin-tls.test.ts` passed. That is what moved the ticket
  from "one flaky test" to "the certificate fixture helper", and it is why the
  Windows-only framing in the original report does not hold.

  Also established while writing: the failing case was introduced by `ec1dd6b`
  (dl-27), the spec went 6 tests → 9 there, and the same file on the same
  Windows runner went ~12 s → 182 s across that merge. The frequency was
  recomputed over that window rather than taken as given — 2 in 23, which lands
  close to the ≈8% originally relayed but for a broader failure class than one
  test.

  One hypothesis was tested and ruled out rather than written down as a
  suspicion; see above. The negative serial numbers it turned up are real and
  should be fixed whenever someone is next in that file, but they are not this.
