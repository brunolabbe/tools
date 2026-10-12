/**
 * Owns the job list: persistence, live event streams, and reconciliation.
 *
 * Restoring from `localStorage` is not enough on its own — a restored job's
 * state is as old as the last frame the previous page load happened to see, so
 * every non-terminal job is re-fetched before its stream is attached.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppError, TERMINAL_STATUSES } from "@downloader/contract";
import type { AppErrorPayload, Job, JobEvent, JobOptions } from "@downloader/contract";
import type { ApiClient } from "../api/types.ts";
import {
  applyJobEvent,
  isTerminal,
  reconcileJob,
  refusalAfter,
  upsertJob,
} from "../lib/job-reducer.ts";
import { createJobStream } from "../lib/job-stream.ts";
import type { JobStream, StreamState } from "../lib/job-stream.ts";
import {
  getBrowserStorage,
  loadJobs,
  loadTitles,
  saveJobs,
  saveTitles,
  sortJobs,
} from "../lib/job-store.ts";

export interface UseJobs {
  jobs: Job[];
  streamStates: Record<string, StreamState>;
  /**
   * Why the server refused to start a job when its link was opened (dl-77), by
   * job id, while that is still the latest thing that happened to it. Kept beside
   * the jobs because it is a moment and `Job` is persisted; it is not saved, so
   * a reload forgets it, which is right: the job is still queued and the link
   * still works.
   */
  refusals: Record<string, AppErrorPayload>;
  /** The visitor followed the link again: whatever it was refused for before is old news. */
  clearRefusal(id: string): void;
  /** The page title each job was started from, by job id — see `loadTitles`. */
  titles: Record<string, string>;
  /**
   * Creates the job and opens its single-use link, which is what starts the
   * work (dl-53) — so one press both makes the job and fetches the file.
   */
  start(url: string, options: JobOptions, title?: string): Promise<Job>;
  cancel(id: string): Promise<void>;
  /** Dismisses one job — the way a failed or canceled card leaves the list. */
  remove(id: string): void;
  /**
   * Drops every completed job (dl-109). A saved card is a confirmation, not a
   * record: it stays while the visitor is still looking at it and goes when
   * they start on the next page. Failed and canceled jobs stay until dismissed.
   */
  clearSaved(): void;
}

export function useJobs(api: ApiClient): UseJobs {
  const storage = useMemo(() => getBrowserStorage(), []);
  const [jobs, setJobs] = useState<Job[]>(() => loadJobs(storage));
  const [streamStates, setStreamStates] = useState<Record<string, StreamState>>({});
  const [refusals, setRefusals] = useState<Record<string, AppErrorPayload>>({});
  const [titles, setTitles] = useState<Record<string, string>>(() => loadTitles(storage));
  const streams = useRef(new Map<string, JobStream>());
  const jobsRef = useRef(jobs);

  jobsRef.current = jobs;

  useEffect(() => {
    saveJobs(storage, jobs);
    saveTitles(storage, titles, jobs);
  }, [jobs, titles, storage]);

  const mergeJob = useCallback((remote: Job) => {
    setJobs((previous) => {
      const local = previous.find((candidate) => candidate.id === remote.id);
      return sortJobs(upsertJob(previous, reconcileJob(local, remote)));
    });
  }, []);

  const failLocally = useCallback((jobId: string, error: AppErrorPayload) => {
    setJobs((previous) =>
      previous.map((job) => {
        if (job.id !== jobId || TERMINAL_STATUSES.has(job.status)) return job;
        const at = new Date().toISOString();
        return { ...job, status: "failed", error, updatedAt: at, finishedAt: at };
      }),
    );
  }, []);

  const applyEvent = useCallback((jobId: string, event: JobEvent) => {
    if (event.type === "refused") {
      // `jobsRef` is assigned during render, so this is the same job the
      // updater below is about to fold the event onto — and reading it here
      // rather than inside the updater keeps that updater pure.
      const before = jobsRef.current.find((job) => job.id === jobId);
      setRefusals((previous) => {
        const next = refusalAfter(previous[jobId], before, event);
        return next === undefined || next === previous[jobId]
          ? previous
          : { ...previous, [jobId]: next };
      });
    }
    setJobs((previous) =>
      previous.map((job) => (job.id === jobId ? applyJobEvent(job, event) : job)),
    );
  }, []);

  const attach = useCallback(
    (jobId: string, onListening?: () => void) => {
      if (streams.current.has(jobId)) return;
      let listening = false;
      const stream = createJobStream({
        jobId,
        open: (id, handlers) => api.openJobEvents(id, handlers),
        refetch: async (id) => (await api.getJob(id)).job,
        onEvent: (event) => applyEvent(jobId, event),
        onReconciled: mergeJob,
        onReconcileError: (error) => failLocally(jobId, AppError.from(error).toPayload()),
        onStateChange: (state) => {
          setStreamStates((previous) => ({ ...previous, [jobId]: state }));
          // `reconnecting` too: a stream that cannot connect must not hold the
          // download back, it only costs the card the refusal's reason.
          // `closed` is not, because that is a job removed before it started.
          if (!listening && (state === "open" || state === "reconnecting")) {
            listening = true;
            onListening?.();
          }
        },
      });
      streams.current.set(jobId, stream);
      stream.start();
    },
    [api, applyEvent, failLocally, mergeJob],
  );

  const detach = useCallback((jobId: string) => {
    streams.current.get(jobId)?.stop();
    streams.current.delete(jobId);
  }, []);

  // Restore: reconcile every unfinished job with the server, then follow it.
  useEffect(() => {
    let disposed = false;
    const open = streams.current;

    async function restore(jobId: string): Promise<void> {
      try {
        const { job } = await api.getJob(jobId);
        if (disposed) return;
        mergeJob(job);
        if (!isTerminal(job)) attach(jobId);
      } catch (error) {
        if (disposed) return;
        failLocally(jobId, AppError.from(error).toPayload());
      }
    }

    for (const job of jobsRef.current) {
      if (!isTerminal(job)) void restore(job.id);
    }
    return () => {
      disposed = true;
      for (const stream of open.values()) stream.stop();
      open.clear();
    };
  }, [api, attach, failLocally, mergeJob]);

  const start = useCallback(
    async (url: string, options: JobOptions, title?: string): Promise<Job> => {
      const { job } = await api.createJob({ url, options });
      if (title) setTitles((previous) => ({ ...previous, [job.id]: title }));
      setJobs((previous) => sortJobs(upsertJob(previous, job)));
      // Not until the job's stream is listening: the server keeps no replay
      // log, so a link refused before then would lose its reason (dl-77) and
      // leave the card saying the download is starting. The card keeps
      // offering the link for a browser that did not let this one through.
      const { link } = job;
      attach(job.id, link ? () => api.openLink(link.url) : undefined);
      return job;
    },
    [api, attach],
  );

  const cancel = useCallback(
    async (id: string): Promise<void> => {
      try {
        const { job } = await api.cancelJob(id);
        mergeJob(job);
        // The route answers before the abort unwinds, so a job canceled
        // mid-probe comes back still running; its `canceled` frame arrives on
        // the stream, which must still be open to deliver it.
        if (!isTerminal(job)) return;
      } catch {
        // A cancel request that failed says nothing about the job: it is most
        // likely still running on the server. Marking the card failed and
        // dropping its stream hid a live download holding the client's slot
        // (dl-65), so ask the server instead and keep following the job.
        try {
          const { job } = await api.getJob(id);
          mergeJob(job);
          if (!isTerminal(job)) return;
        } catch (error) {
          failLocally(id, AppError.from(error).toPayload());
        }
      }
      detach(id);
    },
    [api, detach, failLocally, mergeJob],
  );

  const clearRefusal = useCallback((id: string) => {
    setRefusals((previous) => {
      if (!(id in previous)) return previous;
      const { [id]: _gone, ...rest } = previous;
      return rest;
    });
  }, []);

  const remove = useCallback(
    (id: string) => {
      detach(id);
      setJobs((previous) => previous.filter((job) => job.id !== id));
    },
    [detach],
  );

  const clearSaved = useCallback(() => {
    // The streams are stopped here rather than inside the updater, which must
    // stay pure; `jobsRef` is the list this render saw.
    for (const job of jobsRef.current) {
      if (job.status === "completed") detach(job.id);
    }
    setJobs((previous) => previous.filter((job) => job.status !== "completed"));
  }, [detach]);

  return {
    jobs,
    streamStates,
    refusals,
    clearRefusal,
    titles,
    start,
    cancel,
    remove,
    clearSaved,
  };
}
