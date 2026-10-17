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

with `singleMs` 8483 and `splitMs` 2852 (8483 / 2852 reproduces the number). The
other five runs passed. That file was not touched by dl-117, and the failure is
not a browser test.

The test's own comment records why this is plausible: the four-connection run
alone slows by 150 to 405 ms beside the rest of the suite while `singleMs` is a
paced transfer and does not move; Windows was recorded at 2.91 to 3.00 for that
reason, and the floor of 3 was kept for Linux on the strength of one Linux
reading, 3.45, from the test alone on a quiet machine. Nobody has measured Linux
beside the full suite.

**What is not known: whether dl-117's split made it likelier.** The six files
start more work at the same time than the one file did, and the base arm is a
single run. The ticket cannot settle that by reasoning, so it measures.

**The owner chose (2026-10-17)** to file this as a ticket, over keeping 3x or
setting Linux to 2.5 now.

## Build

1. **Measure the ratio on Linux beside the full downloader project**, the way
   the failing run was made: `npm test -- --project downloader`, reading
   `singleMs` and `splitMs` from the test (put them in a scratch run's output,
   for example with the test's `timing` string, or a JSON reporter and the
   failure message; do not edit the test to print them in the committed tree).
   Two arms, at least eight runs each, on the same machine and with no other
   gated run active (the gate prints how many hold a slot):
   - **base:** `origin/main` at `76ce7d52`, before dl-117's split (one
     `browser-resolver.test.ts`);
   - **split:** the same commit with dl-117's six files (`dl-117-split-browser-test`).
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
