---
id: lg-52
tool: ledger
title: Refuse control characters in a member's address, for every writer
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# lg-52 — Refuse control characters in a member's address

## Why

`readAddress` in `api/src/directory.ts` is the one place an address is read, and
it accepts a NUL byte, and every other C0 control and DEL:

```ts
const ADDRESS = /^[^\s@,;]+@[^\s@,;]+$/u;
export function readAddress(raw: string): string | undefined {
  const address = raw.trim().toLowerCase();
  return ADDRESS.test(address) ? address : undefined;
}
```

`\s` covers tab, newline and the Unicode spaces, so those are refused; a NUL,
`\u0001` to `\u0008`, `\u000e` to `\u001f` and `\u007f` are not. An address
carrying one is stored, answers `200`, and is a directory row that no Access
token can name.

Found by lg-34's gate 1 (`ticket-reviewer-opus`, PASS, finding F1, graded low)
on the unmerged branch `lg-34-change-member-address` (PR #546, draft, base
`lg-33-rename-a-person`). There, `to: "a@b\u0000c"` answered `200` and moved sam
onto an address no Access token can carry, which would lock sam out until an
admin changed it back. The gate established that by reading, not by running it
at the base, and the finding named the defect as older than the branch:
`addMember` and the host command use the same `readAddress`. This ticket is that
older defect, reproduced on `main` below. **The lock-out itself is the gate's
claim and is not measured here**: what is measured is that the row is accepted
and stored.

The gate graded it low because, in its words, "only an admin can send it, and
only in a hand-built request: the web input is `type="email"`". The
reproduction below shows the first half does not hold for adding an address: the
member route, `POST /api/households/:id/members`, called as a non-admin member
(alex), accepted `casey\u007f@example.test` with a `200`, and the host command
takes any argument it is given. The grade is the gate's and is not re-rated here.

## Reproduction

On `origin/main@789ca9ba`, in a worktree with the farm and `npm run build` done.

**1. `readAddress` returns a value** (no test runner, Node 22 strips the types):

```
$ node -e 'import("./tools/ledger/api/src/directory.ts").then((m) => console.log(JSON.stringify(m.readAddress("a@b\u0000c")), JSON.stringify(m.readAddress("a@b\nc"))))'
"a@b\u0000c" undefined
```

**2 to 5. Every writer, in one throwaway spec.** The spec is
`/tmp/claude-1000/-workspaces-tools/20bfbf0a-3b89-4e8d-940c-2389724a8d55/scratchpad/lg-52/build/lg52-repro.test.ts`
(not committed): it was copied into `tools/ledger/api/test/`, run, and removed,
and `git status` was clean after. It prints rather than asserts, and writes every
non-printable character as `\uXXXX`, because `JSON.stringify` leaves DEL, the C1
controls and U+200B raw and a terminal swallows them.

```
$ npx vitest run tools/ledger/api/test/lg52-repro.test.ts --reporter=verbose
 Test Files  1 passed (1)
      Tests  16 passed (16)
```

The lines it printed, by writer:

`readAddress` itself (part 1):

```
readAddress("a@b\u0000c") => "a@b\u0000c"
readAddress("a\u0001@b.test") => "a\u0001@b.test"
readAddress("a@b.test\u001b") => "a@b.test\u001b"
readAddress("a@b\u007f.test") => "a@b\u007f.test"
readAddress("a@b\u0085.test") => "a@b\u0085.test"
readAddress("a@b\u200b.test") => "a@b\u200b.test"
readAddress("a@b\tc") => undefined
readAddress("a@b\nc") => undefined
readAddress("a b@c") => undefined
readAddress("a@@c") => undefined
```

The admin route, `POST /api/admin/households/home/members`, as the admin
(part 2); the row is stored and resolves as a membership:

```
POST adminMembers "mallory@evil\u0000.test" => 200 "{\"address\":\"mallory@evil\\u0000.test\",\"person\":\"mallory\"}"
stored: [{"address":"mallory@evil\u0000.test","household":"home","person":"mallory"}]
membershipOf(stored): {"household":"home","person":"mallory"}
```

The member's own route, `POST /api/households/home/members`, as alex, who is a
member and not an admin (part 2):

```
POST householdMembers "casey\u007f@example.test" => 200 "{\"address\":\"casey\u007f@example.test\",\"person\":\"casey\"}"
```

The admin remove route takes the same text back out, because `removeMember`
reads its address through `readAddress` too (part 2):

```
POST adminMemberRemove "mallory@evil\u0000.test" => 200 "{\"address\":\"mallory@evil\\u0000.test\",\"person\":\"mallory\"}"
```

The host command, `runHouseholdCommand(["member", "home", <address>, "sam"])`,
against a file directory (part 3). A NUL cannot travel in a real `argv`, so the
function is called with the array; ESC can be typed in a shell:

```
member "sam@b\u0000c" => code 0 "...Added sam@b\u0000c to home, as sam.\n..."
member "sam@b\u001bc.test" => code 0 "...Added sam@b\u001bc.test to home, as sam.\n..."
stored: [{"address":"sam@b\u0000c","household":"home","person":"sam"},{"address":"sam@b\u001bc.test","household":"home","person":"sam"}]
```

`LEDGER_ADMINS`, read by `config.ts` through `readAddress` (part 4); the service
boots with a NUL in an admin entry:

```
admins: ["boss@x\u0000.test","ok@x.test"]
```

The schema is no backstop, although `directory.ts`'s header says it is: the
`memberships.address` CHECK is `address = lower(trim(address)) AND address GLOB
'?*@?*'`, and a writer that skips `Directory` and inserts directly is not
refused (part 5):

```
raw INSERT "sam@b\u0000c" => accepted
raw INSERT "sam@b\u001bc.test" => accepted
```

## Build

The direction, from the gate: refuse control characters in `ADDRESS`, so that
every writer refuses them. **Every writer of an address on `main`:**

- `Directory.addMember`, reached by three callers: the admin route
  `POST /api/admin/households/:id/members`, the member route
  `POST /api/households/:id/members`, and the host command's `member` verb
  (`household:ledger`).
- `Directory.removeMember`, reached by the admin remove route and the host
  command's `remove` verb. It reads its address through `readAddress` too, which
  matters below.
- `LEDGER_ADMINS` in `config.ts`, which reads each entry through `readAddress`.
- `Directory.changeAddress` (lg-34, merged as PR #546, `dbf4cd5f`), whose `to`
  goes through `readAddress` as `addMember`'s does, so it inherits the change.
  Its `from` goes through `readAddress` too, and is not the removal exception of
  item 4 (see the Log).

`DEV_IDENTITY` is lower-cased and never goes through `readAddress`, but it is
refused at boot unless the directory already has a member by that address, so it
is not a writer.

1. Change `ADDRESS` so that it refuses the C0 controls (`\u0000` to `\u001f`)
   and DEL (`\u007f`), in one place, so that the three callers above and
   `LEDGER_ADMINS` all inherit it. Do not add a second check beside
   `readAddress` in any caller. Removal is the one exception, item 4.
2. The floor is the C0 controls and DEL only, and this ticket does not widen it.
   `readAddress` also accepts the C1 controls (`\u0085` above) and the
   zero-width characters (`\u200b` above); they are outside the gate's finding,
   and the wider set is filed separately as lg-57.
3. A directory test per refusal, written to fail on `main` first: `addMember`
   with a NUL, with another C0 control and with DEL is refused `BAD_REQUEST`
   "That is not an email address."; the same through each of the two routes; the
   host command's `member` exits non-zero; a `LEDGER_ADMINS` entry carrying one
   stops the boot. Name what the test does to prove the clean address still
   passes (`readAddress("a@b.test")`), so a regex that refuses everything cannot
   pass. **A NUL cannot travel in a real `argv` or environment value** (Node
   throws `ERR_INVALID_ARG_VALUE`: "must be a string without null bytes"), so
   the host command and `LEDGER_ADMINS` tests for a NUL are function-level,
   `runHouseholdCommand` and `loadApiConfig` called with a string; ESC and DEL
   can run as a real process. The HTTP routes, whose body is JSON, are the real
   NUL vector.

4. **Removal still names a stored row that carries a control character.**
   `removeMember`, and through it the admin remove route and the host command's
   `remove` verb, reads its address without the new check, so a directory that
   already holds such a row can still have it removed. It keeps refusing what it
   refused before this change: only the control-character refusal is not applied
   there. A test inserts a row with a NUL past `Directory` (a direct insert, as
   the reproduction's part 5 does) and removes it through `removeMember`, and
   through the `remove` verb; run it against the tightened `ADDRESS` so it fails
   if removal shares the strict check.
5. **Narrow `directory.ts`'s header to what the schema checks.** Its header says
   every write is checked "again by the schema's triggers". The schema's
   `memberships.address` CHECK is `address = lower(trim(address)) AND address GLOB
'?*@?*'` and the triggers check membership, not the character set, so reword the
   claim to say so. No trigger and no migration are added. **The same claim is
   made at a second site**, the header of `api/test/directory.test.ts` ("Each
   rule is held twice … and by the schema, so that a writer which skips the
   class is refused too"), and is reworded the same way.
6. **For the owner, not a gate on the build:** whether a deployed directory
   already holds such a row. Run this against `DIRECTORY_PATH` with `sqlite3` or
   `better-sqlite3`:

   ```sql
   SELECT address, hex(address) FROM current_members WHERE
     instr(address, char(0)) > 0
     OR instr(address, char(1)) > 0
     OR instr(address, char(2)) > 0
     OR instr(address, char(3)) > 0
     OR instr(address, char(4)) > 0
     OR instr(address, char(5)) > 0
     OR instr(address, char(6)) > 0
     OR instr(address, char(7)) > 0
     OR instr(address, char(8)) > 0
     OR instr(address, char(9)) > 0
     OR instr(address, char(10)) > 0
     OR instr(address, char(11)) > 0
     OR instr(address, char(12)) > 0
     OR instr(address, char(13)) > 0
     OR instr(address, char(14)) > 0
     OR instr(address, char(15)) > 0
     OR instr(address, char(16)) > 0
     OR instr(address, char(17)) > 0
     OR instr(address, char(18)) > 0
     OR instr(address, char(19)) > 0
     OR instr(address, char(20)) > 0
     OR instr(address, char(21)) > 0
     OR instr(address, char(22)) > 0
     OR instr(address, char(23)) > 0
     OR instr(address, char(24)) > 0
     OR instr(address, char(25)) > 0
     OR instr(address, char(26)) > 0
     OR instr(address, char(27)) > 0
     OR instr(address, char(28)) > 0
     OR instr(address, char(29)) > 0
     OR instr(address, char(30)) > 0
     OR instr(address, char(31)) > 0
     OR instr(address, char(127)) > 0
   ```

   `current_members` is the rows that stand. `memberships` also holds ended adds
   and the `remove` records, which are append-only and need no removal, so
   querying it counts each removed address twice. The query was run against a
   directory with one clean row and three bad ones (NUL, ESC, DEL):

   ```
   clauses: 33
   rows in current_members: 4, matched: 3
   {"address":"nul@b\u0000c","hex(address)":"6E756C40620063"}
   {"address":"esc@b\u001bc.test","hex(address)":"65736340621B632E74657374"}
   {"address":"del@b\u007f.test","hex(address)":"64656C40627F2E74657374"}
   GLOB '*[^ -~]*' matched 2: "esc@b\u001bc.test" "del@b\u007f.test"
   ```

   **A `GLOB` character class does not do it**: the last line shows it missing
   the NUL row (measured; the reason is not). A row found is a row that stands,
   so item 4 removes it; nothing here migrates it.

## Decision — answered 2026-10-18 by the owner

Three questions were put to the owner as options, each with a recommendation,
and all three were answered with the recommended option. The first two are the
filer's recommendations; the third is the gate's.

**Existing rows.** An existing directory may already hold an address with a
control character, and tightening `ADDRESS` cannot repair it. It also changes
what the code can do about it: `removeMember` reads its address through
`readAddress`, so once `ADDRESS` refuses the character, the admin remove route
and the `remove` verb could no longer name that row. Options:

- (a) `removeMember` (and the host `remove` verb) match without the new check.
- (b) A one-off migration that rewrites or removes the row.
- (c) Refuse at boot while one stands.

**Chosen: (a)**, the filer's recommendation. The precondition it carried was
to run the query against the deployed directory first; the owner did not say
whether they will, so the query is a step for the owner (item 6), not a gate on
the build.

**The schema as a backstop.** The `memberships.address` CHECK cannot gain a
clause without rebuilding the table, and a direct insert past `Directory` is not
refused for a control character (the reproduction's part 5). Options:

- (a) Widen the brief to a `BEFORE INSERT` trigger added by a migration.
- (b) Narrow the `directory.ts` header claim to what the schema actually checks.

**Chosen: (b)**, the filer's recommendation. The trigger is not built (item 5).

**How wide the refusal is.** `readAddress` also accepts the C1 controls (such as
`\u0085`) and the zero-width characters (such as `​`), which the gate's
finding on lg-34 did not name. The owner's first two answers settle only the C0
controls and DEL. Options:

- (a) Refuse the C0 controls and DEL only; file the wider set as its own ticket.
- (b) Widen this ticket to the C1 controls and the zero-width characters.
- (c) Leave it to the builder to measure and report, as the brief first said.

**Chosen: (a)**, the gate's recommendation (lg-52's gate 1, F5). Build item 2
says so, and the wider set is lg-57.

## Done when

- `readAddress("a@b\u0000c")` returns `undefined`, as do the other C0 controls
  and DEL, and `readAddress("a@b.test")` still returns the address (a directory
  test).
- On `main`'s routes, `POST /api/admin/households/:id/members` and
  `POST /api/households/:id/members` answer `400` for an address carrying a
  control character, and no row is written (a route test per route, run to fail
  at the base first).
- The host command's `member` verb exits non-zero for one and writes no row.
- A `LEDGER_ADMINS` entry carrying one stops the boot, with the message that
  names its position and not the entry (the existing refusal).
- A row holding a NUL, inserted past `Directory`, is removed by `removeMember`
  and by the host command's `remove` verb with the tightened `ADDRESS` in place
  (a test that fails if removal shares the strict check).
- Removal keeps refusing what it refused before, with `BAD_REQUEST`: `removeMember`
  given `no-at-sign`, `a b@c`, `a@@c`, the empty string and `a@b,c` (a test per
  input), and `readAddress` keeps returning `undefined` for the same five.
- `directory.ts`'s header no longer claims the schema checks more than it does.
- The report says it did not run item 6's query against a deployed directory, or
  what it found if the owner ran it; neither gates the build.
- If PR #546 has merged by then, `changeAddress` with `to: "a@b\u0000c"` is
  refused by a test; if not, the Log says it was not checked.

## Log

- 2026-10-18 — Filed from lg-34's gate 1, F1, at the owner's decision (file it,
  over "record only" and "fix on lg-34 now"). Reproduced on `origin/main@789ca9ba`
  before filing: every writer listed above accepted a control character, and the
  output is above. Nothing was built.
- 2026-10-18 — The owner answered both open questions with the filer's
  recommendations (existing rows: (a), removal matches without the new check;
  schema backstop: (b), narrow the header, no trigger). Recorded under the
  Decision heading, and the open section is now Build items 4 to 6. The query for
  existing rows stays as a step for the owner. The Why now sets the gate's
  "only an admin can send it" beside the member route, which accepted the same
  address as a non-admin; the grade is not re-rated.
- 2026-10-18 — Gate 1 (`ticket-reviewer-sonnet`, `bec3a2ed..a22953b8`): PASS, eight
  lows. This pull request files the ticket and leaves it `ready`, so no `## Review`
  is committed; the gate's full report is on PR #551's thread, and that thread is
  its record. Its findings are applied in the entries below, except F7 (the pull
  request body, rewritten) and F8.
- 2026-10-18 — Fixed at landing by owner choice: gate 1, F1 — "Build item 4 says
  removal 'keeps refusing what it refused before', and no `Done when` line asserts
  it." Reproduced at `origin/main@9ec8943e` before the edit with the gate's removal
  spec (`-t "not an address"`): `removeMember` answers `BAD_REQUEST` for all five
  inputs, and `readAddress` answers `undefined` for all five.
  `awk '/^## Log/{exit} {print}' <ticket> | grep -c "Removal keeps refusing what it refused before"`
  → `1`, where it was `0`.
- 2026-10-18 — Fixed at landing by owner choice: gate 1, F2 — "Build item 6 says 'A
  row found is removable by item 4', and the query it prints runs over
  `memberships`, which also holds ended adds and the `remove` records … The query
  is also printed with an elision (`OR ... OR`) and is not runnable as printed."
  The query is now over `current_members` and printed whole. Run against a
  directory with one clean row and NUL, ESC and DEL rows: `rows in current_members:
4, matched: 3`, and `clauses: 33`. Scoped above `## Log`, `grep -c "instr(address,
char("` → `33`, `grep -c "OR \.\.\. OR"` → `0`, `grep -c "FROM memberships
WHERE"` → `0`, `grep -c "FROM current_members WHERE"` → `1`.
- 2026-10-18 — Fixed at landing by owner choice: gate 1, F3 — "The header of
  `api/test/directory.test.ts` makes the same claim item 5 corrects." Item 5 now
  names it. `awk '/^## Log/{exit} {print}' <ticket> | grep -c "The same claim is"`
  → `1`, where it was `0`. The header's text is as quoted:
  `sed -n 1,5p tools/ledger/api/test/directory.test.ts` at `origin/main@9ec8943e`
  → "Each rule is held twice — by `Directory`, with a sentence for the operator, /
  and by the schema, so that a writer which skips the class is refused too."
- 2026-10-18 — Fixed at landing by owner choice: gate 1, F4 — "The Decision section
  and the second Log entry call the recommendations 'the builder's' … The Why
  quotes the gate as '... in a hand-built request, since the web input is
  `type="email"`', where lg-34's gate wrote a colon." Scoped above `## Log`,
  `grep -c "builder's recommendation"` → `0` and `grep -c "filer's recommendation"`
  → `3`; `grep -c "hand-built request: the web input"` → `1` and `grep -c
"hand-built request, since"` → `0`. The colon is lg-34's:
  `git show origin/lg-34-change-member-address:tools/ledger/docs/work/lg-34-change-a-members-address-in-one-step.md | grep -c "hand-built request: the web input"`
  → `1`.
- 2026-10-18 — Fixed at landing by owner choice: gate 1, F5 — "Build item 2 leaves
  'whether to refuse more than that' … as 'the builder's to measure and report', in
  prose … Open decision, recommendation: state 'do not widen here; file the wider
  set separately'." The owner chose that over widening to C1 and zero-width and
  over leaving it to the builder; the question, options and answer are under
  Decision, and the wider set is lg-57. Scoped above `## Log`, `grep -c "builder's
to measure"` → `0`, `grep -c "does not widen it"` → `1`, `grep -c "^\*\*How wide
the refusal is"` → `1`.
- 2026-10-18 — Fixed at landing by owner choice: gate 1, F6 — "The reproduction says
  'the service boots with a NUL in an admin entry', but what ran was
  `loadApiConfig` on a JS string. A real process cannot carry NUL in the
  environment or in `argv` … Direction: say so in Build item 3." Item 3 now says
  it. `node -e 'require("node:child_process").spawnSync(process.execPath, ["-e", "1", "a\u0000b"])'`
  → `ERR_INVALID_ARG_VALUE The argument 'args[2]' must be a string without null
bytes`, and with `env: { X: "a\u0000b" }` → `ERR_INVALID_ARG_VALUE The property
'options.env['X']' must be a string without null bytes`; the same call with
  `"a\u001bb\u007f"` in `env` is read back by the child as `"a\u001bb\u007f"`. The
  reproduction's own sentence is left as the filer wrote it.
- 2026-10-18 — Recorded, not changed, by owner choice: gate 1, F8 — "The
  reproduction's parts 2 to 5 rest on a spec in a scratch directory that is not in
  the pull request and does not survive a container rebuild; only part 1 is
  runnable from the ticket." The output printed above is what a builder rebuilds
  the spec from (the gate did, about 200 lines).
- 2026-10-18 — lg-57 filed at the owner's decision: the C1 controls and the
  zero-width characters, which item 2 now leaves out. It depends on this ticket.
- 2026-10-18 — Built. `ADDRESS` is now two constants in `api/src/directory.ts`:
  `ADDRESS_SHAPE`, the old pattern, and `CONTROL`, `/[\u0000-\u001f\u007f]/u`
  (the line carries an `oxlint-disable-next-line no-control-regex`; without it
  `npx oxlint tools/ledger/api/src/directory.ts` → `error eslint(no-control-regex)`).
  `readAddress` refuses on either, and a private `readStoredAddress` checks the
  shape alone; `removeMember` reads through it, so removal keeps refusing exactly
  what it refused and takes a row that holds a control character. `addMember`,
  `changeAddress` and `LEDGER_ADMINS` (via `config.ts`) inherit `readAddress`
  unchanged. Both headers reworded (item 5); no trigger, no migration.
- 2026-10-18 — Red against the base. The new specs were run with
  `tools/ledger/api/src/directory.ts` restored from `origin/main@335efcd4`:
  `npx vitest run` of `directory`, `households`, `household-command` and
  `config-access` → `Tests  11 failed | 105 passed (116)`; the 11 are the
  `readAddress` sweep, `addMember` ×4 (NUL, SOH, ESC, DEL), `changeAddress` to a
  NUL, the `member` verb ×3, both routes (one test), and the `LEDGER_ADMINS`
  entry. The removal tests and the five-input refusals pass at the base, as they
  must. Then with the tightened `readAddress` also on `removeMember` (one line
  changed) → `Tests  3 failed | 113 passed (116)`, the three removal tests (class,
  admin route, `remove` verb): they fail if removal shares the strict check.
  With the change: `Tests  116 passed (116)` over the same four files.
- 2026-10-18 — What the brief had wrong or left open. (a) Its "Unmerged, on PR
  #546" bullet: `changeAddress` is on `main` (`dbf4cd5f`), so it is a writer
  here and `directory.test.ts` refuses `to: "a@b\u0000c"`. (b) `readAddress`
  trims, so a control character that is whitespace (`\t`, `\n`, `\v`, `\f`, `\r`)
  at an address's end was never stored: `readAddress("a@b.test\t")` returns
  `a@b.test`, before and after. The sweep asserts that, not a refusal, for those
  five at the end. (c) `changeAddress`'s `from` goes through the strict
  `readAddress`, so a stored row with a control character cannot be the `from` of
  a change, though it can be removed and re-added. The brief names `removeMember`
  alone as the exception and this change keeps to it; making `from` read through
  `readStoredAddress` is a one-word edit, and is the open decision in the report.
- 2026-10-18 — Not run: item 6's query against a deployed directory; the owner's.
- 2026-10-18 — Owner's answer on gate 1's F1 (`changeAddress` reads `from`
  through the strict `readAddress`, so a stored row with a control character
  cannot be the `from` of a change). Asked: "lg-52 passed gate 1 (#560), no high
  or med. Builder and gate disagree on F1 (low). What do you want?" Options:
  "Keep `from` strict; fix F2/F3 at landing", "Keep `from` strict; leave lows
  recorded", "Widen `from`; fix lows too". Chosen: "Keep `from` strict; fix
  F2/F3 at landing" — the gate's recommendation, overriding the builder's, which
  was to widen `from` through `readStoredAddress`. No code change for F1.
- 2026-10-18 — Fixed at landing by owner choice: gate 1, the Log's removal-strict
  count — "the Log's middle red/green entry gives the removal-strict run as '3
  failed | 98 passed (101)' beside 'the same four files'; 101 is three files".
  The entry now gives 113 passed (116). Three files → `Tests  101 passed (101)`;
  four, with `config-access` → `Tests  116 passed (116)`.
- 2026-10-18 — Fixed at landing by owner choice: gate 1, F3 — "`directory.ts`'s
  header lists what the schema checks and leaves out the person's and the
  household name's length-and-trim checks". The header now names a household
  name's and a person's length and trim among them; `name` and `person` carry a
  length range and a trim check in `db/directory-schema.ts`. Counting "length and trim" in
  `directory.ts` gives 1.
