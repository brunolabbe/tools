---
id: dl-127
tool: downloader
title: The 3x parallel-ranges floor failed once on Linux at 2.97x beside the whole suite
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# dl-127 — The 3x parallel-ranges floor on Linux, set from a measurement

## Why

`engine/test/parallel-ranges.test.ts` › "a job that measures slow switches to 4
connections and finishes at least 3x faster" is dl-98's proof of its Done when 1.
It asserts `single.ms / split.ms >= 3` on wall-clock time, and since
[dl-121](./dl-121-the-3x-parallel-ranges-test-fails-on-the-windows-leg.md)
it asserts 2.5 on Windows and keeps 3 elsewhere.

**It failed once on Linux, beside the whole project.** The builder of
[dl-117](./dl-117-split-browser-resolver-test-so-one-file-is-not-the-whole-run.md)
ran `npm test -- --project downloader` six times locally on one machine, and run
3 failed with:

```
expected 2.9741046875533983 to be greater than or equal to 3
```

with `singleMs` 8483 and `splitMs` 2852 (8483 / 2852 reproduces the number). Runs
4 to 6 passed; the dl-117 Log does not say for runs 1 and 2. That file was not touched by dl-117, and the failure is
not a browser test.

The test's own comment records why this is plausible: the four-connection run
alone slows by 150 to 405 ms beside the rest of the suite while `singleMs` is a
paced transfer and does not move; Windows was recorded at 2.91 to 3.00 for that
reason, and the floor of 3 was kept for Linux on what dl-121's Log records:
dl-98's gate measured 3.450 to 3.476 over 10 quiet Linux runs, and 3.25 at its
lowest under a load average of 10 (a synthetic load). Nobody has measured Linux
beside the full suite.

**What is not known: whether dl-117's split made it likelier.** The six files
start more work at the same time than the one file did, and the base arm is a
single run. The ticket cannot settle that by reasoning, so it measures.

**The owner chose (2026-10-17)** to file this as a ticket, over keeping 3x or
setting Linux to 2.5 now.

## Build

1. **Measure the ratio on Linux beside the full downloader project**, the way
   the failing run was made: `npm test -- --project downloader`. The spec passes
   `timing` only as the `expect` message, so a passing run prints nothing; read
   `singleMs` and `splitMs` from an uncommitted scratch copy of the spec (or an
   uncommitted edit, restored from a commit with `git checkout <sha> -- <path>`)
   that logs `timing` on every run, and never commit it.
   Two arms, **twenty runs each** (the owner's choice, 2026-10-17, below), on the
   same machine and with no other gated run active (the gate prints how many
   hold a slot). The builder may stop an arm before twenty only once each arm
   has had a failure.
   - **base:** `origin/main` at `76ce7d52`, before dl-117's split (one
     `browser-resolver.test.ts`);
   - **split:** the squash-merge commit of PR #499 on `main`, or `76ce7d52` plus
     the six files and the harness restored from it.

   **Why twenty.** At the one failure in six that this ticket reports, eight
   clean runs happen 23 % of the time (5/6 to the eighth), and 60 % of the time
   at the 1-in-16 rate dl-121 recorded on Windows; twenty clean runs at one in
   six happen 2.6 % of the time. Eight a side also cannot say whether the split
   arm fails more often (step 4). By the dl-117 Log's timings (base 297.9 s a
   run, split 73 to 131 s) eight a side is about 50 minutes and twenty a side
   about 2 hours 10 minutes.

2. **Report both distributions** — minimum, median, maximum of
   `single.ms / split.ms`, and the count of runs below 3 — before changing
   anything. The fixture throttle makes `singleMs` about 8.4 s every time, so
   the variance is in `splitMs`.
3. **Set the Linux floor from that data**, the way dl-121 set Windows: a value
   below the lowest ratio recorded and far above 0.999, the ratio of a run that
   never splits. Update the test's comment with the numbers. If both arms show no
   run under 3, keep 3 and say so in the Log with the denominators; that is a
   result.
4. **If the split arm fails more often than the base arm**, say that plainly in
   the Log. Whether to do anything about the split's concurrency is then a
   decision for the owner, not for this ticket.

## Done when

1. The Log holds both arms' runs, each with its count and its minimum, median and
   maximum ratio, and the machine and the date.
2. The Linux floor in `parallel-ranges.test.ts` is either unchanged with the
   measurement that justifies it, or changed to a value below the lowest ratio
   measured, with the comment carrying the numbers.
3. `npx vitest run tools/downloader/engine/test/parallel-ranges.test.ts` passes,
   and `npm run check` passes.

## Log

- 2026-10-17 — Filed from dl-117's Log (open decision A, owner's answer
  2026-10-17). Rated standard: the measurement is mechanical and choosing the
  floor from it is a judgement. The reproduction is the failure above, once in
  six whole-project runs on Linux, at 2.97 with `singleMs` 8483 and `splitMs` 2852.
- 2026-10-17 — Owner answer on the run count, after gate 2. Question: "dl-127
  says 'at least eight runs each' with no rationale. What should dl-127 say?"
  Options: twenty a side / builder chooses (and states the number, the cost and
  the failure rate it could and could not have excluded). The owner chose
  **twenty a side** (recommended): state the number as a choice with the
  arithmetic, and let the builder stop early only on a failure in each arm.
  Build step 1 says so.
- 2026-10-17 — Fixed at landing by owner choice: gate 2, med — "dl-127's Build step 1 cannot produce the data its Done when 1 asks for … **Fix:** replace the example with that method: an uncommitted scratch copy (or an uncommitted edit, restored from a commit with `git checkout <sha> -- <path>`) that logs `timing` on every run, never committed."
  `sed -n '/^## Build/,/^## Done when/p' tools/downloader/docs/work/dl-127-*.md | tr '\n' ' ' | tr -s ' ' | grep -o -F 'uncommitted scratch copy' | wc -l` → 1.
- 2026-10-17 — Fixed at landing by owner choice: gate 2, med (run count) — "state the number as a choice with this arithmetic and set twenty a side, and let the builder stop early only on a failure in each arm."
  `sed -n '/^## Build/,/^## Done when/p' tools/downloader/docs/work/dl-127-*.md | tr '\n' ' ' | tr -s ' ' | grep -o -F 'twenty runs each' | wc -l` → 1.
- 2026-10-17 — Fixed at landing by owner choice: gate 2, low — "name the split arm as the squash-merge commit of PR #499 on `main`, or as `76ce7d52` plus the six files and the harness restored from it."
  `sed -n '/^## Build/,/^## Done when/p' tools/downloader/docs/work/dl-127-*.md | tr '\n' ' ' | tr -s ' ' | grep -o -F 'squash-merge commit of PR #499' | wc -l` → 1.
- 2026-10-17 — Fixed at landing by owner choice: gate 2, low — "cite dl-121's Log record (dl-98's gate 3.450 to 3.476 over 10 quiet Linux runs, 3.25 lowest under load average 10) instead of 'one reading'."
  `sed -n '/^## Why/,/^## Build/p' tools/downloader/docs/work/dl-127-*.md | tr '\n' ' ' | tr -s ' ' | grep -o -F '3.450 to 3.476' | wc -l` → 1.
- 2026-10-17 — Fixed at landing by owner choice: gate 2, low — "runs 4 to 6 passed; the Log does not say for runs 1 and 2".
  `sed -n '/^## Why/,/^## Build/p' tools/downloader/docs/work/dl-127-*.md | tr '\n' ' ' | tr -s ' ' | grep -o -F 'does not say for runs 1 and 2' | wc -l` → 1.
