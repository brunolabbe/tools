/**
 * One box per analysis, from the paste to the saved file (dl-133).
 *
 * The page used to hold one analysis at a time, and the download it led to was a
 * second card in a separate list. Now every Analyse makes a box, and the box
 * walks `waiting → analysing → probed → job` on its own: several run at once,
 * and the job is the same box the analysis was.
 *
 * What is here is the part worth testing without a DOM: the shape of a box,
 * which boxes the page shows, and which waiting box starts next.
 */

import type {
  AppErrorPayload,
  Job,
  JobOptions,
  ProbeResult,
  ProbeStageEvent,
} from "@downloader/contract";
import { isTerminal } from "./job-reducer.ts";

/**
 * The probes one client may hold at once: the API's `maxProbesPerClient`
 * (`api/src/config.ts`, enforced by `probeClientGate`). A third waits here, in
 * the browser, rather than being refused there (dl-133 decision 1). The server
 * stays the authority — another tab on the same address shares its count — and
 * a refusal it sends anyway lands in the box as any failed analysis does.
 */
export const PROBE_SLOTS = 2;

/**
 * The jobs one client may hold in flight: the API's `maxJobsPerClient`. A job's
 * re-probe is not counted against the probe cap, so the two queues are apart
 * (dl-133 decision 2).
 */
export const JOB_SLOTS = 2;

/** Where a probed box is on the way to its job. */
export type DownloadStep =
  /** The renditions and the options, and why the last press failed, if it did. */
  | { kind: "choosing"; error: AppErrorPayload | null }
  /** Download was pressed with both job slots taken; `order` is its place in line. */
  | { kind: "waiting"; options: JobOptions; order: number }
  /** `createJob` is in flight. Counted as a job, so a second box cannot take its slot. */
  | { kind: "starting" };

export type Box =
  /** Made with both probe slots taken: no request has been sent for it yet. */
  | { id: string; kind: "waiting"; url: string; order: number; since: number }
  | {
      id: string;
      kind: "analysing";
      url: string;
      startedAt: number;
      /** The last stage the server reported over this box's own channel (dl-43). */
      stage: ProbeStageEvent | null;
    }
  | { id: string; kind: "failed"; url: string; error: AppErrorPayload }
  | {
      id: string;
      kind: "probed";
      url: string;
      probe: ProbeResult;
      cached: boolean;
      download: DownloadStep;
    }
  | {
      id: string;
      kind: "job";
      url: string;
      jobId: string;
      /**
       * The analysis's preview, kept so the image stays where it was: a job
       * record has none of its own until its re-probe has run. `null` for a box
       * restored on a reload, which had no analysis above it.
       */
      previewPath: string | null;
    };

/**
 * The boxes the page shows: those made in this page's life, newest first, then
 * one per job no such box holds — the jobs `useJobs` restored on a reload, each
 * a box in the job state with no analysis above it (dl-133 decision 6). Those
 * keep `useJobs`' order, which is newest first too.
 *
 * A page box whose job has been dismissed is dropped rather than drawn empty.
 */
export function displayBoxes(boxes: readonly Box[], jobs: readonly Job[]): Box[] {
  const known = new Set(jobs.map((job) => job.id));
  const held = new Set<string>();
  const shown: Box[] = [];
  for (const box of boxes) {
    if (box.kind === "job") {
      if (!known.has(box.jobId)) continue;
      held.add(box.jobId);
    }
    shown.push(box);
  }
  for (const job of jobs) {
    if (held.has(job.id)) continue;
    shown.push({
      id: `job:${job.id}`,
      kind: "job",
      url: job.sourceUrl,
      jobId: job.id,
      previewPath: null,
    });
  }
  return shown;
}

/** Probes this page holds open: every box that is analysing. */
export function probesInFlight(boxes: readonly Box[]): number {
  return boxes.filter((box) => box.kind === "analysing").length;
}

/**
 * Jobs this page holds in flight: every job not yet finished, restored ones
 * included since the server counts those too, and every box whose job is being
 * created, which is about to be one.
 */
export function jobsInFlight(boxes: readonly Box[], jobs: readonly Job[]): number {
  const starting = boxes.filter(
    (box) => box.kind === "probed" && box.download.kind === "starting",
  ).length;
  return starting + jobs.filter((job) => !isTerminal(job)).length;
}

/**
 * The waiting analyses that may start now, first come first served.
 *
 * `abandoned` is the POSTs still out whose box was closed or re-analysed: the
 * server holds their slots until they settle, whatever the page shows (dl-133
 * gate 1, F1).
 */
export function analysesToStart(
  boxes: readonly Box[],
  abandoned = 0,
): Extract<Box, { kind: "waiting" }>[] {
  const free = PROBE_SLOTS - probesInFlight(boxes) - abandoned;
  if (free <= 0) return [];
  return boxes
    .filter((box): box is Extract<Box, { kind: "waiting" }> => box.kind === "waiting")
    .toSorted((a, b) => a.order - b.order)
    .slice(0, free);
}

/** A probed box whose Download is waiting for a job slot. */
export type WaitingDownload = Extract<Box, { kind: "probed" }> & {
  download: Extract<DownloadStep, { kind: "waiting" }>;
};

/** The waiting downloads that may start now, first come first served. */
export function downloadsToStart(boxes: readonly Box[], jobs: readonly Job[]): WaitingDownload[] {
  const free = JOB_SLOTS - jobsInFlight(boxes, jobs);
  if (free <= 0) return [];
  return boxes
    .filter(
      (box): box is WaitingDownload => box.kind === "probed" && box.download.kind === "waiting",
    )
    .toSorted((a, b) => a.download.order - b.download.order)
    .slice(0, free);
}
