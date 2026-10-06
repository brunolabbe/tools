import type { AppErrorPayload, Job } from "@downloader/contract";
import type { StreamState } from "../lib/job-stream.ts";
import { JobCard } from "./JobCard.tsx";

interface JobListProps {
  jobs: readonly Job[];
  streamStates: Record<string, StreamState>;
  /** Client-side pipeline marks by job id — see `useJobs`. */
  watchedSteps: Record<string, number>;
  /** Why each job's link was last refused, by job id — see `useJobs`. */
  refusals: Record<string, AppErrorPayload>;
  onFollowLink: (id: string) => void;
  onCancel: (id: string) => void;
  onRemove: (id: string) => void;
  onRetry: (job: Job) => void;
  onClearFinished: () => void;
}

export function JobList({
  jobs,
  streamStates,
  watchedSteps,
  refusals,
  onFollowLink,
  onCancel,
  onRemove,
  onRetry,
  onClearFinished,
}: JobListProps): React.JSX.Element | null {
  if (jobs.length === 0) return null;

  const finished = jobs.filter(
    (job) => job.status === "completed" || job.status === "failed" || job.status === "canceled",
  ).length;

  return (
    <section className="card" aria-labelledby="jobs-heading">
      <div className="card__head">
        <h2 id="jobs-heading" className="card__title">
          Downloads
        </h2>
        {finished > 0 && (
          <button type="button" className="button button--quiet" onClick={onClearFinished}>
            Clear {finished} finished
          </button>
        )}
      </div>
      <ul className="jobs">
        {jobs.map((job) => (
          <JobCard
            key={job.id}
            job={job}
            streamState={streamStates[job.id]}
            watchedStep={watchedSteps[job.id]}
            refusal={refusals[job.id]}
            onFollowLink={onFollowLink}
            onCancel={onCancel}
            onRemove={onRemove}
            onRetry={onRetry}
          />
        ))}
      </ul>
    </section>
  );
}
