---
id: dl-33
tool: downloader
title: The egress proxy minted an unparseable certificate serial once in 512, and hung the CONNECT
kind: fix
status: done
milestone: null
depends_on: []
difficulty: hard
---

# dl-33 — `ERR_OSSL_ASN1_ILLEGAL_PADDING` under load, in two specs and on two platforms

> **Closed 2026-09-03 with two fixes. The framing below is wrong, and it is kept
> because the wrongness is the useful part.** The `title:` was wrong too and
> _was_ changed, on the gate's finding: a board scan reads frontmatter and never
> reaches this banner, so leaving it would have gone on advertising the
> disproven framing to everyone who did not open the file. The old title was
> "TLS fixture certificates fail to parse under contention, and it is not one
> test".
>
> It is not the fixtures, it is not contention, and it is not a race.
> `newSerial()` in `src/tls-interception.ts` — **production code, in the image**
> — put an unconditional `00` byte in front of sixteen random ones, which DER
> forbids whenever the first of those bytes is `0x00` and the second is under
> `0x80`. That is one certificate in 512, and the tool's own suite issues 133
> per run. "Only under contention" was an artefact: the throw lands inside a
> `secureConnect` handler, so the download hangs and the run pays a 120 s test
> timeout plus a 60 s hook timeout — **the failure is the slowness**, which is
> why every sighting is also a slow run.
>
> The second fix is the reason the first one took three sessions to find: that
> throw **escaped to `uncaughtException`** and nothing refused the CONNECT, so
> the only evidence anyone ever got was a timeout. The scope widened to cover it
> **by explicit user decision** — see the two Log entries of 2026-09-03.

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

> **Retried 2026-09-03, and it went green** (job `33348060111`, success, 22:06),
> run by the coordinator rather than relayed. That closes Option D's "not yet
> known to work" caveat at n=1: it proves a re-run _can_ clear the failure, not
> that one always will, and it says nothing about the rate. It is also
> consistent with what the mechanism predicts — a fresh run redraws every
> serial, so a 1-in-512 draw does not recur.

The failing job in sighting 3 **has not been re-run**. `gh run rerun` was refused
with `Resource not accessible by personal access token` — a token scope limit in
this environment, not a deny rule. I did not re-test that refusal myself, because
triggering CI on another branch's pull request is not this session's to do.

**So whether the failure clears on a re-run is unknown, not resolved**, and it is
the first thing the assignee should find out. It matters directly to the options
below: "accept it and re-run on red" is only viable if a re-run actually clears
it, and nobody has established that.

## Hypotheses

> **Corrected 2026-09-03. The first bullet below is wrong, and it is the answer.**
> The serial number was ruled out twice, by two sessions working independently,
> and both disproofs were sound about the code they looked at and one test case
> short of the defect. What is preserved below is what each of them measured;
> what it concluded is superseded by the Log entry of 2026-09-03. **The bug is
> `newSerial()` in `src/tls-interception.ts`, not the test fixtures.**

Named as hypotheses. One has been tested and is **ruled out** — recorded so the
next person does not spend the same hour.

- **Ruled out, wrongly: the serial number.** `createFixtureCertificate` sets
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
- **Ruled out, and this time by a reproduction: a PEM read while empty or
  truncated.** The two sightings that name a parse site name an _in-memory_ one
  — `tls-interception.test.ts`'s `leafOf` helper, and the `new tls.TLSSocket({
cert })` in `egress-proxy.ts` — neither of which reads a file. The original
  wording is kept below because it is what sent the leading hypothesis in the
  wrong direction. **`ERR_OSSL_ASN1_ILLEGAL_PADDING` is not what a truncated PEM
  produces**: a cut base64 body gives a length overrun, not a malformed
  `INTEGER`. Original text:

- **Was: still open: a PEM read while empty or truncated.** The OpenSSL stack says
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

## Review

**Gate: PASS** — 2026-09-03 · `origin/main...b48caf7` · self-run defect hunt at medium (ticket-reviewer subagent; no `Skill`/`Agent` tool available, hunt run directly)

**Every `file:line` below resolves against `b48caf7`, the commit gated — not
against the branch tip.** The guard commit that follows moves three of them, and
they are left as written because they are the reviewer's evidence for what it
ran: `node scripts/citations.mjs … --rev b48caf7` is how to check them. The
table after the record resolves each one forward.

| Done when                                                                        | Proof                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. The decision is recorded, naming the option taken and why the others were not | **verified** — Log, 2026-09-03 entry: Option A taken; B/C/D reasoned against                                                                                                                              |
| 2. Whether run `33348060111` clears on a re-run is recorded either way           | **verified** — "Not retried" banner: retried 2026-09-03, job `33348060111` green, 22:06                                                                                                                   |
| 3. If a fix lands, the failure is reproduced first, red before green             | **proven** — `tls-interception.test.ts:242-243` (leaf-level, production call site), `:260-264` (encoding boundaries); independently reproduced by the reviewer at both unit and integration level (below) |
| 4. If no fix lands, closes `dropped`                                             | N/A — a fix landed                                                                                                                                                                                        |

- **Core claim verified against real forge + real OpenSSL, not the builder's re-implementation of the strip rule.** Signed actual certificates at the four named boundary draws and parsed each via `tls.createSecureContext` + `X509Certificate`: `00 00 7b…` → threw `ERR_OSSL_ASN1_ILLEGAL_PADDING` (predicted illegal, confirmed); `00 00 ab…`, `00 7b…`, `00 80…` → all parsed (predicted fine, confirmed). The thrown error's `opensslErrorStack` matches the ticket's quoted sighting-3 stack exactly.
- **`positiveDerIntegerHex` verified correct** at `0x80` exactly, all-zero input (→ `"00"`, not zero-length), and the 16-byte-`0xff` worst case (→ 17 bytes, never negative, never over-long); every case round-tripped through real signing + parsing cleanly.
- **The 2M-draw substitution judged sound**: its strip-rule assumption matches real forge at all four tested boundaries. Independently checked the derived arithmetic: `1-(511/512)^133 = 0.2290`, matching the claimed ≈23% upper bound; CI's observed 2/23 ≈ 8.7% sits under it as claimed.
- **Unit-level red/green reproduced independently**: 12 tests green at `b48caf7` (1.96–1.99s). Reverting `positiveDerIntegerHex`'s body to the pre-fix unconditional-`00` logic reproduces the red at `tls.createSecureContext` (tls-interception.test.ts:242) with the exact OpenSSL error.
- **Integration-level reproduction, both directions, is the strongest evidence on the branch.** Forcing every serial draw to the defect shape in `two-origin-tls.test.ts`: fixed source → 9/9 green, 4.01s (positive control, matches the builder's 3.9s); reverted source → 3 failed, **15 unhandled `ERR_OSSL_ASN1_ILLEGAL_PADDING`**, hook timeout at `afterAll:131`, three test timeouts, the named failure exactly `"the same download succeeds when the proxy trusts both origins"` (sighting 3's own case), file duration **421.44s** (matches the builder's 421s), stack naming `egress-proxy.ts:624:23` exactly.
- **Refuted premises confirmed by code reading**: `createFixtureCertificate`'s serial path (`fixtureSerialNumberHex`, dl-36) is unrelated to `newSerial()`; both cert-parse sites are in-memory PEM with no file read at the parse boundary, so the truncated-PEM hypothesis cannot reach either.
- **low** · `positiveDerIntegerHex` (`tls-interception.ts:147-150`) and `fixtureSerialNumberHex` (`test/helpers/tls-origin.ts:125-129`) restate the same DER-positive-integer rule in two packages, undeduplicated. Disclosed and reasoned about in the Log; accepted as a reasonable trade — in-tool duplication between `src` and a test-only fixture helper, each already independently tested, not the cross-tool sharing the repo's "packages/ on second consumer" rule targets.
- **low** · the ticket's `title:` frontmatter is stale relative to the corrected root cause ("…fail to parse under contention, and it is not one test", while the body's own banner says it is none of those things), and `npm run status`/the board render titles from frontmatter rather than the body. Two remedies, not resolved here: leave it (consistent with "the wrongness is the record" for the rest of `## Why`) or update `title:` to name the actual defect while keeping the banner. Left as the ticket author's call.
- **dropped** · none — everything the hunt turned up is carried above.
- **findings** · self-run hunt found 2; both carried, 0 dropped.
- NFR: security n/a · performance n/a · reliability ✓ (this is the fix, and the best-substantiated part of the branch) · maintainability — the one duplication above is the only ding.
- **Out of scope for this gate, noted for context**: the unhandled-error escape at `egress-proxy.ts:614-628` (real and general — confirmed independently, not specific to this ASN.1 error) and whether `options.onFailed` is reachable from it (it is not, confirmed independently) were surfaced during this exchange but concern a _separate_, not-yet-committed guard the user has asked to fold into this same branch as a follow-up commit. That commit is unbuilt as of this gate and needs its own narrow review against the delta; it does not affect the verdict on `b48caf7` above.

### Citations re-resolved against the guard commit

The record above is the reviewer's, pasted unaltered — including its line numbers,
which were correct for `b48caf7` and are the evidence for what it ran. The guard
commit moves three of them and one was already wrong, so they are resolved here
rather than edited in place, since rewriting a reviewer's measurements would
destroy the thing they are for.

| cited                                   | at `b48caf7`                                                      | at this tip    | note                                                                                                                                                                                                                                 |
| --------------------------------------- | ----------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `egress-proxy.ts:624:23`                | the `new tls.TLSSocket(clientSocket, …)` the uncaught stack named | **`:718`**     | the guard moved it below a pre-built `SecureContext`                                                                                                                                                                                 |
| `egress-proxy.ts:614-628`               | the `secureConnect` handler                                       | **`:681-723`** | same commit; the handler grew the guard                                                                                                                                                                                              |
| `tls-interception.test.ts:242-243`      | the `createSecureContext` assertion                               | **`:242`**     | one line, not two — `oxfmt` collapsed it before `b48caf7` was committed, so this was a half-line-stale citation rather than a moved one                                                                                              |
| `two-origin-tls.test.ts` `afterAll:131` | —                                                                 | **`:123`**     | **wrong at `b48caf7` too.** `afterAll` is at line 123, which is also what the ticket's own sighting-3 quote says (`Hook timed out … ❯ two-origin-tls.test.ts:123:1`). The finding it supports is unaffected; only the number was off |
| `tls-interception.ts:147-150`           | `positiveDerIntegerHex`                                           | `:147-151`     | unmoved; the closing brace is 151                                                                                                                                                                                                    |
| `test/helpers/tls-origin.ts:125-129`    | `fixtureSerialNumberHex`                                          | unchanged      | unmoved                                                                                                                                                                                                                              |
| `tls-interception.test.ts:260-264`      | the encoding-boundary assertions                                  | unchanged      | unmoved                                                                                                                                                                                                                              |

Both **low** findings are settled rather than left open. The duplication is
accepted, on the reviewer's own reasoning. The stale `title:` **was updated** —
the body keeps its wrongness because the body is the record of an investigation
that went wrong twice, but a frontmatter title is an index entry rather than a
record, and `npm run status` renders it to readers who never open the file.

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

- **2026-09-01** — **A second, independent disproof of the serial-number
  hypothesis**, from dl-29's builder, who hit this without knowing dl-33 existed
  and arrived at the same suspect from the other direction. Recorded so nobody
  spends a third session on it.

  Sighting: `tls-interception.test.ts > two targets get two certificates and one
key` failed once in three consecutive full `npm test` runs on this devcontainer
  (Linux, not Windows), `Error: error:068000DD:asn1 encoding routines::illegal
padding` out of `new X509Certificate(...)` at the spec's own `leafOf` helper.
  It passed in isolation immediately after, and passed on the next two full runs.
  So: **a fifth sighting, and the second on Linux**, which further weakens the
  Windows-only framing this ticket already discarded.

  The hypothesis, reached independently: `newSerial()`
  (`tools/downloader/api/src/tls-interception.ts:116-121`) prefixes `00` onto
  sixteen random bytes to keep the DER INTEGER positive, so a draw whose _first_
  random byte is itself `0x00` yields two leading zero bytes — redundant leading
  zeros being precisely what "illegal padding" names. P(1/256) per serial also
  fits the observed rarity, which is what made it attractive.

  **It is wrong.** Three measurements, none of them a re-run of dl-33's:

  1. 400 leaves from one interception, parsed through `X509Certificate` —
     0 rejected.
  2. 60 fresh interceptions (fresh root, fresh key each), 2 leaves apiece —
     0/120 rejected.
  3. The decisive one, because the first two only sample: forge driven directly
     with three _chosen_ serials rather than waiting on a 1-in-256 draw —
     `00` + `ff…` (high bit set), `00` + `7f…` (high bit clear, so a redundant
     leading zero), and `00` + `00` + `ab…` (two leading zero bytes, the exact
     hypothesised case). **All three parse.** forge normalises on write, so the
     `00` prefix cannot produce this error at all.

  That is a different method from dl-33's 13 counter values and it reaches the
  same verdict, so the serial number is now ruled out twice over from two
  directions. 520 leaf generations across the two sampling scripts did not
  reproduce the failure by any means, which is itself evidence: whatever this is,
  it does not live in leaf generation on a quiet machine. The contention framing
  in this ticket's Build section survives dl-29's data; the serial framing does
  not, and should not be revisited.

  dl-29 did not fix it and did not widen into `tls-interception.ts`. It has no
  reproduction to offer beyond the above.

- **2026-09-01** — **A contention measurement, from dl-29's branch.** Same
  session as the disproof above, and the first direct wall-clock evidence for
  this ticket's framing rather than for what it is not.

  `npm test -- --project downloader` failed on `two-origin-tls.test.ts` — this
  ticket's own file — with `ERR_OSSL_ASN1_ILLEGAL_PADDING`, plus
  `Hook timed out in 60000ms`, `Test timed out in 120000ms` and four unhandled
  errors of the same ASN.1 kind. The named case was "the same download succeeds
  when the proxy trusts both origins". **That run took 185 s.**

  The immediate re-run — same commit, same machine, no change of any kind between
  them — passed **900/900 in 37.6 s**.

  A 5× wall-clock difference between a failing and a passing run minutes apart,
  on an otherwise idle developer container, is the strongest signal I have for
  contention being the mechanism. It also explains why the leaf-generation probes
  recorded above found nothing across 520 attempts: they ran on a quiet machine,
  one certificate at a time, which is the condition under which this does not
  reproduce.

  A cheap next step for whoever picks this up, offered rather than taken: try to
  force it by running the downloader project under artificial CPU load rather
  than by generating more certificates. This ticket's Done-when 3 already asks
  for the failure to be reproduced "under artificial contention if necessary" —
  the numbers above are a reason to start there rather than treat it as a
  fallback.

  Not measured: which resource is contended. No profiling was done, and "5×
  slower" is consistent with CPU, I/O or scheduler pressure alike.

- **2026-09-03** — **Fixed. Option A, and the race does not exist.**

  The decision, recorded as Done-when 1 asks. **Option A was taken and it
  landed**, inside one bounded round. B was not taken because raising a timeout
  hides the half of the symptom that is not the error; C was not taken because
  sighting 4 was on Ubuntu, so quarantining the Windows matrix does not help and
  costs the coverage dl-19 and dl-27 most depend on; D was the agreed fallback
  and is not needed. **The failure it accepts was never intermittent in the way
  the ticket assumed** — it is a 1-in-512 draw, not a race, and there is nothing
  about it a re-run fixes except by redrawing.

  **The defect.** `newSerial()` in
  [`api/src/tls-interception.ts`](../../api/src/tls-interception.ts) returned
  `` `00${bytesToHex(forge.random.getBytesSync(16))}` ``. A DER `INTEGER` is
  signed and two's-complement: the leading `00` is **required** when the first
  content byte has its high bit set and **forbidden** when it does not, and a
  redundant one is `ASN1_R_ILLEGAL_PADDING` — reason `0xDD`, which is
  `068000DD`, which is the error in every sighting on this ticket.

  forge does normalise, and that is exactly why this survived two disproofs:
  `asn1.toDer` strips **one** redundant leading byte and carries the comment
  `TODO: should all leading bytes be stripped vs just one? .. ex '00 00 01' =>
'01'?`. So the draw that gets through illegal is the one where forge's single
  strip is not enough: **first random byte `0x00`, second under `0x80`**. That
  is `1/256 × 1/2`. Measured over 2,000,000 draws: **3,918 illegal, 1 in
  510.5.** Instrumented, one `npm test -- --project downloader` issues **133**
  serials, so ≈ 23% of runs draw at least one — an upper bound, since a bad
  serial only shows when something parses it, and CI's observed 2-in-23 sits
  under it.

  **Why the two earlier disproofs missed it, precisely.** Neither was sloppy and
  both are worth keeping.

  1. dl-33's own (13 counter values) tested `createFixtureCertificate`, whose
     serial is a small counter with no leading zero byte. It could not have
     found this: **the defect is not in the fixture helper at all.** The ticket's
     "the shared surface is `createFixtureCertificate`" is the one inference in
     the brief that does not hold. The real shared surface is `newSerial()`, and
     both named specs reach it — `tls-interception.test.ts` directly, and
     `two-origin-tls.test.ts` through `startFfmpegProxy` → `createTlsInterception`.
  2. dl-29's third measurement was the right method — chosen serials rather than
     sampling — and picked `00` + `00` + `ab…`. `0xab` has its **high bit set**,
     so forge's one-byte strip leaves `00 ab…`, which is legal, and it parsed.
     It was one case short: `00` + `00` + `7b…` does not. Reproduced here, with
     both cases side by side, and its conclusion "forge normalises on write" is
     true but not sufficient.

  **Where it lands, and why it looked like load.** Not the fixtures: the throw
  is at `egress-proxy.ts`'s `new tls.TLSSocket(clientSocket, { isServer: true,
key, cert })`, which arms an intercepted CONNECT — **synchronously, inside a
  `secureConnect` handler**. So it is an unhandled error rather than a failed
  download, the CONNECT never completes, ffmpeg waits, and the run pays a 120 s
  test timeout and then a 60 s hook timeout in `afterAll` while cleanup blocks
  on a stuck socket. `120 + 60 = 180`; sighting 3's file took **182 s**, and
  dl-29's contention sighting took 185 s against 37.6 s for the re-run. **That
  5× is the timeout, not the machine.** The contention framing has the causal
  arrow backwards, and the ticket's advice to force it with artificial CPU load
  would have wasted the session.

  **The reproduction, forced rather than waited for**, because a ~9% failure
  cannot be shown fixed by a green run. All on this devcontainer, at
  `91c117b`, in a worktree with `node_modules` farmed and `dist` built.

  | run                           | what                                                                | result                                                                                                                                                                                                                       |
  | ----------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | unit, unfixed source          | new test, RNG stubbed to the `00 7b…` draw                          | **red** at `tls.createSecureContext({ cert: leaf.cert, key: leaf.key })` — the production call site copied verbatim — with `error:068000DD:asn1 encoding routines::illegal padding`                                          |
  | unit, fixed source            | same test                                                           | green, 12 tests, 1.9 s                                                                                                                                                                                                       |
  | integration, unfixed encoding | `two-origin-tls.test.ts` with **every** serial forced to that shape | **red, and the whole CI signature**: `Hook timed out in 60000ms`, three × `Test timed out in 120000ms`, 15 unhandled `ERR_OSSL_ASN1_ILLEGAL_PADDING` whose `opensslErrorStack` is byte-for-byte sighting 3's, file **421 s** |
  | integration, fixed encoding   | same forcing                                                        | green, 9 tests, **3.9 s**                                                                                                                                                                                                    |

  The last two are the same file on the same machine minutes apart, and the only
  difference is the encoding. 421 s → 3.9 s is the timeout disappearing.

  **The fix.** `positiveDerIntegerHex` strips leading zero bytes first and only
  then re-prefixes one when the high bit is set. Stripping before prefixing is
  what makes it idempotent under forge's own one-byte strip — a minimal encoding
  survives that pass unchanged, which is the property the round-trip test rests
  on. Exported so the encoding can be asserted directly; the same reason dl-36
  exports `fixtureSerialNumberHex`.

  **This was a production defect, not a test defect.** `newSerial()` is in
  `api/src`, `node-forge` is a runtime dependency since dl-27, and the code path
  is a real download through the egress proxy. One CONNECT in 512 to a
  not-yet-seen host would hang until a timeout, with an unhandled error in the
  log and no `AppError`. Nothing in the ticket suggested that, because it was
  filed as a flaky test.

  **Not done, and stated rather than inferred.**

  - **Not run on Windows.** Two of the five sightings are Windows and this
    container is Linux. The mechanism is OpenSSL's DER decoder and forge's
    encoder, neither platform-specific, and sighting 4 and dl-29's are on Linux
    — but "the Windows sightings are the same bug" is an inference, not a
    measurement. The only thing that settles it is the failure not recurring.
  - **Not proven to be the only cause.** Every sighting on this ticket is
    `ERR_OSSL_ASN1_ILLEGAL_PADDING` and this explains that error completely, at
    a rate that brackets the observed one. It does not rule out a second,
    rarer defect wearing the same timeout.
  - **The fourth hypothesis is untouched**: an orphaned child holding a port on
    Windows. It was offered as an explanation for the _timeout_, and the timeout
    now has one, so there is nothing left pointing at it — but nothing here
    tested it either. **Do not file it**; it has no reproduction.
  - **`fixtureSerialNumberHex` was not folded into the new helper**, though it
    now states the same rule twice in two packages. It could have been: they
    differ only in taking a counter rather than bytes. It was not, because
    dl-36 already made it correct and it is asserted by its own tests, so the
    change would be churn in a file this defect never touched — and a test
    helper importing an encoder out of `src` to save four lines is the wrong
    trade. Recorded so the duplication is a decision rather than an oversight.

- **2026-09-03** — **A second fix, and the scope widened by explicit user
  decision rather than by a builder exceeding its brief.**

  **The question, the answer, the reason.** Fixing the serial exposed something
  the Build never asked for: the throw it caused **escaped to
  `uncaughtException`**, so the CONNECT was never refused and the only symptom
  anyone ever saw was a timeout. That is true of _any_ certificate failure at
  that site, not just this one. Offered as three options — file it, fold it in,
  or leave it — with the cost of folding stated plainly: it widens dl-33 past
  its Build and puts an error-path change into a security-adjacent file whose
  value right now is being narrow and proven. **The user chose to fold it in.**
  The builder and the coordinator had both recommended filing it; recorded so
  the disagreement is visible rather than smoothed over.

  **Two guesses at the mechanism were wrong before one was right, and both were
  caught by measurement rather than by review.**

  1. _"Route the failure to `options.onFailed`."_ — the builder's own wording,
     relayed as an instruction without either party checking it. Wrong.
  2. _"`onFailed` is unreachable: it is wired to `secure`'s `error` event and the
     throw is in the `secureConnect` handler, so nothing routes it there."_ — the
     gate's correction. Also wrong, and in a way that mattered: it implies a
     **new reporting path** is needed.

  **What is actually true, measured.** The callback is perfectly reachable from
  inside the `secureConnect` handler — it is a parameter in lexical scope. What
  breaks is the **order**. `options.onEstablished()` runs six lines above the
  throw and sets the caller's `settled`, and `fail()` opens with
  `if (settled) return`. A probe placed in the callback printed
  `PROBE-ENTERED settled=true`: the callback **was entered** and the report was
  then swallowed, no 502 written, the CONNECT still hanging. Worse if `settled`
  had been false, since line 618 has already written
  `HTTP/1.1 200 Connection Established` and a 502 would then go into an open
  tunnel — the exact hazard `settled`'s own comment says it exists to prevent.

  So the fix is **not a new path, it is the existing one moved above the point
  of no return** — which is `terminateTls`'s own stated principle ("The order is
  the point. The origin handshake completes **before** the client is told
  `200`") applied to the second fallible step. The leaf is minted and its
  `SecureContext` built inside a `try`/`catch` before `onEstablished()`; the
  ready-made context is then handed to `new tls.TLSSocket`, which relocates the
  build rather than adding one.

  **No new error code.** `INTERNAL` from `@webtools/core` already means "this
  service is broken", and `runFfmpeg` uses it for the same shape of fault — its
  binary would not start. Nothing here is about video, so nothing belongs in the
  downloader's half of the taxonomy.

  **A fourth outcome, because three were not enough.** `connectFailed` split a
  socket failure three ways — policy refusal, dead network, bad origin
  certificate — and all three describe _the target_. This one describes us.
  Filing it as `unreachable` says the packets went nowhere; filing it through
  `refused` prints `refused … INTERNAL`, which that function's own comment names
  as the line that sends a reader into `ssrf.ts`. Those are the two misreadings
  that cost this ticket three sessions, so it gets `InterceptionLeafError`, its
  own branch, and `logger.error` rather than `warn` — the only one of the four
  that is a service defect rather than a fact about a target.

  **The reason phrase is load-bearing and was chosen against a regex.** ffmpeg
  echoes a proxy's status line and `isTlsVerificationFailure` reads it back out
  of stderr, requiring `/certificate/` **and** a verification word. "Proxy could
  not issue a certificate" has the first and not the second, so this fails as
  itself instead of being reported as a rejected origin. Pinned by a test that
  also asserts dl-27's real phrase still matches, so it is a discrimination and
  not a regex that quietly stopped working.

  **Red then green, at the socket and through ffmpeg.**

  | run                                                                                                | result                                                                                                                                                                                                                                                                         |
  | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | new socket tests, guard absent                                                                     | **red as the symptom, not as an assertion**: `connectThrough` times out, `afterEach` hook times out at 60 s, and **two uncaught exceptions escape** — `ERR_OSSL_PEM_BAD_BASE64_DECODE` at `egress-proxy.ts:624` and a plain `Error: no leaf for you` at `:623`. File **131 s** |
  | same tests, guard present                                                                          | green, 26 tests, **3.0 s**                                                                                                                                                                                                                                                     |
  | `two-origin-tls.test.ts`, serial encoding reverted **and** every draw forced illegal, guard absent | 421 s, 3 test timeouts, 1 hook timeout, **15 unhandled errors**                                                                                                                                                                                                                |
  | the same, guard present                                                                            | **1.9 s, zero unhandled errors, zero timeouts.** Three honest assertion failures: the tests expecting `TLS_VERIFICATION_FAILED` get `DOWNLOAD_FAILED`, because a leaf we could not issue is correctly _not_ reported as a rejected origin                                      |

  The last pair is the whole case for this commit: same broken certificates,
  same file, **421 s to 1.9 s**, and a diagnosis that names the cause instead of
  a timeout that names nothing.

  **The third distinct OpenSSL error is the generality evidence.** dl-33's own
  is `ILLEGAL_PADDING`; the gate reproduced `PEM routines::no start line`
  independently; the red run above produced `PEM routines::bad base64 decode`.
  Plus a plain `Error` thrown from minting, which is not a certificate-loading
  failure at all. The guard covers both fallible steps, and a test asserts the
  mint case precisely so a guard that covered only the load could not pass.

  **Not done.** No Windows run, same as the first fix. The guard is not proven
  to be the _only_ unguarded synchronous throw in a socket event handler in this
  file — it is the only one dl-33 has evidence for, and a sweep for others was
  not in scope and is not filed, because a sweep with no reproduction is how the
  first three sessions went.
