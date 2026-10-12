import type { JobStatus } from "@downloader/contract";

export const STATUS_LABEL: Record<JobStatus, string> = {
  queued: "Starting",
  probing: "Re-analysing",
  downloading: "Downloading",
  completed: "Done",
  failed: "Failed",
  canceled: "Canceled",
};

/**
 * Why the job is sitting in this state, in one line — the line under the job
 * card's bar, which is where the card says what is happening now (dl-109). It
 * moves with the status and nothing finer: the re-probe's own stages do not
 * reach the job's event stream.
 */
export const STATUS_HINT: Record<JobStatus, string> = {
  queued: "Opening your download link.",
  probing: "Re-analysing the page for fresh stream links — signed links expire within minutes.",
  downloading: "Sending the video to your browser as it is fetched. Nothing is kept here.",
  completed: "Your browser has the whole file. The server kept no copy.",
  failed: "Stopped before finishing.",
  canceled: "You stopped this download.",
};
