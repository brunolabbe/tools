import type { Job } from "@downloader/shared";
import type { StreamState } from "../lib/job-stream.ts";
import { JobCard } from "./JobCard.tsx";

interface JobListProps {
  jobs: readonly Job[];
  streamStates: Record<string, StreamState>;
  onCancel: (id: string) => void;
  onRemove: (id: string) => void;
  onRetry: (job: Job) => void;
  onClearFinished: () => void;
}

export function JobList({
  jobs,
  streamStates,
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
            onCancel={onCancel}
            onRemove={onRemove}
            onRetry={onRetry}
          />
        ))}
      </ul>
    </section>
  );
}
