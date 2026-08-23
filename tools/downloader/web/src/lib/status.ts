import type { Job, JobStatus } from "@downloader/contract";

export const STATUS_LABEL: Record<JobStatus, string> = {
  queued: "Queued",
  probing: "Re-analysing",
  downloading: "Downloading",
  muxing: "Assembling",
  completed: "Ready",
  failed: "Failed",
  canceled: "Canceled",
};

/** Why the job is sitting in this state, in one line. */
export const STATUS_HINT: Record<JobStatus, string> = {
  queued: "Waiting for a free worker slot.",
  probing: "Fetching fresh stream links — signed URLs expire within minutes.",
  downloading: "Pulling the video data.",
  muxing: "Joining audio and video into a playable file.",
  completed: "Finished and ready to download.",
  failed: "Stopped before finishing.",
  canceled: "You stopped this download.",
};

export const STATUS_ORDER: readonly JobStatus[] = [
  "queued",
  "probing",
  "downloading",
  "muxing",
  "completed",
];

export function statusIndex(status: JobStatus): number {
  const index = STATUS_ORDER.indexOf(status);
  return index === -1 ? STATUS_ORDER.length - 1 : index;
}

/**
 * How far along `STATUS_ORDER` this job has ever been, which is not the same
 * question as where it is now.
 *
 * `downloading → probing` is the FSM's one back-edge (dl-9): a signed media URL
 * that expires mid-download sends the job back for fresh links rather than
 * failing it. Marking the step list from `statusIndex` alone renders that as the
 * job walking backwards — "Downloading" loses its done marker while the bytes it
 * already fetched are still on screen beside it — which reports the opposite of
 * what happened, and reads as a setback rather than as routine.
 *
 * The mark is derived from the `Job` rather than remembered in the component,
 * because `JobCard` must render the same thing for the same job on any mount:
 * the list is restored from `localStorage` and re-fetched on every page load, so
 * a `useRef` would reset underneath it and disagree with its own earlier render.
 *
 * **`attempts`, not `progress.downloadedBytes`.** The orchestrator patches
 * `initialProgress("probing")` as it takes the back-edge, on the grounds that an
 * abandoned attempt's bytes are not progress towards this one — so a re-probing
 * job's `downloadedBytes` is `0` and could never once be the tell it looks like.
 * `attempts` is bumped in that same patch, and a retry is only ever reached
 * through `REPROBE_WORTHY`, whose codes are both raised while downloading. So
 * `attempts > 1` means the download stage has been entered and left.
 *
 * Only `probing` is inferred about. There is exactly one back-edge, and
 * `muxing → probing` is deliberately not in `JOB_TRANSITIONS`; every other
 * status is its own high-water mark by construction. That also keeps `failed`
 * and `canceled` — which `STATUS_ORDER` does not carry, and which `statusIndex`
 * therefore maps to the last index — from acquiring a trail of done steps they
 * never walked.
 */
export function statusHighWaterMark(job: Job): number {
  const current = statusIndex(job.status);
  if (job.status !== "probing" || job.attempts <= 1) return current;
  return statusIndex("downloading");
}
