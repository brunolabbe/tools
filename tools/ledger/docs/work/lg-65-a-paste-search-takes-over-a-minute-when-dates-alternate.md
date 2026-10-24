---
id: lg-65
tool: ledger
title: A paste search takes over a minute when a workbook's dates alternate by a day
kind: fix
status: needs-decision
milestone: null
depends_on: []
difficulty: hard
---

# lg-65 — A paste search takes over a minute when a workbook's dates alternate by a day

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

## Decision — open

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

## Build

Not dispatchable until the Decision is answered. Once it is, the work is:

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
