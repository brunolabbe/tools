import type { AppErrorPayload, Job } from "@downloader/contract";
import type { StreamState } from "../lib/job-stream.ts";
import { JobCard } from "./JobCard.tsx";

interface JobListProps {
  jobs: readonly Job[];
  /** The page title each job was started from, by job id — see `useJobs`. */
  titles: Record<string, string>;
  streamStates: Record<string, StreamState>;
  /** Why each job's link was last refused, by job id — see `useJobs`. */
  refusals: Record<string, AppErrorPayload>;
  onFollowLink: (id: string) => void;
  onCancel: (id: string) => void;
  onRemove: (id: string) => void;
  onRetry: (job: Job) => void;
}

/**
 * The live downloads, and the ones that need reading (dl-109). There is no
 * "Clear finished": a saved job leaves when the next analysis starts, and a
 * failed or canceled one is dismissed from its own card.
 */
export function JobList({
  jobs,
  titles,
  streamStates,
  refusals,
  onFollowLink,
  onCancel,
  onRemove,
  onRetry,
}: JobListProps): React.JSX.Element | null {
  if (jobs.length === 0) return null;

  // Only once bytes flow. Before the first response header the browser holds
  // a request, not a download, and Firefox cancels it with the tab (measured by
  // dl-109's gate); a queued link has not even been opened.
  const live = jobs.some((job) => job.status === "downloading");

  return (
    <section className="card" aria-labelledby="jobs-heading">
      <h2 id="jobs-heading" className="card__title">
        Downloads
      </h2>
      {/* Named so a card can be found as one of this list's own items:
          the card nests a list of its own progress messages (dl-109). */}
      <ul className="jobs" aria-label="Downloads">
        {jobs.map((job) => (
          <JobCard
            key={job.id}
            job={job}
            title={titles[job.id]}
            streamState={streamStates[job.id]}
            refusal={refusals[job.id]}
            onFollowLink={onFollowLink}
            onCancel={onCancel}
            onRemove={onRemove}
            onRetry={onRetry}
          />
        ))}
      </ul>
      {/* True because the transfer is the browser's own connection: closing the
          page drops only its event stream (`routes/events.ts`), and only the
          file connection closing cancels the job (`routes/files.ts`). */}
      {live && (
        <p className="muted jobs__note">
          You can close this page — downloads continue in your browser. To stop one, press Stop here
          or cancel it in your browser's downloads.
        </p>
      )}
    </section>
  );
}
