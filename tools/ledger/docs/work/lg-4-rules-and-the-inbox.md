---
id: lg-4
tool: ledger
title: Classify rows by rule, and put everything else in an inbox
kind: work-package
status: done
milestone: P2
depends_on: [lg-2]
difficulty: standard
---

# lg-4 — Classify rows by rule, and put everything else in an inbox

## Why

Each row belongs to one bucket, and each deposit to one person. The paste
carries enough to classify most rows exactly. The rest need a human, and a
transfer that differs from its usual amount is a question, not a guess
([00-ANALYSIS.md §3](../00-ANALYSIS.md)).

## Build

1. `books`: `classify(row, rules)`. A rule is a description pattern, an optional
   Desjardins category, an optional exact amount, and the person and bucket it
   assigns. A row takes a rule only on an **exact** match. With no match, or with
   more than one, it takes none, and the function returns the nearest rule as a
   suggestion.
2. Buckets are `mortgage` and `current-expenses`. A row with no person is
   **joint**: rebates, the sale of a shared thing, and one half of an error
   pair.
3. Migration: `rules`, and `classifications`. **A classification is a record,
   never a column on the row**, so reclassifying appends a new one with who did
   it (lg-3's person, when it lands) and when. The latest record wins.
4. Classify on paste. What no rule matches lands in the **inbox**.
5. `web`:
   - the inbox, with the suggested rule and one tap to accept it or to pick the
     person and bucket;
   - an offer to turn the answer into a rule;
   - a rules screen to add, edit and retire rules.
6. **Rules live in the database only.** Caisse names identify a household, so
   no rule is seeded from the repository.

## Done when

1. An exactly matching row is classified on paste. A row whose amount differs
   from its rule's fixed amount lands in the inbox, with that rule suggested.
2. Two rules matching one row send it to the inbox, never to the first rule.
3. Reclassifying keeps the earlier classification as history.
4. Web tests cover accepting a suggestion and creating a rule from an answer.
5. Gates green.

## Review

### Gate 1

**Gate: CONCERNS** — 2026-10-03 · `ebb808b...d9c4ae8` (base `ebb808b`, still `origin/main` after the gate’s fetch) · code-review at medium, run by the gate itself · every unpinned coordinate below resolves at `d9c4ae8`

| Done when                                                                                                         | Proof                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. An exact match is classified on paste; a row off its rule’s fixed amount is the inbox with that rule suggested | `tools/ledger/api/test/classifications.test.ts:58 "row_id: rowId(target, TRANSFER, 40000)"` ✓ · `tools/ledger/api/test/classifications.test.ts:86 "suggestion: { id: rule.id, amountCents: 40000"` ✓                                                                                                                            |
| 2. Two rules matching one row send it to the inbox, never to the first                                            | `tools/ledger/api/test/classifications.test.ts:184 "row?.matching.map((rule) => rule.id)"` ✓, and in the other order `tools/ledger/api/test/classifications.test.ts:196 "MORTGAGE)[0]?.reason"` ✓                                                                                                                               |
| 3. Reclassifying keeps the earlier classification as history                                                      | `tools/ledger/api/test/classifications.test.ts:217 "expect(stored[0]).toMatchObject({"` ✓ · `tools/ledger/api/test/classifications.test.ts:234 "expect(standing).toEqual"` ✓                                                                                                                                                    |
| 4. Web tests cover accepting a suggestion and creating a rule from an answer                                      | `tools/ledger/web/test/inbox.test.tsx:111 "rowId: ODD.id, ruleId: RULE.id"` ✓ · `tools/ledger/web/test/inbox.test.tsx:158 "descriptionPattern: GROCERIES.description,"` ✓                                                                                                                                                       |
| 5. Gates green                                                                                                    | **verified** — `npm run check` exit 0; `npm test -- --project ledger` 313 of 313 in 20 files (at `ebb808b`: 203 in 13); preflight exit 0; `citations-gate.mjs --against origin/main` exit 0, 148 enforced, 0 failing; image-closure 7 of 7. The `ledger.yml` image build was not run; no `package.json` or `Dockerfile` changed |

- **med** · `tools/ledger/web/src/rules/RuleForm.tsx:72 "setProblem(AppError.from(error).message);"` — the form’s own rendering of a server refusal is tested by nothing, and `RuleForm.tsx` has no test file of its own. Only the inbox’s offer reaches it; the rules screen’s `change` catches every refusal itself. Replacing the line with `void error;` leaves `inbox.test.tsx` and `rules.test.tsx` at 16 of 16. Failure scenario: a person takes the offer, the API refuses the rule (`BAD_REQUEST` for a person the configuration lacks, `UNAUTHENTICATED` once Access lapses), the form re-enables in silence, and the person believes the rule exists. No Done-when line rests on it.
- **low** · `tools/ledger/web/test/rules.test.tsx:127 "expect(editRule).toHaveBeenCalledWith(7, {"` — “sends the new version for that rule’s id” runs over a list of one rule, so it cannot tell that rule’s id from the first rule’s: `editRule(rules[0]?.id ?? 0, draft)` at `tools/ledger/web/src/rules/Rules.tsx:107 "editRule(rule.id, draft)"` leaves `rules.test.tsx` at 7 of 7. Editing the second of two rules closes it, as the retire test already does.
- **low** · `tools/ledger/web/src/inbox/Inbox.tsx:107 "await classifyRow({ rowId: row.id, personId, bucket });"` — the refusal of a person’s own answer is untested: a fixed sentence in place of the server’s leaves `inbox.test.tsx` at 9 of 9. The same mutation on the accept path goes red.
- **low** · `tools/ledger/api/src/db/schema.ts:84 "the second insert is refused by the database"`, and the Log’s “a unique partial index so two people editing one rule cannot both win; the second is `RULE_NOT_FOUND`”. Through the API the second edit is refused by the in-force check in the same `IMMEDIATE` transaction (`tools/ledger/api/src/rules.ts:115 "read(context.db, insert(context, draft, id, false))"`), never by the index. Measured: two concurrent `POST /api/rules/1` give 200 and 404 `RULE_NOT_FOUND`; a direct `INSERT` superseding the same version gives `SQLITE_CONSTRAINT_UNIQUE`; a raw SQLite error inside a route surfaces as 500 `INTERNAL`. So the index is a backstop the API cannot reach, and were it ever to fire the caller would get `INTERNAL`, not `RULE_NOT_FOUND`.
- **low** · `tools/ledger/web/src/App.tsx:27 "A failure leaves the number out"` — the `catch` keeps the previous count, so after one success a failed refresh shows a stale number, not none.
- **low** · `tools/ledger/api/src/classifications.ts:164 "export function inboxCount"` — exported and used nowhere in `tools/ledger`.
- **low** · `tools/ledger/api/test/schema.test.ts@ebb808b:76 "migrating a migrated database again changes nothing"` — no suite test migrates a version-1 database that holds rows; this one starts at version 2. The gate did it by hand: a database built by the base’s own `migrate` and `importStatement` (12 rows) opened by the head at `user_version` 2 with rows and imports identical, no classification, all 12 in the inbox.
- **low** · `parseTypedAmountCents` in `tools/ledger/books/src/amount.ts` refuses `1 100.00`, `1,100.00`, `+350.5` and `0.5` while taking `-1 100,00` and `1100.00`. Every `formatCents` output round-trips (14 of 14), so the pre-filled offer is safe.
- **dropped** · bare `Error` in `api/test/helpers/classification.ts` and `web/test/inbox.test.tsx`: test code, not a raise site; no `src` file raises one.
- **dropped** · accepting any rule in force for any row, matching or not: that is a person’s answer, and a `differs` row needs it.
- **findings** · code-review at medium returned 10; 8 carried, 2 dropped.
- NFR: security ✓ (all seven lg-4 routes answer 403 `UNAUTHENTICATED` with no identity; `GET /api/people` returns configured ids, no address, and logs nothing) · performance ✓ (no regular expression is built from a pattern; ten `*` over 200,000 characters, 4 ms) · reliability ✓ (a planted failure on an extending paste leaves rows, imports and classifications unchanged) · maintainability — the lows above.
- **For the open decision** (file the waiting rows when a rule is created), measured and not decided: as built, every row stored before lg-4 stays in the inbox until a person taps it — a new exactly matching rule filed 0 of 12 (3 shown as `matches`), and re-pasting the same statement filed 0. The API also accepts a bare `*` as a pattern, which matches every description.
- **Not verified** · the image build; e2e (none exists); the screens against a running server in a browser; a rule edit raced from a second database connection.
- **Citations** · the branch moves 1 citation in lg-1’s record and 10 in lg-2’s and edits neither record, so under repo-47’s rule (`.claude/skills/orchestrate-tickets/reference/records.md@ebb808b:350 "only the records it also edits"`) they are reported, not failed, and are not this branch’s to repoint.

## Log

- 2026-10-03 — Built, on `origin/main` at `ebb808b`: `classify` and
  `matchesPattern` in `books/src/classify.ts`; migration 2 (`rules`,
  `current_rules`, `classifications`, `current_classifications`) in
  `api/src/db/schema.ts`; `api/src/rules.ts` and `api/src/classifications.ts`;
  `GET/POST /api/rules`, `POST /api/rules/:id` (an edit), `POST /api/rules/:id/retire`,
  `GET /api/inbox`, `POST /api/classifications` and `GET /api/people`; two codes,
  `RULE_NOT_FOUND` and `ROW_NOT_FOUND` (both 404); and in `web` the inbox, the
  offer to make an answer a rule, the rules screen and tabs that carry the
  inbox's count.
  - **The suite passes.** `npm test -- --project ledger` → `Test Files 20 passed
(20)`, `Tests 313 passed (313)`; `npm run check` exit 0; `node scripts/preflight.mjs
--base origin/main --title "feat(ledger): classify rows by rule and put the
rest in an inbox (lg-4)"` → `preflight passed (exit 0)`.
  - **Done when 1–4, and where each is proved.** (1) An exact match is classified
    on paste: `api/test/classifications.test.ts`, "a row matching one rule
    exactly is classified, and the rest are the inbox"; a changed amount is the
    inbox with that rule suggested: "a transfer that is not its usual amount
    lands in the inbox with that rule suggested". (2) "send it to the inbox,
    never to the first rule", and the same with the rules added the other way
    round. (3) "keeps the earlier classification, with who changed it and when",
    which reads both records and `current_classifications`. (4)
    `web/test/inbox.test.tsx`, "accepting a suggestion sends its rule and the row
    leaves the inbox" and "answering with a person and a bucket, then taking the
    offer, creates a rule from the row".
  - **The tests can fail.** Each mutation was applied to the source alone and
    restored. In `books/src/classify.ts`, taking the first match
    (`matching.length === 1` → `>= 1`): `npx vitest run` on `classify.test.ts`
    and `classifications.test.ts` → `4 failed | 46 passed (50)`, all four in
    `classify.test.ts`, because the API reads books' `dist` and the source edit
    reached nothing there; after `npx tsc --build tools/ledger/books`,
    `classifications.test.ts` alone → `2 failed | 18 passed (20)` ("send it to
    the inbox, never to the first rule" and the reversed order). Ignoring the
    amount (`amountMiss = false`, rebuilt): the same two files → 11 failed, 6 in
    `classify.test.ts` and 5 in `classifications.test.ts`. In
    `api/src/classifications.ts`, a `DELETE` of the row's earlier records before
    the `INSERT`: `classifications.test.ts` and `classification-schema.test.ts`
    → `2 failed | 26 passed (28)`, the reclassify test and the scan that no API
    source issues an `UPDATE` or a `DELETE`. In `Inbox.tsx`, `onAccept(row.id)`
    for `onAccept(suggestion.id)` fails "accepting a suggestion" (1 of 9), and
    `amountCents: null` for the row's amount in the offer fails the offer test
    (1 of 9).
  - **A paste is stored with its classifications or not at all.** A trigger on
    `classifications` that aborts every insert makes the paste answer 500 and
    leave `statement_rows` and `statement_imports` both at 0
    (`classifications.test.ts`, "a paste is stored with its classifications or
    not at all").
  - **Decisions the brief left open, made here.**
    - **A pattern is the whole description, case, accents and runs of spaces
      ignored, with `*` for any run of characters** — never a regular
      expression. A person types these, and a pattern built into a regular
      expression from their input is the shape that backtracks without end. The
      matcher is the iterative two-pointer one; a test runs 30 stars against
      2000 characters.
    - **Nearest rule.** Only a rule whose pattern matches is a candidate. Order:
      fewest criteria failed, smallest gap between the rule's fixed amount and
      the row's, most criteria named, longest literal pattern. Level means no
      winner, and the suggestion is `null` rather than the older rule.
    - **A rule is edited and retired by appending** (`supersedes`, and `retired`
      on a retirement), with a unique partial index so two people editing one
      rule cannot both win; the second is `RULE_NOT_FOUND`. A classification
      cites the rule version it used.
    - **A new rule does not reclassify rows already stored.** A rule applies to
      the rows a paste adds. An inbox row a rule now matches exactly shows as
      reason `matches`, one tap to accept. See the fold-in note below.
    - **The offer to make a rule fills in the amount**, on purpose: a rule that
      names the usual amount asks about a different one, where a rule that does
      not would file it without a word. A person clears the field to loosen it.
    - **`GET /api/people`, and a `personId` on rules and classifications,** come
      from the configured names (`ACCESS_PEOPLE`): the brief's "lg-3's person" is
      the `Person.id` lg-3 landed, and lg-5's `people` table does not exist yet.
      lg-5's Build now says to point the route at the table.
  - **What the brief had wrong.** "lg-3's person, when it lands" is stale: lg-3
    has landed, and `personOf(request)` is what records who. The brief names no
    way for the web to learn who a rule may name, so `GET /api/people` was
    added.
  - **Moved citations, not repointed.** The branch moves lines that two merged
    records cite: `lg-2-store-a-pasted-statement.md` (10) and
    `lg-1-parse-an-accesd-paste.md` (1, in `tools/ledger/CLAUDE.md`). Preflight
    reports them as moved and does not fail them, since the branch edits
    neither record (repo-47's rule). Repointing is mechanical: `node
scripts/citations.mjs tools/ledger/docs/work/lg-2-store-a-pasted-statement.md`
    lists the new lines.
  - **Fold-in: one done, one not.** Done: `tools/ledger/README.md` still said
    "the books do not yet", false since lg-1 and more so now; one sentence. Not
    done: applying a new rule to the rows already in the inbox would make the
    offer worth more (one answer files the backlog of a recurring transfer), and
    is a few lines in `api/src/rules.ts`. It is a decision and not a rename: it
    classifies rows nobody has looked at, on a pattern a person typed seconds
    ago, and a `*` rule would file everything. Reported to the orchestrator as
    an open decision.
  - **Not covered.** No e2e spec: `e2e/README.md` says the first one is a paste
    surviving a reload. The inbox and rules screens were exercised in jsdom with
    the API client faked, never against a running server in a browser.

- 2026-10-03 — Owner's decision on the open question above. **The question:**
  should creating a rule also file the rows already waiting in the inbox?
  **Put to the owner through AskUserQuestion:** (A) new pastes only, as built; an
  inbox row a new rule matches exactly shows as `matches`, with one tap to
  accept; (B) also file the inbox on rule creation; (C) ask on creation, "N inbox
  rows match — file them?". **The owner chose A**, the builder's recommendation,
  so no recommendation was overridden. **The gate's measurement, carried with
  it:** as built, rows stored before lg-4 stay in the inbox until tapped, and
  the API accepts a bare `*` pattern. **Status:** decided, nothing to build.
