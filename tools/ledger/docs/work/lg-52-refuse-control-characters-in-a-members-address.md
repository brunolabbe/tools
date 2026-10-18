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
only in a hand-built request, since the web input is `type="email"`". The
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
- Unmerged, on PR #546: `Directory.changeAddress` (lg-34), whose `to` goes
  through `readAddress` as `addMember`'s does. It is covered by this change once
  both are on `main`; until then it is the gate's example and not a writer on
  `main`. Whoever lands second checks the other.

`DEV_IDENTITY` is lower-cased and never goes through `readAddress`, but it is
refused at boot unless the directory already has a member by that address, so it
is not a writer.

1. Change `ADDRESS` so that it refuses the C0 controls (`\u0000` to `\u001f`)
   and DEL (`\u007f`), in one place, so that the three callers above and
   `LEDGER_ADMINS` all inherit it. Do not add a second check beside
   `readAddress` in any caller. Removal is the one exception, item 4.
2. Whether to refuse more than that is the builder's to measure and report, not
   to widen silently: `readAddress` also accepts the C1 controls (`\u0085` above)
   and the zero-width characters (`\u200b` above). They are outside the gate's
   finding. The floor is C0 and DEL.
3. A directory test per refusal, written to fail on `main` first: `addMember`
   with a NUL, with another C0 control and with DEL is refused `BAD_REQUEST`
   "That is not an email address."; the same through each of the two routes; the
   host command's `member` exits non-zero; a `LEDGER_ADMINS` entry carrying one
   stops the boot. Name what the test does to prove the clean address still
   passes (`readAddress("a@b.test")`), so a regex that refuses everything cannot
   pass.

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
   claim to say so. No trigger and no migration are added.
6. **For the owner, not a gate on the build:** whether a deployed directory
   already holds such a row. Run this against `DIRECTORY_PATH` with `sqlite3` or
   `better-sqlite3`:

   ```
   SELECT address, hex(address) FROM memberships WHERE
     instr(address, char(0)) > 0 OR instr(address, char(1)) > 0 OR ... OR
     instr(address, char(31)) > 0 OR instr(address, char(127)) > 0
   ```

   with one `instr` per character from 0 to 31 and 127. It was run against a
   directory with two clean rows and three bad ones (NUL, ESC, DEL):

   ```
   $ node find.mts <worktree>
   query matched:
     {"address":"del@b.test","hex":"64656C40627F2E74657374"}
     {"address":"esc@b\u001bc.test","hex":"65736340621B632E74657374"}
     {"address":"nul@b\u0000c","hex":"6E756C40620063"}
   rows in total: 5
   GLOB '*[^ -~]*' matched: "del@b.test" "esc@b\u001bc.test"
   ```

   **A `GLOB` character class does not do it**: the last line shows it missing
   the NUL row (measured; the reason is not). Query `memberships` rather than
   `current_members` to see removed rows too; the view is the ones that stand.
   The scratch script is
   `/tmp/claude-1000/-workspaces-tools/20bfbf0a-3b89-4e8d-940c-2389724a8d55/scratchpad/lg-52/build/find.mts`.
   A row found is removable by item 4; nothing here migrates it.

## Decision — answered 2026-10-18 by the owner

Both questions were put to the owner as options, each with a recommendation, and
both were answered with the recommended option.

**Existing rows.** An existing directory may already hold an address with a
control character, and tightening `ADDRESS` cannot repair it. It also changes
what the code can do about it: `removeMember` reads its address through
`readAddress`, so once `ADDRESS` refuses the character, the admin remove route
and the `remove` verb could no longer name that row. Options:

- (a) `removeMember` (and the host `remove` verb) match without the new check.
- (b) A one-off migration that rewrites or removes the row.
- (c) Refuse at boot while one stands.

**Chosen: (a)**, the builder's recommendation. The precondition it carried was
to run the query against the deployed directory first; the owner did not say
whether they will, so the query is a step for the owner (item 6), not a gate on
the build.

**The schema as a backstop.** The `memberships.address` CHECK cannot gain a
clause without rebuilding the table, and a direct insert past `Directory` is not
refused for a control character (the reproduction's part 5). Options:

- (a) Widen the brief to a `BEFORE INSERT` trigger added by a migration.
- (b) Narrow the `directory.ts` header claim to what the schema actually checks.

**Chosen: (b)**, the builder's recommendation. The trigger is not built (item 5).

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
- 2026-10-18 — The owner answered both open questions with the builder's
  recommendations (existing rows: (a), removal matches without the new check;
  schema backstop: (b), narrow the header, no trigger). Recorded under the
  Decision heading, and the open section is now Build items 4 to 6. The query for
  existing rows stays as a step for the owner. The Why now sets the gate's
  "only an admin can send it" beside the member route, which accepted the same
  address as a non-admin; the grade is not re-rated.
