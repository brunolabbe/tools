---
id: lg-20
tool: ledger
title: Who belongs to which household, read from a directory database
kind: work-package
status: done
milestone: P6
depends_on: []
difficulty: hard
---

# lg-20 — Who belongs to which household, read from a directory database

## Why

A second household is to use the ledger, with books of its own
(`00-ANALYSIS.md` §7, _More than one household_, decided by the owner on
2026-10-12). Today who may sign in, and who they are, is `ACCESS_PEOPLE`: one
environment variable mapping an address to a person, read once at boot, which
knows nothing of households and can be changed only on the host. The owner chose
to move membership into a database the app reads, so that it can later be
managed from the app (lg-22), and to keep which addresses are admins in
configuration.

This ticket is the directory and the identity check that reads it. Books stay
one file until [lg-21](./lg-21-books-per-household.md).

## Build

1. **The directory database**, a SQLite file of its own beside the books
   (`DIRECTORY_PATH`, defaulting next to `DATABASE_PATH`, as `/data/directory.db`
   in the image). It has its own migrations, kept apart from the books'.
   - `households`: an id, which becomes a filename in lg-21, so it is a plain
     lowercase word that the schema and the code both refuse otherwise, and a
     display name.
   - Membership, **appended and never edited**, like every record in this tool
     (the ledger `CLAUDE.md`, _A stored row is never edited_): a record adds an
     address to a household under a person name, or removes it, and names the
     person who made the change and when. The current membership is a view over
     it, as `current_rules` is over `rules`. A test scans for `UPDATE` and
     `DELETE` the way `api/test/classification-schema.test.ts` does.
   - An address belongs to at most one household, and a person name is unique
     inside its household. The rule that a name is permanent (`00-ANALYSIS.md` §7)
     holds within a household.
   - **A household holds at most two person names**, each behind any number of
     addresses, refused in the schema and in the code with a ledger error code
     (the ledger `CLAUDE.md`, _Ledger error codes_). Nothing in the books
     handles a third: `books/src/ratio.ts` refuses a ratio that is not between
     two salaries, and `books/src/buckets.ts` settles nothing but two. A second
     address for a name already in the household is not a third person.
2. **The identity check reads the directory.** `createIdentityVerifier` in
   `api/src/access.ts` still verifies Access's token exactly as it does. What
   it leaves on the request is an identity: the verified address, whether it is
   an admin (step 3), and its current membership — a household and a person
   name — or none. The lookup `personFor` does against `config.people` becomes
   that lookup in the directory, **on every request**, so a membership change
   applies without a restart.
   - `personOf(request)` returns the member's `Person` and throws `FORBIDDEN`
     when the identity has no membership, so every existing route refuses an
     admin who is in no household, unchanged. lg-22's `adminOf` is the one
     guard that reads the admin flag.
   - `Person` in `@ledger/contract` gains `household`, and `MeResponse` gains
     `admin`, so the web can tell an admin apart before lg-22 gives them a
     screen. This is the owner's approval, through this filing, of an additive
     change to the contract.
   - An address that is neither a member nor an admin is `FORBIDDEN` at the
     hook, as an unknown address is today. The log line that names it stays at
     `info`. Access admits only listed addresses (`00-ANALYSIS.md` §7, _Access
     keeps its allowlist_), so such an address is one the operator admitted and
     nobody filed, never a stranger; the limit on refusals by client address
     arrives with repo-98, which is what lets strangers reach this check.
3. **Admins are configuration.** `LEDGER_ADMINS` holds comma-separated
   addresses. This ticket only reads and validates it, and lg-22 is the first to
   act on it. An admin need not be a member, and one who is not reads no books.
4. **A host command for setup and recovery**, `npm run household:ledger --`,
   with `add <household> <display name>`, `member <household> <address> <person>`,
   `remove <address>` and `list`. It writes the directory as the operator, and it
   is how the first household exists before lg-22's screen does. `member`
   reminds the operator that the address must also be on the ledger's Access
   policy, which is a dashboard edit (step 7). **It refuses a second household
   until lg-21 lands**, because before then every household would read the
   same books file. lg-21 removes the refusal, and the refusal's test fails
   until it does.
5. **`ACCESS_PEOPLE` is retired.**
   - `api/src/config.ts` stops reading it, and boot refuses to start if it is
     still set, so a stale `.env` cannot look as if it still admits people.
   - The `people` table in the books is enrolled from the household's current
     members instead (`enrollPeople` in `api/src/people.ts`, at boot and when a
     member is added).
   - `DEV_IDENTITY` stays. In development it must name an address the directory
     holds.
   - The import command's `--as <person>` resolves against the directory.
   - Every place that names `ACCESS_PEOPLE` changes in this ticket. A grep at
     filing found them in `api/src/access.ts`, `config.ts`, `people.ts`,
     `import-command.ts`, `api/test/config-access.test.ts`, `auto-file.test.ts`,
     `workbook-import.test.ts`, `tools/ledger/.env.example`, `README.md`,
     `CLAUDE.md`, `compose.ledger.prod.yaml`, `.env.prod.example` and
     `docs/02-DEPLOYMENT.md`. The compose fragment's `LEDGER_ACCESS_PEOPLE`
     becomes `LEDGER_ADMINS`.
6. **The web shows a page for an address in no household.** Today nothing in
   `web/src` handles a 403: a grep finds none. An address Access admits but the
   directory does not — admitted and not yet filed, or removed — gets a page
   saying it belongs to no household, which names nobody and nothing. An admin
   in no household sees the same page until lg-22 gives them a screen.
7. **Docs.** In the ledger `CLAUDE.md`, rewrite _Identity comes from Cloudflare
   Access_, _People come from configuration, never the repository_ and the
   `ACCESS_PEOPLE=… DEV_IDENTITY=…` development instructions. Update
   `00-ANALYSIS.md` §7's bullets, which still describe `ACCESS_PEOPLE`. In
   `docs/02-DEPLOYMENT.md`, rewrite _The ledger's: two people, and still no
   Bypass_ and the ledger section's _Its login admits two people_: the policy
   admits every household's addresses, each added in the dashboard, since the
   setup script creates the application with two and never rewrites a policy,
   and the directory decides the household. Keep _No Bypass rule, ever_ and
   _Never "widen it" to public_, and point the second at repo-98.

**Traps.**

- Real addresses and household names never enter the repository: fixtures use
  `example.test` addresses.
- The directory is the second SQLite file this process opens. Health has to report
  it as well, without its path (`api/test/health.test.ts`).
- On Windows, opening the second file must not make the file tests time out
  (repo-93).

## Done when

1. An address that is a current member gets its person and household on the
   request; an admin in no household is identified and refused by every books
   route; an address that is neither, or was removed, gets 403. API tests
   prove each, including a removal taking effect without a restart.
2. The membership records are appended only, and a test that scans for `UPDATE`
   and `DELETE` proves it.
3. A third person name in a household is refused; a test proves it.
4. The host command creates a household, adds a member, removes one and lists
   them, and refuses a second household; tests prove each.
5. Boot refuses `ACCESS_PEOPLE`, and refuses a `DEV_IDENTITY` the directory does
   not hold; tests prove both.
6. An admitted address in no household sees the "no household" page; a web test
   proves it.
7. Gates green, including the ledger image's boot in `.github/workflows/ledger.yml`.

## Review

**Gate: CONCERNS** — 2026-10-12 · `bb4d2044..6baf3dd6` · Sonnet 5.5, depth full (hard)

In none of the cases I ran was anyone let in who should not be: the identity attacks (address spelling, an address on two lists, an admin in no household on every route, remove then re-add, `DEV_IDENTITY` against production) all fail closed, and the positive controls went red. No `high`. One `med`, which no `Done when` line depends on, and seven `low`.

| Done when                                                                                                                                                                                          | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. A member gets person and household; an admin in no household is identified and refused by every books route; a neither-address or removed address gets 403; a removal applies without a restart | `api/test/directory-identity.test.ts` › "a member" › "gets their person and household on the request" (asserts the `/api/me` body); › "an admin in no household" › "is identified, and refused by /api/me as by every books route" (walks the 34 books entries of `helpers/routes.ts`) and "is identified as an admin with no person"; › "an address that is neither a member nor an admin" › "is refused at the hook, and the operator's log names it at info" and "once removed, is refused on the next request, without a restart". **Positive control run:** with the directory read once when the verifier is built, 2 of 8 in that file go red ("once removed…" gets 200 where 403 is expected, and "added while the app runs…"); restored. I also enumerated every registered method and path with `printRoutes` (64 pairs, HEAD and second verbs included; 62 besides `GET` and `HEAD /api/health`) through the built server: the admin in no household got 403 on 62 of 62, a neither-address 403 on 62 of 62, and the control member 62 of 62 non-403, so the loop can see a pass. **proven** |
| 2. Membership records appended only; a scan for `UPDATE` and `DELETE` proves it                                                                                                                    | `api/test/directory.test.ts` › "the directory is only ever appended to" › "no source file that writes the directory issues an UPDATE or a DELETE" (its companion asserts the scan read `directory-schema.ts`, `directory.ts` and `household-command.ts`) and › "the schema refuses an UPDATE or a DELETE of a membership or a household". **Positive control run:** a planted `UPDATE memberships SET …` in `directory.ts` takes the scan red (1 of 12, `offenders` = `["directory.ts"]`); restored. The scan's limits are F2. **proven**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 3. A third person name is refused                                                                                                                                                                  | `api/test/directory.test.ts` › "membership" › "a third person name is refused as HOUSEHOLD_FULL, by the code and by the schema" (asserts the code and the trigger's message). **proven**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 4. The host command creates, adds, removes, lists, and refuses a second household                                                                                                                  | `api/test/household-command.test.ts` › "creates a household, with a display name of several words", "adds a member, and reminds the operator of the Access policy", "removes a member", "lists every household and its members", "refuses a second household until each household has books of its own (lg-21)" (asserts exit 1, the `lg-21` text and that the directory still holds one). I also ran the built `dist/household-ledger.js` as a separate process against a running server: `remove` took effect on the next request, `member` re-added on the next. **proven**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 5. Boot refuses `ACCESS_PEOPLE` and a `DEV_IDENTITY` the directory does not hold                                                                                                                   | `api/test/config-access.test.ts` › "refuses ACCESS_PEOPLE, set to anything, so a stale .env cannot look as if it admits people" (a value, and empty) and › "refuses to start with a development identity the directory has no member for" (a stranger and an admin); `household-command.test.ts` › "refuses a directory nothing outlives, and the retired ACCESS_PEOPLE". Whether the retirement reaches the production path is F3. **proven**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 6. An admitted address in no household sees the "no household" page                                                                                                                                | `web/test/app.test.tsx` › "an address in no household sees one page saying so, naming nobody, and no screens (lg-20)" (finds the heading first, so the `not.toMatch(/@\|alex\|sam\|home\b/)` runs on a rendered page) and › "any other failure of /api/me leaves the screens as they are (lg-20)". **proven**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 7. Gates green, including the ledger image's boot                                                                                                                                                  | `gh pr checks 441` on the head named in the header: `ledger` › `docker` pass (the image's boot and the UI request), `CI` › `check` pass, `CI` › `test (ubuntu-latest)` pass, `CI` › `test (windows-latest, informational)` pass, `security` › `codeql`, `CodeQL` and `dependency-review` pass, `pr-title` pass. `gh pr view 441 --json headRefOid` reports the head gated. **proven (gate)**, counted proven: every leg has run green on this head. The trap "the second file must not make Windows file tests time out" is covered by that same Windows leg.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

I ran the suites at the head: `npx vitest run tools/ledger/api` 442 of 442 (25 files), `npx vitest run tools/ledger/web` 127 of 127 (13 files). I did not re-run `npm run check`; CI's `check` is green on this head. The branch's test diffs delete no assertion that still has a subject: the one removed (`ACCESS_PEOPLE` naming an address twice) tested a setting that no longer exists, and `route-limits.test.ts` only moved its route table to `helpers/routes.ts`.

### Measured for the owner: the premise of the two-name cap

The dispatch asks for the measurement only; no recommendation is made. Books: seven synthetic rows (an `alex` mortgage deposit of 500.00, a `sam` one of 400.00, a joint payment of -700.01, two buffer contributions, taxes, an opening deposit), salaries 6 000 000 and 4 000 000 cents for 2026, the ratio confirmed, and period 1 closed (alex owes sam a deposit of 350.00). Then `sam` is removed from the directory, and the books are booted again on 2027-02-03. World B adds nobody; world C adds `casey`, with the cap's trigger dropped on a scratch copy and the row inserted raw, since the cap would otherwise refuse (`addMember` after sam's removal gives `HOUSEHOLD_FULL`, and the books stay at two names).

| Read                                                                         | B: sam removed, nobody added              | C: sam removed, casey is a third name                                                           |
| ---------------------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `GET /api/people`                                                            | `["alex","sam"]`                          | `["alex","casey","sam"]`                                                                        |
| `GET /api/buckets?asOf=2026-09-30` mortgage `own`, balance 19999             | alex 14999, sam 5000; `lead` alex by 9999 | alex 26666, **casey -23334**, sam 16667; `lead` **null** (the joint payment is split in thirds) |
| `GET /api/stats/mortgage-own` and `/contributions` people                    | alex, sam                                 | alex, casey, sam                                                                                |
| `POST /api/salaries` 2027 for alex and the newcomer, then `POST /api/ratios` | 200, 200 (70/30)                          | 200, 200 (70/30, alex and casey)                                                                |
| `GET /api/periods/open?end=2027-01-31`                                       | 200, alex deposits 733.33                 | **400 `BAD_REQUEST`, "Every ratio in a settlement is between the same two people."**            |
| `POST /api/periods/close` 2026-10-01 to 2027-01-31                           | 200, same settlement                      | **400, same message**                                                                           |

So a third name in `people` rewrites a past mortgage split in thirds (a figure the owner already relied on), drops the lead, and stops the next period from closing. This holds whichever way the cap counts: what matters is whether the third name reaches `people`, and the enroller puts every current member's name there. **Unmeasured:** a cap counting only current members was not built; world C is what that rule would admit.

### Findings

- **med** · no `Done when` line depends on it · **F1 — the household id's schema CHECK admits an embedded NUL**, against the brief's "a plain lowercase word that the schema and the code both refuse otherwise". `id NOT GLOB '*[^a-z]*'` and `length(id)` both stop at the first NUL, so `ho\0me`, `a\0` and `ho\0me\0` pass. Repro on a migrated directory (`migrateDirectory`): `INSERT INTO households (id, name, created_at, created_by) VALUES (?, 'N', 'x', 'raw')` with `"ho\u0000me"` is accepted and `hex(id)` reads `686F006D65`, while `Directory.addHousehold({ id: "ho\u0000me", … })` answers `BAD_REQUEST`. The test "has an id that is one plain lowercase word, refused otherwise by the code and the schema" has no NUL in its list. Not graded `high`: the class is the only writer today and refuses it, so no caller can store one; but the migration's comment and that test's title say the schema refuses it, and it does not. Stated fix, run on a scratch table: add `AND length(CAST(id AS BLOB)) = length(id)` to the CHECK (it refuses all three NUL forms and accepts `home` and a 32-letter id), as a new migration only if the shipped one cannot be edited, and add a NUL row to the refused list. Not run against the full suite.
- **low** · **F2 — the append-only property is held by `UPDATE`/`DELETE` triggers and a regex, and neither sees `INSERT OR REPLACE`** (no live call site: nothing issues one, and it needs write access to the file). On a directory with two adds, `INSERT OR REPLACE INTO memberships (id, address, household_id, person, action, changed_at, changed_by) VALUES (1, 'alex@example.test', 'home', 'alex', 'remove', 'x', 'raw')` was accepted and row 1 stopped being an `add` (`recursive_triggers` is 0, so SQLite deletes the old row without firing the `DELETE` trigger); `INSERT OR REPLACE INTO households …` renamed `home`. The scan has the same blind spot as its model in `classification-schema.test.ts`, which uses the same regex: planting `UPDATE "memberships" SET …` and `INSERT OR REPLACE INTO memberships …` in `directory.ts` left `directory.test.ts` at 12 of 12 green. Fix: a `BEFORE INSERT` trigger refusing an `id` that exists, and `REPLACE` and a quoted or qualified table in the scan.
- **low** · **F3 — a stale `LEDGER_ACCESS_PEOPLE` is not caught on the production path** (open decision; no `Done when` line depends on it, line 5 is met as written). Step 5's stated purpose is that "a stale `.env` cannot look as if it still admits people". `compose.ledger.prod.yaml` passes only the variables it names, so the API never sees `ACCESS_PEOPLE`. Repro: `docker compose --env-file <env with GHCR_OWNER, LEDGER_TAG, LEDGER_ACCESS_TEAM, LEDGER_ACCESS_AUD and LEDGER_ACCESS_PEOPLE=alex@example.test=alex> -f compose.prod.yaml -f compose.ledger.prod.yaml config` renders the ledger with `ACCESS_AUD`, `ACCESS_TEAM` and `LEDGER_ADMINS: ""` and no error. The owner's host `.env` will hold that line, since the compose file required it until now. The sentence in `.env.prod.example` ("the API refuses to start with ACCESS_PEOPLE set: delete the line") is true of the API and unreachable from compose. Options: (a) reword that sentence and the deployment note to say nothing refuses it and it is deleted by hand; (b) make compose refuse it, which a probe compose file confirmed works as `SOME_VAR: "${LEDGER_ACCESS_PEOPLE:+${NEVER_SET:?LEDGER_ACCESS_PEOPLE is retired - delete it from .env}}"` (an error when set, empty when not; the variable must not be named `ACCESS_PEOPLE`, which the API refuses even when empty). Recommendation: (a), one sentence, unless the owner wants the stack to refuse.
- **low** · **F4 — the second file at boot**: every bad state I tried refuses with a typed `INTERNAL` and exit 1, except a missing file. Run as real `dist/main.js` processes, these refuse: a garbage file (`file is not a database`), `0444` in a `0555` directory (`attempt to write a readonly database`), a path that is a directory (`unable to open database file`), a parent that cannot be made (`EACCES`, `ENOTDIR`), and `DIRECTORY_PATH` set to the books file (`no such table: current_members`, books left at `user_version` 7, 23 tables, integrity ok). A populated `0444` file in a writable directory starts and serves reads, which is right for a read-only directory. **A missing file is created empty and the process starts**: `/api/health` answers `ok: true` and every request is 403, with only the per-request info line to say why, and nothing logged at boot says the directory has no household. It fails closed and admits nobody, but an unmounted volume or a wrong `DIRECTORY_PATH` looks like a healthy service refusing everyone. Also `DIRECTORY_PATH` equal to `DATABASE_PATH` on a fresh path fails at boot (`no such table: statement_imports`) and leaves that file half-migrated at `user_version` 4 with both schemas' tables. Fix: a `warn` at boot when the directory holds no member, and a config refusal when the two paths are equal.
- **low** · **F5 — enrolment on the request path turns a failed write into a failed read** (no `Done when` line depends on it). Measured: 40 concurrent first requests from a household whose newly added name the books lack made one row change, and the 41st none; five sequential boots left `["alex"]` and four real processes booting at once on one books file (two of them died on the books' own migration race, below) left `["alex","sam"]`, with no duplicate or partial row (the PK and `INSERT OR IGNORE` hold). So the first `GET /api/people` after a member is added does write, as the Log says. If the books cannot take that write, **every** request from that household then fails, not only the new member's, and nothing caches the failure: with the books write-locked by another connection, `GET /api/people` returned 500 `INTERNAL` after 5006 ms and `GET /api/rules` 500 after 5005 ms (the 5 s `busy_timeout`, spent synchronously on the event loop), and with a connection that cannot write both `GET /api/people` and `GET /api/buckets` returned 500; `GET /api/people` answered 200 again once the write could happen. The body is the generic `INTERNAL` message, nothing leaks. Before this branch those reads were served while writes failed. The condition is a name the books lack at the same time as an unwritable books file (the import command holds the lock while it writes).
- **low** · **F6 — the per-request enrol reads the whole directory** (no live call site at one household; a separate mechanism from F5, same hook). `Directory.people(household)` runs `members()`, which selects every current membership and filters in JavaScript, and the identity hook calls it on every request before the route-level rate limit. Measured on a built `Directory` with 6000 members in 3000 households: `membershipOf` 0.018 ms per call, `people(household)` 10.1 ms. Negligible at the one household the host command allows; it grows with lg-21 and lg-22. Fix: filter in the SQL.
- **low** · **F7 — the upgrade path: the cap counts the directory's names, not the books'.** A books file that already holds `alex` and `sam` (from `ACCESS_PEOPLE`), a new empty directory, and an operator who types `Alex` for the first member: no refusal, `people` becomes `["Alex","alex","sam"]`, and the mortgage `own` shows three people and `lead` null, as in world C. The deployment note says the directory is empty on first deploy and to delete `LEDGER_ACCESS_PEOPLE`, and does not say the names must be the ones the books already hold. Mitigated by the lg-21 brief ("the owner had not started using the ledger… `/data/ledger.db` is deleted at deploy"), which is why it is `low`. Fix: one sentence telling the operator to copy the names from the old `LEDGER_ACCESS_PEOPLE` before deleting it.
- **low** · **F8 — no test crosses a process.** "A removal takes effect without a restart" is asserted on the one `Directory` object the app and the test share. The documented path is the host command, a second process writing a file the running API reads; I ran that with the real command and a running server (removed, 403 on the next request; re-added, 200), and it worked, but nothing asserts it. A test with two connections on a temp file would. Likewise `ledger.yml` does not run the household command inside the image; I ran the built `household-ledger.js` under the image's environment (`NODE_ENV=production`, Access set, `LEDGER_ADMINS` empty) and `add`, `member`, `list`, `remove` all exited 0. The image itself was not run by me.
- **dropped** · four of six real server processes booting at once on a fresh books file: two die (`duplicate column name: source`, `table spending_categories already exists`). That is the books' own migration race, unchanged by this branch; with the books already migrated, 6 of 6 start.
- **dropped** · `NODE_ENV=prod` boots with `DEV_IDENTITY`. `isProduction` is the literal `production`, as before; not in this diff.
- **dropped** · `DIRECTORY_PATH=/proc/nope/directory.db` hangs the boot with no output. Node's recursive `mkdir` under `/proc`; `DATABASE_PATH` does the same, and `EACCES` and `ENOTDIR` refuse properly.
- **dropped** · `Directory.addHousehold` accepts a second household; only the command refuses. That is what the brief says (the command refuses until lg-21).
- **dropped** · a person's name has no character set beyond 1 to 64 characters, trimmed. Operator-set text, escaped by the UI; not a defect of this ticket.
- **findings** · the hunt returned 13; 8 carried (F1 to F8), 5 dropped.
- Household ids, enumerated: `../x`, `a/b`, `a\b`, `.`, `..`, empty, a space, `CON`, `Com1`, `lpt9`, `com1`, `con`, `prn`, `aux`, `nul`, `AUX`, `nUl`, `home.`, ` home`, `ho me`, a trailing newline, `é`, a fullwidth letter, `home:stream`, `~1`, `clock$`, 33 and 300 characters are refused by `isHouseholdId` and by `Directory.addHousehold`, and by the schema except the NUL forms (F1). `home ` (trailing space) is trimmed and stored as `home`. `com`, `lpt` and `conin` are accepted, correctly: only the four device names without a digit can occur, since digits are refused. lg-21's `<data>/households/<id>.db` layout cannot collide with `directory.db` or `ledger.db`.
- Membership as a log, enumerated: add, remove, add (all three rows stamped the same millisecond) resolves to a member; add, remove, add under another name resolves to the new name; a remove stamped in 2020 after an add stamped later still ends it (the view orders by `id`, not time); a remove of an address never added, of an already-removed one, or naming the wrong person is refused by the class and by the trigger.
- Invariants walked: no cross-tool import (`@ledger/*` only); failures are `AppError` (core `BAD_REQUEST` for the directory's other refusals, and `HOUSEHOLD_FULL`, are the owner's open question and the settled decision, not graded); no shell in the new source; redaction n/a (the log names an address at info, which the brief settles); contract edits are the approved `Person.household` and `MeResponse.admin` plus `HealthResponse.directory` (open question, not graded); the new specs sit in already-registered packages; no new workspace dependency, so no `Dockerfile` pair, only the added `ENV DIRECTORY_PATH`; SSRF and progress n/a. Style is covered by CI's `check`.
- NFR: security ✓ (nobody admitted who should not be; F1 and F2 are raw-writer holes with no caller) · performance — F6 · reliability — F4, F5 · maintainability — F3 and F7 are documentation that overstates or omits.

## Log

- 2026-10-12 — Filed from the owner's design discussion. The decisions are in
  `00-ANALYSIS.md` §7 and the roadmap. Asked and answered in order: whose books a
  second person sees (households in one app, over a separate instance or joining
  these books); how households are kept apart (a file each, over a column); where
  membership lives (a database, over configuration); who manages it (an admin
  screen, with each household's members adding but not removing); and the gate
  (keep Access, open its policy, the directory decides, over an allowlist on
  Access and over replacing Access with an OIDC provider).
- 2026-10-12 — Reviewed before merge, and the owner reversed the gate: Access
  keeps its allowlist and the directory decides, so the limit on refusals by
  client address moved to repo-98, which is now the deferred opening. The review
  also found that this ticket refused every non-member at the hook while lg-22
  let an admin be in no household, which is now the identity's admin flag with
  `personOf` failing closed; and that nothing capped a household at the two
  people the books can settle, which is now step 1's cap.
- 2026-10-12 — Built on `lg-20` from `main` at `bb4d2044`. The directory is
  `api/src/directory.ts` over its own migrations in
  `api/src/db/directory-schema.ts`; the identity check reads it on every request
  (`createIdentityVerifier` in `api/src/access.ts`, `personOf` and `identityOf`
  in `api/src/identity.ts`); the host command is `api/src/household-command.ts`;
  the web's page is `web/src/NoHousehold.tsx`. `Person` gains `household`,
  `MeResponse` gains `admin`, `HealthResponse` gains `directory` (the brief's
  trap asked for it), and `HOUSEHOLD_FULL` (409) is the one new ledger code.
  - Each `Done when` test was made to fail first by loosening what it guards,
    one at a time, with the source restored after each: a verifier that caches
    membership fails "once removed, is refused on the next request, without a
    restart"; a `personOf` that lets a null person through fails "is
    identified, and refused by /api/me as by every books route"; a `DELETE FROM
memberships` string in the command fails the directory scan; a dropped
    update trigger fails "the schema refuses an UPDATE or a DELETE"; a cap of
    three in the code fails three tests, in the trigger one; dropping the
    second-household refusal, the `ACCESS_PEOPLE` refusal, the `DEV_IDENTITY`
    check, or keying the page on `UNAUTHENTICATED`, each fails its own test.
  - The dev flow, run through npm against scratch files: `add`, `member`, a
    refused second `add` (exit 1), `list`; then the built API with
    `DEV_IDENTITY` answered `/api/me` with
    `{"person":{"id":"alex","email":"alex@example.test","household":"home"},"admin":false}`,
    health with `"database":{"open":true},"directory":{"open":true}`, `/api/people`
    with `["alex","sam"]` after `member home sam@… sam` without a restart, and
    403 `FORBIDDEN` for alex after `remove` without a restart. Boot refused
    `ACCESS_PEOPLE=x` and a `DEV_IDENTITY` the directory lacked, each naming it.
  - **What the brief had wrong, or left open.**
    - _Enrolled when a member is added_: the host command is another process
      and never touches the books, so the API enrols. Boot enrols every current
      member's name, and the identity hook enrols the caller's household's names
      it has not seen (`createEnroller` in `api/src/people.ts`, remembering what
      the table holds so a request with nothing new writes nothing). So a member
      added from the host is in `/api/people` from the next request anyone in
      the household makes.
    - _At most two person names_ is counted over every name the household has
      **ever** held, not only its current members': the books keep a name once
      they hold it (§7, a name is permanent) and settle between two people, so a
      third name after a removal would break them all the same. A removed name
      may come back under any address. Recorded as an open decision for the
      owner in the report; the trigger and the check are one line each to change.
    - The directory's other refusals — an id that is not a word, a household
      that exists or does not, an address already in one, removing one in none —
      are core's `BAD_REQUEST` with a sentence for the operator, because only the
      host command can reach them; lg-22 step 8 adds a ledger code with the
      route that first throws one. The cap is the one the brief named as a
      ledger code.
    - The existing source scan in `classification-schema.test.ts` already
      covered the new files. The directory's own scan
      (`directory.test.ts`) also asserts it read the schema, the class and the
      command, and the schema refuses an `UPDATE` or `DELETE` itself, with
      triggers.
    - A household id also refuses `con`, `prn`, `aux` and `nul`, which Windows
      will not open as `<id>.db` once lg-21 makes it a file name.
    - `/api/me` refuses an admin in no household, as every books route does,
      so `MeResponse.person` stays non-null; the web shows the no-household page
      on that `FORBIDDEN`, and leaves the shell on any other failure.
    - The host command signs its changes `operator`, never an address.
    - `00-ANALYSIS.md` §7 said a request with no valid token gets a 401; it has
      been a 403 since lg-3, by the owner's decision. Corrected with the rest of
      §7.
    - The route table `route-limits.test.ts` walked is now
      `api/test/helpers/routes.ts`, shared with the identity suite's walk;
      lg-21's isolation sweep and lg-22's authority sweep can take it too.
  - **Fold-in:** nothing else became free. lg-19 and lg-8 rebase onto the
    `Person` and `MeResponse` change; neither is touched here.
- 2026-10-12 — The owner answered the three open decisions the build reported.
  The builder recommended option A in all three; none of its recommendations
  was overridden.
  - **Two-person cap.** Options: (A) count every name the household ever held,
    as built; (B) count current members only. The question carried the gate's
    measurement: after sam's removal, a third name split the mortgage bucket
    three ways with `lead` null, and period open/close returned 400 "Every ratio
    in a settlement is between the same two people." Owner, verbatim: "There
    should not have a cap count. A household could have 3, 4, 5 if needed. But,
    we would need a way to manage persons in household, because it can change.
    Usually very not often, but still. We can settle for now as built, but keep
    that in mind, maybe fill a ticket?" So A stands for now, and the cap's
    removal is filed as [lg-23](./lg-23-a-household-of-more-than-two.md).
  - **Codes for the directory's other refusals.** Options: (A) core
    `BAD_REQUEST`; (B) four new ledger codes. Owner chose **A**, as built.
  - **Contract scope and audit.** Options: approve both as built; approve the
    health field but add a `--by <address>` flag; remove the health field. Owner
    chose **approve both**: `HealthResponse.directory: { open }` is approved as
    an additive contract change, and the changed-by stays the literal `operator`.
- 2026-10-12 — Gate 1's **F1** (med: the household-id CHECK admits an embedded
  NUL, `ho\0me` and `a\0`) is _fixed at landing_, by the owner's instruction,
  with no re-gate and no round opened. F2 to F8 stay recorded and unfixed; F3's
  option (a) was offered to the owner for landing and not chosen. The gate
  section is committed as written.
  - The clause is `AND length(CAST(id AS BLOB)) = length(id)` in the `households`
    CHECK in `api/src/db/directory-schema.ts`, as the finding gave it. The test
    is "the schema refuses an id with a NUL in it, at the start, the middle or
    the end", the last test in `api/test/directory.test.ts`, inserting each of
    `\0home`, `ho\0me`, `a\0` and `\0` straight through SQL.
  - Without the clause, `npx vitest run tools/ledger/api/test/directory.test.ts`
    exits 1:
    `× the schema refuses an id with a NUL in it, at the start, the middle or the end`,
    `AssertionError: "ho\u0000me": expected [Function] to throw an error`,
    `Tests  1 failed | 12 passed (13)`.
  - With it, the same command exits 0: `Tests  13 passed (13)`.
  - The ledger API project with the clause: `npx vitest run tools/ledger/api`
    exits 0, `Test Files  25 passed (25)`, `Tests  443 passed (443)`.
