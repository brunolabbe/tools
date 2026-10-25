import { useEffect, useRef, useState } from "react";
import type { AppErrorPayload, Job, JobStatus, ProbeStageEvent } from "@downloader/contract";
import { useElapsed } from "../hooks/useElapsed.ts";
import { useNow } from "../hooks/useNow.ts";
import { localErrorPayload } from "../lib/error-presentation.ts";
import {
  formatBytes,
  formatDuration,
  formatEta,
  formatExpiry,
  formatSpeed,
} from "../lib/format.ts";
import type { StreamState } from "../lib/job-stream.ts";
import { PROBE_STAGE_PENDING, probeStageText } from "../lib/probe-stages.ts";
import { STATUS_HINT, STATUS_LABEL } from "../lib/status.ts";
import { ErrorPanel } from "./ErrorPanel.tsx";
import { ProgressMessages } from "./ProgressMessages.tsx";
import type { ProgressMessage } from "./ProgressMessages.tsx";
import { Preview } from "./Preview.tsx";
import { ProgressBar } from "./ProgressBar.tsx";

interface JobCardProps {
  job: Job;
  /**
   * The page title the job was started from, or `undefined` for a job started
   * before dl-109 or restored without one. The job record has no title of its
   * own — see `loadTitles`.
   */
  title: string | undefined;
  streamState: StreamState | undefined;
  /**
   * Why the server last refused to start this job when its link was opened
   * (dl-77), or `undefined`. The browser reports that as a failed file and the
   * page cannot see it, so this comes from the job's event stream.
   */
  refusal: AppErrorPayload | undefined;
  /**
   * The latest stage the re-probe reported (dl-110), or `undefined` before the
   * first. Read only while the job is `probing`.
   */
  stage: ProbeStageEvent | undefined;
  /**
   * The job the visitor has just started from this page, so its card is
   * scrolled into view once: it lands under the panel they pressed Download in,
   * which can be below the fold. Never a job restored on a reload.
   */
  reveal?: boolean;
  /** The visitor followed the link, which makes any earlier refusal old news. */
  onFollowLink: (id: string) => void;
  onCancel: (id: string) => void;
  onRemove: (id: string) => void;
  onRetry: (job: Job) => void;
}

export function JobCard({
  job,
  title,
  streamState,
  refusal,
  stage,
  reveal = false,
  onFollowLink,
  onCancel,
  onRemove,
  onRetry,
}: JobCardProps): React.JSX.Element {
  const now = useNow(15_000);
  const waitedMs = useElapsed(useStepStartedAt(job.status), 1_000);
  const item = useRef<HTMLLIElement>(null);

  // `nearest`, so a card already on screen does not move; guarded because
  // jsdom has no layout and so no `scrollIntoView`.
  useEffect(() => {
    if (reveal) item.current?.scrollIntoView?.({ block: "nearest" });
  }, [reveal]);

  // dl-109: a saved job is a one-line confirmation, not a card. Nothing on it
  // can be acted on — the server kept no copy (dl-53) — and it leaves the list
  // when the next analysis starts.
  if (job.status === "completed" && job.result) {
    return (
      <li ref={item} className="job job--completed job--saved">
        <CompletedResult result={job.result} title={title} thumbnailPath={job.thumbnailPath} />
      </li>
    );
  }

  const active = job.status !== "completed" && job.status !== "failed" && job.status !== "canceled";
  const { progress } = job;
  // No filename branch: a job only has a result once completed, and a
  // completed job is the one-line saved row above, which names its file.
  const heading = title ?? job.variant?.label ?? job.sourceUrl;
  // Neither part repeats the heading: a card titled by its rendition or by its
  // address does not say it twice.
  const subtitle = [
    heading === job.variant?.label ? null : job.variant?.label,
    heading === job.sourceUrl ? null : hostOf(job.sourceUrl),
  ]
    .filter((part): part is string => typeof part === "string" && part !== "")
    .join(" · ");

  return (
    <li ref={item} className={`job job--${job.status}`}>
      <div className="job__head">
        {/* Same grouping reason as `card__headline`: `job__head` is
            `space-between`, and this must be additive — a job from before dl-29,
            or one whose probe found no image, renders exactly as it did. */}
        <div className="job__headline">
          <Preview path={job.thumbnailPath} size="card" />
          <div className="job__titles">
            <h3 className="job__title">{heading}</h3>
            <p className="muted job__subtitle" title={job.sourceUrl}>
              {subtitle}
            </p>
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

      {/* No step list (dl-109): the bar and the line under it are the
          progression. The bar is indeterminate until bytes flow, so the
          `downloading → probing` back-edge reads as the bar going indeterminate
          again rather than as a step walked backwards. */}
      {active && (
        <>
          {/* In the same place from the first frame, so nothing moves when bytes
              start to flow; while preparing it reads "0 B of ~430 MB" and the
              bar stays indeterminate, with no percent until there is one. */}
          <div className="job__meter">
            <span className="job__figure">
              {formatBytes(progress.downloadedBytes)}{" "}
              {/* An expectation, not a measurement (dl-96), so it says so. */}
              <span className="muted">
                {progress.totalBytes !== null
                  ? `of ~${formatBytes(progress.totalBytes)}`
                  : "· total not known yet"}
              </span>
            </span>
            {job.status === "downloading" && progress.percent !== null && (
              <span className="muted job__percent">{Math.round(progress.percent)}%</span>
            )}
          </div>
          <ProgressBar
            percent={job.status === "downloading" ? progress.percent : null}
            label={STATUS_LABEL[job.status]}
            {...(progress.speedBps !== null ? { valueText: formatSpeed(progress.speedBps) } : {})}
          />
          {/* Directly under the bar (dl-109). The connection count (dl-108) is
              one more message here. */}
          <ProgressMessages
            messages={progressMessages(job.status, stage, progress.originConnections)}
          />

          <Stats status={job.status} progress={progress} waitedMs={waitedMs} />
        </>
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
        {active ? (
          <button type="button" className="button" onClick={() => onCancel(job.id)}>
            Stop
          </button>
        ) : (
          <button type="button" className="button" onClick={() => onRemove(job.id)}>
            Dismiss
          </button>
        )}
      </div>
    </li>
  );
}

/**
 * Only what is known (dl-109). An unknown value used to render as "—" in a
 * fixed grid of five, which on most jobs was a row of dashes; it is left out
 * instead. The downloaded figure is not here — it heads the bar, in every
 * active state.
 */
function Stats({
  status,
  progress,
  waitedMs,
}: {
  status: JobStatus;
  progress: Job["progress"];
  waitedMs: number;
}): React.JSX.Element | null {
  // Each stat owns a column, so cards line up down the list and an unknown
  // value leaves its cell empty rather than letting the next one slide over.
  const rows: { term: string; value: string; column: 1 | 2 | 3 }[] = [];
  if (status === "queued" || status === "probing") {
    rows.push({ term: "Waiting", value: `${Math.floor(waitedMs / 1000)} s`, column: 1 });
  } else {
    // A time first in both states — how long it has waited, how long is left —
    // so the eye finds it in the same place when the job starts to move.
    if (progress.etaSec !== null)
      rows.push({ term: "Remaining", value: formatEta(progress.etaSec), column: 1 });
    if (progress.speedBps !== null)
      rows.push({ term: "Speed", value: formatSpeed(progress.speedBps), column: 2 });
    if (progress.segmentsDone !== null) {
      rows.push({
        term: "Segments",
        value: `${progress.segmentsDone}${progress.segmentsTotal === null ? "" : ` / ${progress.segmentsTotal}`}`,
        column: 3,
      });
    }
  }
  if (rows.length === 0) return null;
  return (
    <dl className="stats">
      {rows.map((row) => (
        <div key={row.term} className={`stats__col-${row.column}`}>
          <dt>{row.term}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The status line first, then whatever explains it. While re-analysing, the
 * re-probe's latest stage is the line (dl-110), worded as the analysing panel
 * words it, and the pending line until the first stage lands.
 */
function progressMessages(
  status: JobStatus,
  stage: ProbeStageEvent | undefined,
  originConnections: number | null,
): ProgressMessage[] {
  const messages: ProgressMessage[] = [
    status === "probing"
      ? { key: "stage", text: stage === undefined ? PROBE_STAGE_PENDING : probeStageText(stage) }
      : { key: "status", text: STATUS_HINT[status] },
  ];
  // Only a split is worth saying: "1 connection" on every job would be noise,
  // and `null` is "not measured", which is not a count to show.
  if (status === "downloading" && originConnections !== null && originConnections >= 2) {
    messages.push({
      key: "connections",
      text: `Reading on ${originConnections} connections. This source throttles each one.`,
    });
  }
  return messages;
}

/**
 * When this card first saw the job in its current status, while it is
 * preparing; `null` otherwise. Measured here rather than read off the record:
 * `updatedAt` moves on every progress frame, and `createdAt` says nothing about
 * a re-probe on the back-edge. It is how long the visitor has watched this
 * step, which is a fact — the same honesty `AnalysingPanel`'s clock relies on.
 */
function useStepStartedAt(status: JobStatus): number | null {
  const [mark, setMark] = useState(() => ({ status, at: Date.now() }));
  // Derived state, set during render: React re-renders at once with the new
  // mark, before anything is painted with the old one.
  if (mark.status !== status) setMark({ status, at: Date.now() });
  return status === "queued" || status === "probing" ? mark.at : null;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * The job's single-use link (dl-53), offered in case the browser blocked the
 * one the page opened on the visitor's behalf (#433). Following it is what
 * starts the work: the file streams to this browser as it is produced, and the
 * card follows the progress over the event stream meanwhile.
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
    <div className="offer">
      <div className="offer__text">
        <p className="offer__title">Nothing in your browser's downloads?</p>
        <p className="muted offer__detail">
          Some browsers block a download the page starts on its own. Open it yourself — the link
          works once · {expiry.label}.
        </p>
      </div>
      <a className="button button--primary" href={link.url} download onClick={onFollow}>
        Download
      </a>
    </div>
  );
}

/**
 * What the saved line names. The file's own name when the server still has it;
 * the page title this browser kept when it does not, because the server blanks a
 * finished job's filename fifteen minutes after it ends (dl-107) and a tab that
 * was closed before the `completed` event never held it; and neither, with no
 * dash left dangling, when this browser holds no title either.
 */
function savedLabel(filename: string, title: string | undefined): string {
  const name = filename !== "" ? filename : (title ?? "");
  return name.trim() === "" ? "Saved by your browser" : `Saved by your browser — ${name}`;
}

function CompletedResult({
  result,
  title,
  thumbnailPath,
}: {
  result: NonNullable<Job["result"]>;
  /** The page title this browser kept for the job; see `savedLabel`. */
  title: string | undefined;
  /** Required, not optional — `undefined` is a job recorded before dl-29. */
  thumbnailPath: string | null | undefined;
}): React.JSX.Element {
  return (
    <output className="result">
      {/* Grouped with the meta rather than added as a bare child of `.result`,
          which is `space-between`. Same reason as `card__headline` and
          `job__headline`. `result__headline` collapses to just the meta when
          `Preview` renders null. */}
      <div className="result__headline">
        <Preview path={thumbnailPath} size="card" />
        <div className="result__meta">
          <p className="result__filename">{savedLabel(result.filename, title)}</p>
          {/* No second download: the file went to this browser and no copy
              exists to fetch again (dl-53). Downloading again is a new analysis. */}
          <p className="muted">
            {formatBytes(result.sizeBytes)} · {result.container.toUpperCase()}
            {result.durationSec !== null ? ` · ${formatDuration(result.durationSec)}` : ""} · the
            server kept no copy
          </p>
        </div>
      </div>
      <span className="pill pill--completed">{STATUS_LABEL.completed}</span>
    </output>
  );
}
