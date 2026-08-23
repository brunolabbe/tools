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
import { STATUS_ORDER, reachedStep, statusHighWaterMark, statusIndex } from "../src/lib/status.ts";
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

// ---------------------------------------------------------------------------
// The second witness (dl-20)
// ---------------------------------------------------------------------------

test("a step the client watched holds the mark when the job record cannot", () => {
  // The live-stream shape, and the one dl-18's fix could not reach: no
  // `JobEvent` carries `attempts`, so a client following a healthy stream over
  // the back-edge holds `attempts: 1` and the job record on its own proves
  // nothing. What the client watched is the other witness, and it answers here.
  const listening = job("probing", { attempts: 1, progress: { downloadedBytes: 0 } });

  expect(reachedStep(listening)).toBe(statusIndex("probing"));
  expect(statusHighWaterMark(listening, statusIndex("downloading"))).toBe(
    statusIndex("downloading"),
  );
});

test("the two witnesses are maxed, not chosen between", () => {
  // A refetched job knows `attempts` and nothing about what this client watched;
  // a listening client is the other way round. Either one alone has to carry the
  // mark, which is what makes `reconcileJob`'s choice between the two copies
  // survivable whichever way it goes.
  const refetched = job("probing", { attempts: 2, progress: { downloadedBytes: 0 } });
  const listening = job("probing", { attempts: 1, progress: { downloadedBytes: 0 } });
  const downloading = statusIndex("downloading");

  expect(statusHighWaterMark(refetched, 0)).toBe(downloading);
  expect(statusHighWaterMark(listening, downloading)).toBe(downloading);
  expect(statusHighWaterMark(refetched, downloading)).toBe(downloading);
});

test("only probing is inferred about, whatever the attempts counter says", () => {
  // There is exactly one back-edge, so every other status is its own high-water
  // mark by construction. Reading `attempts` without the status would report a
  // job that re-probed and then reached `muxing` as having got only as far as
  // `downloading` — true of the attempt it abandoned, wrong about this one — and
  // would put a `queued` job two steps ahead of itself. Neither is visible on a
  // card, because the current step outranks the mark and the list is rendered
  // only for an active job; both are wrong answers from a helper whose whole job
  // is to say where a job has been.
  for (const status of ["queued", "downloading", "muxing", "completed"] as const) {
    expect(reachedStep(job(status, { attempts: 2 }))).toBe(statusIndex(status));
  }
});

test("a watched step is a floor under the job, never a promotion of it", () => {
  // `Math.max`, not a replacement: a job that has only moved forwards is still
  // its own high-water mark. Returning `watched` outright would leave a
  // `downloading` job marked as though it were only at `probing`.
  expect(statusHighWaterMark(job("queued"), 0)).toBe(statusIndex("queued"));
  expect(statusHighWaterMark(job("downloading"), statusIndex("probing"))).toBe(
    statusIndex("downloading"),
  );
});

test("a terminal job ignores the mark, whatever this client watched", () => {
  // The trap the test above names, reached the new way: `STATUS_ORDER` has no
  // step for `failed` or `canceled`, so a client that watched the job get as far
  // as `muxing` and then fail must not be handed a trail of done steps for it.
  for (const status of ["failed", "canceled"] as const) {
    const terminal = job(status, { attempts: 2 });
    expect(reachedStep(terminal)).toBeNull();
    expect(statusHighWaterMark(terminal, statusIndex("muxing"))).toBe(statusIndex(status));
  }
});
