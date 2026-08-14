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
import { applyJobEvent, isTerminal, reconcileJob, upsertJob } from "../lib/job-reducer.ts";
import { createJobStream } from "../lib/job-stream.ts";
import type { JobStream, StreamState } from "../lib/job-stream.ts";
import { getBrowserStorage, loadJobs, saveJobs, sortJobs } from "../lib/job-store.ts";

export interface UseJobs {
  jobs: Job[];
  streamStates: Record<string, StreamState>;
  start(url: string, options: JobOptions): Promise<Job>;
  cancel(id: string): Promise<void>;
  remove(id: string): void;
  clearFinished(): void;
}

export function useJobs(api: ApiClient): UseJobs {
  const storage = useMemo(() => getBrowserStorage(), []);
  const [jobs, setJobs] = useState<Job[]>(() => loadJobs(storage));
  const [streamStates, setStreamStates] = useState<Record<string, StreamState>>({});
  const streams = useRef(new Map<string, JobStream>());
  const jobsRef = useRef(jobs);

  jobsRef.current = jobs;

  useEffect(() => {
    saveJobs(storage, jobs);
  }, [jobs, storage]);

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
    setJobs((previous) =>
      previous.map((job) => (job.id === jobId ? applyJobEvent(job, event) : job)),
    );
  }, []);

  const attach = useCallback(
    (jobId: string) => {
      if (streams.current.has(jobId)) return;
      const stream = createJobStream({
        jobId,
        open: (id, handlers) => api.openJobEvents(id, handlers),
        refetch: async (id) => (await api.getJob(id)).job,
        onEvent: (event) => applyEvent(jobId, event),
        onReconciled: mergeJob,
        onReconcileError: (error) => failLocally(jobId, AppError.from(error).toPayload()),
        onStateChange: (state) => setStreamStates((previous) => ({ ...previous, [jobId]: state })),
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
    async (url: string, options: JobOptions): Promise<Job> => {
      const { job } = await api.createJob({ url, options });
      setJobs((previous) => sortJobs(upsertJob(previous, job)));
      attach(job.id);
      return job;
    },
    [api, attach],
  );

  const cancel = useCallback(
    async (id: string): Promise<void> => {
      try {
        const { job } = await api.cancelJob(id);
        mergeJob(job);
      } catch (error) {
        failLocally(id, AppError.from(error).toPayload());
      } finally {
        detach(id);
      }
    },
    [api, detach, failLocally, mergeJob],
  );

  const remove = useCallback(
    (id: string) => {
      detach(id);
      setJobs((previous) => previous.filter((job) => job.id !== id));
    },
    [detach],
  );

  const clearFinished = useCallback(() => {
    setJobs((previous) => {
      for (const job of previous) {
        if (TERMINAL_STATUSES.has(job.status)) {
          streams.current.get(job.id)?.stop();
          streams.current.delete(job.id);
        }
      }
      return previous.filter((job) => !TERMINAL_STATUSES.has(job.status));
    });
  }, []);

  return { jobs, streamStates, start, cancel, remove, clearFinished };
}
