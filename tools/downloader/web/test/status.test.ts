/**
 * The pipeline's memory, tested without a DOM.
 *
 * `statusHighWaterMark` is a fact about the job FSM rather than about markup,
 * which is why it lives in `lib/status.ts` and is asserted here rather than only
 * through a rendered card — the interesting cases are combinations of `status`
 * and `attempts`, and none of them needs a browser to be wrong.
 *
 * No `@vitest-environment` docblock, deliberately: this file runs on the
 * `downloader` project's default node environment, beside
 * `presentation-helpers.test.ts`.
 */

import { expect, test } from "vitest";
import { STATUS_ORDER, statusHighWaterMark, statusIndex } from "../src/lib/status.ts";
import { job } from "./fixtures.ts";

test("a job that has only ever moved forward is at its own high-water mark", () => {
  for (const status of STATUS_ORDER) {
    expect(statusHighWaterMark(job(status))).toBe(statusIndex(status));
  }
});

test("the first probe has been nowhere, whatever the progress snapshot says", () => {
  // `queued → probing` is the job's opening move and `attempts` is 1 there, so
  // nothing is behind it. The byte count is set high on purpose: it is the value
  // the *other* candidate signal would have read, and a card that marked
  // "Downloading" done here would be inventing a stage the job never entered.
  const first = job("probing", { attempts: 1, progress: { downloadedBytes: 41_000_000 } });

  expect(statusHighWaterMark(first)).toBe(statusIndex("probing"));
  expect(statusHighWaterMark(first)).toBeLessThan(statusIndex("downloading"));
});

test("a re-probe holds the mark at downloading, with no bytes left to show for it", () => {
  // The shape the server actually sends over the back-edge: `attempts` bumped
  // and the progress snapshot reset to `initialProgress("probing")`, because the
  // abandoned attempt's bytes are not progress towards this one (dl-9). So the
  // byte count is *zero* by the time a re-probing job reaches the UI, which is
  // the whole reason the mark reads `attempts`.
  const reprobing = job("probing", { attempts: 2, progress: { downloadedBytes: 0 } });

  expect(reprobing.progress.downloadedBytes).toBe(0);
  expect(statusHighWaterMark(reprobing)).toBe(statusIndex("downloading"));
});

test("a terminal job gains no trail of steps it never walked", () => {
  // `STATUS_ORDER` stops at `completed`, so `statusIndex` maps `failed` and
  // `canceled` to its last index — which is exactly the value a careless mark
  // would turn into four done steps behind a job that got nowhere. `JobCard`
  // renders the list only for an active job, and this keeps the helper honest
  // regardless.
  for (const status of ["failed", "canceled"] as const) {
    const terminal = job(status, { attempts: 2 });
    expect(statusIndex(status)).toBe(STATUS_ORDER.length - 1);
    expect(statusHighWaterMark(terminal)).toBe(statusIndex(status));
  }
});
