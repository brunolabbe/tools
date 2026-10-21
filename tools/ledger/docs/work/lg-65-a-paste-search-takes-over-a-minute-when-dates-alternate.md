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
paste into a 300-row workbook then takes over a minute on `main`, inside the
write transaction of the import (`importStatement` in
`tools/ledger/api/src/statements.ts` runs in one `IMMEDIATE` transaction, so the
database's write lock is held for the whole search). Nothing bounds how long the
search may run.

The figures below come from [lg-58](./lg-58-file-paste-reports-dates-a-day-off.md)'s
gate 1 on its own branch, `lg-58-report-day-off-dates`, PR #596 (draft, **not
merged**, head `add2fb9f`). The "branch" column is that unmerged branch, quoted as
prose. It is not a dependency: the defect is on `main`, and the reproduction below
needs only `main`. The branch is faster on every shape the gate could run on both
trees, and it still takes 25 to 43 seconds on the 300-row cases and over 150
seconds on the 1,000-row one. A fix on that branch would not close the defect.

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

| case (3 pasted rows inside)                 | `main` `2d1b22bb`   | branch `add2fb9f` (PR #596, unmerged) | outcome                                           |
| ------------------------------------------- | ------------------- | ------------------------------------- | ------------------------------------------------- |
| 200-row workbook, 50 a date, alternating    | 30,723 ms           | 3,042 ms                              | `STATEMENT_ROW_CONFLICT` (two ways), both trees   |
| 300-row workbook, 100 a date, alternating   | over 60 s, stopped  | 25,317 ms                             | `STATEMENT_ROW_CONFLICT` (two ways) on the branch |
| 300-row workbook, 100 a date, constant      | over 60 s, stopped  | 42,872 ms                             | accepted, 0 added, 3 present, on the branch       |
| 1,000-row workbook, 200 a date, alternating | over 150 s, stopped | over 150 s, stopped                   | not finished on either                            |

Not measured: whether any real household workbook has dates that change at
almost every row (the gate's dates come from the formula above); the other
`mode` values (`tail`, `miss`); the constant 1,000-row shape; the scaling between
the sizes; and whether the branch's outcomes are right in the constant case.

## Decision — open

The defect is slow search, and the owner has to choose the bound before anyone
can build a fix that is checked against it. Two questions, the second depending on
the first.

**Question 1. How long may a paste hold the write lock?** The reproduction's
300-row shapes run 25 to 43 s on the branch and over a minute on `main`. The
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
  and the differential oracle that lg-58 wrote. That oracle is in PR #596, not on
  `main`.

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
