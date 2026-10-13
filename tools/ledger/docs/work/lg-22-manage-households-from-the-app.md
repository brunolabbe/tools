---
id: lg-22
tool: ledger
title: Households and their members, managed from the app
kind: work-package
status: done
milestone: P6
depends_on: [lg-20, lg-21]
difficulty: hard
---

# lg-22 — Households and their members, managed from the app

## Why

After [lg-20](./lg-20-the-household-directory.md), the directory is changed only by
a command on the host. The owner chose to manage it from the app
(`00-ANALYSIS.md` §7, _Who manages membership_, decided 2026-10-12):

- an admin creates households and adds or removes any member;
- a household's own members can add a member to their household and remove
  nobody, because removal cuts a person off from their own records.

## Build

1. **Who is an admin** is `LEDGER_ADMINS`, which lg-20 reads. An admin need not be
   a member of any household. Being an admin grants directory rights only: an
   admin reads a household's books only by being its member.
2. **Admin routes** live under `/api/admin/`, guarded by an `adminOf(request)` that
   fails closed. An admin can:
   - list households and their current members;
   - create a household, which gets its books file the way lg-21 gives a new
     household one;
   - add a member;
   - remove a member.
3. **Household routes**, for a member of that household only:
   - list the household's members and its membership history (who added or
     removed whom, and when);
   - add a member.

   There is no removal route here, and a test proves a member cannot remove
   anyone through any route.

4. **Every change is an appended directory record naming the person who made it**
   (lg-20). Adding an address that already belongs to another household is
   refused, and so is a third person name (lg-20's cap). **A member is told only
   that the address cannot be added**, whichever the reason: the reason would
   let any member ask whether an address uses the ledger. An admin is told
   which. An address that changes household is a removal by an admin, then an
   add. _What this hides is which household holds an address, not that one
   does: an add that succeeds and one that is refused still tell the two apart,
   which any answer distinguishing them would. The owner accepted that on
   2026-10-13 (gate 1, F6); an add that succeeds is a record naming the member
   who made it._
5. **Every new route takes a rate limit** (`rateLimitsFor(context).write`/`.read`),
   or `api/test/route-limits.test.ts` fails. An admin route is keyed on the
   admin's address, since an admin may have no person (lg-20), and
   `route-limits.test.ts` accepts that hook as it does the two.
6. **The authority sweep.** It walks every admin route as a non-admin member, and
   every household route as a member of the _other_ household and as an admin
   in no household, and every route as an address Access admits that is
   neither member nor admin. Each must answer 403 and change nothing. Make it
   fail first by loosening one guard, and record the failing run in the Log.
7. **The screens.**
   - An admin sees households and members, with add and remove.
   - A member sees their household's members and history, and adds one.
   - Mobile-first, as the rest of the web is.
   - Each screen tells whoever adds a member that the address must also be
     admitted on the ledger's Access policy, which the operator does in the
     dashboard (`docs/02-DEPLOYMENT.md`, step 2), and the admin screen lists
     every household's addresses so the operator can see which to admit.
8. **Error codes.** A new ledger code arrives with the route that first throws it,
   with its status in `api/src/http-errors.ts` (the ledger `CLAUDE.md`), for
   example an address already in another household. Use core's `FORBIDDEN` for a
   refusal of authority.
9. **What lg-20's gate left on the directory's writers** (gate 1, F2 and F6). This
   ticket adds the first writers in the app, so they are fixed here.
   - **`INSERT OR REPLACE` gets past append-only** (F2). It deletes the old row
     without firing the `DELETE` trigger (`recursive_triggers` is off), so a
     membership's `add` can become a `remove` and a household can be renamed.
     The source scan in `directory.test.ts` has the same blind spot, and misses a
     quoted table too. Add a `BEFORE INSERT` trigger in `directory-schema.ts`
     that refuses an `id` that already exists, and make the scan see `REPLACE`
     and a quoted or qualified table name. Plant each and watch it go red.
   - **The member lookup reads the whole directory** (F6). `Directory.people`
     selected every current membership and filtered in JavaScript, and the
     identity hook calls it on every request: 10 ms at 6000 members, against
     0.02 ms for `membershipOf`. **Done in lg-21**, whose per-household books
     are attached by that hook: `Directory.members(household)` filters in the
     SQL. Nothing is left of it here.

**Traps.**

- A member's history shows other members' addresses. It shows them only within
  their own household, and a test proves that.
- The admin screen lists every household. Showing it to anyone but an admin is the
  leak the sweep exists to catch.

## Done when

1. An admin creates a household, adds and removes members, and the new household
   can sign in to empty books of its own; API and web tests prove it.
2. A member adds a member to their own household and sees its history, and can
   remove nobody; tests prove both.
3. The authority sweep proves every admin route refuses a non-admin, every
   household route refuses a member of another household and an admin in no
   household, and every route refuses an admitted address that is neither,
   with nothing changed. The Log records that it failed with one guard loosened.
4. Every new route is rate limited (`route-limits.test.ts`).
5. The schema refuses an `INSERT OR REPLACE` over an existing membership or
   household, and the source scan fails on a planted `REPLACE` and on a quoted
   table (step 9).
6. Gates green.

## Review

**Gate: FAIL** — 2026-10-13 · `9580c2b1..d7cb745c` (`git diff 9580c2b1...d7cb745c`, 36 files; head is a merge from `main`) · Sonnet 5.5, depth full

One `high` (F1, shipped text false against the code, no data exposed); every `Done when` line is proven. The authority seam holds under 6498 real requests. Pull request #472's CI on this head is green on all nine checks.

| Done when                                                                                                                                                                                                                        | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. An admin creates a household, adds and removes members; the new household signs in to empty books                                                                                                                             | **proven** — `api/test/households.test.ts` › "creates a household, adds its members, and they sign in to empty books of their own" (asserts the new member's `/api/me`, empty `rules` and `people`, a rule filed lands in `cabin`'s books while `home`'s count stays 0, and the history record is `by` the admin) and › "removes a member, who is refused on the next request; their name stays in the books"; web `web/test/admin.test.tsx` › "creates a household, adds a member to it and shows the list again" and › "removes a member only once the removal is confirmed" |
| 2. A member adds to their own household and sees its history, and can remove nobody                                                                                                                                              | **proven** — `households.test.ts` › "adds a member to their own household, signed with their address", › "sees their household's members and its history, with who made each change", › "can remove nobody, through any route" (red with `adminOf` loosened, below); web `household.test.tsx` › "offers no way to remove anyone" (companion assertion: the only button is "Add member", so it does not pass on an empty screen)                                                                                                                                                |
| 3. The authority sweep refuses every admin route to a non-admin, every household route to the other household and to an admin in no household, every route to an admitted stranger, nothing changed; the Log records the red run | **proven** — `api/test/authority.test.ts` › "every admin route › refuses a member who is no admin, and changes nothing", › "every household route › refuses a member of the other household…", › "…refuses an admin in no household…", › "every route › refuses an address Access admits that is neither member nor admin…", each with a "control:" test that the same request succeeds as the right identity. The Log's red run reproduced (below). The sweep sends valid JSON only, which is why F1 slipped through it                                                       |
| 4. Every new route is rate limited                                                                                                                                                                                               | **proven** — `api/test/route-limits.test.ts` › "every route in the contract is accounted for, so a new one cannot be forgotten" plus its per-route "refuses the second request in a minute, as RATE_LIMITED" rows for `household`, `householdMembers`, `adminHouseholds`, `adminMembers`, `adminMemberRemove`, › "POST adminHouseholds refuses the second request in a minute too", and the three "the key, on an admin route" tests                                                                                                                                           |
| 5. The schema refuses `INSERT OR REPLACE` over a membership or household; the scan fails on a planted `REPLACE` and a quoted table                                                                                               | **proven** for the spellings the ticket names — `api/test/directory.test.ts` › "the schema refuses an INSERT OR REPLACE over an existing membership or household" (four statements incl. an upsert, each `toThrow(/appended, never replaced/)`, rows compared after, a new record still goes in), › "a directory made before the trigger takes it on its next open", › "the source scan sees a REPLACE and a table quoted or behind its schema", › "no source file that writes the directory issues an UPDATE or a DELETE". Residual scan blind spots are F3                   |
| 6. Gates green                                                                                                                                                                                                                   | **verified** — `npm run check` exit 0 here; `npm test -- --project ledger`: `Test Files  56 passed (56)`, `Tests  954 passed (954)`. PR #472 on head `d7cb745c`: `check` ×2, `test (ubuntu-latest)`, `test (windows-latest, informational)`, `docker`, `codeql`, `CodeQL`, `dependency-review`, `changes` all `pass`                                                                                                                                                                                                                                                           |

### What I ran

- **Routes enumerated by Fastify**, not by the test list: `printRoutes({ includeHooks: true })` on the booted app lists eight entries for the branch (`GET`, `HEAD` of `/api/households/:id`; `POST` `…/members`; `GET`, `HEAD`, `POST` of `/api/admin/households`; `POST` `…/:id/members`; `POST` `…/:id/members/remove`), every one with `rateLimit()` in `onRequest`. Admin routes: guard in the hook and again in the handler. Household routes: `personOf` in the hook, `memberOf` in the handler only.
- **6498 real requests** through `server.inject` (script `probe.mts`; each on a fresh app): 6 identities (unauthenticated, stranger, alex of `home`, kim of `away`, an admin in no household, alex made an admin too) × 7 verbs × 57 path spellings (home/away/nonexistent/`HOME`/`ho%6De`/`ho%2Fme`/`%2e%2e`/`home%00`, trailing slash, `/api/Admin`, `//`, doubled slash) × four bodies. Results: every `/api/admin/...` request from a non-admin is 403 `FORBIDDEN` (POST, GET, HEAD) or route-miss 404 `NOT_FOUND` (PUT/PATCH/DELETE/OPTIONS), 0 directory changes; alex and kim changed the directory only by adding to their own household (`/api/households/home/members`, `/api/households/ho%6De/members`); no request from a non-admin removed anyone. For a member, another existing household and a nonexistent one answered identically across all 19 verb×body combinations on both household paths (`away==nonexist: True` for alex, `home==nonexist: True` for kim); stranger and unauthenticated identical too. Trailing-slash, case and doubled-slash variants are 404 `NOT_FOUND` for everyone, including the unauthenticated. **Positive control for the harness:** the same run shows the privileged identities answered 200 with `changed=true` (admin POSTs, alex's own add), so a 403 here is the guard's, not a harness that cannot succeed.
- **Positive control, `memberOf` loosened** (the household comparison removed from `identity.ts`, `npx vitest run tools/ledger/api/test/authority.test.ts`):
  - Red: `Tests  1 failed | 10 passed (11)` — "every household route > refuses a member of the other household, and changes nothing"; `admitted` held `GET /api/households/home: 200 {"household":{"id":"home",…` and `POST /api/households/home/members: 200 {"address":"casey@example.test","person":"sam"}`; `- "directoryChanged": false` / `+ "directoryChanged": true`. With the same mutation `households.test.ts` › "sees no other household's members or history, in their own or by asking for it" also went red (`Tests  1 failed | 13 passed (14)` over `households.test.ts` + `isolation.test.ts`).
  - Restored (`git checkout d7cb745c -- tools/ledger/api/src/identity.ts`, 0 mutation markers left): `Test Files  1 passed (1)`, `Tests  11 passed (11)`.
- **Second control, `adminOf` loosened** over `authority.test.ts` + `households.test.ts` + `route-limits.test.ts`: `Tests  3 failed | 80 passed (83)` — "refuses a member who is no admin, and changes nothing", "can remove nobody, through any route", and "refuses a non-admin as FORBIDDEN, spending nothing, with the limits on or off". Restored.
- **Step 9, F2.** `triggers` probe (`trigger.mts`) on a migrated directory: `INSERT OR REPLACE`, lowercase `replace into`, multi-line `REPLACE\n INTO`, `ON CONFLICT(id) DO UPDATE`, `ON CONFLICT DO NOTHING`, `INSERT OR IGNORE` with a taken id, `rowid`-keyed replace, `main.households` — all `refused: … appended, never replaced`, rows unchanged; `UPDATE … SET id` and `UPDATE OR REPLACE` refused by the older UPDATE trigger. A directory file at `user_version` 1 accepted `INSERT OR REPLACE INTO households` (the lg-20 hole), then `Directory.open` moved it to 2 and refused the same statement. With migration 2 deleted, `directory.test.ts`: `Tests  2 failed | 14 passed (16)`. With `INSERT OR REPLACE INTO memberships (id) VALUES (1)` planted in `src/directory.ts`, the source scan went red (`expected [ 'directory.ts' ] to deeply equal []`).

### Findings

- **high** · no `Done when` line depends on it · **F1 — the household routes' guard runs after the body is parsed, and the shipped text says the opposite.** `api/src/routes/households.ts`'s header says "Every guard runs before the body is read, so a refusal is the same 403 for any request", and the ticket's Log repeats "Every guard runs before the body is read". That holds for `/api/admin/...` (the guard is in the `adminRead`/`adminWrite` hook) and not for `/api/households/:id`: its hook is `read`/`write`, which asks only `personOf`, and `memberOf(request, id)` is the first line of the _handler_, which Fastify reaches after parsing the body. Reproduction (`probe2.mts`, section A; premises: limits off, alex a member of `home`, `away` exists, `nonexist` does not):
  ```
  alex POST /api/households/away/members     [invalid JSON] -> 400 BAD_REQUEST     (claim: 403)
  alex POST /api/households/nonexist/members [invalid JSON] -> 400 BAD_REQUEST
  alex POST /api/households/home/members     [wrong content-type] -> 400 BAD_REQUEST
  alex POST /api/households/away/members     [wrong content-type] -> 403 FORBIDDEN
  alex (non-admin) POST /api/admin/households [invalid JSON] -> 403 FORBIDDEN
  ```
  Measured impact is nil for the seam: the 400 is the same for `away`, `home` and a household that does not exist, so nothing distinguishes them, and nothing changes. It is graded by the table's clause on shipped text false against the code. The sweep does not see it because every probe sends valid JSON. **Open decision, two remedies:** (a) reword the sentence in `routes/households.ts` and correct the Log line to say the admin's guards run in the route's hook and a household's own in the handler, after the body is parsed; (b) run `memberOf` in an `onRequest` hook for the two household routes (`request.params` is populated in a route-level `onRequest` hook: measured `{"id":"home"}`), so the sentence becomes true, and add an invalid-JSON probe for each household route to the sweep. **Recommend (b)**: about eight lines, it makes the household routes refuse like the admin routes do, and it closes the one request shape the sweep never sent. (a) is acceptable if the owner prefers the smaller change.
- **low** · no `Done when` line depends on it · **F2 — web: any failure of the admin list after `/api/me` answers FORBIDDEN is shown as "No household".** `web/src/App.tsx` catches _everything_ from `fetchAdminHouseholds` and sets `inNoHousehold`; only FORBIDDEN means that. Reproduction (a scratch spec copied into the disposable tree and deleted, `zz-gate-tmp.test.tsx`; `fetchMe` rejects `FORBIDDEN`):
  ```
  admin-list failure UNREACHABLE: "No household" page=true, books shell=false
  admin-list failure RATE_LIMITED: "No household" page=true, books shell=false
  admin-list failure INTERNAL:    "No household" page=true, books shell=false
  ```
  An admin in no household (the first-run state `docs/02-DEPLOYMENT.md` describes) who meets a transient failure on that one request is told the ledger does not know them; a reload fixes it. `App.tsx`'s header promises that "Any other failure leaves the shell". Fix: send only FORBIDDEN to `inNoHousehold` and let any other failure leave the shell, as the `/api/me` branch does. The two cases the dispatch named do behave: a stranger (me and the admin list both FORBIDDEN) sees "No household" and no admin screen, and a non-admin member's Household tab holds no "Remove" text and no button matching `/remove/i`, and has no Admin tab (both passed in the scratch spec).
- **low** · no live call site · **F3 — the append-only scan still misses SQL spellings SQLite accepts, and its comment claims it does not.** `api/test/helpers/append-only.ts` says a table name is matched "bare or quoted any of the three ways SQLite reads one". SQLite reads a fourth: a single-quoted name in table position. Measured by running each through SQLite itself (each reached the `never edited` trigger, so each is valid SQL) and then the scan (`trigger.mts`):
  ```
  UPDATE 'memberships' SET …                          SQLite: valid   scan: false
  UPDATE memberships AS m SET …                       SQLite: valid   scan: false
  UPDATE memberships INDEXED BY memberships_address SET …   SQLite: valid   scan: false
  INSERT … ON CONFLICT (id) DO UPDATE SET …           scan: MISSED
  DELETE /* c */ FROM memberships                     scan: MISSED
  ```
  Planting the single-quoted table, the `AS` alias and the upsert in `src/directory.ts` and running `directory.test.ts`: `Tests  16 passed (16)` (the scan stays green). The double-quote, backtick, bracket and schema-qualified forms the ticket names are all caught, as are `INSERT OR REPLACE` and `REPLACE INTO` in every case, multi-line and template-literal spelling I tried, so the vector F2 was about is covered; the trigger refuses all of the above at runtime. Also, `OR REPLACE` and `REPLACE INTO` match English prose in a comment ("a fallback or replace of…" is flagged), which the three innocent sentences in the test do not include. Fix: reword the comment, and match `\bUPDATE\b[^;]*?\bSET\b` and `\bDO\s+UPDATE\b` rather than a table shape.
- **low** · no live call site · **F4 — the admin rate-limit key shares a namespace with the person key.** `adminKey` is `admin:<address>`; `personKey` is `<household>:<person id>`; `admin` is a legal household id and a person's name is free text (1 to 64 characters). Reproduction (`probe2.mts`, section B, limit 3 a minute): the admin creates household `admin` with member `m1`; `m1` adds `m2@x.test` under the person name `admin@example.test`; `m2` reads `/api/rules` four times (`200, 200, 200, 429 RATE_LIMITED`); then the real admin's first `GET /api/admin/households` answers `429 RATE_LIMITED`. So a member can spend an admin's bucket, but only in a household whose id is `admin` and whose member is named exactly like the admin's address; the same collision writes the admin's address into a log line, against the hook's own "never writes the address into a log line" (`probe3.mts`: `{"level":"warn",…,"scope":"reads","key":"admin:admin@example.test","retryAfterSec":20,"msg":"rate limited"}`). Everything else I tried does not spend it: five requests from a non-admin member and five unauthenticated ones to an admin route all 403 and the admin then got `200, 200, 429` at a limit of 2 (no token spent by others), and the `rate limited` line for the admin carried no key and no address (0 lines mention the admin address). Fix: prefix the admin key with a character no household id can hold (a household id is `[a-z]+`), for example `@admin:`; or reserve `admin` as a household id.
- **low** · no live call site · **F5 — the sweep's "every method the server answers" leaves out `HEAD`.** `authority.test.ts` › "has a request for every admin and household route, with every method the server answers" loops `GET POST PUT PATCH DELETE`; Fastify also answers `HEAD` on both `GET` routes (shown in `printRoutes`). `HEAD` reuses the `GET` handler and hooks and my probe got 403 for every non-admin on `HEAD /api/admin/households` and `HEAD /api/households/<other>`, so nothing is broken; a future explicit `app.head(...)` without a guard would not be caught. Add `HEAD` to the method list.
- **low, and an open decision for the owner (not a defect of the build)** · **F6 — the member's generic refusal hides which household, not that an address is taken.** Measured (`probe2.mts`, section C; `sam`'s household `home` holds two names): adding `kim@away.test` as `sam` (in another household), `alex@example.test` as `sam` (in the member's own) and a free address as a third name `third` all answer `409 MEMBER_NOT_ADDED` with byte-identical bodies, as the brief intends. But adding a _free_ address under an existing name (`sam`) answers `200` and adds it. A member can therefore try any address under a name their household already holds: refusal means the address is in some household, success means it was free and is now theirs. The brief and `tools/ledger/CLAUDE.md` say the reason "would say whether an address uses the ledger"; the generic answer removes which household and the third-name case, and leaves this. Options: (a) accept it and say so in the ledger `CLAUDE.md` and the brief's rationale (recommended: any answer that distinguishes success from refusal carries it, and a probe that succeeds leaves a record naming the prober); (b) make a member's add a request an admin approves (reverses the owner's 2026-10-12 choice); (c) tighten the write limit on the member add route. No test on the branch asserts the opposite of any `Done when` line.
- **dropped** · the household directory accepts `INSERT OR REPLACE INTO households (id,…) VALUES (NULL,…)` as a new row: `households.id` is `TEXT PRIMARY KEY` without `NOT NULL`, which SQLite allows to be NULL. It replaces nothing, was in lg-20's migration 1, and no route can produce a NULL id (the schema and `addHousehold` refuse it). Out of this ticket; mentioned so the lander can file it if wanted.
- **dropped** · `DROP TRIGGER` followed by a replace succeeds. Out of scope: the app never issues DDL, and anyone who can run DDL on the file can do anything.
- **dropped** · an admin can add themselves to any household and so read its books (`adminMembers`). That is the brief (step 1: an admin reads books only by being a member; step 2: an admin adds any member) and every such change is a record naming the admin.
- **dropped** · a member can re-add an address an admin removed. That is the owner's choice (members add, nobody but an admin removes).
- **dropped** · a member's history shows an admin's address as `by`. Within the member's own household, and the brief's "who added or removed whom".
- **findings** · the hunt returned 11; 6 carried (F1 to F6), 5 dropped. The two owner-settled points (household id in the path; the FORBIDDEN fallback with no change to `MeResponse`) were not graded.

### Invariants walked

Contract edits (ROUTES, schemas, four codes) are within the brief's steps 2, 3 and 8. The four codes are in `LEDGER_ERROR_CODES`, `DEFAULT_ERROR_MESSAGES` (a `Record<ErrorCode, string>`, so exhaustive at compile time) and `STATUS_BY_CODE` (409, 409, 404, 404); `http-errors.test.ts` › "%s has a status line and does not answer 500" iterates the list and the new codes are in it; no other map over the code type exists in `contract`, `api` or `web`. `AppError` throughout, no bare `Error`, no shell, no `console`, no `any`. No cross-tool import, no new workspace dependency (the image-closure rule does not apply). New tests sit in existing registered test directories and ran. Redaction: no header or URL logged; the admin hook logs no key (F4 aside). No SSRF surface and no progress reporting in the diff (skipped). Every changed source file has a test file: `routes/households.ts` (`households.test.ts`, `authority.test.ts`), `identity.ts`, `rate-limit.ts` (`route-limits.test.ts`), `directory.ts`, `directory-schema.ts` (`directory.test.ts`); `web/src/api/households.ts` has none of its own, as none of its siblings do, every screen test mocks it.

NFR: security — authority seam measured, F1 (text), F4, F6 · performance n/a (admin list is one query per household, at household scale) · reliability — F2; migration 2 verified on a directory at version 1 · maintainability — F3, F5.

### Gate 2

**Gate: PASS** — 2026-10-13 · `d7cb745c..3e3d61d7` (`git log --no-merges d7cb745c..3e3d61d7` is one commit, `fix(ledger): guard household routes before the body is parsed (lg-22)`; its parent is `d7cb745c`, no merge in the range) · Sonnet 5.5, depth full

Gate 1's one `high` (F1) is fixed and every other finding is fixed or documented as the owner decided. The round adds two `low` findings (N1, N2), none a `high`, so **no third gate is needed**. PR #472 on head `3e3d61d7`: all nine checks `pass`, including `test (ubuntu-latest)` (7m44s) and `test (windows-latest, informational)` (9m10s), read at 01:53 UTC after they finished. `npm run check` exit 0 here; `npm test -- --project ledger`: `Test Files  56 passed (56)`, `Tests  960 passed (960)` (954 at gate 1).

| Gate 1 finding                                                 | Verdict                                                          |
| -------------------------------------------------------------- | ---------------------------------------------------------------- |
| **F1 (high)** guard runs after the body is parsed              | **fixed**                                                        |
| **F2** any admin-list failure shown as "No household"          | **fixed**                                                        |
| **F3** scan misses SQL spellings SQLite accepts                | **fixed** for every spelling named; residuals are new finding N1 |
| **F4** admin rate-limit key shares a namespace with a person's | **fixed**                                                        |
| **F5** sweep omits `HEAD`                                      | **fixed**                                                        |
| **F6** member's refusal still tells taken from free            | **documented** as the owner decided; text checked                |

### Verdicts, each with how I checked it

- **F1, fixed.** `api/src/routes/households.ts` now puts `asMember` (which calls `memberOf` on the path's id) in the `onRequest` list of both household routes, ahead of the rate limit, and each handler still asks again. `request.params` is populated there, as I measured at gate 1. Re-ran my gate 1 `probe2.mts`, section A, on the new head (same premises: limits off, alex a member of `home`):
  ```
  alex POST /api/households/away/members     [invalid JSON | wrong content-type | empty body w/ json type | oversize 2MB] -> 403 FORBIDDEN (all four)
  alex POST /api/households/nonexist/members [same four]                                                                   -> 403 FORBIDDEN (all four)
  alex POST /api/households/home/members     [invalid JSON | wrong content-type | empty body | oversize 2MB]               -> 400 | 400 | 400 | 413   (his own household, as before)
  stranger POST /api/households/home/members [invalid JSON | wrong content-type] and alex POST /api/admin/households [same] -> 403 FORBIDDEN
  ```
  At gate 1 the `away` and `nonexist` rows were `400, 403, 400, 413`; they are now identical and 403 for every body shape, the 2 MB one included, so the sentence "Every guard runs in the route's `onRequest` hooks, before the body is parsed, so a refusal is the same 403 whatever the request carries" now holds for the body shapes I could send. (A request refused before routing, such as an undecodable URL, is not covered by that sentence and not what F1 was about; not tested.) The sweep now sends each household and admin route a body that does not parse (`MALFORMED`, as every identity that must be refused; a 400 is the only other answer a route could give, so a 403 `FORBIDDEN` is the guard's).
  **Positive control (as dispatched):** `memberOf` put back into the add route's handler only, i.e. `{ onRequest: write }` in place of `{ onRequest: [asMember, write] }` for `POST /api/households/:id/members`, `npx vitest run tools/ledger/api/test/authority.test.ts`: `Tests  1 failed | 12 passed (13)`, "every household route › refuses a member of the other household, and changes nothing", with `"POST /api/households/home/members: 400 {\"error\":{\"code\":\"BAD_REQUEST\",\"message\":\"The request could not be understood.\",\"retryable\":false}}"` in `admitted`. Restored (`git checkout 3e3d61d7 -- tools/ledger/api/src/routes/households.ts`, `git status` clean). **The builder's note checked and true:** with the hook taken off `GET /api/households/:id` alone the same file stays `Tests  13 passed (13)`; Fastify parses no body on a `GET`, so the hook there only makes both routes refuse the same way. That is a property of this Fastify version, measured here; if a later one parsed `GET` bodies, the malformed `GET` probe would go red the day the hook were missing.
- **F2, fixed.** `web/src/App.tsx` sends only a FORBIDDEN from the admin list to "No household". With the gate 1 version of `App.tsx` put back, `npx vitest run tools/ledger/web/test/app.test.tsx`: `Tests  3 failed | 12 passed (15)` (the three new `UNREACHABLE`, `RATE_LIMITED`, `INTERNAL` tests); with the round's version: `Tests  15 passed (15)`. The stranger (both FORBIDDEN) still reaches "No household" in the existing lg-20 test.
- **F3, fixed for what was named.** `api/test/helpers/append-only.ts` no longer reads a table shape: `\bUPDATE\b[^;]*?\bSET\b`, `\bDO\s+UPDATE\b`, `\bDELETE` + whitespace or SQL comments + `FROM`, `\bOR\s+REPLACE\b`, `\bREPLACE\s+INTO\b`. The four plants from the dispatch, planted together in `src/directory.ts` (`UPDATE 'memberships' SET …`, `UPDATE memberships AS m SET …`, `ON CONFLICT (id) DO UPDATE SET …`, `DELETE /* c */ FROM memberships`) and run over `directory.test.ts` + `classification-schema.test.ts`: `Tests  2 failed | 22 passed (24)`, each scan listing `directory.ts` (the same first three plants gave `16 passed (16)` at gate 1). Restored, tree clean. My `trigger.mts` scan list on the new pattern: every write spelling that was `MISSED` at gate 1 is now `CAUGHT` (`UPDATE 'memberships'`, `AS m`, `INDEXED BY`, `NOT INDEXED`, doubled-quote name, comment before `SET`, upsert, `DELETE /* c */ FROM`); the two rows still `MISSED` are `replace(` as a string function, which is not a write. **False positives against what the scans read:** `scan-fp.mts` over all 42 `.ts` files of `tools/ledger/api/src` (the books scan reads all of them; the directory scan the ones that name the tables): `flagged: 0`; only one file, `db/schema.ts`, holds both the words "update" and "set", and it is not flagged; `hash.update(chunk); const s = new Set();` and `items.delete(x)` are clean. The documented price is real and confirmed: `"an update, then a set"` and `"// or replace the file"` in a comment are flagged, which fails the scan loudly and is reworded. No catastrophic backtracking: 400 KB of `UPDATE x x …` 26 ms, `DELETE` then 100000 unclosed `/*` 12 ms.
- **F4, fixed.** `adminKey` is `@admin:<address>`, and a household id is `[a-z]+`. `probe2.mts` section B on the new head: m2 (person named `admin@example.test` in household `admin`) reads `200, 200, 200, 429`, and the real admin's first `GET /api/admin/households` is now `200` (it was `429` at gate 1). Section D unchanged: five non-admin and five unauthenticated requests to an admin route are all 403 and the admin got `200,200,429` at a limit of 2; no log line mentions the admin address. With the old `admin:` prefix put back, `route-limits.test.ts`: `Tests  1 failed | 60 passed (61)`, "is never a person's, even in a household called admin under the admin's address as a name". The `rate limited` line for m2 still reads `"key":"admin:admin@example.test"`: that is the household `admin`'s member's own key (the name they were given), not the admin's `@admin:` key, which is never logged, and the builder's Log says as much.
- **F5, fixed.** `authority.test.ts` loops `GET HEAD POST PUT PATCH DELETE`, with a `HEAD` probe and a control for each `GET` route, and reads only the status of a `HEAD`. The suite is `Tests  13 passed (13)` (11 at gate 1).
- **F6, documented.** The owner's choice (a) is in `tools/ledger/CLAUDE.md` ("It does not hide that an address is taken … the owner accepted that on 2026-10-13"), in the brief's step 4 (an italic note, brief text above it unchanged), and in the header of `api/src/routes/households.ts`. Each states what the code does: the member's refusal hides which household and the third-name case, and an add that succeeds is a record naming the member (`by`). No code changed for it, as decided.

### Findings in the lines this round touched

- **low** · no live call site · **N1 — the scan's REPLACE alternatives were not given the comment tolerance the DELETE one was, and `;` in a comment ends the UPDATE search.** `scan-evade.mts` on the new pattern: `REPLACE /* c */ INTO memberships …` **MISSED**, `INSERT OR /* c */ REPLACE /* c */ INTO …` **MISSED** (adjacent `OR /* c */ REPLACE INTO` is caught by the `REPLACE INTO` alternative), `UPDATE memberships -- note; careful\n SET person = 1` **MISSED**, `UPDATE "a;b" SET …` **MISSED**. `REPLACE` is the vector F2 was about, so the inconsistency is worth one line, but no source writes in place, the trigger refuses all of these at runtime, and the header of `append-only.ts` does not claim these spellings. Fix: give `REPLACE\s+INTO` and `OR\s+REPLACE` the same `(?:\s|/\*[\s\S]*?\*/|--[^\n]*)+` separator the `DELETE` alternative has.
- **low** · no live call site · **N2 — the "spends nothing" test checks a literal that goes stale silently.** `route-limits.test.ts` › "refuses a non-admin as FORBIDDEN, spending nothing, with the limits on or off" asserts `limiter.check("@admin:member@example.test").allowed`; the round updated the literal with the prefix. With the old `admin:` key put back (F4 control above) this test stays green and only the new test fails, so the literal does not track the key. The refusal is correct by construction, since the key cannot be computed without `adminOf` throwing, so nothing real is unproven. Fix: assert on the limiter's state some way that does not name the key (for example, call the hook as the admin with that address on the same limiter afterwards and expect it admitted).
- **findings** · the re-gate hunt returned 2 in the round's lines; both carried, none dropped. Gate 1's F1 to F6 have the verdicts above.

NFR: security — F1 closed by measurement, F4 closed, the seam holds on the new head · performance n/a (pattern costs measured, above) · reliability — F2 closed; the web fallback now matches `/api/me`'s rule · maintainability — N1, N2; the scan now fails loudly on prose that spells `UPDATE … SET` or `or replace` in one statement, as documented.

## Log

- 2026-10-12 — Filed with lg-20, lg-21 and repo-98. The owner chose the admin
  screen over a host command alone, and chose that members add but do not remove,
  over members adding and removing anyone but the last.
- 2026-10-12 — Reviewed before merge. Access keeps its allowlist, so a member's
  add now tells them the operator must admit the address; a member's refusal
  is one generic answer, because the specific one was an oracle over every
  address; admin routes get a limiter keyed on the address; and the sweep gains
  the two identities lg-20 now lets through the hook without a household.
- 2026-10-12 — Step 9 and Done-when 5 added from lg-20's gate 1 (F2, F6), which
  the owner chose to fold here rather than fix on lg-20.
- 2026-10-12 — The owner answered lg-23's Question 4: "remove a member" removes
  an address, and the person's name stays in the books. This ticket lands
  before lg-23 and keeps refusing a third person name. lg-23 changes that test
  when it lifts the cap.
- 2026-10-12 — Step 9's F6 (the member lookup reading the whole directory) was
  folded into lg-21, which puts that lookup on every request's books path:
  `Directory.members(household)` now filters in the SQL. Measured on the built
  class with 6000 members in 3000 households, `people(household)` went from
  9.853 ms to 0.031 ms a call (`membershipOf` 0.016 ms). F2 stays here.
- 2026-10-13 — Built on `lg-22` from `main` at `6d879b26`.
  - **The routes.** `api/src/routes/households.ts`: a household's own under
    `/api/households/:id` (`GET` its members and history, `POST …/members` to
    add), guarded by `memberOf(request, id)` in `api/src/identity.ts`, which
    refuses a member of another household and, through `personOf`, an admin in
    none; and the admin's under `/api/admin/households` (`GET` every household
    with its members, `POST` a new one, `POST …/:id/members` to add,
    `POST …/:id/members/remove` to remove), guarded by `adminOf`. Every guard runs
    before the body is read. Each change is a directory record whose `by` is the
    caller's lower-cased address. A new household gets its books the way lg-21
    gives any: on the first request or probe that needs them.
  - **Errors.** Four ledger codes, with their statuses in `http-errors.ts`:
    `ADDRESS_ALREADY_A_MEMBER` (409, the admin's, whose sentence names the
    household), `MEMBER_NOT_ADDED` (409, the member's one answer for that and for
    `HOUSEHOLD_FULL`), `HOUSEHOLD_NOT_FOUND` and `MEMBER_NOT_FOUND` (404).
    `Directory` throws the first, third and fourth where it threw `BAD_REQUEST`;
    the host command prints the same sentences and exits 1 as before.
  - **Rate limits.** `rateLimitsFor` has `adminRead` and `adminWrite`, keyed
    `admin:<address>` through `adminOf`, so a non-admin is refused before a token
    is spent, with the limits on or off; the log line carries no key for them.
    `route-limits.test.ts` walks the five new routes as alex made an admin as
    well as a member, `POST adminHouseholds` in the two-verb block, and three
    tests of the admin key.
  - **The authority sweep failed first, once per guard.** `api/test/authority.test.ts`,
    `npx vitest run tools/ledger/api/test/authority.test.ts`, each guard restored
    after:
    - `memberOf` without its household check: exit 1, `Tests  1 failed | 10 passed (11)`,
      "refuses a member of the other household, and changes nothing",
      `+ "GET /api/households/home: 200 {\"household\":{\"id\":\"home\"…`,
      `+ "POST /api/households/home/members: 200 {\"address\":\"casey@example.test\",\"person\":\"sam\"}"`,
      `- "directoryChanged": false` / `+ "directoryChanged": true`. The admin in no
      household stayed refused, by `personOf`.
    - `adminOf` without its admin check: exit 1, `Tests  1 failed | 10 passed (11)`,
      "refuses a member who is no admin, and changes nothing", all four admin
      requests answered 200, the last
      `POST /api/admin/households/home/members/remove: 200 {\"address\":\"sam@example.test\",\"person\":\"sam\"}`,
      `"directoryChanged": true`.
    - Restored: `Tests  11 passed (11)`. Each request in the sweep is one its
      controls see succeed as the right identity, and the sweep compares every
      directory record and every table of both households' books.
  - **"Can remove nobody" failed first too**: with `adminOf` loosened,
    `households.test.ts` › "can remove nobody, through any route" went red with
    a `remove` record `by: "sam@example.test"`. Its first version sent one body
    with extra keys to every route, which the strict schemas refused, and it
    stayed green with the guard off; it now sends each shape a removal takes.
  - **Step 9, F2.** Directory migration 2 adds `BEFORE INSERT` triggers refusing
    a `memberships` id or a `households` id that exists. Before it,
    `npx vitest run tools/ledger/api/test/directory.test.ts`: exit 1,
    `Tests  1 failed | 14 passed (15)`, "the schema refuses an INSERT OR REPLACE…",
    `INSERT OR REPLACE INTO memberships (…) VALUES (1, 'alex@example.test', 'home', 'alex', 'remove', …): expected [Function] to throw an error`.
    After: `Tests  15 passed (15)`, and 16 with a test that a directory at migration 1 takes the trigger on its next open.
    An upsert (`ON CONFLICT DO UPDATE`) meets the same trigger. The scan's pattern
    is `api/test/helpers/append-only.ts`; the old one returned `false` for both
    plants (`node -e`), and with the new one each planted line in `directory.ts`
    took the scan red alone (`Tests  1 failed | 14 skipped (15)`,
    `+ "directory.ts"`): `INSERT OR REPLACE INTO memberships (id) VALUES (1)` and
    `UPDATE "memberships" SET person = 1`. A test holds the pattern to eleven
    planted statements and three innocent sentences.
  - **Step 9, F6: done in lg-21, confirmed in the code.** `Directory.members(household)`
    selects `WHERE household_id = ?` (`api/src/directory.ts`), and `Books.forMember`
    calls `people(household)`. Nothing of it was left here.
  - **The screens.** `web/src/household/Household.tsx` (members, history newest
    first, the add form; no remove button anywhere), `web/src/admin/Admin.tsx`
    (each household with remove behind a confirm and an add form, a new
    household, and "Addresses to admit"), sharing `MemberForm.tsx`, whose note
    says every address must also be admitted on the Access policy. The shell
    gives a member a Household tab and an admin an Admin tab; an admin in no
    household, whom `/api/me` refuses, is shown the admin's screen alone, found
    by asking for the admin's list before saying "no household".
  - `npm test -- --project ledger`: `Test Files  56 passed (56)`,
    `Tests  954 passed (954)`. `npm run check`: exit 0.
  - **What the brief had wrong, or left open.**
    - _A household route refuses a member of the other household with 403_: true
      only if the route names a household, so these take `:id` and a guard. The
      alternative, the household taken from the identity as `booksOf` takes the
      books, needs no guard and so has none to sweep. Recorded as an open decision
      in the build report.
    - _An admin sees households_: an admin in no household is refused by
      `/api/me`, which the web read as "no household". The shell now asks for the
      admin's list on that refusal rather than widening `MeResponse`. Also in the
      build report.
    - A member is told only that an address cannot be added for an address
      already in their own household too, though that one is no oracle: one
      answer is simpler and leaks nothing.
    - `docs/02-DEPLOYMENT.md` and the README said the directory is written from
      the host until lg-22; both now say who manages it from the app.
  - **Fold-in:** the books' own append-only scan in
    `classification-schema.test.ts` had the same blind spot (F2 said so) and now
    uses the same pattern; a planted `INSERT OR REPLACE INTO rules` in
    `api/src/rules.ts` takes it red (`+ "rules.ts"`). The books have no
    `BEFORE INSERT` triggers, and adding them is a migration per table that
    nothing asked for, so it was not folded.
- 2026-10-13 — **The owner answered four questions**, through the orchestrator:
  1. How a household route picks its household. Options: (A) the id in the
     path, checked by `memberOf`; (B) the household taken from the identity, as
     `booksOf` takes the books. **Chosen: A**, the builder's recommendation.
  2. How the web finds an admin in no household. Options: (A) on `/api/me`'s
     `FORBIDDEN`, ask for the admin's list, with no change to `MeResponse`;
     (B) `/api/me` answers `person: null` for them, a contract change. **Chosen:
     A**, the builder's recommendation.
  3. Gate 1's F1, the household guard running after the body is parsed.
     Options: (a) reword the comment and this Log; (b) run `memberOf` in an
     `onRequest` hook for the two household routes and add an invalid-JSON
     probe per household route to the sweep. **Chosen: (b)**, the gate's
     recommendation.
  4. Gate 1's F6, a member's add telling success from refusal, so whether an
     address is in some household. Options: (a) accept it and say so in the
     ledger `CLAUDE.md` and this brief; (b) an admin approves every member's
     add, reversing the 2026-10-12 choice; (c) a tighter write limit on that
     route. **Chosen: (a)**, the gate's recommendation.
- 2026-10-13 — Round 1, on gate 1's F1 (high) and F2 to F6 (low).
  - **F1.** The finding held: the household routes asked `memberOf` in the
    handler, after Fastify parsed the body, so an invalid body answered 400
    where the earlier entry above says every guard runs before the body is
    read. Now a route-level `onRequest` hook, `asMember`, asks it ahead of the
    rate limit, and the handler asks again. The sweep sends every household and
    admin route a body that does not parse, as every identity that must be
    refused. With the hook taken off the add route (the guard back in the
    handler alone), `npx vitest run tools/ledger/api/test/authority.test.ts`:
    exit 1, `Tests  1 failed | 12 passed (13)`, "refuses a member of the other
    household, and changes nothing",
    `+ "POST /api/households/home/members: 400 {\"error\":{\"code\":\"BAD_REQUEST\",…`.
    The same run before the fix gave the same line. Restored, `13 passed (13)`.
    Taking the hook off the `GET` route leaves the sweep green: Fastify does not
    parse a `GET`'s body, so the guard is ahead of anything a body can do there
    either way; the hook is on it so both routes refuse the same way.
  - **F2.** The finding held. `App.tsx` sent any failure of the admin list to
    "No household"; only `FORBIDDEN` goes there now. Three new tests in
    `web/test/app.test.tsx` (an `UNREACHABLE`, `RATE_LIMITED` and `INTERNAL`
    from the admin list after `/api/me`'s `FORBIDDEN`) failed first, exit 1,
    `Tests  3 failed | 12 passed (15)`, and pass after.
  - **F3.** The finding held. `api/test/helpers/append-only.ts` no longer reads
    a table between the keywords: any `UPDATE … SET` within one statement, an
    upsert's `DO UPDATE`, a `DELETE` and its `FROM` with only space or comments
    between them, and `OR REPLACE` / `REPLACE INTO`. The gate's spellings and a
    multi-line `UPDATE` are in the scan's own test, which failed first
    (`UPDATE 'memberships' SET person = 1: expected false to be true`). Planted
    one at a time in `src/directory.ts`, each takes `directory.test.ts`'s scan
    red, `Tests  1 failed | 15 skipped (16)`, `+ "directory.ts"`:
    `UPDATE 'memberships' SET …`, `UPDATE memberships AS m SET …`, an
    `ON CONFLICT (id) DO UPDATE SET …`, and `DELETE /* c */ FROM memberships`.
    `DELETE` and `FROM` with anything between them, which the gate did not ask
    for, flagged prose in three comments of `db/schema.ts` and
    `db/directory-schema.ts`, so between them there may be only space and SQL
    comments. `OR REPLACE` still matches prose, as the gate noted: a false alarm
    there fails the scan loudly, so it stays and the comment says so.
  - **F4.** The finding held, as a test: a person hook and the admin hook on one
    limiter, household `admin`, person `admin@example.test` — the admin's first
    request was refused `RATE_LIMITED`. Of the gate's two remedies, the key
    prefix: an admin's key is `@admin:<address>`, and `@` is in no household
    id, so no person's key can spell it. Reserving `admin` as a household id
    would have been a directory rule for a rate limiter's sake. The new test
    passes after. A person named like an address still puts that name in their
    own `rate limited` log line, as any name is; that is the name, not the
    admin's key.
  - **F5.** `HEAD` is in the sweep's method list, with a `HEAD` probe on both
    `GET` routes and its control.
  - **F6.** Documented, per the owner's answer: the ledger `CLAUDE.md`, step 4
    of this brief, and the header of `api/src/routes/households.ts`.
- 2026-10-13 — **The owner answered**, through the orchestrator: gate 2's two
  lows, N1 and N2, are applied at landing with no re-gate. Options: apply at
  landing, or leave them recorded. **Chosen: apply at landing**, the
  orchestrator's recommendation.
- 2026-10-13 — N1 and N2 _fixed at landing_ (owner, 2026-10-13).
  - **N1.** `REPLACE /* c */ INTO memberships (id) VALUES (1)` planted in
    `api/src/directory.ts`: `npx vitest run tools/ledger/api/test/directory.test.ts -t "no source file"`
    exit 0, `Tests  1 passed | 15 skipped (16)` — the scan missed it. The
    scan's own test, given that spelling, `INSERT OR /* c */ REPLACE /* c */ INTO …`
    and an `OR -- c` line break, failed first:
    `REPLACE /* c */ INTO memberships (id) VALUES (1): expected false to be true`.
    Both `REPLACE` alternatives now take the separator the `DELETE` one has
    (`GAP` in `api/test/helpers/append-only.ts`); with the plant still in,
    `directory.test.ts` exit 1, `+ "directory.ts"`, and restored, both scans
    `Tests  24 passed (24)`.
  - **N2.** With the old `admin:` key put back and the hook made to spend the
    address's token before refusing, the old assertion
    (`limiter.check("@admin:member@example.test").allowed`) stayed green,
    `Tests  1 passed | 60 skipped (61)`. The test now calls the hook as an admin
    with the same address on the same one-token limiter and expects it
    admitted, which names no key: under the same change it failed,
    `promise rejected "AppError: Too many requests…" instead of resolving`.
    Both restored.
