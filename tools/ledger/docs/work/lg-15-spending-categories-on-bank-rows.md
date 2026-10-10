---
id: lg-15
tool: ledger
title: Give bank rows and period lines a spending category from one shared list
kind: work-package
status: done
milestone: P3
depends_on: [lg-4, lg-6]
difficulty: standard
awaiting: Done when 6 — after the push to `main` that runs `security.yml`'s dismissal step, both `js/missing-rate-limiting` alerts on the `GET` handlers in `tools/ledger/api/src/routes/spending-categories.ts` read dismissed, "Suppressed via SARIF"
---

# lg-15 — Give bank rows and period lines a spending category from one shared list

## Why

The owner wants spending by type charted ([00-ANALYSIS.md §9](../00-ANALYSIS.md)),
and until now only receipt items were to carry a category (lg-10, in Phase 4).
A pasted row already carries Desjardins' own category, which is enough to give
most rows a spending category without reading anything else, and a rule can
say what Desjardins' grouping gets wrong for one merchant. lg-6's period lines
carry a free-text category, which would chart "groceries" and "épicerie" as two
slices. The owner settled the design on 2026-10-06
([00-ANALYSIS.md §6](../00-ANALYSIS.md), _Categories_, amendment).

**Two words, two things.** `category` on a row and on a rule is already
Desjardins' own text (`Virements`, `Hypothèque`). The new thing is a **spending
category**, and every table, column, type and screen this ticket adds says so,
so the two can never be read for each other.

## Build

1. **Migration: the list.** `spending_categories`, append-only and versioned the
   way `rules` is (a new version supersedes; a retirement is a version). Seeded
   with groceries, alcohol, household, pharmacy, restaurant, other — generic
   words, so seeding them from the repository is allowed, unlike rules. Editable
   from a screen.
2. **Migration: the map.** `spending_category_map`: Desjardins' category text
   (folded the way `classify` folds it) to a spending category, append-only, the
   latest version per Desjardins text winning. Nothing seeded: the Desjardins
   texts are not all known (§2 lists what the sample showed).
3. **Migration: the overrides.**
   - `rules` gains a nullable spending category. A rule version that names one
     overrides the map for every row it classifies.
   - A row may carry its own override, as an append-only record with who and
     when, latest winning — never a column on the row (the lg-4 rule).
   - `period_lines` gains a nullable spending category. A new line, and a new
     version of a line, picks from the list. The free-text `category` column
     stays, and lines already stored keep their text untouched.
4. **`books`, pure: `spendingCategory(row, classifyingRule, map, override)`.**
   Order: the row's own override, then the classifying rule's, then the map's
   entry for the row's Desjardins category, then none. Computed when read, so
   fixing a map entry recategorises every row it covers; the map's own history
   is kept by its versions.
5. **Uncategorised never blocks.** A row with no spending category is filed by
   person and bucket exactly as today. It never enters the inbox for want of a
   category. The API answers its category as `null`, and a filter lists those
   rows.
6. `web`:
   - the list screen, and the map screen (one line per Desjardins category seen
     in stored rows, with its spending category or none);
   - the rule form gains the optional spending category;
   - a row's spending category is shown wherever the row is, and editable there
     (writing the override);
   - the period-line form picks from the list.
7. **What lg-9 reads**, written into its Build in the same change: a joint-account
   row with a receipt attached (lg-8) is split by its receipt items' categories
   (lg-10) and its own spending category is not counted; a period line with no
   list category, which is every line stored before this ticket and every line
   lg-7 imports, charts as uncategorised, its text shown in the detail.
8. **Traps.**
   - `lg-16` changes `classify` and the inbox in the same files. Whichever lands
     second rebases; neither depends on the other. What lg-16 built, for the
     rebase: `MatchableRule` now also carries `bucket` and `personId`, because
     two rules level at the top **share an answer** when those two agree, and
     the row then takes the newest by `id`; `classify` ranks by `score`'s
     `named` and `literal`, so a rule that only differs by its spending
     category is level with the other and the newest wins. A rule's spending
     category is therefore not part of "the same answer": decide whether it
     should be before two rules differing only in it classify silently.
     `InboxRow` gained `history`, and `classifyingRule` for `spendingCategory`
     is the rule `classify` returned, which is what `classifications.rule_id`
     already stores.
   - The rule form's spending category is part of a rule version, so editing it
     supersedes the rule like any other field.

## Done when

1. A row whose Desjardins category is mapped gets that spending category; a row
   classified by a rule naming one gets the rule's; a row with its own override
   gets the override; each asserted in one `books` test over the four-step order.
2. A row with no spending category is classified and does not enter the inbox.
   An API test proves it.
3. Changing a map entry changes the spending category of rows already stored,
   and the earlier map version is still stored.
4. A new period line takes a spending category from the list; a line stored
   before the migration keeps its text. An API test proves both.
5. Web tests cover setting a map entry, a rule's spending category, a row's
   override and a period line's.
6. Gates green.

## Review

**Gate: CONCERNS** — 2026-10-10 · `ad51f0b8..2cd1f92e` · Opus 5.5, depth full

| Done when                                                                                                                  | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Mapped row gets the map's, rule's row the rule's, override the override's, in one `books` test over the four-step order | `books/test/spending.test.ts` › "spendingCategory, the four-step order" (override first; rule next; map next; none) ✓. Positive control: swapping steps 2 and 3 fails "the classifying rule's comes next, over the map's" and `api/test/spending-categories.test.ts` › "a row classified by a rule naming one gets the rule's, over the map's" (2 of 663)                                                                                                                       |
| 2. A row with no spending category is classified and stays out of the inbox; API test                                      | `api/test/spending-categories.test.ts` › "is classified like any other and does not enter the inbox": the inbox does not hold the row, its classification is `source: "rule"`, and `spendingCategory` is `null` ✓                                                                                                                                                                                                                                                               |
| 3. A map change recategorises stored rows; the earlier version stays stored                                                | `api/test/spending-categories.test.ts` › "changing an entry changes rows already stored, and the earlier version is still stored" ✓. Real input: a database migration 5 left, built with `ad51f0b8`'s code, opened with the head's code. Re-mapping `Épicerie` moved only the row the map answered. A row with an override, and a row filed by a rule that names a category, both kept theirs                                                                                   |
| 4. A new period line takes a category from the list; a line stored before the migration keeps its text; API test           | `api/test/spending-categories.test.ts` › "a new line takes one from the list, and the open period lists it" and › "a line stored before the migration keeps its text and has no spending category" ✓. The second test reads through `currentLines`, not HTTP. Real input, over HTTP: `GET /api/periods/open` on the migrated database answered `["épicerie", null]` and `[null, null]`                                                                                          |
| 5. Web tests: map entry, rule's category, row override, period line's                                                      | `web/test/spending.test.tsx` › "setting a map entry sends the bank category's text and the spending category"; `web/test/rules.test.tsx` › "a new rule can name a spending category, and a retired one is not offered"; `web/test/inbox.test.tsx` › "choosing another writes the row's own, and the row stays in the inbox"; `web/test/periods.test.tsx` › "a line entered by hand, ticked as the other person's, is a charge to them" (asserts `spendingCategoryId: 4` sent) ✓ |
| 6. Gates green                                                                                                             | **unproven (gate)**: `npm run check` exits 0 and the `ledger` project passes 663 of 663 (597 at base), and every pull-request check on `2cd1f92e` passed except code-scanning `CodeQL`, which **failed** with two new alerts that nobody has excused (F1)                                                                                                                                                                                                                       |

- **F1 · med** · Done when 6 depends on it · **open decision**. On `2cd1f92e`, code-scanning `CodeQL` fails with two
  `js/missing-rate-limiting` alerts ("This route handler performs a database
  access, but is not rate-limited"), both in
  `api/src/routes/spending-categories.ts`, on the `GET` handlers of
  `ROUTES.spendingCategories` and `ROUTES.spendingCategoryMap`. Each of those paths also has a `POST`, which is the same
  shape as `GET` salaries, `GET` recurring and `GET` people. Both handlers are
  limited: `printRoutes({ includeHooks: true })` shows `rateLimit()` on them, and taking `{ onRequest: read }` off the
  map `GET` fails 1 of 37 in `route-limits.test.ts` ("spendingCategoryMap
  refuses the second request in a minute, as RATE_LIMITED"). The Log does not
  mention CodeQL. Options: (a) **recommended**, treat it as the earlier routes were treated. The owner excuses both under adr/005,
  and each route gets the `// codeql[js/missing-rate-limiting]` comment that
  names its guarding test, as `routes/salaries.ts` has. (b) Move each `GET` to a path that no `POST` shares. That is a contract change
  and gives up the precedent. The owner has to grant an excusal; the gate cannot.
- **F2 · med** · no `Done when` line depends on it · Two new routes have nothing that asserts their limit. `route-limits.test.ts`'s
  `VERBS` table takes one verb per `ROUTES` key, so `POST /api/spending-categories`
  and `POST /api/spending-category-map` are never requested. Reproduction: delete
  `{ onRequest: write }` from both in `routes/spending-categories.ts`, then run
  `npx vitest run tools/ledger/api`. Result: 343 of 343 pass. The table had this gap before the branch (`POST`
  rules, for example). This branch adds two more instances. The fix is a test per second verb, or a walk over
  `printRoutes`.
- **F3 · med** · no `Done when` line depends on it · The branch for "a rule now matches a row filed before that rule existed" has
  no proof, in either place it exists. In `inbox()` (`api/src/classifications.ts`), replace
  `match.kind === "classified" ? match.rule : null` with `null`. Separately, in `listRows`
  (`api/src/rows.ts`, a new file with no test file of its own), replace `rule = match.rule` with `rule = null`. Each change, run alone,
  leaves the `ledger` project at 663 of 663. When that branch breaks, the inbox and
  `GET /api/rows` give the same row different categories, and the
  `?spendingCategory=none` filter lists it wrongly. Both are one mechanism.
- **F4 · low** · **open decision** · A rule offered from a person's answer does
  not give its category to the row it was offered from. That row's
  classification is `manual` with no `rule_id`, so the category comes from the map or is none.
  Reproduction (`startApp`, answer the first inbox row as `mortgage`, then create
  the offered rule with `spendingCategoryId` = Household). The row answers
  `{ source: "manual" }` with `spendingCategory: null`. This follows the brief's
  order and the owner's decision 2, but the inbox form invites the opposite reading. Options:
  (a) **recommended**, leave it and say on the offer form that the category applies to future rows. (b) Have the offer also append an override for that row.
  (c) Store the answer as `accepted`, citing the new rule.
- **F5 · low** · An inbox row whose nearest suggestion names a spending category
  shows the map's category (`{ id: 1, source: "map" }`, reason `differs`).
  Accepting the suggestion files it under the rule's category (`{ id: 4, source: "rule" }`), because the
  classification cites that rule. This agrees with decision 2, and the display is accurate for the
  moment. It is recorded because the category changes on Accept and nothing says so.
- **F6 · low** · The note lg-15 added to lg-17's item 8 names `inbox()` but not
  `listRows` (`api/src/rows.ts`). That is a second direct reader of
  `current_classifications`. Under lg-17's sibling-record option, `listRows` would answer an
  automatically filed row as `classification: null`. Nothing here would have to be undone for lg-17:
  `HistoryAnswer` and `answersByDescription` are untouched, and migration 7 is free.
  The note should add `listRows` to lg-17's Build.
- **F7 · low** · The Log is false against the code. It says "changing the one line in `sameAnswer` to ignore it fails
  2 of 51 … and nothing else". Measured: 3 of 663 fail in the `ledger` project, the
  two `classify.test.ts` tests plus `api/test/spending-categories.test.ts` ›
  "two rules level at the top differing only in their spending category ask, as
  one answer".
- **F8 · low** · `nfr:maintainability`. `routes/spending-categories.ts` copies
  `idOf`, `Schema` and `bodyOf` from `routes/periods.ts` under the names `categoryId`,
  `Schema` and `parsed`. That makes a second copy inside one package.
- **F9 · low** · A filed row that has a category appears on no web screen. The web reads
  `GET /api/rows` only with `?spendingCategory=none`. So a row the map or a rule
  categorised wrongly cannot get an override from the web. "Shown wherever the
  row is" holds only because no screen shows such a row. lg-9's detail is the
  natural home for it.
- **F10 · low** · `nfr:performance`. Every `GET /api/rows` reads every stored row
  and runs `classify` on each unfiled one, and only then applies `limit`. At household scale this has no live cost.
- **dropped** · I suspected the migration should re-create `current_rules` and
  `current_period_lines`. On the migrated base database both views show
  `spending_category_id` without that. Not a defect.
- **dropped** · I questioned whether editing the contract and adding
  `SPENDING_CATEGORY_NOT_FOUND` needed a separate decision. Item 6 of the Build requires the API surface, and the code means
  nothing outside the ledger, so it belongs in the tool's own taxonomy. Not a defect.
- **dropped** · I questioned `BAD_REQUEST` with a custom message for a duplicate
  name. `salaries.ts` sets the same precedent. Not a defect.
- **findings** · the hunt returned 13; 10 carried, 3 dropped.
- Settled decisions, checked against the code. (1) `sameAnswer` compares
  `spendingCategoryId ?? null`. Planting it to ignore that field fails 3 of 663. (2) The
  category comes from the cited rule version (`citedRule` reads `rules` by id,
  over every version), and the real-input run kept a row filed by rule version 1 on
  the map after the edit. (3) An override of `null` withdraws, and the next lookup
  falls back to the rule, then the map.
- Inbox membership: an override on an inbox row left the inbox ids unchanged
  (`[7,1]` before and after). A mapped category neither holds a row in the inbox
  nor lets one out.
- Invariants skipped as untouchable by this diff: shell use, process trees, redaction, SSRF,
  progress, Dockerfile closure (no new workspace dependency).
- NFR: security ✓ (strict schemas, refusals name fields and not values, every route is limited) ·
  performance F10 · reliability F3 · maintainability F8.

### Gate 2

**Gate: CONCERNS** — 2026-10-10 · `2cd1f92e..2acb6aa5` · Opus 5.5, depth full

| Done when      | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6. Gates green | **unproven (gate)**. `test (ubuntu-latest)` and `test (windows-latest, informational)` were still running on `2acb6aa5` when this section was written. `check`, `docker`, `codeql`, `dependency-review` and `changes` passed. Code-scanning `CodeQL` failed with 2 new `js/missing-rate-limiting` alerts, both in `api/src/routes/spending-categories.ts`, on the `GET` handlers of the list and the map. That failure is expected under adr/005: `security.yml` dismisses only on a push to `main`, so an inline `// codeql[...]` comment never clears a pull request's check. The Log records the owner's excusal with its options (decision 4). Once the ubuntu leg passes on this head, the row becomes **awaiting**: the event is the push to `main` that runs `security.yml`'s dismissal step, and the reading is that both alerts read dismissed, "Suppressed via SARIF", on `main` afterwards |

Rows 1–5 are untouched by this round. The `ledger` project now passes 668 of 668 (663 at `2cd1f92e`).

- **F1 · fixed, as the owner chose (a).** Both new `GET` handlers carry
  `// codeql[js/missing-rate-limiting]`, with the same excusal text as
  `routes/salaries.ts`. Each comment names the test that guards that exact route. I removed `{ onRequest: read }` alone from each
  and ran `route-limits.test.ts`:
  - the list `GET` fails 1 of 40, "spendingCategories refuses the second request in a minute, as RATE_LIMITED";
  - the map `GET` fails 1 of 40, "spendingCategoryMap refuses the second request in a minute, as RATE_LIMITED".

  Both names match the comments. The three older comments' re-measured counts hold, each run alone:
  - `GET` recurring fails 1 of 40, "GET recurring refuses the second request in a minute too";
  - `GET` people fails 1 of 40, "people refuses the second request in a minute, as RATE_LIMITED";
  - `GET` salaries fails 1 of 40, "GET salaries refuses the second request in a minute too".

  The suppression itself can be read only after the merge (row 6). I did not check
  that the comment's line matches the alert. The check-run page reports each alert three lines
  below its comment, on the handler's last line, and the precedents put their comments in the same place.

- **F2 · fixed.** Added `route-limits.test.ts` › "POST %s refuses the second
  request in a minute too", for `rules`, `spendingCategories` and `spendingCategoryMap`.
  - Removing `{ onRequest: write }` from both new `POST`s (the gate-1
    reproduction) fails 2 of 348 in `tools/ledger/api`. Before the fix it was 0 of 343.
  - Each `POST` alone fails 1 of 40, under its own name.
- **F3 · fixed.** Added `spending-categories.test.ts` › "a rule that matches a
  row filed before the rule existed" › "gives the unfiled row its category in
  the inbox and in the rows list alike". It also asserts that the `none` filter
  leaves the row out. The second test in that block covers a rule that is only
  the nearest suggestion. Each gate-1 mutation, applied alone, fails that first test, 1 of 348:
  - in `inbox()`, `null` in place of the matching rule;
  - in `listRows`, `rule = null`.
- **F6 · fixed.** lg-17's item 8 now names `listRows` as a second direct reader
  of `current_classifications`, and says what the sibling-record option would do to it.
- **F7 · fixed.** The Log now says 3 of 663 and names the api test. It keeps the
  wrong first draft quoted as wrong.
- **F4, F5, F8, F9, F10** · recorded at gate 1, unchanged by this round, as the owner directed.
- **New in this round's lines:** none. The two new `POST` tests send `{}`, which
  gets a 400 that still spends a token, so the second request's 429 depends only on the limit.
  The mutations above prove it.
- **findings** · 0 new; of the 5 gate-1 findings in the round, 5 fixed and 0 refuted.
- **No high.** Nothing in this round is a `high`. The verdict stays CONCERNS only because row 6 is
  waiting on the test legs that were still running.

## Log

- 2026-10-06 — Filed from a conversation with the owner, who chose every design
  point above through questions: the map as default with a rule overriding it,
  uncategorised never blocking, this ticket creating the list (lg-10 now reuses
  it), and period lines picking from the list. The lg-9 split for receipt rows
  was stated to the owner as the filer's default and not objected to. The
  per-row override and computing the category when read are the filer's own
  defaults, not put to the owner; a builder who finds either wrong says so.
- 2026-10-10 — Built, on `lg-15-spending-categories` from `ad51f0b8`. Gate
  pending; the status stays `ready`.
  - **Storage.** Migration 6 (`api/src/db/schema.ts`): `spending_categories`
    (versions; a rename or a retirement supersedes), `spending_category_map`,
    `spending_category_overrides`, and a nullable `spending_category_id` on
    `rules` and `period_lines`. Everything that picks a category stores the id
    of its **first** version, because a rename files a new version and a
    reference to the version id would go stale; `root_id` is `NULL` on a first
    version and the id of the first on every later one (CHECK-tied to
    `supersedes`). Six generic names are seeded; no rule and no map line is.
  - **`books`.** `spendingCategory(row, classifyingRule, map, override)` and
    `spendingMap(versions)` in `books/src/spending.ts`; the four-step order is
    asserted in `books/test/spending.test.ts` (override over rule over map over
    none). `api/src/rows.ts` lists stored rows with theirs (`GET /api/rows`,
    `?spendingCategory=none` is the filter, capped by `limit`) and writes the
    override; `inbox()` answers `InboxRow.spendingCategory`.
  - **Item 7 was already written.** #380, which filed this ticket, wrote the
    receipt-split and uncategorised notes into lg-9's Build; this change only
    adds to that bullet where to read the category from. A short note on what
    lg-15 touched was added to lg-17's item 8, since it shares the files.
  - **What the brief had wrong.** Nothing in the design; two things about the
    surroundings. (1) I first re-created `current_rules` and
    `current_period_lines` in the migration on the belief that a `SELECT *`
    view keeps the columns the table had when it was made. It does not in
    SQLite: deleting those lines left every test green (45 of 45 in
    `spending-categories.test.ts` and `rules.test.ts`), so they were taken out
    and the test that reads the new column through the view stays as the
    regression. (2) The "1 of its N tests" counts in the CodeQL comments in
    `routes/periods.ts`, `routes/rules.ts` and `routes/salaries.ts` were stale
    (22, 22, 31 against a file that had 31); six new routes make it 37, and
    each was re-measured by taking `{ onRequest: read }` off its route and
    running `route-limits.test.ts` (1 failure each, named as the comment says),
    then restored. That is the fold-in exception: the comment says what to
    measure, and adding the routes changed the number.
  - **Words.** The rule form's "Category" label became "Bank category" and the
    period-line form's free-text input became a "Spending category" select, so
    the two are never read for each other. A new line sends `category: null`;
    the free-text column and every stored line's text are untouched, and the
    web lists a line by its spending category, else its text.
  - **Open decisions, for the owner (not settled here).**
    1. _Is a rule's spending category part of "the same answer" in `classify`?_
       Built: **yes**, `sameAnswer` compares it (`null` counts as a value), so
       two rules level at the top that differ only in it are `ambiguous` and the
       row waits. Pinned by `books/test/classify.test.ts`, "classify, with
       spending categories (lg-15)": changing the one line in `sameAnswer` to
       ignore it fails 3 of 663 in the `ledger` project (the first and third
       tests there, and `api/test/spending-categories.test.ts` › "two rules
       level at the top differing only in their spending category ask, as one
       answer"). The first draft of this entry said "2 of 51 … and nothing
       else", which measured only the `books` file.
       The other choice classifies silently by the newest `id`. Cost of yes: a
       row asks where two equally specific rules disagree on the category only.
    2. _Does a filed row follow its rule's later edits?_ Built: **no**, a
       classified row takes the category of the rule **version** its
       classification cites (`rule_id`), as the brief said; editing a rule to
       add a category leaves rows it already filed on the map's. Pinned by
       `api/test/spending-categories.test.ts`, "editing a rule's category files
       a version, and a row keeps the version it was filed by". The alternative
       follows the rule's chain to its latest version, retirements included
       (they copy the category), so past rows follow an edit as they follow a
       map fix; about 15 lines of recursive SQL and the assertion above flips.
    3. _The override's `null` withdraws it; it cannot say "none"._ A row whose
       map or rule gives a category cannot be made uncategorised by hand.
       Built so because a withdrawal has to be expressible and the brief lists
       no third state; a separate "explicitly none" record is the alternative.
  - **Not run.** No browser or end-to-end run: `e2e/README.md` says there is
    still no spec, and the screens are covered by the web unit tests only.
- 2026-10-10 — Gate 1 round: the owner's answers, and what was fixed.
  - **Owner decisions, 2026-10-10.**
    1. A rule's spending category is part of "the same answer": **yes, as
       built.** Options were yes (rules that differ only in it ask) or no
       (newest `id` wins silently). The builder recommended yes.
    2. A filed row follows its rule's later edits: **no, as built.** Options
       were the cited version (a row keeps the rule version it was filed by) or
       the rule's chain to its latest version. The builder leaned to the chain;
       the orchestrator recommended the cited version, which was also the
       brief's default. The owner chose the cited version.
    3. An override can mean "explicitly none": **no, as built.** Options were
       `null` withdraws (built) or a separate "explicitly none" record. The
       builder recommended `null` withdraws.
    4. CodeQL `js/missing-rate-limiting` on the two new `GET` handlers (the
       list and the map): **excused under `docs/adr/005`.** Options were that,
       or moving each `GET` to a path no `POST` shares (a contract change that
       gives up the precedent of salaries, recurring and people). The gate
       recommended the excusal. Each route now carries the
       `// codeql[js/missing-rate-limiting]` comment naming its guarding test,
       and all five such comments were re-measured together: taking
       `{ onRequest: read }` off all five fails exactly 5 of 40 in
       `route-limits.test.ts`, one each, by the name each comment cites.
    5. Gate F4: left as recorded, including the form wording. F5, F8, F9 and
       F10 stay in the gate record and the code is unchanged for them.
  - **F2.** `route-limits.test.ts` walks one verb per route, so the `POST` of a
    path that also answers a `GET` was never requested. Reproduced as the gate
    described. Added `POST %s refuses the second request in a minute too` for
    `rules` (an earlier gap of the same shape), `spendingCategories` and
    `spendingCategoryMap`. Mutation: taking `{ onRequest: write }` off both new
    `POST`s fails 2 of 348 in `tools/ledger/api` (both new tests), where it was
    343 of 343 before. A walk over `printRoutes` was the other option; the
    per-verb test was chosen because it is the shape the file already uses.
  - **F3.** Added `a rule that matches a row filed before the rule existed`
    (two tests, `api/test/spending-categories.test.ts`): the inbox and
    `GET /api/rows` give the unfiled row its matching rule's category, the
    filter does not list it, and a rule that is only the nearest suggestion
    gives neither a category. Mutations, each alone, over `tools/ledger`:
    `inbox()` passing `null` for the rule fails 1 of 668; `listRows` setting
    `rule = null` fails 1 of 668 (the first new test both times), where each
    left 663 of 663 before.
  - **F6, F7.** lg-17's item 8 now names `listRows` as a second reader of
    `current_classifications`; the sentence above about `sameAnswer` now gives
    the 3 of 663 it measured.
