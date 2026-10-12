---
id: lg-20
tool: ledger
title: Who belongs to which household, read from a directory database
kind: work-package
status: ready
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
