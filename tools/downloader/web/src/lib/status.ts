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
 * The furthest pipeline step this `Job`, on its own, proves it has occupied —
 * or `null` when it proves nothing, which is the case for the two statuses the
 * pipeline has no step for.
 *
 * `statusIndex` folds `failed` and `canceled` onto the last step because the
 * progress bar has to put them somewhere. That is a fact about the bar, not
 * about where the job has been, and a high-water mark that inherited it would
 * hand a job that got nowhere a trail of four done steps. `null` is how this
 * function refuses to say.
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
 * status is its own high-water mark by construction.
 */
export function reachedStep(job: Job): number | null {
  const position = STATUS_ORDER.indexOf(job.status);
  if (position === -1) return null;
  if (job.status === "probing" && job.attempts > 1) return statusIndex("downloading");
  return position;
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
 * **Two witnesses, and the answer is the higher of them (dl-20).** `reachedStep`
 * is what the job record itself proves, and it is the only one that survives a
 * page reload — but it depends on `attempts`, which no `JobEvent` carries, so a
 * client watching a healthy stream never sees it move. `watched` is the other:
 * the furthest step this client has seen the job hold, folded by `markWatched`
 * in `job-reducer.ts` as the frames land. Neither alone is enough. A reload has
 * only the first (the mark map is session state); a live stream has only the
 * second (the refetch that would carry `attempts` has not happened).
 *
 * Nothing here is remembered in the component. `JobCard` must render the same
 * thing for the same job on any mount — the list is restored from `localStorage`
 * and re-fetched on every page load, so a `useRef` inside the card would reset
 * underneath it and disagree with its own earlier render.
 *
 * `watched` is ignored for `failed` and `canceled` — see `reachedStep` — which
 * is what keeps a terminal job from acquiring a trail of steps it never walked.
 */
export function statusHighWaterMark(job: Job, watched = 0): number {
  const reached = reachedStep(job);
  if (reached === null) return statusIndex(job.status);
  return Math.max(reached, watched);
}
