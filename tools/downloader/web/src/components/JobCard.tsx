import type { Job } from "@downloader/contract";
import { useNow } from "../hooks/useNow.ts";
import { localErrorPayload } from "../lib/error-presentation.ts";
import {
  UNKNOWN,
  formatBytes,
  formatDuration,
  formatEta,
  formatExpiry,
  formatPercent,
  formatSpeed,
} from "../lib/format.ts";
import type { StreamState } from "../lib/job-stream.ts";
import {
  STATUS_HINT,
  STATUS_LABEL,
  STATUS_ORDER,
  statusHighWaterMark,
  statusIndex,
} from "../lib/status.ts";
import { ErrorPanel } from "./ErrorPanel.tsx";
import { ProgressBar } from "./ProgressBar.tsx";

interface JobCardProps {
  job: Job;
  streamState: StreamState | undefined;
  /**
   * The furthest pipeline step this client has *watched* the job hold, which the
   * job record cannot report on its own once the back-edge has been taken. See
   * `statusHighWaterMark`; `undefined` means nothing has been watched yet.
   */
  watchedStep: number | undefined;
  onCancel: (id: string) => void;
  onRemove: (id: string) => void;
  onRetry: (job: Job) => void;
}

export function JobCard({
  job,
  streamState,
  watchedStep,
  onCancel,
  onRemove,
  onRetry,
}: JobCardProps): React.JSX.Element {
  const now = useNow(15_000);
  const active = job.status !== "completed" && job.status !== "failed" && job.status !== "canceled";
  const { progress } = job;
  const title = job.variant?.label ?? job.result?.filename ?? job.sourceUrl;
  // Where the job is, and how far it has been — two different questions once
  // the `downloading → probing` back-edge exists. See `statusHighWaterMark`.
  const currentStep = statusIndex(job.status);
  const furthestStep = statusHighWaterMark(job, watchedStep ?? 0);

  return (
    <li className={`job job--${job.status}`}>
      <div className="job__head">
        <div className="job__titles">
          <h3 className="job__title">{title}</h3>
          <p className="muted url-echo">{job.sourceUrl}</p>
        </div>
        <div className="pills">
          {streamState === "reconnecting" && (
            <output className="pill pill--warn">reconnecting…</output>
          )}
          <span className={`pill pill--${job.status}`}>{STATUS_LABEL[job.status]}</span>
        </div>
      </div>

      {active && (
        <>
          <ol className="steps" aria-label="Pipeline">
            {STATUS_ORDER.map((status, index) => {
              // `active` is asked first: a re-probing job is *at* a step it has
              // already been past, and where it is now outranks how far it got.
              const state =
                index === currentStep ? "active" : index <= furthestStep ? "done" : "pending";
              return (
                <li
                  key={status}
                  className={
                    state === "pending" ? "steps__item" : `steps__item steps__item--${state}`
                  }
                  // The three states were CSS and nothing else — a colour and a
                  // `::before` tick that a screen reader has no reason to read —
                  // so the list announced five steps and no sense of which one
                  // the job was on. `aria-current` names that one; the label
                  // names the ones behind it, because a done step is otherwise
                  // indistinguishable from a pending one by name.
                  aria-current={state === "active" ? "step" : undefined}
                  aria-label={state === "done" ? `${STATUS_LABEL[status]}, done` : undefined}
                >
                  {STATUS_LABEL[status]}
                </li>
              );
            })}
          </ol>
          <ProgressBar
            percent={progress.percent}
            label={STATUS_LABEL[job.status]}
            {...(progress.speedBps !== null ? { valueText: formatSpeed(progress.speedBps) } : {})}
          />
          <p className="muted" aria-live="polite">
            {STATUS_HINT[job.status]}
          </p>
          <dl className="stats">
            <div>
              <dt>Progress</dt>
              <dd>
                {progress.percent === null ? "unknown total" : formatPercent(progress.percent)}
              </dd>
            </div>
            <div>
              <dt>Downloaded</dt>
              <dd>
                {formatBytes(progress.downloadedBytes)}
                {progress.totalBytes !== null ? ` / ${formatBytes(progress.totalBytes)}` : ""}
              </dd>
            </div>
            <div>
              <dt>Speed</dt>
              <dd>{formatSpeed(progress.speedBps)}</dd>
            </div>
            <div>
              <dt>Remaining</dt>
              <dd>{formatEta(progress.etaSec)}</dd>
            </div>
            <div>
              <dt>Segments</dt>
              <dd>
                {progress.segmentsDone === null
                  ? UNKNOWN
                  : `${progress.segmentsDone}${progress.segmentsTotal === null ? "" : ` / ${progress.segmentsTotal}`}`}
              </dd>
            </div>
          </dl>
        </>
      )}

      {job.status === "completed" && job.result && (
        <CompletedResult result={job.result} now={now} />
      )}

      {job.status === "failed" && job.error && (
        <ErrorPanel error={job.error} onRetry={() => onRetry(job)} retryLabel="Analyse and retry" />
      )}

      {job.status === "canceled" && <ErrorPanel error={localErrorPayload("JOB_CANCELED")} />}

      <div className="job__actions">
        {active && (
          <button type="button" className="button" onClick={() => onCancel(job.id)}>
            Cancel
          </button>
        )}
        <button type="button" className="button button--quiet" onClick={() => onRemove(job.id)}>
          Remove from list
        </button>
      </div>
    </li>
  );
}

function CompletedResult({
  result,
  now,
}: {
  result: NonNullable<Job["result"]>;
  now: number;
}): React.JSX.Element {
  const expiry = formatExpiry(result.expiresAt, now);

  if (expiry.expired) {
    return <ErrorPanel error={localErrorPayload("FILE_EXPIRED")} />;
  }

  return (
    <div className="result">
      <div className="result__meta">
        <p className="result__filename">{result.filename}</p>
        <p className="muted">
          {formatBytes(result.sizeBytes)} · {result.container.toUpperCase()}
          {result.durationSec !== null ? ` · ${formatDuration(result.durationSec)}` : ""}
        </p>
      </div>
      <div className="result__actions">
        <a className="button button--primary" href={result.downloadUrl} download={result.filename}>
          Download file
        </a>
        <span className="muted result__expiry">{expiry.label}</span>
      </div>
    </div>
  );
}
