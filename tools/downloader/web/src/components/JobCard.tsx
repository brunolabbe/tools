import type { AppErrorPayload, Job } from "@downloader/contract";
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
import { Preview } from "./Preview.tsx";
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
  /**
   * Why the server last refused to start this job when its link was opened
   * (dl-77), or `undefined`. The browser reports that as a failed file and the
   * page cannot see it, so this comes from the job's event stream.
   */
  refusal: AppErrorPayload | undefined;
  /** The visitor followed the link, which makes any earlier refusal old news. */
  onFollowLink: (id: string) => void;
  onCancel: (id: string) => void;
  onRemove: (id: string) => void;
  onRetry: (job: Job) => void;
}

export function JobCard({
  job,
  streamState,
  watchedStep,
  refusal,
  onFollowLink,
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
  // dl-41: once a job is completed the preview leaves the head for the result
  // panel, so a finished card shows the image once, beside the filename it now
  // labels. This is the same expression the `CompletedResult` render below is
  // guarded by, so the preview is in one place or the other — never in both,
  // and never in neither.
  const previewInResult = job.status === "completed" && job.result !== null;

  return (
    <li className={`job job--${job.status}`}>
      <div className="job__head">
        {/* Same grouping reason as `card__headline`: `job__head` is
            `space-between`, and this must be additive — a job from before dl-29,
            or one whose probe found no image, renders exactly as it did. */}
        <div className="job__headline">
          {!previewInResult && <Preview path={job.thumbnailPath} size="card" />}
          <div className="job__titles">
            <h3 className="job__title">{title}</h3>
            <p className="muted url-echo">{job.sourceUrl}</p>
          </div>
        </div>
        <div className="pills">
          {streamState === "reconnecting" && (
            <output className="pill pill--warn">reconnecting…</output>
          )}
          <span className={`pill pill--${job.status}`}>{STATUS_LABEL[job.status]}</span>
        </div>
      </div>

      {job.status === "queued" && job.link && (
        <LinkOffer link={job.link} now={now} onFollow={() => onFollowLink(job.id)} />
      )}
      {/* Above nothing and beside the offer: the link is still good, and this is
          why the last attempt at it did not start. Only while the job is still
          queued, which is the only state a refusal leaves it in. */}
      {job.status === "queued" && refusal && <ErrorPanel error={refusal} />}

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
                {progress.percent !== null
                  ? formatPercent(progress.percent)
                  : progress.totalBytes === null
                    ? "unknown total"
                    : UNKNOWN}
              </dd>
            </div>
            <div>
              <dt>Downloaded</dt>
              <dd>
                {formatBytes(progress.downloadedBytes)}
                {/* An expectation, not a measurement (dl-96), so it says so. */}
                {progress.totalBytes !== null ? ` / ~${formatBytes(progress.totalBytes)}` : ""}
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
        <CompletedResult result={job.result} thumbnailPath={job.thumbnailPath} />
      )}

      {job.status === "failed" && job.error && (
        <ErrorPanel error={job.error} onRetry={() => onRetry(job)} retryLabel="Analyse and retry" />
      )}

      {/* The job's own error, so its `details.reason` picks the copy (dl-53); the
          local payload only for a record that somehow has none. */}
      {job.status === "canceled" && (
        <ErrorPanel error={job.error ?? localErrorPayload("JOB_CANCELED")} />
      )}

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

/**
 * The job's single-use link (dl-53). Following it is what starts the work:
 * the file streams to this browser as it is produced, and the card follows the
 * progress over the event stream meanwhile.
 *
 * `download` with no value, so the name comes from the server's
 * `Content-Disposition` — the title is only known after the re-probe the link
 * itself triggers — and so a refusal lands in the browser's downloads list
 * instead of navigating this page away from the card that explains it.
 */
function LinkOffer({
  link,
  now,
  onFollow,
}: {
  link: NonNullable<Job["link"]>;
  now: number;
  onFollow: () => void;
}): React.JSX.Element {
  const expiry = formatExpiry(link.expiresAt, now);
  if (expiry.expired) return <ErrorPanel error={localErrorPayload("FILE_EXPIRED")} />;
  return (
    <div className="result__actions">
      <a className="button button--primary" href={link.url} download onClick={onFollow}>
        Download
      </a>
      <span className="muted result__expiry">works once · {expiry.label}</span>
    </div>
  );
}

function CompletedResult({
  result,
  thumbnailPath,
}: {
  result: NonNullable<Job["result"]>;
  /** Required, not optional — `undefined` is a job recorded before dl-29. */
  thumbnailPath: string | null | undefined;
}): React.JSX.Element {
  return (
    <div className="result">
      {/* Grouped with the meta rather than added as a bare child of `.result`,
          which is `space-between`. Same reason as `card__headline` and
          `job__headline`. `result__headline` collapses to just the meta when
          `Preview` renders null. */}
      <div className="result__headline">
        <Preview path={thumbnailPath} size="card" />
        <div className="result__meta">
          <p className="result__filename">{result.filename}</p>
          <p className="muted">
            {formatBytes(result.sizeBytes)} · {result.container.toUpperCase()}
            {result.durationSec !== null ? ` · ${formatDuration(result.durationSec)}` : ""}
          </p>
        </div>
      </div>
      {/* No second download: the file went to this browser and no copy exists
          to fetch again (dl-53). Downloading again is a new analysis. */}
      <p className="muted result__expiry">Saved by your browser. The server kept no copy.</p>
    </div>
  );
}
