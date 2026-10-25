/**
 * The words a job's status is shown with, tested without a DOM.
 *
 * Until dl-109 this file tested `statusHighWaterMark`, the step list's memory of
 * the `downloading → probing` back-edge. The job card has no step list now — the
 * bar and the progress messages under it are the progression — so what is left
 * in `lib/status.ts` is a label and a line per status.
 *
 * No `@vitest-environment` docblock, deliberately: this file runs on the
 * `downloader` project's default node environment.
 */

import { expect, test } from "vitest";
import { JOB_STATUSES } from "@downloader/contract";
import { STATUS_HINT, STATUS_LABEL } from "../src/lib/status.ts";

test("the statuses read as a streamed download does, not as a queue and a stored file", () => {
  expect(STATUS_LABEL).toEqual({
    queued: "Starting",
    probing: "Re-analysing",
    downloading: "Downloading",
    completed: "Done",
    failed: "Failed",
    canceled: "Canceled",
  });
});

test("every status has a label, and every one but re-analysing a line", () => {
  // Re-analysing says what the re-probe is doing instead, from its stage.
  for (const status of JOB_STATUSES) {
    expect(STATUS_LABEL[status]).not.toBe("");
    if (status !== "probing") expect(STATUS_HINT[status]).not.toBe("");
  }
  expect(Object.keys(STATUS_HINT)).not.toContain("probing");
});
