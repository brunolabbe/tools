---
id: lg-57
tool: ledger
title: Refuse C1 controls and zero-width characters in a member's address
kind: fix
status: done
milestone: null
depends_on: [lg-52]
difficulty: standard
---

# lg-57 — Refuse C1 controls and zero-width characters in a member's address

## Why

lg-52 refuses the C0 controls (`\u0000` to `\u001f`) and DEL (`\u007f`) in a
member's address, in `CONTROL` in `api/src/directory.ts` (the check
`readAddress` makes after `ADDRESS_SHAPE`), and leaves a wider set
to this ticket on purpose: its Build item 2 says the floor is C0 and DEL only,
and its Decision section records the owner's answer to how wide the refusal is.
The set left is the C1 controls (`\u0080` to `\u009f`) and the zero-width
characters (`\u200b` to `\u200d`, and `\ufeff`). None of them is visible in a
member list or an email client, and no Access token can be expected to carry
one, so an address that holds one is a directory row nobody can sign in as, the
same outcome lg-52 describes for a NUL.

lg-52's gate 1 found that `readAddress` accepts two of them today, in its F5:
"Build item 2 leaves 'whether to refuse more than that' (C1 controls such as
`\u0085`, zero-width such as `\u200b`) as 'the builder's to measure and report',
in prose." The owner's decision of 2026-10-18 was to leave them out of lg-52 and
file them here. **The lock-out is lg-52's claim and is not measured here**; what
is measured is that `readAddress` returns the value.

## Reproduction

On `origin/main@9ec8943e`, in a worktree with the farm and `npm run build` done.
A terminal swallows `\u0085` and `\u200b`, so the one-liner is piped through
`od -c`, which shows the bytes `302 205` (U+0085) and `342 200 213` (U+200B) in
the output. The whole set, from a script that writes every non-printable
character as `\uXXXX`:

```
$ node -e 'import("./tools/ledger/api/src/directory.ts").then((m) => console.log(JSON.stringify(m.readAddress("a\u0085@b.test")), JSON.stringify(m.readAddress("a\u200b@b.test"))))' | od -c | head -3
0000000   "   a 302 205   @   b   .   t   e   s   t   "       "   a 342
0000020 200 213   @   b   .   t   e   s   t   "  \n
```

```
readAddress("a\u0085@b.test") => "a\u0085@b.test"
readAddress("a\u009f@b.test") => "a\u009f@b.test"
readAddress("a\u0080@b.test") => "a\u0080@b.test"
readAddress("a\u200b@b.test") => "a\u200b@b.test"
readAddress("a\u200c@b.test") => "a\u200c@b.test"
readAddress("a\u200d@b.test") => "a\u200d@b.test"
readAddress("a\ufeff@b.test") => undefined
readAddress("a@b.test") => "a@b.test"
```

**`\ufeff` is already refused**, and not by anything this ticket adds: it is
White_Space in JavaScript's `\s`, which `ADDRESS_SHAPE` already excludes. It is named
here because the owner's set names it, and so that a build does not conclude it
has work to do for it.

## Build

It extends lg-52's single `CONTROL` change, in the same place, so that every
writer lg-52 lists inherits it: `Directory.addMember` (the admin route, the
member route and the host `member` verb) and `LEDGER_ADMINS` through
`readAddress`. **Do not add a second check beside `readAddress` in any caller**,
as lg-52's item 1 says.

**lg-52's Decision answers apply unchanged:** removal still matches a stored row
without the new check (its Build item 4), so a directory that already holds an
address with one of these characters can still have it removed, and no schema
trigger and no migration is added.

1. Extend `CONTROL` (renamed `UNSEEN`) to refuse `\u0080` to `\u009f`, `\u200b` to `\u200d` and
   `\ufeff`. Refuse nothing else: this ticket names the set and does not widen
   it.
2. A test per refusal, written to fail on `main` first, in the shape of lg-52's
   item 3: `readAddress` and `addMember` with `\u0085`, `\u009f`, `\u200b` and
   `\u200d` are refused `BAD_REQUEST` "That is not an email address."; the same
   through each of the two routes; the host command's `member` exits non-zero;
   a `LEDGER_ADMINS` entry carrying one stops the boot. `\ufeff` is already
   refused, so its test cannot fail first: say so, and keep it as a guard.
3. Name what proves a clean address still passes: `readAddress("a@b.test")`,
   and an ordinary non-ASCII letter (`readAddress("é@b.test")`), so that a
   change refusing everything outside ASCII cannot pass.
4. A row holding one of these characters, inserted past `Directory`, is removed
   by `removeMember` and by the host `remove` verb with the tightened `UNSEEN`
   in place, as lg-52's item 4 does for a NUL.

## Done when

- An address `readAddress` returns carries no character in `\u0080` to
  `\u009f`, `\u200b` to `\u200d` or `\ufeff`: it returns `undefined` for one
  anywhere inside the address, and `\ufeff` at either end is trimmed as any
  whitespace is. It still returns `a@b.test` and `é@b.test` (a directory test).
- `POST /api/admin/households/:id/members` and
  `POST /api/households/:id/members` answer `400` for one, and no row is written.
- The host command's `member` verb exits non-zero for one and writes no row.
- A `LEDGER_ADMINS` entry carrying one stops the boot.
- A row holding one, inserted past `Directory`, is removed by `removeMember` and
  by the host `remove` verb.
- lg-52 is on `main` first; this ticket changes `UNSEEN` (lg-52's `CONTROL`) after it.

## Review

**Gate: FAIL** — 2026-10-19 · `96da35c8..8291f5aa` · Opus 5.5, depth standard

| Done when                                                                                                                                                      | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `readAddress` returns `undefined` for an address carrying any character in U+0080–U+009F, U+200B–U+200D or U+FEFF, and still returns `a@b.test` and `é@b.test` | **not met on the literal reading, for U+FEFF at either end.** `api/test/directory.test.ts` › "is not an address to readAddress, while a clean one and a non-ASCII letter are" ✓ carries the C1 and zero-width clause (red under lg-52's class and with U+200D planted out) and both clean addresses. But › "refuses U+FEFF inside an address, as it already did" asserts `readAddress("\ufeffa@b.test")` is `"a@b.test"`, the opposite of the line for an input that carries U+FEFF. The gate's population: 142 of 144 refused; the 2 returned are U+FEFF first and last. See the first `high` |
| The admin and member add routes answer `400` for one, and no row is written                                                                                    | `api/test/households.test.ts` › "is refused 400 by the admin's add route and by a member's, and no row is written" ✓ (status, `BAD_REQUEST` and `directorySnapshot` unchanged; red under lg-52's class)                                                                                                                                                                                                                                                                                                                                                                                        |
| The host command's `member` verb exits non-zero for one and writes no row                                                                                      | `api/test/household-command.test.ts` › "refuses an address with %s on the member verb, exits non-zero and writes no row" ✓, 4 cases (red under lg-52's class; the U+200D case red with U+200D planted out)                                                                                                                                                                                                                                                                                                                                                                                     |
| A `LEDGER_ADMINS` entry carrying one stops the boot                                                                                                            | `api/test/config-access.test.ts` › "refuses an admin entry with one, naming its position and not the entry" ✓ — asserts `loadApiConfig` throws "LEDGER_ADMINS entry 2 is not an address" with no part of the entry; `createApp` calls `loadApiConfig` before anything else (read, not run)                                                                                                                                                                                                                                                                                                     |
| A row holding one, inserted past `Directory`, is removed by `removeMember` and by the host `remove` verb                                                       | `api/test/directory.test.ts` › "is no obstacle to removing a row that already stands with one, which the schema let in" ✓ and `api/test/household-command.test.ts` › "still removes a row that already holds a U+0085 or a U+200B, which the schema let in" ✓ — both red when `removeMember` reads with `readAddress` (plant)                                                                                                                                                                                                                                                                  |
| lg-52 is on `main` first; this ticket changes the check after it                                                                                               | **verified** — lg-52's commit is an ancestor of the base, and the diff changes the class it added                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

- **high** · Done when 1 depends on it · **open decision** · U+FEFF at the first or last position is accepted: `readStoredAddress` runs `trim()` before `UNSEEN` is tested, and `trim()` strips U+FEFF (it is JavaScript WhiteSpace). `readAddress("\ufeffa@b.test")` and `readAddress("a@b.test\ufeff")` both return `"a@b.test"`, and the branch's own test pins the first. The value returned carries no U+FEFF, so no unsignable row is stored; the line, read literally, asks for `undefined`. Graded as dl-100's gate 1 was: a test on the branch asserts the opposite of the line's literal reading. Options: **(1, recommended)** the owner rewords Done when 1 to say an address `readAddress` _returns_ carries none of the set, and that U+FEFF at either end is trimmed as any whitespace is. No code change; the test already pins it. **(2)** a fix round tests `UNSEEN` on the raw text before `trim()`, so a pasted address with a leading BOM is refused. Not run here; it would refuse input that is accepted, clean, today. No C1 or zero-width character is stripped by `trim()`: only U+FEFF, of the 36.
- **low** · no `Done when` line depends on it · **open decision** · `changeAddress` reads `from` with the tightened `readAddress`, so a stored row holding U+0085 can no longer be moved to a clean address: `BAD_REQUEST` "That is not an email address." at head, where lg-52's class (main) moves it. The admin can still remove the row and add the clean address. lg-52 did the same thing for NUL. Options: **(1, recommended)** fold in: read `from` with `readStoredAddress`, as `removeMember` does, since it names a row that already exists, and add one test. **(2)** leave it, and say in the Log that a stored row is fixed by removing it and adding it again. The suggested fix is a direction; the gate did not run it.
- **low** · `nfr:maintainability` · the Log says "The brief's prose above is corrected to the real name", but three `ADDRESS` mentions remain above the Log: the Reproduction's U+FEFF paragraph (where it means `ADDRESS_SHAPE`), Build item 4 ("the tightened `ADDRESS`", meaning `UNSEEN`) and Done when 6. The mentions it did correct are right: lg-52 split `ADDRESS` into `ADDRESS_SHAPE` and `CONTROL`, and this branch renames `CONTROL` to `UNSEEN`. The text overclaims; nothing relies on it.
- **dropped** · the suspicion that `trim()` also lets a leading or trailing C1 or zero-width character through. Measured: `trim()` strips only U+FEFF, of the 36. The other 35 are refused at all four positions.
- **findings** · the hunt returned 4; 3 carried, 1 dropped.
- Write paths: every `memberships` INSERT goes through `Directory.#record`, which has three callers. `addMember` checks with `readAddress`; it is reached by both add routes and the host `member` verb. `changeAddress` checks both `from` and `to` with `readAddress`; it is reached by the admin's address route. `removeMember` reads with `readStoredAddress`, on purpose. `LEDGER_ADMINS` is checked by `readAddress` in `config.ts` `admins` and is never written to the directory. No import, invite or migration writes `memberships`.
- Reads with a stored U+0085 row: 92 GETs (46 routes, each as a member and as an admin) answered below 500. The app booted. The household and admin-households bodies list the row, and the host `list` and `remove` exit 0.
- Positive control: dropping U+200D from `UNSEEN` turned 3 of the branch's new tests red. lg-52's class turned 12 of 133 red, which matches the Log.
- NFR: security ✓ (the boot refusal names only the position) · performance n/a · reliability — the second finding · maintainability — the third.
- CI at `8291f5aa`: all 9 checks pass, the Windows informational leg included.

### Gate 2

**Gate: FAIL** — 2026-10-20 · `8291f5aa..695e83f7` (base `96da35c8`) · Opus 5.5, depth narrow, round 1 only

| Done when                                                                                                                                                                                   | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An address `readAddress` returns carries none of the set: `undefined` for one anywhere inside, `\ufeff` at either end trimmed as any whitespace is; still returns `a@b.test` and `é@b.test` | **unproven, for one clause: `\ufeff` at the last position.** `api/test/directory.test.ts` › "is not an address to readAddress, while a clean one and a non-ASCII letter are" ✓ carries the inside clause and both clean addresses (red with U+200D planted out of `UNSEEN`). › "refuses U+FEFF inside an address, as it already did" ✓ asserts `readAddress("\ufeffa@b.test")` is `"a@b.test"`, which is the leading end only. No test in `tools/ledger` has a trailing U+FEFF. The gate's population at this head: 142 of 144 refused, and the 2 returned are U+FEFF first and last, both `"a@b.test"`, so the line is true; the trailing half has no assertion. See the `med` |
| lg-52 is on `main` first; this ticket changes `UNSEEN` (lg-52's `CONTROL`) after it                                                                                                         | **verified** by reading: lg-52's merge (#560) is in the base's history, and the diff replaces `CONTROL` with `UNSEEN` in `api/src/directory.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

The round did not touch Done when 2–5; gate 1's grades for them stand. The project still runs their tests: `npm test -- --project ledger` at this head gave 1546 of 1546 passing, in 71 files.

Gate 1's findings:

- **high, U+FEFF at either end · fixed.** Done when 1 now says what the code does (owner, option 1), and no test asserts the opposite of the line. The new `med` below is about the reworded line's proof. The line above `## Log` holds no literal set character: a scan of U+0080–U+009F, U+200B–U+200D and U+FEFF counts 0 there (and 3 of 3 on its own positive control).
- **low, `changeAddress` and a stored row · fixed.** At this head, gate 1's `population.mts` prints `changeAddress from the stored row => ok {"address":"sam@b.test",...}`, where at 8291f5aa it printed `THROWS BAD_REQUEST`. The new `api/test/directory.test.ts` › "moves the row to a clean address, which the schema let it be stored without" is red against 8291f5aa's `directory.ts` (`1 failed | 134 passed (135)` over the four touched spec files) and red under the dispatch's plant that reads `from` with `readAddress`. Both failures are `BAD_REQUEST` at the `changeAddress` call itself, after the rows are inserted and the `Directory` is built, so it fails at the move and not at setup. `to` keeps the full check. Through `Directory.changeAddress`, 142 of 144 are refused `BAD_REQUEST` with no row written, and the 2 accepted are U+FEFF at either end, trimmed to the clean address. Through `POST /api/admin/households/:id/members/address`, 142 of 144 get `400 BAD_REQUEST` with no row written, and the same 2 get `200`. When `to` is read with `readStoredAddress` instead, 3 tests go red, the new "still refuses one as the new address, and nothing changes" among them. `readStoredAddress` has one other caller, `removeMember`, and the round did not touch it.
- **low, stale `ADDRESS` · fixed.** Above `## Log`, `ADDRESS_SHAPE`, `CONTROL` and `UNSEEN` each appear only where they mean that constant: the Reproduction's U+FEFF paragraph says `ADDRESS_SHAPE`, Build item 4 says `UNSEEN`, and Done when 6 says `UNSEEN` (lg-52's `CONTROL`). No bare `ADDRESS` is left.

New in the round:

- **med** · Done when 1 depends on it · the clause "`\ufeff` at either end is trimmed" has an assertion for the leading end only. The fix is one line in `api/test/directory.test.ts` › "refuses U+FEFF inside an address, as it already did": `expect(readAddress("a@b.test\ufeff")).toBe("a@b.test");`. The gate ran it as a scratch spec. It passes at this head (`1 passed (1)`) and fails when `readStoredAddress` trims with `trimStart()` (`expected undefined to be 'a@b.test'`). Under that same plant, the project goes red on 3 trailing-whitespace tests, none of which uses U+FEFF.
- **low** · no `Done when` line depends on it · the behaviour changes from main for a `from` that matches no row. When that `from` carries a C0 control or DEL, `changeAddress` now answers `MEMBER_NOT_FOUND` where main answered `BAD_REQUEST`. Measured through `Directory.changeAddress`, over 132 inputs (33 code points × 4 positions): 112 change, the 28 non-whitespace controls (27 C0 and DEL) at every position, giving `BAD_REQUEST` at `96da35c8` and `MEMBER_NOT_FOUND` at this head. The other 20 are the same at both shas. Tab, LF, VT, FF and CR at either end are trimmed and give `MEMBER_NOT_FOUND`, which is 10. The same five inside the address are refused by `\s` with `BAD_REQUEST`, which is the other 10. At this head the admin route answers `404` for those 112; the gate did not run the route at `96da35c8`. No row is written at either sha. For the lg-57 set nothing changes: 142 of 144 give `MEMBER_NOT_FOUND` at both shas, and 2 give `BAD_REQUEST` at both. The answer is true in both forms, since no member has that address. It follows from the owner's option (1) and matches `removeMember`. Nothing asserts either code, and the Log does not mention the change. Direction: add one sentence to the Log.
- **dropped** · the 2026-10-18 Log entry still carries a literal U+FEFF ("and `<U+FEFF>` is the one of the set that is already refused"). The round did not touch that line, and Done when 1's scan covers only the text above `## Log`. Out of the round's range. The lander may want to rewrite it as `\ufeff`.
- **findings** · the hunt returned 3; 2 carried, 1 dropped. None is a `high`.
- NFR: security ✓ (`to` refused 142 of 144 through the method and the route, and the 2 accepted are clean) · performance n/a · reliability ✓ (no row written on any refusal: 552 inputs through the method, 552 through the route) · maintainability: the `low` above.
- CI at `695e83f7` (`gh pr checks 573`): `check`, `test (ubuntu-latest)`, `docker`, `codeql`, `CodeQL`, `dependency-review` and `changes` pass. `test (windows-latest, informational)` was pending when read, so it was read, not graded.

## Log

- 2026-10-18 — Filed at the owner's decision of 2026-10-18, from lg-52's gate 1,
  F5: the C1 controls and the zero-width characters, left out of lg-52 so that it
  stays at C0 and DEL. Reproduced on `origin/main@9ec8943e` before filing: the
  output is above, and `﻿` is the one of the set that is already refused.
  Nothing was built.
- 2026-10-19 — Built on `origin/main@96da35c8`, branch `lg-57-address-control-chars`.
  **What the brief had wrong:** it names `ADDRESS` in `api/src/directory.ts`, which
  lg-52's landing split into `ADDRESS_SHAPE` (the `\s`-based shape) and `CONTROL`
  (the C0 and DEL class `readAddress` tests after it, and `readStoredAddress` leaves
  out so removal still matches a stored row). The refusal went into `CONTROL`, renamed
  `UNSEEN` because it is no longer only controls:
  `/[\u0000-\u001f\u007f-\u009f\u200b-\u200d\ufeff]/u`. Nothing else was widened.
  `\ufeff` is listed in the class though `\s` already refused it, so the set reads
  whole; `trim` still removes it at the very ends, as it does any whitespace. The
  brief's prose above is corrected to the real name.
  Red first: the new tests, run against the old class with
  `npx vitest run tools/ledger/api/test/{directory,households,household-command,config-access}.test.ts`
  (the four files named singly), gave `Tests  12 failed | 121 passed (133)`:
  readAddress, addMember for U+0085, U+009F, U+200B and U+200D, changeAddress, the
  admin and member routes, the host `member` verb four times, and the
  `LEDGER_ADMINS` entry. With the class widened, `Tests  133 passed (133)`. What
  passed on the old class are the guards: U+FEFF refused inside an address (and
  `addMember` with it), the clean `a@b.test` and `é@b.test`, and removal of stored
  rows holding U+0085 or U+200B through `removeMember`, the admin remove route and
  the host `remove` verb. No fold-in: no other already-specified piece became free;
  the web paste screen's own address handling is lg-54's.
- 2026-10-19 — Round 1, after gate 1 (FAIL at 8291f5aa). Three findings, two owner
  answers given through AskUserQuestion on 2026-10-19.
  1. **U+FEFF at either end.** `readStoredAddress` trims before `UNSEEN` is tested, and
     `trim()` strips U+FEFF, so `readAddress` of a BOM-prefixed or BOM-suffixed
     address returns the clean address, not `undefined`. Question: does Done when 1
     mean `undefined` for any occurrence, or that no address returned carries one?
     Options: (1) reword the line to the second reading, no code change; (2) test
     `UNSEEN` on the raw text before `trim()`, refusing input accepted clean today.
     **The owner chose (1).** Done when 1 now says an address `readAddress` returns
     carries none of the set, and U+FEFF at either end is trimmed as any whitespace
     is. The code points above `## Log` are written as `\uXXXX` text; they were
     literal characters.
  2. **`changeAddress` and a stored row.** `from` was read with `readAddress`, so a
     row holding U+0085 could not be moved to a clean address (lg-52 did the same for
     a NUL). Options: (1) fold in: read `from` with `readStoredAddress`, as
     `removeMember` does; (2) leave it and say removing and re-adding is the way.
     **The owner chose (1).** `to` is still read with `readAddress`. Red at
     8291f5aa: `npx vitest run tools/ledger/api/test/directory.test.ts` gave
     `Tests  1 failed | 84 passed (85)`, the new "moves the row to a clean address"
     test failing with `BAD_REQUEST`; the second new test (a `to` carrying U+0085,
     U+009F or U+200B is still refused) passed there and is the guard that `to` kept
     its check.
  3. **Stale `ADDRESS`.** Three mentions above the Log named the old constant; they
     now read `ADDRESS_SHAPE` (the Reproduction's U+FEFF paragraph), `UNSEEN` (Build
     item 4) and `UNSEEN` (lg-52's `CONTROL`) in Done when 6.
- 2026-10-20 — Round 2, after gate 2 (med and low, fixed with no third gate, under
  the severity floor).
  1. **Med, trailing U+FEFF.** Done when 1's "trimmed at either end" had an assertion
     for the leading end only. Added `expect(readAddress("a@b.test﻿")).toBe("a@b.test")`
     to "refuses U+FEFF inside an address, as it already did" in
     `api/test/directory.test.ts`.
  2. **Low, `changeAddress` and a `from` that matches no row.** Because `from` is now
     read with `readStoredAddress`, as `removeMember` does, a `from` carrying a C0
     control or DEL that matches no row answers `MEMBER_NOT_FOUND` (404 through the
     admin route) where `origin/main@96da35c8` answered `BAD_REQUEST`. No row is
     written either way, and no member has that address, so both answers are true.
