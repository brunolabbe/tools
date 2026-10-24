---
id: lg-65
tool: ledger
title: A paste search holds the write lock for 30 s to minutes when a workbook's dates alternate by a day
kind: fix
status: done
milestone: null
depends_on: []
difficulty: hard
---

# lg-65 — A paste search holds the write lock for 30 s to minutes when a workbook's dates alternate by a day

## Why

A paste that re-dates or reorders a day is matched against the workbook by a
search over the ways its rows can be cut into blocks: `matchStretch` and
`matchBlock` in `tools/ledger/api/src/workbook-days.ts`. That search is the
origin of two tickets: [lg-59](./lg-59-a-paste-cannot-double-store-a-redated-reordered-day.md)
(PR #564, merged 2026-10-19) built it, and
[lg-61](./lg-61-a-paste-against-a-workbook-row-two-or-three-days-off.md)
(PR #586, merged 2026-10-20) gave it a second, wider reading. Both are on
`main` at `2d1b22bb`.

When the workbook's dates change at almost every row, almost every row is a
place a block may end, and the search has that many cuts to try. A three-row
paste into a 300-row workbook then takes 28 to 71 seconds on `main` (it took over
a minute on `main` before lg-58), inside the
write transaction of the import (`importStatement` in
`tools/ledger/api/src/statements.ts` runs in one `IMMEDIATE` transaction, so the
database's write lock is held for the whole search). Nothing bounds how long the
search may run.

The figures below come from [lg-58](./lg-58-file-paste-reports-dates-a-day-off.md)'s
gate 1 on its own branch, `lg-58-report-day-off-dates`, PR #596 (merged as
`aaccab20`; the gate measured head `add2fb9f`, the merged head is `e1764829`). The
"branch" column is that gate's tree, which `main` now carries, and the "`main`
`2d1b22bb`" column is the tree before lg-58. The defect is on `main` as it stands:
the 2026-10-24 Log entry re-measured it there. The merged code is faster on every
shape the gate could run on both trees, and it still takes 28 to 34 seconds on the
300-row alternating case, 51 to 71 on the constant one, and over 277 seconds on the
1,000-row one. lg-58 did not close the defect.

### Reproduction

**Input shape, exactly.** One workbook import with `w` rows, `statement_imports`
source `workbook`, rows `seq` 0 to `w − 1` in one `BEGIN … COMMIT`, starting from
an opening balance of 1,000,000 cents. For row `i`:

- **Date:** `day ⌊i / r⌋ + (i mod 2)`, so within each block of `r` rows the dates
  alternate by a day. `r` is the rows a date: 50, 100 or 200 below.
- **Amount:** `alt` gives +1000 cents on even `i` and −1000 on odd `i`; `const`
  gives +1000 on every row. The stored balance follows the amounts.

**Where the paste sits.** Three rows, `i` from `⌊w/2⌋ − 1` to `⌊w/2⌋ + 1`, in the
middle of the history, so each pasted row is one the workbook already holds. Each
carries the amount of its row and the date `⌊i / r⌋`, which is the day before the
stored date on odd `i`, so the paste reads as its rows re-dated by a day. Its
opening balance is 1,000,000 plus the amounts before its first row, and the
balances follow from it. The text is `renderPaste(withBalances(rows, opening))`
from `tools/ledger/api/test/helpers/paste.ts`.

**The call.** `importStatement({ db, personId: "alex", now: () => new Date("2026-10-18T00:00:00Z") }, text)`
on a fresh `:memory:` better-sqlite3 database after `migrate(db)`, timed with
`performance.now()` around that one call. One case per vitest process, run first
on `main` and then on the branch, each under `timeout` (the gate used 60 s for the
300-row cases and 150 s for the 1,000-row one).

**The spec**, `tools/ledger/api/test/lg-65-reproduction.test.ts`, is the gate's
timing harness with its header comment cut. Copy it into a worktree of `main`
(farm and build first) and run it with `GATE_OUT` and `GATE_CFG` set:

```ts
import { appendFileSync, readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { expect, test } from "vitest";
import { AppError } from "@ledger/contract";
import { migrate } from "../src/db/schema.ts";
import { importStatement } from "../src/statements.ts";
import { renderPaste, withBalances } from "./helpers/paste.ts";

const OUT = process.env.GATE_OUT as string;
const CFG = process.env.GATE_CFG as string;
const OPEN = 1_000_000;
const BASE = Date.UTC(2026, 0, 1);
const dateOf = (offset: number): string =>
  new Date(BASE + offset * 86_400_000).toISOString().slice(0, 10);

interface Case {
  r: number;
  w?: number;
  p: number;
  amts: "const" | "alt" | "five";
  mode: "tail" | "inside" | "miss";
  redate?: "none" | "alt" | "rand" | "plus1";
}

function amountAt(kind: Case["amts"], i: number): number {
  if (kind === "const") return 1000;
  if (kind === "alt") return i % 2 === 0 ? 1000 : -1000;
  return [1000, -1000, 500, -500, 500][i % 5] as number;
}

test("timing", () => {
  const c = (JSON.parse(readFileSync(CFG, "utf8")) as Case[])[0] as Case;
  const w = c.w ?? c.p * 2 + 50;
  const db = new Database(":memory:");
  migrate(db);
  const imp = db.prepare(
    "INSERT INTO statement_imports (imported_at, imported_by, source) VALUES (?, ?, 'workbook')",
  );
  const ins = db.prepare(
    "INSERT INTO statement_rows (seq, date, category, description, amount_cents, balance_cents, import_id) VALUES (?, ?, '', ?, ?, ?, ?)",
  );
  const id = imp.run("2026-10-01T00:00:00Z", "alex").lastInsertRowid;
  let balance = OPEN;
  const all: { day: number; amountCents: number }[] = [];
  for (let i = 0; i < w; i++)
    all.push({ day: Math.floor(i / c.r), amountCents: amountAt(c.amts, i) });
  const redate = (i: number): number =>
    c.redate === "alt"
      ? i % 2
      : c.redate === "rand"
        ? (((i * 2654435761) >>> 0) % 3) - 1
        : c.redate === "plus1"
          ? 1
          : 0;
  db.exec("BEGIN");
  all.forEach((t, i) => {
    balance += t.amountCents;
    ins.run(i, dateOf(t.day + redate(i)), `W${i}`, t.amountCents, balance, id);
  });
  db.exec("COMMIT");
  let from: number;
  let to: number;
  if (c.mode === "tail") {
    from = w - c.p;
    to = w + 1;
    all.push({ day: Math.floor(w / c.r), amountCents: 700 });
  } else if (c.mode === "inside") {
    from = Math.floor(w / 2) - Math.floor(c.p / 2);
    to = from + c.p;
  } else {
    from = w - c.p;
    to = w;
    all[w - Math.floor(c.p / 2)] = { day: all[w - Math.floor(c.p / 2)]!.day, amountCents: 333 };
  }
  let open = OPEN;
  for (let i = 0; i < from; i++) open += all[i]!.amountCents;
  const rows = all.slice(from, to).map((t) => ({
    date: dateOf(t.day),
    description: `Op ${t.amountCents}`,
    amountCents: t.amountCents,
  }));
  const text = renderPaste(withBalances(rows, open));
  const started = performance.now();
  let outcome: string;
  try {
    const rep = importStatement(
      { db, personId: "alex", now: () => new Date("2026-10-18T00:00:00Z") },
      text,
    );
    outcome =
      `accepted add=${rep.rowsAdded} present=${rep.rowsAlreadyPresent}` +
      ((rep as { datesDiffering?: unknown[] }).datesDiffering
        ? ` dd=${(rep as { datesDiffering: unknown[] }).datesDiffering.length}`
        : "");
  } catch (error: unknown) {
    outcome =
      error instanceof AppError
        ? `${error.code}${error.message.includes("two ways") ? " (two ways)" : ""}`
        : `throw ${String(error)}`;
  }
  const ms = Math.round(performance.now() - started);
  appendFileSync(OUT, `${JSON.stringify({ ...c, w, ms, outcome })}\n`);
  db.close();
  expect(true).toBe(true);
});
```

**The runs.** Each case is one JSON array in a file, one object, then:

```bash
echo '[{"r":100,"w":300,"p":3,"amts":"alt","mode":"inside","redate":"alt"}]' > case.json
GATE_OUT=out-base.jsonl GATE_CFG=case.json timeout -k 5 60 \
  npx vitest run --testTimeout=900000 tools/ledger/api/test/lg-65-reproduction.test.ts
```

Use `--testTimeout=900000`: vitest's 5-second default fails the file after the
loop has run, which reads as a failure of the code. A run cut by `timeout` leaves
no line in `GATE_OUT`, so its absence is the reading, and `timeout` exits 124. The
four cases are `{"r":50,"w":200,…}`, `{"r":100,"w":300,…}` (alternating and
constant amounts) and `{"r":200,"w":1000,…}`, each with `"p":3,"mode":"inside","redate":"alt"`.

**The figures.** Single runs, one case per process, base then branch, with other
probes on a machine at load average 3 to 6 on 12 cores. The ratios are what to
read. Taken from the gate's full report and checked against its raw
`time-tiny2-*.jsonl` and `time-tiny-*.jsonl` lines.

| case (3 pasted rows inside)                 | `main` `2d1b22bb` (before lg-58) | branch `add2fb9f` (PR #596, now merged as `aaccab20`) | outcome                                           |
| ------------------------------------------- | -------------------------------- | ----------------------------------------------------- | ------------------------------------------------- |
| 200-row workbook, 50 a date, alternating    | 30,723 ms                        | 3,042 ms                                              | `STATEMENT_ROW_CONFLICT` (two ways), both trees   |
| 300-row workbook, 100 a date, alternating   | over 60 s, stopped               | 25,317 ms                                             | `STATEMENT_ROW_CONFLICT` (two ways) on the branch |
| 300-row workbook, 100 a date, constant      | over 60 s, stopped               | 42,872 ms                                             | accepted, 0 added, 3 present, on the branch       |
| 1,000-row workbook, 200 a date, alternating | over 150 s, stopped              | over 150 s, stopped                                   | not finished on either                            |

Not measured: whether any real household workbook has dates that change at
almost every row (the gate's dates come from the formula above); the other
`mode` values (`tail`, `miss`); the constant 1,000-row shape; the scaling between
the sizes; and whether the branch's outcomes are right in the constant case.

## Decision — answered 2026-10-24

The defect is slow search, and the owner has to choose the bound before anyone
can build a fix that is checked against it. Two questions, the second depending on
the first.

**Question 1. How long may a paste hold the write lock?** The reproduction's
300-row shapes run 28 to 71 s on `main` as it stands (2026-10-24 Log entry). The
filer cannot recommend a number, because nothing here measures what the owner
will tolerate for a paste. Options: a bound in seconds, stated for the 300-row
shapes and for the 1,000-row shape separately, or a bound that is only
"whatever the search takes" (no bound; the defect is then recorded as accepted).

**Question 2. How is the bound kept?**

- **A. Cap the cuts the search will try, and refuse above the cap** with a named
  error, the way `LONGEST_SEARCHED_DAY` already refuses a day's search ("that search
  is not made"). Cost: small to build. It changes outcomes: a paste the search
  accepts today on a long alternating workbook would be refused, and the cap value
  is itself the owner's choice.
- **B. A wall-clock timeout on the search.** Cost: small to build. The outcome then
  depends on the machine's load: the same paste can be accepted on one run and
  refused on another, and no test can pin it. Not recommended.
- **C. The same answer, found faster**, by a search over the same cuts that does
  less work per cut. The filer has not designed one or measured one: the search
  tries each (from, to) pair once, so the obvious memo does not help. Cost: hard. Acceptance is unchanged, so it can be checked against the existing suites
  and a differential oracle, which C would have to write: lg-58's oracle was a
  gate's brute-force run and was never committed (see the 2026-10-24 Log entry).

**Recommendation: C, with A as the fallback only if C cannot meet the bound from
Question 1.** C keeps every outcome the rule gives today; A changes outcomes and
needs a cap the owner has to choose. The filer has not measured C's speed-up, so
this is a recommendation and not a finding. `difficulty: hard` rates C, the
recommended option; A alone would be `standard`.

**The owner's answers, 2026-10-24** (relayed by the orchestrator in the build
dispatch; the full options are in that day's second Log entry):

- **Question 1: "10 s / 30 s".** A three-row paste completes in under 10 s on each
  300-row shape and under 30 s on the 1,000-row shape.
- **Question 2: "C, then A".** Build C. If C cannot meet 10 s / 30 s, do not build
  A: stop, and bring the owner the measured speed-up, the cap value that would meet
  the bound and the pastes it would refuse, as options.

## Build

The Decision is answered (above). The work is:

1. On a worktree of `main`, copy the reproduction spec in, run the 300-row
   alternating case, and confirm it runs past 60 s before any code changes.
2. Build the option the owner chose. Under C, the outcome and the stored rows must
   match `main`'s on every paste the `lg-59` and `lg-61` suites cover and on a seeded
   differential against `main`'s search. Under A, the refusal is a named code
   with its own test, and the cap's value is the owner's.
3. The suite cannot run the 300-row shape within its budget. Find a smaller shape
   that fails on `main` by measurement first, and pin it with a spec in
   `tools/ledger/api/test/`.
4. Record base and fixed times for each reproduction shape in the Log.

## Done when

1. On the 300-row alternating reproduction, a three-row paste completes in under
   the bound the owner sets under Decision, with `main`'s and the fixed build's
   times in the Log (measured by the reproduction spec, not a unit test).
2. The 1,000-row reproduction is measured too, and the Log states whether it meets
   the bound.
3. Outcomes are unchanged on every paste the `lg-59` and `lg-61` suites cover and
   on the seeded differential against `main`. Any paste whose outcome changes is one
   the chosen option names (a refusal under a cap). The test that asserts this is
   named in the Log.
4. A regression spec for the pinned shape is in `tools/ledger/api/test/`, sized to
   fail on `main` within the suite's budget.

## Review

**Gate: CONCERNS** — 2026-10-24 · `8a6dcf9a..715e4cc3` · Sonnet 5.5, depth full. No `high`; one `med`, which no `Done when` line is unmet by.

| Done when                                                                                                                                     | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. A three-row paste into the 300-row alternating reproduction completes under the owner's 10 s, with `main`'s and the fixed times in the Log | **verified** — the ticket's reproduction spec re-run on the head, one case per process: 763 ms at load 1.62 (`STATEMENT_ROW_CONFLICT`, two ways); the constant shape 901 ms (accepted, 0 added, 3 present). `main`'s 30.5–33.7 s and 51–71 s are the Log's and I did not re-run them; I re-ran `main` on the 250-row shape: 14.6 s. The line asks for a spec run, not a unit test, so nothing in `npm test` asserts it                                                                                                                    |
| 2. The 1,000-row reproduction is measured, and the Log says whether it meets the bound                                                        | **verified** — 4,497 ms at load 1.49 against 30 s, `STATEMENT_ROW_CONFLICT` (two ways). `main` never finished on this shape, so its outcome here is unknown and equivalence at this size is unmeasured                                                                                                                                                                                                                                                                                                                                    |
| 3. Outcomes unchanged on the lg-59 and lg-61 suites and on the seeded differential, the test named in the Log                                 | **proven** — `api/test/lg-65-search.test.ts` › "the search pairs and decides every seeded paste as main's search did (lg-65)" compares every `matchStretch` call and every stored outcome with `main`'s search; `api/test/workbook-days.test.ts` and `api/test/statements.test.ts` are unchanged and pass (ledger project: 1,676 of 1,676 tests, 80 of 80 files). My run of seeds 20,001–25,000: 0 of 96,592 calls and 0 of 5,000 outcomes differ, and my own 400,000-call differential finds 0. How far the committed spec reaches is F1 |
| 4. A regression spec for the pinned shape, sized to fail on `main` within the suite's budget                                                  | **proven** — `api/test/lg-65-alternating-dates.test.ts` › "a three-row paste into 250 rows whose dates alternate by a day is read in under 5 s (lg-65)": it asserts the error code, the three readings, then `elapsed < 5000`. On `main`'s search it fails on the time line ("expected 14613.39293 to be less than 5000", one run), the two assertions before it having passed; on the head 10 of 10 pass at 581–688 ms                                                                                                                   |

- **med** · F1 · no `Done when` line is unmet by it; it is the reach of line 3's committed proof · The committed differential does not guard the tie-break in `pairAt` (`api/src/workbook-days.ts`). One planted line (drop the `dates.sort` that orders a leftover row's candidate dates by first listing in the block) leaves `lg-65-search.test.ts` green at its 200 seeds, leaves a dump of seeds 1 to 20,000 byte-identical to the head's, and is seen over seeds 20,001–25,000 in 2 calls of 96,592 (one seed, 21059). The head is right there (0 of 400,000 in my differential, which sees the same plant in 21 of 20,000 cases, 2.9 s). Two copies of one rule are kept in step by a guard that barely reaches it: `pairAmounts` still serves a part with rows on both sides, `pairAt` the rest. **Open decision**, remedy A recommended: (A) commit a no-database differential of `matchStretch` against the reference copy, drawing small amount pools, re-dated and swapped rows, blocks of 18–24 rows (the full report has the script's shape and what it caught); (B) widen `paste-population.ts` until its seeds draw the tie, unmeasured. Reproduction in the full report.
- **low** · F2 · no live call site · The population reads less than exists: its alternating shape never draws a paste that cannot fit (`miss`), stops at 40 rows, and puts rows a paste stored only in the stretch shapes (6,143 of 96,592 calls hold any). My differential draws all three; 0 differ.
- **dropped** · "The oracle is not `main`'s search": a diff of `helpers/reference-search.ts` against `main`'s `workbook-days.ts` shows only the `export` keywords, the imports, the two constants copied in and the header comment changed; `matchStretch`, `matchPart`, `pairAmounts` and `someAddUpTo` are identical text. Not a defect.
- **dropped** · "A shortcut diverges from `main` at an edge" (a block of exactly 20 rows and of 21, a stretch opening on a block boundary, balances that agree only after a block grows, `pairAt` against `pairAmounts` on tied amounts): 0 of 400,000 direct calls and 0 of 96,592 population calls differ, each edge reached (56,853 and 49,798 of the 400,000 hold the stretch in a block of 20 and of 21 rows), and three of my four planted divergences were caught by the committed spec. No divergence found.
- **dropped** · "The `someAddUpTo` rewrite changes an answer": 0 of 300,000 random triples differ, 157,786 of them true.
- **dropped** · "The 5,000 ms assertion is flaky": 10 of 10 at 581–688 ms, 3 of 3 beside the ledger suite at 1,023–1,323 ms, 587 ms on CI's ubuntu leg and 673 ms on its Windows leg, on this head. Margins are 7 to 8 times unloaded and 3.8 times loaded; `main` fails it by 2.9 times.
- **findings** · the hunt returned 6; 2 carried, 4 dropped.
- CI: `gh pr checks 606` at this head, every check `pass` including `test (windows-latest, informational)`; the run belongs to this sha.
- Invariants: walked style (no `any`, no `console`, `import type`, `.ts` extensions, `node:` builtins in the new files) and test registration (the new specs sit under `api/test`, inside the tests tsconfig glob; CI `check` is green on this head); skipped contract, error taxonomy, shell, redaction, SSRF, progress, Dockerfile and routes, none of which the diff touches (`statements.ts` is unchanged).
- NFR: security n/a · performance ✓ (bound met on all three shapes; time past 1,000 rows unmeasured, and the Log's profile puts most of the remaining 1,000-row time in `nearby` outside this diff, which I did not re-measure) · reliability ✓ · maintainability — F1.

### Gate 2

**Gate: PASS** — 2026-10-24 · `715e4cc3..60d08bfd` (the round: three commits, two files, a new spec and the ticket; base `8a6dcf9a`) · Sonnet 5.5, depth medium (dispatch: narrow). No `high`, no `med`; F1 and F2 are fixed; one new `low`.

| Done when                                                                             | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. A three-row paste into the 300-row alternating reproduction completes under 10 s   | unchanged since gate 1, where it was **verified** (763 ms): the round's diff is the new spec and the ticket, so `api/src/workbook-days.ts` is the file gate 1 timed; not re-run                                                                                                                                                                                                                                                                                                                                      |
| 2. The 1,000-row reproduction is measured and the Log says whether it meets the bound | unchanged since gate 1, where it was **verified** (4,497 ms against 30 s); not re-run                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 3. Outcomes unchanged on the lg-59 and lg-61 suites and on the seeded differential    | **proven** — `api/test/lg-65-search.test.ts` › "the search pairs and decides every seeded paste as main's search did (lg-65)" and now `api/test/lg-65-search-direct.test.ts` › "matchStretch answers every drawn case as main's search did (lg-65)". The second fails on each of gate 1's M1, M2, M3 and M4 at its default 20,000 cases and passes on the head (0 of 20,000 differ, 0 of 150,000). The reach that gate 1 left open on this line is closed (F1). Ledger project: 81 of 81 files, 1,677 of 1,677 tests |
| 4. A regression spec for the pinned shape, sized to fail on `main`                    | unchanged since gate 1, where it was **proven**; the round does not touch it                                                                                                                                                                                                                                                                                                                                                                                                                                         |

- **fixed** · F1 (med) · the tie-break in `pairAt` is now guarded. M2 (the deleted `dates.sort`) planted into this tree fails the committed direct spec at its default count: `Tests 1 failed`, 21 of 20,000 cases differ, the first case 1774 (`[18,20,22,21,19]` against `[18,20,22,19,21]`). M1, M3 and M4 fail it too (101, 274 and 1,275 differ). The source was restored after each and is byte-identical to the head's.
- **fixed** · F2 (low) · the three gaps are drawn, and each assertion fires when its draw is weakened. At 20,000 cases: 1,764 altered pastes in an `alt`, `altwide` or `long` history, 1,255 alternating histories over 40 rows, 3,178 alternating cases holding a stored row. With one draw weakened per run (no alteration in those shapes; the history capped at 40 rows; no stored row in alternating shapes), the spec failed three times of three, each on its own tally line (`expected 0 to be greater than 0`). Reach the F2 count leaves open is F3.
- **low** · F3 · no live call site; no `Done when` line depends on it · text and a count that say a little more than the code does, in the round's new file `api/test/lg-65-search-direct.test.ts` and its Log entry. (a) The header says "a fifth of the pastes have one row's amount changed by 100 cents or one row's date moved a day", and the Log says 22 %; the draw alters about 14.5 % (7.5 % amount, 7 % date), which is 1,764 of 11,970 alternating or long-day cases measured. (b) The header says the default run takes "about a second or two here"; the same file's `DEFAULT_CASES` comment says about 3 s, and I measured 2.7 to 3.3 s of test time. (c) `tally.altOrLongAltered`, which the "miss is drawn" assertion reads, counts pastes the draw altered, not pastes the search refused: 1,146 of the 1,764 got a refusal from `main`'s search (344 `alt`, 407 `altwide`, 395 `long`), and the other 618 still found a reading. The shapes F2 named are in fact reached, so every falsehood runs in the safe direction; but the assertion would stay green if the alteration stopped producing refusals. Direction, untested: say "about 15 %" and "about three seconds", and count `reading === null` among the altered pastes beside the altered count.
- **dropped** · "The committed generator is not gate 1's": a copy of `draw` cut from the committed spec and one from gate 1's `gate-fuzz.test.ts`, compared field by field (rows, start, pasted rows, tolerance, `same` at every offset, `holds20`, `holds21`, kind) over cases 1 to 150,000: 0 differ. Control: narrowing one draw in the copy (a 3-day re-date to 2) makes 3,406 of 20,000 differ. Faithful.
- **dropped** · "The spec can go red on a clean tree": no `Math.random`, `Date.now` or clock anywhere in the file; the generator is integer arithmetic (`Math.imul`, `>>> 0`) over a fixed seed, the dates are UTC from a fixed epoch, and every assertion in it reads a count from the seeded draws. Time: 2.7 to 3.3 s unloaded; 5.15 s beside the running ledger suite (3.9 times under the project's 20 s per test); 3.7 s on CI's ubuntu leg and 3.9 s on its Windows leg. Reliable.
- **dropped** · "A figure in the round's Log is wrong": every figure I could re-run matched (M1 to M4's counts and first cases, 1,764 / 1,255 / 3,178, the 20 and 21 row counts, 150,000 cases at 20 s with 112,219 read, 1,677 tests); the two I did not run are named in the full report. The only false sentence is the one F3 carries.
- **findings** · the hunt returned 4; 1 carried, 3 dropped.
- CI: `gh pr checks 606` at this head, all ten checks `pass` including both `test` legs, and the rollup's ten entries are `COMPLETED` / `SUCCESS`; the two `test` legs were still pending at my first read and passed at my last.
- Invariants: walked style (no `any`, no `console`, `import type`, `.ts` extensions, `node:` builtin, typed generator) and test registration (the spec sits under `api/test`, inside the tests glob; CI `check` is green on this head); skipped the rest, which a spec and a ticket file cannot touch.
- NFR: security n/a · performance ✓ (about 3 s of test time added to the ledger project) · reliability ✓ (deterministic, F3's dropped item) · maintainability — F3.

## Log

### 2026-10-21 — filed by lg-65's maintenance builder

- **Origin.** lg-58's gate 1 on PR #596 (branch `lg-58-report-day-off-dates`,
  head `add2fb9f`, draft, not merged) measured lg-59's block search on `main`
  against that branch, and reported it as an observation outside its own scope.
  The base for this filing is `origin/main` at `2d1b22bb`.
- **Transcription checked against the raw lines.** The figures were read from the
  gate's scratch directory, which will not survive: `time-tiny2-base.jsonl` (200-row
  alternating `"ms":30723`; 300-row alternating and constant `exit 124`),
  `time-tiny2-head.jsonl` (`"ms":25317`, `"ms":3042`, `"ms":42872`), and
  `time-tiny-base.jsonl` and `time-tiny-head.jsonl` (the 1,000-row alternating case,
  `exit 124` on both at 150 s). Each table cell matches its line.
- **Input shape checked against the source.** The shape in Reproduction is the one
  `gate-lg58-time.test.ts` and `time-tiny.sh` / `time-tiny2.sh` generate: row `i`
  dated `⌊i/r⌋ + (i mod 2)`, amounts by `amts`, the paste at `⌊w/2⌋ − 1` to
  `⌊w/2⌋ + 1` dated `⌊i/r⌋`. The one-transaction claim was checked in
  `tools/ledger/api/src/statements.ts` (the `.immediate()` transaction around the
  import).
- **Not re-run.** The timings are the gate's, single runs under load; this filing
  did not time anything.
- **`depends_on: []`.** The defect is on `main` and its reproduction needs only
  `main`. The branch figures are context, and PR #596 is not a prerequisite.
- **Difficulty `hard`**, rated for the recommended option C: a change to the matching
  search, whose outcomes an oracle checks. Option A alone would be `standard`.
- **Status `needs-decision`.** The bound and the means are the owner's choice, and
  the page says a question its own text leaves open is not for the next agent to
  settle.
- **Not measured:** real workbooks with this shape; the constant 1,000-row case;
  the other `mode` values; the scaling between sizes.

### 2026-10-24 — the reproduction run on `main` `8a6dcf9a` (Build step 1 only, no fix)

- **The owner's intake answer, 2026-10-24.** The question: "lg-65's timings come
  from a branch that has since merged, and C would have to write a new oracle. How
  should it go?" The options were "Reproduce first, then ask", "10 s / 30 s, C then
  A", "No bound: accept" and "Leave lg-65 out". The owner chose **"Reproduce first,
  then ask"**: a builder runs Build 1 on `main` and stops with the timings, and the
  owner then sets the bound and picks A or C with today's numbers. **Question 1
  (the bound) and Question 2 (A, B or C) are still open**, so `status` stays
  `needs-decision`; no source changed on this branch.
- **The reproduction was not in the repo; it was rebuilt from this page.**
  `git ls-files tools/ledger/api/test` has no `lg-65-reproduction` file, so the
  spec in Reproduction was copied verbatim from this page to
  `tools/ledger/api/test/lg-65-reproduction.test.ts` in a worktree at `8a6dcf9a`
  (farm, then `npm run build`, exit 0), run, and **not committed**. A wrapper ran each
  case in its own vitest process, one at a time, under `timeout -k 5 <cap>` with
  `--testTimeout=900000`, as the page says. Cases are the page's:
  `{"r":100,"w":300,…}` alternating and constant, `{"r":50,"w":200,…}` and
  `{"r":200,"w":1000,…}`, each with `"p":3,"mode":"inside","redate":"alt"`.
- **Machine.** 12 cores, shared. "Load" is `/proc/loadavg`'s one-minute figure read
  just before each run (the five- and fifteen-minute figures were lower, 1.0 to
  3.9). Runs were sequential, so none of them overlapped another of these.

  | shape                                      | rows  | run | cap  | time (ms)    | load before | outcome                             |
  | ------------------------------------------ | ----- | --- | ---- | ------------ | ----------- | ----------------------------------- |
  | 300-row, 100 a date, alternating amounts   | 300   | 1   | 180s | 30,508       | 1.68        | `STATEMENT_ROW_CONFLICT` (two ways) |
  | 300-row, 100 a date, alternating amounts   | 300   | 2   | 180s | 30,766       | 1.97        | `STATEMENT_ROW_CONFLICT` (two ways) |
  | 300-row, 100 a date, alternating amounts   | 300   | 3   | 180s | 33,729       | 6.13        | `STATEMENT_ROW_CONFLICT` (two ways) |
  | 300-row, 100 a date, constant amounts      | 300   | 1   | 180s | 51,311       | 1.70        | accepted, 0 added, 3 present        |
  | 300-row, 100 a date, constant amounts      | 300   | 2   | 180s | 61,189       | 2.32        | accepted, 0 added, 3 present        |
  | 300-row, 100 a date, constant amounts      | 300   | 3   | 180s | 71,423       | 4.23        | accepted, 0 added, 3 present        |
  | 200-row, 50 a date, alternating amounts    | 200   | 1   | 120s | 4,157        | 5.54        | `STATEMENT_ROW_CONFLICT` (two ways) |
  | 1,000-row, 200 a date, alternating amounts | 1,000 | 1   | 300s | not finished | 5.17        | `timeout` exit 124 at the cap       |

  The 1,000-row run left no line in `GATE_OUT`; the wrapper's own clock read 277 s
  between start and the 124 (the cap is 300 s; the 23 s gap is unexplained, and no
  vitest process survived it). So the finding is "over roughly 277 s to 300 s", not a
  number.

- **Does the 300-row case still run past 60 s on today's `main`? Not the
  alternating one; the constant one does, twice of three.** The alternating runs
  took 30.5, 30.8 and 33.7 s, under the 60 s cap that the filing used. The constant
  runs took 51.3, 61.2 and 71.4 s: two of three past 60 s, and the times rose with
  each run while the load before them rose too (1.70, 2.32, 4.23), so the spread is
  confounded with machine load and is not a trend in the code. The 1,000-row case is
  still unfinished past the cap. Build step 1's "confirm it runs past 60 s" is
  therefore met by the constant 300-row shape and not by the alternating one.
- **Against the filing's figures.** The 200-row alternating case is 4.2 s here
  against 30.7 s on `2d1b22bb` and 3.0 s on the gate's branch; the 300-row cases
  are 28 to 34 s and 51 to 71 s here against 25.3 s and 42.9 s on the branch. Today's
  `main` is the branch's tree (with the fixes made before merge), so these agree
  with the branch column to within the load. The "over 60 s" `main` column was the
  pre-lg-58 tree and is no longer what `main` does.
- **Stale statements corrected in this commit**, each quoted:
  - The Why paragraph said: "PR #596 (draft, **not merged**, head `add2fb9f`). The
    "branch" column is that unmerged branch, quoted as prose. It is not a
    dependency: the defect is on `main`, and the reproduction below needs only
    `main`. The branch is faster on every shape the gate could run on both trees,
    and it still takes 25 to 43 seconds on the 300-row cases and over 150 seconds on
    the 1,000-row one. A fix on that branch would not close the defect." PR #596
    merged at `aaccab20` on 2026-10-21 (`gh pr view 596`: `"state":"MERGED"`,
    `mergeCommit.oid` `aaccab20e1a46c3e17681c8a1ee7878d03ca9de3`, merged head
    `e1764829`, not `add2fb9f`), so the "branch" column is `main`'s code, minus any
    change between `add2fb9f` and `e1764829`, and the "`main` `2d1b22bb`" column is
    the tree before lg-58. The table header carries the same wording and is
    corrected the same way.
  - Option C said: "the differential oracle that lg-58 wrote. That oracle is in PR
    #596, not on `main`." Re-checked here: `git grep -il -e oracle -e differential`
    over `tools/ledger/api` and `tools/ledger/books/src` on `origin/main`
    (`8a6dcf9a`) matches nothing, and over `origin/lg-58-report-day-off-dates`
    (`tools/ledger/api`, `tools/ledger/books/src`) and
    `origin/lg-58-file-paste-reports-dates-a-day-off` (`tools/ledger`) it matches
    only unrelated files (settlement helpers in `books/test` and other tickets'
    prose, none about the paste search). The lg-58 ticket's Log names "the
    brute-force oracle" as a gate's run (seeds 1 to 20,000), so it was a scratch
    script that was never committed. C would write its own oracle. Option C now says so.
  - One more the measurement made false: the Why said a three-row paste into a
    300-row workbook "takes over a minute on `main`", and Question 1 said the
    300-row shapes run "25 to 43 s on the branch and over a minute on `main`". Both
    now say 28 to 71 s on `main` as it stands.
- **Build step 3, a smaller shape that is slow on `main`** (optional, a few
  minutes). Same case shape, one run each, load before in brackets:

  | shape                                    | rows | time (ms) | load | outcome                             |
  | ---------------------------------------- | ---- | --------- | ---- | ----------------------------------- |
  | 150-row, 50 a date, alternating amounts  | 150  | 1,977     | 3.08 | `STATEMENT_ROW_CONFLICT` (two ways) |
  | 200-row, 50 a date, constant amounts     | 200  | 5,545     | 3.02 | accepted, 0 added, 3 present        |
  | 250-row, 100 a date, alternating amounts | 250  | 16,516    | 3.60 | `STATEMENT_ROW_CONFLICT` (two ways) |
  | 250-row, 100 a date, constant amounts    | 250  | 27,669    | 2.94 | accepted, 0 added, 3 present        |

  The two 250-row shapes take 16.5 and 27.7 s; 200 rows take 4 to 6 s. Whether
  any is "slow enough to fail within the suite's budget" is not measured: the
  suite's per-test budget was not looked up, and one run per shape here is no
  estimate of its spread.

- **Not measured.** The constant 1,000-row case; the 1,000-row time (capped); the
  other `mode` values (`tail`, `miss`); the scaling exponent (four sizes at one run
  each is not a fit); a repeat of the 200-row and 250-row cases; real workbooks
  with this shape; whether the cap run's 277 s against a 300 s cap is a clock or a
  harness artefact.

### 2026-10-24 — the owner's answers to both questions (lg-65's builder)

- **Who and how.** The owner answered on 2026-10-24; the orchestrator relayed the
  answers, with the options they were chosen from, in this build's dispatch.
  `status` moves from `needs-decision` to `ready` in this commit, before any source
  changes.
- **Question 1, "How long may a paste hold the write lock?"** Options, each put with
  the measured times on `main` (300-row alternating ~30 s, 300-row constant 51 to
  71 s, 1,000-row alternating past ~277 s): "10 s / 30 s", "5 s / 15 s",
  "30 s / 90 s" and "No bound: accept". The orchestrator made no recommendation.
  **The owner chose "10 s / 30 s"**: the 300-row shapes under 10 s, the 1,000-row
  shape under 30 s.
- **Question 2, "How is the bound kept?"** Options: "C, then A" (the same answers
  found faster; C writes its own differential oracle against `main`; if C misses
  the bound, stop and bring the owner A's cap value to choose), "A only: cap and
  refuse" and "C only, no fallback". **The owner chose "C, then A"**, the filer's and
  the orchestrator's recommendation. Concretely: build C; if C cannot meet
  10 s / 30 s, do not build A, but stop and report the measured speed-up, the cap
  value that would meet the bound and which pastes it would refuse, as options.
- **How each line is graded**, as the dispatch scoped it:
  - The bound is read on the three Build-1 shapes, 300-row alternating, 300-row
    constant and 1,000-row alternating, all `"p":3,"mode":"inside","redate":"alt"`:
    the median of 3 isolated runs for each 300-row shape and 1 run of the 1,000-row
    shape, with `/proc/loadavg` beside each. A time taken at a load over 6 is re-run.
  - "Outcomes unchanged" is read on (a) every paste the `lg-59` and `lg-61` suites
    cover; (b) a seeded differential of the new search against `main`'s over seeds
    1 to 20,000, the population lg-58's gate used, run once and recorded here with a
    positive control (a planted one-cut divergence the oracle must catch); and
    (c) a committed spec that runs a subset of those seeds, sized to the ledger
    suite's budget.
  - Build step 3's smaller shape is chosen after looking up the suite's budget.
  - Stop conditions: C missing the bound (above), and any outcome difference the
    oracle finds that is not a bug in the new search, reported with its seed.

### 2026-10-24 — option C built: the same answers, found faster (lg-65's builder)

- **C met the bound, so A was not built.** The search code is at `5f0bc943`
  (`api/src/workbook-days.ts`); `statements.ts` is unchanged. The base is `main`
  `8a6dcf9a`.
- **What changed, and why each step keeps the answer.** `matchStretch` still runs
  the same search over the same cuts, in the same order, with the same
  tie-break; it skips only blocks whose answer is known without weighing them, as
  its doc now lists: blocks wholly before the stretch pair nothing, so every cut up
  to the stretch's first row is reached with nothing dated otherwise, and those
  cuts are set rather than searched; a block holding the whole stretch and more
  than `LONGEST_SEARCHED_DAY` rows is refused by `matchPart`, and so is every longer
  block from the same cut, so the cut's search stops there; `matchPart`'s two
  balance checks are made before the block is built, since one depends only on
  where the block opens and the other only on where it closes. A block's date
  range and whether it holds a paste's row are kept as the block grows instead of
  being rebuilt with `slice` and `Math.min(...)` for every pair, and its pairing is
  read from per-amount, per-date position lists (`pairAt`, `pairAmounts` step for
  step) instead of being built from the block. `someAddUpTo` gives the same answer
  with less work: it searches the smaller of "the `count` taken" and "the rest
  left", carries a sum only while enough amounts remain to make the count, and
  extends its sets in place.
- **What the brief had wrong.** Option C said "the search tries each (from, to)
  pair once, so the obvious memo does not help". That is true, and no memo is used:
  the time went to pairs whose answer was known before weighing them, and to the
  per-pair `slice`. It also did not know that `someAddUpTo` (a part that starts and
  ends inside a day) is most of the time on small workbooks with mixed amounts: on
  population seed 531, a 57-row alternating workbook with mixed amounts, it took
  812 of 898 ms of the search before the rewrite (10,028 calls), and the search
  took 333 ms after it.

**Done when 1 and 2: the bound.** Each run is the reproduction spec on this page,
in its own vitest process, one at a time, through the Build 1 wrapper with the
tree as an argument (`time.sh` in the build scratch). The load is
`/proc/loadavg`'s one-minute figure before each run; none was over 6. `main`'s
times are the 2026-10-24 Build 1 entry above, at `8a6dcf9a`.

| shape (`"p":3,"mode":"inside","redate":"alt"`) | `main` `8a6dcf9a`           | fixed `5f0bc943`, runs (load)           | fixed median | bound | met |
| ---------------------------------------------- | --------------------------- | --------------------------------------- | ------------ | ----- | --- |
| 300-row, 100 a date, alternating amounts       | 30,508 · 30,766 · 33,729 ms | 722 (1.24) · 738 (1.14) · 730 (1.13) ms | 730 ms       | 10 s  | yes |
| 300-row, 100 a date, constant amounts          | 51,311 · 61,189 · 71,423 ms | 874 (1.24) · 857 (1.14) · 869 (1.13) ms | 869 ms       | 10 s  | yes |
| 1,000-row, 200 a date, alternating amounts     | not finished, cut at ~277 s | 4,354 ms (1.13), one run                | —            | 30 s  | yes |

Outcomes on the fixed build: `STATEMENT_ROW_CONFLICT` (two ways), accepted with 0
added and 3 present, and `STATEMENT_ROW_CONFLICT` (two ways), the first two equal
to `main`'s in Build 1. **`main`'s outcome on the 1,000-row shape is not known**:
it never finished. A first single run of each shape, before `someAddUpTo` was
rewritten, read 962 ms, 1,135 ms and 4,983 ms at load 0.6 to 1.0.

Three more shapes, one run each on the fixed build, not graded: 1,000-row constant
amounts 4,320 ms; the spec's mixed amounts (`"amts":"five"`) at 300 rows 1,289 ms
and at 1,000 rows 5,772 ms; all accepted, 0 added, 3 present. Where the 1,000-row
time goes now: a CPU profile of a 1,000-row constant paste (4,551 ms in all) puts
2,509 ms in `nearby` in `statements.ts` (the SQL walk out from each candidate's
edge, 1,284,798 rows read over 2,002 calls) and 1,634 ms in `matchStretch`. That is
inside the bound, and this branch does not touch it.

**Done when 3: outcomes unchanged.**

- **(b) The seeded differential, seeds 1 to 20,000, run once.** The population is
  `api/test/helpers/paste-population.ts`, rebuilt from lg-58's Log ("the tail of a
  synthetic bank stretch, with or without a new row, against a workbook of the same
  3 to 6 movements with rows re-dated and swapped"; that generator was never
  committed) and widened with a second paste across rows a first paste stored,
  pastes that cannot fit, lg-65's alternating shape at 12 to 40 rows, and one day
  of 16 to 24 rows. Draws over the 20,000 seeds: 6,783 stretch tails, 5,081 slices
  inside, 2,560 two-paste cases, 2,600 that cannot fit, 1,947 alternating and 1,029
  long days. The 22,560 pastes came to 16,590 accepted (5,503 of them naming dates
  that differ), 4,368 `STATEMENT_CHAIN_BROKEN`, 1,451 `STATEMENT_ROW_CONFLICT` and
  151 `STATEMENT_BEFORE_HISTORY`. Two readings of it:
  - **Against `main`'s code, in a second tree.** A worktree at `8a6dcf9a` (farmed
    and built) and this branch at `5f0bc943` each ran every seed through
    `importStatement` and wrote one line per seed (every paste's report or error
    code, message and details, and every stored row after). The two files are
    byte-identical: 20,000 lines each, sha256 `2fd32c3e…0b1f5633` both (96 s on
    `main`, 82 s on the branch).
  - **Call by call, in process.** `api/test/lg-65-search.test.ts` with
    `LG65_SEEDS=1-20000` answers every `matchStretch` call by both this search and
    `api/test/helpers/reference-search.ts`, `main`'s search at `8a6dcf9a` kept
    verbatim, and runs every seed once on each: 0 of 387,077 calls differ (78,730
    of them found a reading), 0 of 20,000 outcomes differ; exit 0 in 236 s.
  - **Positive control: two planted divergences, each caught.** Each was edited
    into `5f0bc943`'s `matchStretch`, run, and restored with
    `git checkout 5f0bc943 -- tools/ledger/api/src/workbook-days.ts`.
    (1) The `dayEnds` cut never made (`(false && dayEnds(...))`): the committed spec
    fails (2 call mismatches in seeds 1 to 200), the compare run below fails 3 of
    126 tests, and the two-tree dump differs from `main`'s on 4 of 20,000 seeds
    (6387, 6716, 9902, 19989). (2) Blocks from before the stretch skip the first
    cut past its start (`let to = from + 1 < past ? past + 1 : from + 1;`): the
    committed spec fails (43 call mismatches, 6 outcome mismatches in seeds 1 to
    200), the compare run fails 4 of 126, and 1,004 of 20,000 seeds differ.
- **(a) Every paste the lg-59 and lg-61 suites cover.** Those suites are in
  `api/test/workbook-days.test.ts`; `statements.test.ts` holds the other paste
  cases. Both ran under a scratch config that adds a setup file wrapping
  `matchStretch` the same way, throwing on any call where the two searches
  differ, with `workbook-import.test.ts` beside them: 158 of 158 pass, 0
  mismatches over 118 calls (`workbook-days.test.ts`, 40 finding a reading) and
  725 calls (`statements.test.ts`, 120); `workbook-import.test.ts` makes none.
  Plainly, with no wrapper: `npx vitest run` on the first two files, 126 of 126.
- **(c) The committed spec** is `api/test/lg-65-search.test.ts`, "the search pairs
  and decides every seeded paste as main's search did (lg-65)": seeds 1 to 200,
  2.7 s of test time here, against the ledger project's 20 s a test
  (`vitest.config.ts`). Before the 20,000-seed run, the population's alternating
  shape was cut from 20 to 60 rows to 12 to 40, and each seed now copies a
  migrated database instead of migrating one: 600 seeds of this spec had taken
  28 s.

**Done when 4 and Build 3: the pinned shape.** The ledger project allows 20 s a
test. Times measured on the reproduction spec, 3 runs each, load 1.0 to 1.5:
200-row constant 5,066 · 4,794 · 4,896 ms on `main`, 503 · 481 · 497 ms fixed;
200-row alternating 3,095 · 3,200 · 3,148 on `main`, 378 · 348 · 354 fixed;
250-row alternating 14,799 · 15,650 · 17,501 on `main`, 562 · 556 · 547 fixed.
The 250-row alternating shape leaves the widest margin on both sides of a ceiling,
so `api/test/lg-65-alternating-dates.test.ts`, "a three-row paste into 250 rows
whose dates alternate by a day is read in under 5 s (lg-65)", pins it: the three
readings `main` gives (3, 2 and 0 rows already stored) and under 5,000 ms. Run 3
times on each tree, alternately: on the `main` tree it fails 3 of 3 on the time
line alone ("expected 15087 / 15388 / 15790 to be less than 5000", the readings
matching), and on the branch it passes 3 of 3 (588, 560, 578 ms). A 5 s ceiling is
3.0 times under `main`'s fastest run and 8.5 times over the branch's slowest.

**Folded in.** The title said the search "takes over a minute"; Build 1 measured
the 300-row alternating shape at about 30 s, so it now reads "holds the write lock
for 30 s to minutes". The file name keeps its old slug, since `status` reads only
the id from it and the PR and dispatch name the path.

**Not measured.** `main`'s outcome and time on the 1,000-row shape (it never
finished); real workbooks with this shape; the `tail` and `miss` modes; histories
holding rows from more than two pastes. **An unexplained clock gap**, as in Build 1
(277 s against a 300 s cap): the wrapper's `date +%s` reads less than the spec's
`performance.now()` (13 s of wall against 14,799 ms on `main`'s first 250-row run),
and vitest reported 236 s for the 20,000-seed spec where the wrapper read 216 s.
The medians above are `performance.now()`'s.

### 2026-10-24 — gate 1's F1 and F2 applied: a direct differential, committed (lg-65's fixer, round 1)

- **The owner's answer, 2026-10-24.** The question: "lg-65 F1: the committed check
  barely reaches the pairAt tie-break (a planted fault passes the 200 seeds the spec
  runs). The code itself shows 0 differences over 400,000 cases. What should
  happen?" The options: "A: commit the direct check" (the gate's recommendation, a
  typed no-database differential of `matchStretch` against the reference copy, which
  also covers F2; one round, then a narrow gate 2), "B: widen the seeded population",
  and "Record it, land now". The owner chose **A**.
- **Committed.** `api/test/lg-65-search-direct.test.ts`, "matchStretch answers every
  drawn case as main's search did (lg-65)", at `5f9514c8` (the spec) and `5daf0f83`
  (`Array#toSorted` for two lint errors, `unicorn(no-array-sort)`, found by `npm run
  check`; the draws are unchanged). It is gate 1's `gate-fuzz.test.ts` made typed:
  the same generator, so its draws are the ones gate 1 measured. It calls
  `matchStretch` and `helpers/reference-search.ts` (`main`'s search, verbatim) on the
  same rows, start, paste and tolerance, with no database, and compares the JSON.
  `paste-population.ts` and `lg-65-search.test.ts` are untouched. Its case count is
  20,000 (`DEFAULT_CASES`): 2.8 s of test time here against the ledger project's 20 s
  a test (`vitest.config.ts`), which leaves about seven times for a loaded runner.
  `LG65_DIRECT_CASES=first-last` and `LG65_DIRECT_SUMMARY=<file>` size and report a
  larger run; a run of more than about 100,000 cases must also pass `--testTimeout`,
  since 150,000 cases take 20 s and the project's limit is 20 s.
- **F2's three gaps, and how each is drawn** (also in the spec's header). The spec
  counts each and fails if one is not drawn:
  - _A paste that cannot fit (`miss`) in an alternating or long-day history._ In
    every date shape, about 15 % of pastes get one row's amount changed by 100 cents or one
    row dated a day off (the draw's `mode`; half of the amount draws add 0 and are
    not counted). Drawn at 20,000 cases: 1,764 of them in an `alt`, `altwide` or `long`
    history.
  - _An alternating history over 40 rows._ `n` runs 8 to 46 for every shape but
    `long`. 1,255 `alt`/`altwide` cases at 20,000 hold more than 40 rows.
  - _Rows a paste stored inside an alternating run._ A share of the copy's rows
    (none half the time, then 10 % or 30 %) is replaced by the bank's own row with
    `fromWorkbook: false`, in every shape. 3,178 `alt`/`altwide` cases at 20,000 hand
    the search one.
- **Not vacuous, asserted.** At least one case found a reading and at least one did
  not, in each of the five shapes (`alt` 3,177 of 3,971 at 20,000, and so on); a block
  of exactly 20 rows and of exactly 21 rows holding the stretch, some of each read
  (2,792 and 2,449 cases at 20,000; 2,086 and 1,840 found).
- **Positive controls.** Gate 1's `mutate.mjs` (M1 to M4), one at a time into this
  tree's `api/src/workbook-days.ts`, the spec run at its committed count with
  `npx vitest run tools/ledger/api/test/lg-65-search-direct.test.ts`, the file
  restored with `git checkout 5daf0f83 -- tools/ledger/api/src/workbook-days.ts`
  (`git diff 5daf0f83 --stat` empty after each, `git status --short` empty at the
  end). All four fail on the committed spec as it stands at `5daf0f83`; the
  `5f9514c8` version failed all four with the same cases.

  | id  | planted line                                                                    | result at 20,000 cases      | cases that differ | first                                                            |
  | --- | ------------------------------------------------------------------------------- | --------------------------- | ----------------- | ---------------------------------------------------------------- |
  | M1  | `closes - opens > LONGEST_SEARCHED_DAY` becomes `>=`                            | fails, `Tests 1 failed`     | 101 of 20,000     | case 280 (alt): `[12,3,14,5]` against `[12,1,14,3]`              |
  | M2  | `dates.sort((one, other) => one.first - other.first);` deleted from `pairAt`    | **fails**, `Tests 1 failed` | 21 of 20,000      | case 1774 (const): `[18,20,22,21,19]` against `[18,20,22,19,21]` |
  | M3  | the closing-balance test for a block opening before the stretch made `false &&` | fails, `Tests 1 failed`     | 274 of 20,000     | case 65 (alt): `[0,15,2,17,5,21,6]` against `null`               |
  | M4  | a stored row's `from + 1 < past` becomes `from + 1 <= past`                     | fails, `Tests 1 failed`     | 1,275 of 20,000   | case 19 (altwide): `null` against `[0,1,2,4,7,5,8]`              |

  M2, the one gate 1 showed the seeded spec missing, is caught at case 1774, within
  the first tenth of the committed count. It is the same 21 as gate 1's script
  measured over 20,000, as it should be: the generator is the same.

- **The head shows no difference.** At the committed count, `Tests 1 passed`, 0 of
  20,000 cases differ (`foundTotal` 14,879 read a reading). At 150,000 cases
  (`LG65_DIRECT_CASES=1-150000 npx vitest run --testTimeout=900000 …`): `Tests 1
  passed`, 20.1 s, 0 of 150,000 differ, 112,219 found a reading (gate 1's script
  saw 0 of 400,000 with the same generator).
- **Checks.** `npm run check` exit 0 (after the `toSorted` commit; its first run
  failed on those two lint errors). `npx vitest run` on this spec and on
  `lg-65-search.test.ts` together: 2 of 2 passed, 3.7 s. `npm test -- --project
  ledger`: exit 0, `Test Files 81 passed (81)`, `Tests 1677 passed (1677)` (gate 1's run of the head read 80 and 1,676).
- **Done when 3 now names two tests:** `lg-65-search.test.ts` (outcomes and every
  call over the seeded population) and `lg-65-search-direct.test.ts` (every call over
  drawn inputs, which reaches the `pairAt` tie-break and the four shortcut edges).
- **What gate 1 had wrong.** Nothing in its figures: the 21 cases of M2 in 20,000 and
  the 20-second cost of 150,000 both reproduce. Two corrections to how it described the
  population: "22 % altered" in its script includes draws that add 0 cents to an
  amount (and so do not alter the paste), which this spec's tally excludes; and its
  script, as written, could not be committed, not only for its `as never` casts
  but because the repo's lint rejects `Array#sort` (two errors, fixed above).
- 2026-10-24 — Fixed at landing by owner choice: gate 2, F3 — "text and a count that
  say a little more than the code does, in the round's new file
  `api/test/lg-65-search-direct.test.ts` and its Log entry. (a) The header says "a
  fifth of the pastes have one row's amount changed by 100 cents or one row's date
  moved a day", and the Log says 22 %; the draw alters about 14.5 % (7.5 % amount, 7 %
  date) … (b) The header says the default run takes "about a second or two here"; the
  same file's `DEFAULT_CASES` comment says about 3 s … (c) `tally.altOrLongAltered`,
  which the "miss is drawn" assertion reads, counts pastes the draw altered, not
  pastes the search refused: 1,146 of the 1,764 got a refusal from `main`'s search …
  Direction, untested: say "about 15 %" and "about three seconds", and count
  `reading === null` among the altered pastes beside the altered count." Applied as
  stated: (a) the header and this Log's F2 entry now say "about 15 %"; (b) the header
  says "about three seconds"; (c) the tally gains `altOrLongRefused`, counted in the
  same place as `altOrLongAltered` when `main`'s search gave no reading, and the test
  asserts it is greater than 0 beside the altered count.
  - `LG65_DIRECT_SUMMARY=<file> npx vitest run tools/ledger/api/test/lg-65-search-direct.test.ts`
    → `Tests 1 passed (1)`, 2.79 s of test time; the summary reads `"cases": "1-20000"`,
    `"mismatches": 0`, `"altOrLongAltered": 1764`, `"altOrLongRefused": 1146`.
  - **Control, on a committed tree (`0fdf2b06`), restored from that sha afterwards.**
    The alteration was weakened until it no longer refuses: the amount change and the
    date shift multiplied by 0 (the `r()` calls kept, so the draws are the same
    stream), `altered` kept true. That alone left `altOrLongRefused` at 436 of 2,678:
    the copy's neighbour swaps and re-dating refuse some pastes without any
    alteration. Swaps (`swapRate`) and the copy's re-dating off, the `long` day cut to
    2 rows, and the stored rows (`storedRate`) off, took it to 0 refusals (a debug
    line printed one per refused paste; 0 printed). With the two neighbouring
    assertions that also depend on refusals (`foundTotal < total`, each shape's
    `found < calls`) turned into no-ops so the new one is the first left, the run
    exits 1: `AssertionError: expected 0 to be greater than 0`, at the line of
    `expect(tally.altOrLongRefused).toBeGreaterThan(0)`, and the line before it,
    `expect(tally.altOrLongAltered).toBeGreaterThan(0)`, passed (the altered count,
    2,729 in the run before the stored rows were turned off). Before the neighbours were turned off, the same weakened run
    failed one assertion earlier, `expected 4041 to be less than 4041`, so the new
    assertion is not what stops a drifting alteration there; it is what stops one
    whose other checks stay green.
