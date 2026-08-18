---
id: pl-20
tool: planner
title: One builder for a saved intake, instead of three copies of its SQL
kind: chore
status: done
milestone: null
depends_on: []
---

# pl-20 — One builder for a saved intake

**Packages:** `api` (tests only)

## Why

`api/test/intakes-routes.test.ts` hand-writes the same two `INSERT` statements
three times, once per fixture that needs an intake already in the database:

- `saveStaleIntake` — `:287`
- `saveVersionOneRoadTrip` — `:317`
- `saveVersionTwoRoadTrip` — `:394`, added by
  [pl-18](./pl-18-destination-asked-early.md)

Each writes `INSERT INTO intakes (id, title, tree_version, created_at,
updated_at)` and then loops `INSERT INTO answers (intake_id, question_id, value,
answered_at)`. Two copies was tolerable; the third is the one that makes it a
pattern, and it was found by the `code-review` pass behind pl-18's review gate.

**The cost is specific, not stylistic.** These are untyped SQL strings in test
code, so a column rename in migration 3's tables is caught by nothing here: the
suite does not typecheck a string, and the failure mode is not a red build but a
fixture that writes a subtly wrong row and a test that then asserts against it.
`api/src/db/intakes.ts` is the real writer and is typed against the contract;
these three are a shadow writer that nothing holds to the same shape.

It is a **`low`** finding and it is in test code. It is a ticket rather than a
drive-by because the file belongs to a merged ticket and nobody should be opening
it for reasons they merely overheard.

## Build

1. **One builder in `api/test/helpers/intakes.ts`**, beside the helpers that are
   already there — that file is where this suite's fixtures live, and a fourth
   copy inside the test file is what this ticket exists to stop.
2. **Take what actually varies** and nothing else. Across the three call sites
   that is: the tree version, the answers, and (for the stale case) the
   timestamps. Everything else is the same row every time. Resist a parameter per
   column — a builder with eight optional arguments is the copies again with
   extra steps.
3. **Type the answers against the contract**, so a change to `Answer` or to what
   an answer's stored JSON looks like breaks this at `npm run check` rather than
   at some future assertion. That is the whole point of the exercise; a shared
   helper that is still untyped has moved the problem rather than fixed it.
4. **Rewrite the three call sites** to use it, and check that each still tests
   what it did. `saveVersionOneRoadTrip` and `saveVersionTwoRoadTrip` differ in
   the tree version they claim and in the answers they carry — that difference is
   the subject of pl-18's reconciliation tests and must survive the refactor
   intact.

Traps worth knowing in advance:

- **These fixtures deliberately bypass `api/src/db/intakes.ts`.** They exist to
  write rows the current code would not write — an intake at an older
  `tree_version`, an answer to a question the tree no longer has — which is the
  only way to test reconciliation on read. So the builder must keep writing SQL
  directly. **Do not "fix" it by routing through the real writer**: that would
  delete the test cases.
- **Do not reuse a question id for a different question**, here or anywhere. The
  version-one and version-two fixtures depend on specific ids meaning specific
  things across a tree change.
- Nothing about the behaviour under test changes. If the assertion count moves,
  something went wrong.

## Done when

- One typed builder in `api/test/helpers/intakes.ts` is the only place in the
  planner's suites that writes `INSERT INTO intakes` or `INSERT INTO answers` by
  hand — asserted by reading the file, not by a scan.
- All three call sites use it, and each still asserts what it asserted before.
- The answers a fixture carries are typed against `@planner/contract`, so a
  contract change breaks the build rather than a fixture.
- `npm run check` and `npm test -- --project planner` pass, with the same number
  of tests as before.

## Log

**2026-08-18 — done.** `saveIntake` in `api/test/helpers/intakes.ts` takes
`{ id, treeVersion, answers }` and writes the two `INSERT`s; the three fixtures
in `intakes-routes.test.ts` are now one call each and keep the comments that say
what each answer is for, which is the part of them worth reading. `answers` is
`Answers` from `@planner/contract`, so the values go through `answered()` and a
change to `Answer` breaks `npm run check` rather than a later assertion.

`npm run check` green, `npm test -- --project planner` 526 tests over 40 files —
the same count as `main`, checked by stashing and re-running rather than by
trusting that nothing moved.

**The brief was wrong about the timestamps.** It said they vary "for the stale
case"; all three fixtures wrote `NOW` for `created_at` and `updated_at`, and one
test asserts exactly that (`expect(second.intake.updatedAt).toBe(NOW.toISOString())`
— the tree moved, nobody touched the intake). So the builder takes no timestamp
argument and stamps `NOW`, which is the "resist a parameter per column" rule
applied to the one parameter the brief itself asked for. Only `id`, the tree
version and the answers vary; `title` is `NULL` in all three.

**Two hand-written `INSERT`s remain in the planner's suites, on purpose**, so
the grep behind the first acceptance line returns more than this builder and the
next reader should not have to re-derive why:

- `intakes-store.test.ts:105,108` writes `"{not json"` and `{"state":"shrugged"}`
  to prove `selectAnswers` reports an unreadable row instead of throwing over it.
  A builder typed against `Answer` cannot express either by construction — that
  is what typing it was for — so routing this through it would delete the test.
  Its valid rows already go through `insertIntake`/`upsertAnswer`.
- `migrations.test.ts:61` writes one row into a raw database at a pinned
  `user_version` to prove `migrate` twice is a no-op. There is no `App` there and
  no answers; pointing a migration test at an intake fixture helper would couple
  the schema's test to the tree's.

Both are the store's or the schema's own tests rather than intake fixtures, which
is the line the acceptance line was drawing. The three that shared a shape now
share a function.
