---
id: lg-103
tool: ledger
title: A finished Save closes whichever row's control is open, another row's included
kind: fix
status: ready
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
control stays open. It waits for the Save's own notice (`<output>`, role `status`)
to show that the Save is stored. It cannot wait for "no button named Save": B's open
control renders one, so that wait never ends while B stays open. The test is not in
the repo; to run it, copy the file below to `tools/ledger/web/test/`, run it, and
delete the copy.

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
      // The Save's own notice: B's open control also renders a Save button.
      if (screen.queryByRole("status") === null) throw new Error("open");
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
2. `npm run build`, then `PROBE_OUT=<a scratch file> npx vitest run
   tools/ledger/web/test/zz-lg103-repro.test.tsx --reporter=verbose`.
3. Planted fix, to see the test pass: in `tools/ledger/web/src/history/History.tsx`,
   replace line 289 `setChanging(null);` with
   `setChanging((open) => (open === row.id ? null : open));`, run step 2 again, then
   restore the file (`git checkout <sha> -- <path>`; the file is not otherwise edited).
4. `rm tools/ledger/web/test/zz-lg103-repro.test.tsx`. A copy left in `test/` fails
   the next `npm run check` on `oxfmt --check`.

Output on `main` at `1eafa0c6` (`exit 1`, the red reading):

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

Output with the planted fix at step 3 (`exit 0`, the green reading):

```
 ✓ |ledger| tools/ledger/web/test/zz-lg103-repro.test.tsx > another row opens while A's Save is pending, nofocus 298ms
 ✓ |ledger| tools/ledger/web/test/zz-lg103-repro.test.tsx > another row opens while A's Save is pending, focus 139ms
 Test Files  1 passed (1)
      Tests  2 passed (2)

pending-other-nofocus expanded ["false","true"]
pending-other-nofocus after-save expanded ["false","true"]
pending-other-nofocus after-save active "BUTTON:Change who and what: A, 2026-10-10"
pending-other-focus expanded ["false","true"]
pending-other-focus after-save expanded ["false","true"]
pending-other-focus after-save active "BUTTON:Change who and what: B, 2026-10-10"
```

The first line of each pair is A and B's `aria-expanded` while A's Save is pending;
the second is the same after the Save is stored. The `active` lines are where focus is
after the Save. They are the same with the planted fix as on `main`: A's button in the
no-focus arm, B's in the focus arm.

## Decision — answered 2026-11-07 by the owner

**Chosen: A, the completed Save closes only its own row's control.** Asked through
AskUserQuestion, with the three options below and a fourth, "not now"; the ticket
carried no recommendation. Not chosen: B, hold every row's Change control while a
Save is in flight; C, leave it and record it; and "not now". The Build and `Done when`
below are written for A.

The question as it was asked, and its options as written then:

**Who decides:** the owner. One question is open. The options are listed without a
recommendation.

**1. What happens to another row's open control when a Save completes?**

1. **A. The completed Save closes only its own row's control.** `refile` clears the
   open control only when it is the saved row's; today `setChanging(null)` clears
   whatever is open. Costs: one line in `History.tsx`, the planted change in the
   Reproduction (green there). Focus has no consequence: the `active` lines are the
   same as on `main` in both arms (the green output above), and gate 1 on `5629dcab`
   read the same on `main` and on #751's `History.tsx`. The stored answer is the same.
2. **B. Hold every row's Change control while a Save is in flight.** No other control
   can open until the Save answers, so the completion cannot reach one. Costs: a slow
   Save holds every other row's control for its round trip, and lg-99's `disabled` on
   the unread row becomes one on the whole list while a Save is saving. Focus under B
   is **not measured**. Gate 1 on `5629dcab` reasoned that it is a cost: `refile` calls
   `setChanging(null)` before the re-read and `setSaving(false)` after it, so a Change
   button disabled by `saving` is disabled while the control closes. #751's own comment
   says a button must be enabled while its control closes, or the focus handed back to
   it goes nowhere. A one-row run of B did not show that, because its mocked re-read
   resolved at once; a slow re-read is the measurement, and it was not run here.
3. **C. Leave it, and record it.** Costs nothing now. The window is a Save's round
   trip: a control opened inside it closes when the Save answers, and the person opens
   it again. Recorded in the Log; no test is added.

## Build

**Chosen by the owner on 2026-11-07: option A.** The steps are:

1. `web/src/history/History.tsx`, `refile`: `setChanging` clears only the saved row's
   id (the planted line in the Reproduction), not whatever row's control is open.
2. `web/test/history.test.tsx`: the reproduction's two arms, as tests in that file,
   with the Save's notice as the wait. The owner chose A, so the reproduction is the
   test: it fails on `main` and passes with step 1's change.

## Done when

Written for A, the option the owner chose on 2026-11-07.

1. A test in `tools/ledger/web/test/history.test.tsx` runs the reproduction's two arms
   and proves that when A's Save completes, B's open control stays open
   (`aria-expanded` `["false","true"]`, the wait being the Save's notice). It fails on
   `main` at `1eafa0c6` (the red output above) and passes with the answer's change
   (the green output above). The owner chose A, so the reproduction is the test.
2. The owner chose A, so the branch of question 1 that adds no test (C) does not apply.
3. `npm run check` and `npm test -- --project ledger` pass.

## Log

### 2026-11-07, filing

Filed from lg-99's gate 1 (Opus 5.5, at lg-99's `191f8927`). The gate's words: "dropped
· a finished Save closes whichever control is open, another row's included
(`setChanging(null)`); base identical, out of the reviewed range — worth a ticket."
Its open decision 3 recommended filing it, with the reproduction it had: `pending-other-*
after-save expanded ["false","false"]` on base and head. The owner chose to file it.

- **Reproduced on `main`** at `1eafa0c6`, with the test in the Reproduction above; the
  red output is there, and the planted fix's green output too.
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
  `classifyRow` and asserts only the controls), whether a closed control keeps what the
  person chose in it, and focus under Q1 B (see the Decision).
- **Readings.** The probe's readings match the gate's on base (its probe-base output,
  `pending-other-nofocus` and `pending-other-focus`, `after-save expanded`
  `["false","false"]`).

### 2026-11-07, round 1 (gate 1 on `5629dcab`: FAIL)

Gate 1 (Sonnet 5.5, narrow) failed the filing on five findings. Each is answered here.

- **F1, high: the reproduction could not pass under any fix.** Its wait was "no button
  named Save", and B's open control renders one. Under the planted fix it timed out
  (`Error: open`) and logged no `after-save` line. The wait is now the Save's own notice
  (`<output>`, role `status`). Red on `main` with the stated message; green with the
  planted fix in both arms (the outputs above). The earlier output, with the old wait, was
  the same assertion failure on `main` and is superseded.
- **F2, high: question 2 described a state that cannot occur.** `changing` holds one row
  id, so opening B closes A's control before A's Save completes. The focus on A's button
  in the no-focus arm comes from B's opening, which lg-95's N1 names, not from the Save.
  With the one-line fix, both arms already give what Q2's option b describes. So Q2's
  costs for option b, and Q1 A's "closedByOwn needs the case of a close by Save", priced a
  change nothing needs. **The owner chose on 2026-11-07, through AskUserQuestion: drop
  Q2, and say that Q1 A has no focus consequence, citing the gate's readings** (the
  gate's recommendation). Not chosen: keep Q2 as a recorded non-question. Q2 was
  removed from the Decision and its options are recorded here as they stood:
  - a. Focus goes to the saved row's own button, in both arms. Costs: in the focus arm,
    a person who had focus on B's control is moved out of it.
  - b. Focus stays in B's control if it is there; otherwise it goes to A's button, as
    now. Costs: a new condition in `Refile`'s focus effect, which #751 also changes.
- **F3, med: Q1 B's "no focus question arises" was not run.** It is marked not measured
  in the Decision, with the gate's reasoning. It is not measured here; the builder of
  lg-103 judges it.
- **F4, low:** the ticket carries no recommendation, and the pull request body says so
  too. No change; the dispatch's recommendation is in the report, not the file.
- **F5, low:** lg-100's stale sentences were reworded in a separate commit on this branch,
  recorded in lg-100's Log.

### 2026-11-07, decision

- 2026-11-07 — The owner answered the `## Decision` question through AskUserQuestion:
  **A, the completed Save closes only its own row's control.** The ticket carried no
  recommendation. Not chosen: B (hold every row's Change control while a Save is in
  flight), C (leave it and record it), and "not now". The question and its options are
  kept under the heading, unedited.
- Status moved `needs-decision` to `ready` in the commit that records the answer, as
  `roles/builder.md` says. `difficulty` stays `standard`: A is one line in `History.tsx`
  and a test.
- The Build's opening and its step 1, and `Done when`'s preamble and item 2, are
  reworded for A. The Build's step 2 and `Done when` item 1 are not touched by this
  commit.

### 2026-11-07, landing

- 2026-11-07 — Fixed at landing by owner choice: gate 2, N1 — "lg-100's new Log bullet
  says 'The first bullet above, left as written, is superseded.' Those words are in the
  fourth bullet, and the third bullet is superseded too and is not named." The sentence
  in lg-100's Log now names the fourth bullet and the third. Proof:
  `git diff b6c724b9 HEAD -- tools/ledger/docs/work/lg-100-a-pot-charge-keeps-its-items-categories.md | grep -c '^-.*2026-11-07. The first bullet'`
  → `1`.
- 2026-11-07 — Fixed at landing by owner choice: gate 2, N2 — "lg-103's Build step 2 and
  Done when 1 read as the reproduction being the test under any answer but C." Both now
  say the owner chose A, so the reproduction is the test. Proof:
  `git diff b6c724b9 HEAD -- tools/ledger/docs/work/lg-103-a-save-closes-another-rows-control.md | grep -c '^-.*Under C, no test is added'`
  → `1`, and the same with `'^-.*green output above, under A'` → `1`.
- 2026-11-07 — #751 at its later head. The filing entry above says `gh pr diff 751` has
  no changed line naming `setChanging`; that was true at `42446ded`. At `bf152330`
  (`git ls-remote --heads origin lg-99-reread-and-focus`, read 2026-11-07) #751 adds
  `setChanging((current) => (current === row.id ? null : current))` guards in `refile`'s
  re-read paths. The `setChanging(null)` after a stored Save (line 293 there) is not
  touched, so "leaves this behaviour as it is" still holds.
- 2026-11-07 — Gate 1's full report and gate 2's are on the pull request thread, #754;
  the ticket is `ready` from the owner's answer above. Filed by builder-mechanical
  (Haiku 5.5, high), gated twice by ticket-reviewer-sonnet (Sonnet 5.5, xhigh, narrow),
  landed by the fixer (Sonnet 5.5, high).
