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

## Review

**Gate: PASS** — 2026-08-18 · `origin/main...HEAD` · code-review at medium

Diff reviewed: `git diff origin/main...HEAD` (one commit, 102fc65), touching `tools/planner/api/test/helpers/intakes.ts`, `tools/planner/api/test/intakes-routes.test.ts`, and the ticket file.

| Done when                                                                                                                                        | Proof                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One typed builder in `helpers/intakes.ts` is the only place in the planner's suites that hand-writes `INSERT INTO intakes`/`INSERT INTO answers` | `grep -rn "INSERT INTO (intakes                                                                                                                                                                                                                                                                                                                                                                               | answers)" tools/planner`→ only`api/test/helpers/intakes.ts:129,133`(the builder) plus the two documented exceptions the ticket's Log names:`intakes-store.test.ts:105,108`(malformed-JSON case, can't be typed) and`migrations.test.ts:61`(schema test, no`App`/tree). This line says "asserted by reading the file, not by a scan," so verified by inspection rather than a test, as intended. ✓ |
| All three call sites use it, and each still asserts what it asserted before                                                                      | `saveStaleIntake`/`saveVersionOneRoadTrip`/`saveVersionTwoRoadTrip` now call `saveIntake` (`intakes-routes.test.ts:288,313,376`); assertions unchanged — `discarded`, `answerRows`, `brief` and `updatedAt` checks at `intakes-routes.test.ts:335-356` (v1↔v2), `393-408` (v2↔v3), `460` (`expect(second.intake.updatedAt).toBe(NOW.toISOString())`, the stale-intake case) all read identically to `main`. ✓ |
| Answers typed against `@planner/contract`                                                                                                        | `helpers/intakes.ts:123` — `saveIntake(app: App, intake: { id: string; treeVersion: number; answers: Answers })`, `Answers` imported from `@planner/contract`; values built through `answered()` which returns `Answer`. `npm run check` typechecks this under `tsconfig.tests.json` (verbose build log shows `intakes-routes.test.ts` as that project's newest input) — clean. ✓                             |
| `npm run check` and `npm test -- --project planner` pass, same test count as before                                                              | Ran both: `npm run check` clean (only pre-existing, unrelated `no-await-in-loop` warnings in downloader/agent files); `npm test -- --project planner` → 526 tests, 40 files, matching the ticket Log's claim of the same count as `main`. ✓                                                                                                                                                                   |

- No findings. The `code-review` skill at medium returned `[]` after an explicit line-by-line diff of each old inline `write()` block against the new `saveIntake` call (SQL text, parameter order, JSON payloads byte-identical), plus checks on the `App` type re-export path, `Answers`/`QuestionId` typing of retired ids, and `Object.entries` ordering. Nothing to carry or drop.

Invariants checked: tool-import boundary (only `@planner/contract`/`fastify`, no cross-tool import), contract not edited (only consumed), test registration (`tsconfig.tests.json:124` already references `tools/planner/api`; the helper file is part of that project's build per `tsc --build --verbose`), style (`import type` used correctly, no `any`/`console`, `.ts` relative-import extensions). Invariants skipped as not plausibly touched by a test-fixture-only diff: `AppError`/error-code taxonomy, shell/spawn safety, `redactHeaders`/`redactUrl`, SSRF checks, faked-progress rule, new-dependency-and-Dockerfile rule (no new workspace dependency added).

- NFR: security n/a (test-only fixture code) · performance n/a (test-only) · reliability ✓ (behavior proven identical, assertion-by-assertion, test count unchanged) · maintainability ✓ (exactly what the ticket set out to do — three duplicated SQL blocks now one typed function)

## Log

**2026-08-18 — done.** `saveIntake` in `api/test/helpers/intakes.ts` takes
`{ id, treeVersion, answers }` and writes the two `INSERT`s; the three fixtures
in `intakes-routes.test.ts` are now one call each and keep the comments that say
what each answer is for, which is the part of them worth reading. `answers` is
`Answers` from `@planner/contract`, so the values go through `answered()` and a
change to `Answer` breaks `npm run check` rather than a later assertion.

**What it does not type is the question id.** `QuestionId` is `string`, so
`Answers` constrains the value and not the key: a change to `Answer` breaks the
build, but a wrong or mistyped id still writes a row and nothing says so. That is
deliberate rather than an oversight — `retired.question`, `road-trip.drive-hours`
and `road-trip.vehicle` are ids the tree no longer has, and a key typed as a union
of the live ones would make these three fixtures unwritable, for the same reason
the builder bypasses `db/intakes.ts` at all. So the builder is no help against
reusing an id for a different question; the tree's own content review is still the
only thing standing there.

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
