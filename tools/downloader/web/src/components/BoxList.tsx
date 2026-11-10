import type { AppErrorPayload, Job, JobOptions, ProbeStageEvent } from "@downloader/contract";
import type { Box } from "../lib/boxes.ts";
import type { StreamState } from "../lib/job-stream.ts";
import { AnalysingPanel } from "./AnalysingPanel.tsx";
import { ErrorPanel } from "./ErrorPanel.tsx";
import { JobCard } from "./JobCard.tsx";
import { ProbePanel } from "./ProbePanel.tsx";

export interface BoxListProps {
  boxes: readonly Box[];
  jobs: readonly Job[];
  /** The page title each job was started from, by job id — see `useJobs`. */
  titles: Record<string, string>;
  streamStates: Record<string, StreamState>;
  /** Why each job's link was last refused, by job id — see `useJobs`. */
  refusals: Record<string, AppErrorPayload>;
  /** The latest stage of each job's re-probe, by job id — see `useJobs`. */
  stages: Record<string, ProbeStageEvent>;
  /** The job just started from this page, whose box is brought into view. */
  revealId: string | null;
  onClose: (boxId: string) => void;
  onReanalyse: (boxId: string) => void;
  onDownload: (boxId: string, options: JobOptions) => void;
  onClearStartError: (boxId: string) => void;
  /** A waiting Download put back: the box returns to its options, as chosen. */
  onStopWaitingDownload: (boxId: string) => void;
  onFollowLink: (jobId: string) => void;
  onCancel: (jobId: string) => void;
  onDismissJob: (boxId: string, jobId: string) => void;
  onRetryJob: (boxId: string, job: Job) => void;
}

/**
 * One box per analysis, from the paste to the saved file (dl-133), newest
 * first, directly under the address field. There is no "Clear finished": every
 * box is closed from itself, a saved one included.
 */
export function BoxList(props: BoxListProps): React.JSX.Element | null {
  const { boxes, jobs } = props;
  if (boxes.length === 0) return null;

  // Only once bytes flow. Before the first response header the browser holds
  // a request, not a download, and Firefox cancels it with the tab (measured by
  // dl-109's gate); a queued link has not even been opened.
  const live = jobs.some((job) => job.status === "downloading");

  return (
    <div className="boxes">
      {/* Named so a box can be found as one of this list's own items: a box
          nests lists of its own — the renditions, the progress messages. */}
      <ul className="boxes__list" aria-label="Analyses">
        {boxes.map((box) => (
          <li key={box.id} className="box card">
            <BoxBody box={box} {...props} />
          </li>
        ))}
      </ul>
      {/* True because the transfer is the browser's own connection: closing the
          page drops only its event stream (`routes/events.ts`), and only the
          file connection closing cancels the job (`routes/files.ts`). */}
      {live && (
        <p className="muted boxes__note">
          You can close this page — downloads continue in your browser. To stop one, press Stop here
          or cancel it in your browser's downloads.
        </p>
      )}
    </div>
  );
}

function BoxBody({ box, ...props }: BoxListProps & { box: Box }): React.JSX.Element | null {
  switch (box.kind) {
    case "waiting":
      return (
        <AnalysingPanel
          url={box.url}
          startedAt={box.since}
          stage={null}
          waiting
          onCancel={() => props.onClose(box.id)}
        />
      );
    case "analysing":
      return (
        <AnalysingPanel
          url={box.url}
          startedAt={box.startedAt}
          stage={box.stage}
          onCancel={() => props.onClose(box.id)}
        />
      );
    case "failed":
      // The address, because with several boxes on the page an error alone
      // does not say which page it is about.
      return (
        <>
          <p className="muted url-echo">{box.url}</p>
          <ErrorPanel
            error={box.error}
            onRetry={() => props.onReanalyse(box.id)}
            onDismiss={() => props.onClose(box.id)}
            retryLabel="Analyse again"
          />
        </>
      );
    case "probed": {
      const { download } = box;
      // One panel through the wait: a waiting Download sets the table and the
      // options aside rather than unmounting the panel that holds the choice,
      // so Stop waiting brings them back as chosen.
      return (
        <>
          <ProbePanel
            probe={box.probe}
            cached={box.cached}
            busy={download.kind === "starting"}
            waiting={download.kind === "waiting"}
            onDownload={(options) => props.onDownload(box.id, options)}
            onReanalyse={() => props.onReanalyse(box.id)}
            onDismiss={() => props.onClose(box.id)}
            onStopWaiting={() => props.onStopWaitingDownload(box.id)}
          />
          {download.kind === "choosing" && download.error && (
            <ErrorPanel error={download.error} onDismiss={() => props.onClearStartError(box.id)} />
          )}
        </>
      );
    }
    case "job": {
      const job = props.jobs.find((candidate) => candidate.id === box.jobId);
      if (job === undefined) return null;
      return (
        <JobCard
          job={job}
          title={props.titles[job.id]}
          streamState={props.streamStates[job.id]}
          refusal={props.refusals[job.id]}
          stage={props.stages[job.id]}
          previewPath={box.previewPath}
          reveal={job.id === props.revealId}
          onFollowLink={props.onFollowLink}
          onCancel={props.onCancel}
          onRemove={(jobId) => props.onDismissJob(box.id, jobId)}
          onRetry={(failed) => props.onRetryJob(box.id, failed)}
        />
      );
    }
  }
}
