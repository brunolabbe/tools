import type { JobStatus } from "@downloader/shared";

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
