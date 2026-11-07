---
id: lg-103
tool: ledger
title: A finished Save closes whichever row's control is open, another row's included
kind: fix
status: needs-decision
milestone: null
depends_on: []
difficulty: standard
---

# lg-103 — A finished Save closes whichever row's control is open, another row's included

## Why

On the History screen (`web/src/history/History.tsx`), a row's "Change who and
what" control can be open on one row while another row's Save is still in flight.
When that Save is stored, `refile` calls `setChanging(null)` (line 289 on `main` at
`1eafa0c6`). That clears the one open-control id whatever row it names, so the
control the person opened on the other row closes when the Save completes, and
they must open it again.

The answer itself is not affected: `refile` sends it for the row whose Save it
was, and the other row's answer is not sent. What goes wrong is the open control on
a row the person has not finished with. Found by lg-99's gate 1 (Opus 5.5, on
2026-11-07, at lg-99's `191f8927`) while reviewing lg-99's focus change. It is out of
that branch's range: the base is identical. The owner chose to file it.

## Reproduction

Reproduced on `origin/main` at `1eafa0c6` (the tip when this was filed). The
reproduction is a test that asserts the reading the ticket expects: the other row's
control stays open. On `main` it fails, which is the reproduction. It is not in the
repo; to run it, copy the file below to `tools/ledger/web/test/`, run it, and delete
the copy.

```tsx
// @vitest-environment jsdom
// lg-103 reproduction: a finished Save closes another row's open control.
// Copied into tools/ledger/web/test/ for one run, then removed. Logs the readings
// to PROBE_OUT and asserts the expected reading, so the run shows both.

import { appendFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AppError } from "@ledger/contract";
import type { StoredRow } from "@ledger/contract";
import { classifyRow } from "../src/api/inbox.ts";
import { fetchPeriods } from "../src/api/periods.ts";
import { fetchRows } from "../src/api/rows.ts";
import { fetchPeople } from "../src/api/rules.ts";
import { fetchSpendingCategories } from "../src/api/spending.ts";
import { History } from "../src/history/History.tsx";

vi.mock("../src/api/rows.ts", () => ({ fetchRows: vi.fn() }));
vi.mock("../src/api/inbox.ts", () => ({ classifyRow: vi.fn() }));
vi.mock("../src/api/periods.ts", () => ({ fetchPeriods: vi.fn() }));
vi.mock("../src/api/rules.ts", () => ({ fetchPeople: vi.fn() }));
vi.mock("../src/api/spending.ts", () => ({ fetchSpendingCategories: vi.fn() }));

const OUT = process.env.PROBE_OUT ?? "/dev/null";
function log(name: string, value: unknown): void {
  appendFileSync(OUT, `${name} ${JSON.stringify(value)}\n`);
}

const SAVED = {
  id: 9,
  rowId: 1,
  bucket: "current-expenses",
  personId: "sam",
  ruleId: null,
  source: "manual",
  classifiedAt: "2026-11-01T00:00:00.000Z",
  classifiedBy: "alex",
} as const;

function filed(id: number, description: string, personId = "alex"): StoredRow {
  return {
    id,
    date: "2026-10-10",
    category: "Épicerie",
    description,
    amountCents: -100,
    balanceCents: 100000,
    classification: { bucket: "current-expenses", personId, source: "manual" },
    spendingCategory: { id: 1, source: "map" },
  } satisfies StoredRow;
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((a) => {
    resolve = a;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(fetchPeople).mockImplementation(async (_s, who) =>
    who === "in" ? ["alex", "sam"] : ["alex", "pat", "sam"],
  );
  vi.mocked(fetchSpendingCategories).mockResolvedValue([]);
  vi.mocked(fetchPeriods).mockResolvedValue([]);
});
afterEach(() => cleanup());

const wait = (ms: number): Promise<void> =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });

const who = (el: Element | null): string =>
  el === document.body
    ? "BODY"
    : el instanceof HTMLElement
      ? `${el.tagName}:${el.getAttribute("aria-label") ?? el.textContent ?? ""}`
      : String(el);

function buttons(): HTMLElement[] {
  return within(screen.getByRole("list", { name: "Bank rows" })).getAllByRole("button", {
    name: /^Change who and what/u,
  });
}

async function two(): Promise<void> {
  vi.mocked(fetchRows).mockResolvedValue({ rows: [filed(1, "A"), filed(2, "B")], total: 2 });
  render(<History />);
  await screen.findByRole("list", { name: "Bank rows" });
}

for (const arm of ["nofocus", "focus"] as const) {
  test(`another row opens while A's Save is pending, ${arm}`, async () => {
    const save = deferred<typeof SAVED>();
    vi.mocked(classifyRow).mockReturnValue(save.promise);
    await two();
    const [a, b] = buttons();
    if (arm === "focus") a!.focus();
    fireEvent.click(a!);
    if (arm === "focus") screen.getByRole("button", { name: "Save" }).focus();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await wait(10);
    if (arm === "focus") b!.focus();
    fireEvent.click(b!);
    await wait(10);
    log(
      `pending-other-${arm} expanded`,
      buttons().map((x) => x.getAttribute("aria-expanded")),
    );
    save.resolve(SAVED);
    await waitFor(() => {
      if (screen.queryByRole("button", { name: "Save" }) !== null) throw new Error("open");
    });
    await wait(30);
    const readings = buttons().map((x) => x.getAttribute("aria-expanded"));
    log(`pending-other-${arm} after-save expanded`, readings);
    log(`pending-other-${arm} after-save active`, who(document.activeElement));
    // B opened after A's Save began; A's Save finishing must not close B's control.
    expect(readings).toEqual(["false", "true"]);
  });
}
```

Steps:

1. `cp` the file above to `tools/ledger/web/test/zz-lg103-repro.test.tsx`, from the
   worktree root.
2. `npm run build`, then `npx vitest run tools/ledger/web/test/zz-lg103-repro.test.tsx`.
3. `rm tools/ledger/web/test/zz-lg103-repro.test.tsx`. A copy left in `test/` fails
   the next `npm run check` on `oxfmt --check`.

Output on `main` at `1eafa0c6` (`exit 1`; `PROBE_OUT` pointed at a scratch file):

```
 × |ledger| tools/ledger/web/test/zz-lg103-repro.test.tsx > another row opens while A's Save is pending, nofocus
   → expected [ 'false', 'false' ] to deeply equal [ 'false', 'true' ]
 × |ledger| tools/ledger/web/test/zz-lg103-repro.test.tsx > another row opens while A's Save is pending, focus
   → expected [ 'false', 'false' ] to deeply equal [ 'false', 'true' ]
 Test Files  1 failed (1)
      Tests  2 failed (2)

pending-other-nofocus expanded ["false","true"]
pending-other-nofocus after-save expanded ["false","false"]
pending-other-nofocus after-save active "BUTTON:Change who and what: A, 2026-10-10"
pending-other-focus expanded ["false","true"]
pending-other-focus after-save expanded ["false","false"]
pending-other-focus after-save active "BUTTON:Change who and what: B, 2026-10-10"
```

The first line of each pair is A and B's `aria-expanded` while A's Save is pending;
the second is the same after the Save is stored. The `active` lines are where focus is
after the Save: A's button in the no-focus arm, B's in the focus arm.

## Decision — open

**Who decides:** the owner. Two questions. The second arises only if the first is
answered A. The options are listed without a recommendation.

**1. What happens to another row's open control when a Save completes?**

1. **A. The completed Save closes only its own row's control.** `refile` clears the
   open control only when it is the saved row's; today `setChanging(null)` clears
   whatever is open. Costs: one change in `History.tsx`; lg-99's `closedByOwn` ref and
   focus effect then need the case of a close by Save while another row's control is
   open, which is question 2. The stored answer is the same.
2. **B. Hold every row's Change control while a Save is in flight.** No other control
   can open until the Save answers, so the completion cannot reach one. Costs: a slow
   Save holds every other row's control for its round trip, and lg-99's `disabled` on
   the unread row becomes one on the whole list while a Save is saving. No focus
   question arises.
3. **C. Leave it, and record it.** Costs nothing now. The window is a Save's round
   trip: a control opened inside it closes when the Save answers, and the person opens
   it again. Recorded in the Log; no test is added.

**2. Only if question 1 is A: where focus goes when a completed Save closes its own
control while another row's control stays open.** On `main` the two arms differ (see
Reproduction): focus goes to A's button in the no-focus arm and stays on B's button in
the focus arm.

1. **a. Focus goes to the saved row's own button, in both arms.** Costs: in the focus
   arm, a person who had focus on B's control is moved out of it to A's button, which
   changes `main`'s reading.
2. **b. Focus stays in B's control if it is there; otherwise it goes to A's button, as
   now.** Costs: a new condition in the focus-restore effect of `Refile`, which lg-99's
   PR #751 also changes, so the two must agree.

## Build

Pending the decision above; no remedy is chosen here. Once question 1 is answered (and
question 2, if it applies):

1. `web/src/history/History.tsx`, `refile`: the close follows the answer. Under A,
   `setChanging` clears only the saved row's id. Under B, `Refile`'s change control is
   disabled on every row while `saving`. Under C, nothing changes.
2. Under A, `Refile`'s focus effect (`closedByOwn`, `wasOpen`) follows question 2.
3. `web/test/history.test.tsx`: the reproduction's two arms, as tests in that file.
   Under C, no test is added.

## Done when

Written before the decision; reworded with the owner's answer.

1. A test in `tools/ledger/web/test/history.test.tsx` runs the reproduction's two arms
   and proves that when A's Save completes, B's open control stays open
   (`aria-expanded` `["false","true"]`). It fails on `main` at `1eafa0c6`.
2. Under question 2, the focus outcome the owner chose is asserted in the same two arms.
3. Under question 1 C, no test is added, and the Log records the choice.
4. `npm run check` and `npm test -- --project ledger` pass.

## Log

### 2026-11-07, filing

Filed from lg-99's gate 1 (Opus 5.5, at lg-99's `191f8927`). The gate's words: "dropped
· a finished Save closes whichever control is open, another row's included
(`setChanging(null)`); base identical, out of the reviewed range — worth a ticket."
Its open decision 3 recommended filing it, with the reproduction it had: `pending-other-*
after-save expanded ["false","false"]` on base and head. The owner chose to file it.

- **Reproduced on `main`** at `1eafa0c6`, with the test in the Reproduction above. The
  output is there. `git status --short` was empty after the copy was removed.
- **lg-99's branch.** lg-99 (PR #751, branch `lg-99-reread-and-focus`, head
  `42446ded`) changes `History.tsx`'s focus handling, and it leaves this behaviour as it
  is: `gh pr diff 751` has no changed line that names `setChanging`, only context lines
  at its `Refile` focus effect. lg-99's Log on #751 records this defect as "the owner
  chose to file it as a ticket, filed separately by the orchestrator. Not fixed or filed
  here." This ticket is that filing.
- **Overlap.** #751 edits `web/src/history/History.tsx` and `web/test/history.test.tsx`,
  where the Build's lines land. Neither depends on the other, since the defect is on
  `main`; the merge order only matters for the text.
- **Not measured:** that the stored answer goes to A's row (the probe mocks
  `classifyRow` and asserts only the controls), and whether a closed control keeps
  what the person chose in it.
- **Readings.** The probe's readings match the gate's on base (its probe-base output,
  `pending-other-nofocus` and `pending-other-focus`, `after-save expanded`
  `["false","false"]`).
