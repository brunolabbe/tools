/**
 * The boxes on the page, one per analysis, and the queue in front of the
 * server's two per-client caps (dl-133).
 *
 * Each box owns what `App` used to own once for the whole page: its own probe
 * id, its own stage channel, its own token against a late answer. A box made
 * with both probe slots taken waits here, with no request sent, and a Download
 * pressed with both job slots taken waits the same way; the layout effect below
 * starts each as soon as a slot frees. The counts come from the boxes and the
 * jobs this page holds, never from a guess at the server's state — and the
 * server stays the authority: what it refuses anyway lands in the box.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AppError } from "@downloader/contract";
import type { Job, JobOptions } from "@downloader/contract";
import type { ApiClient } from "../api/types.ts";
import { analysesToStart, displayBoxes, downloadsToStart } from "../lib/boxes.ts";
import type { Box } from "../lib/boxes.ts";
import type { EventStream } from "../lib/event-stream.ts";
import { mintProbeId } from "../lib/probe-id.ts";
import type { UseJobs } from "./useJobs.ts";

export interface UseBoxes {
  /** What the page shows, in order: see `displayBoxes`. */
  boxes: Box[];
  /** The job just started from a box on this page, whose box is brought into view. */
  revealId: string | null;
  /** A new box at the top, for an address the caller has already validated. */
  analyse(url: string): void;
  /** Analyses the box's address again, in the same box. */
  reanalyse(id: string): void;
  /** Closes a box that is waiting, analysing, failed or analysed. */
  close(id: string): void;
  /** Download pressed in an analysed box: starts its job, or waits for a slot. */
  download(id: string, options: JobOptions): void;
  /** A waiting Download put back: the box returns to its options, as chosen (owner, 2026-11-10). */
  stopWaitingDownload(id: string): void;
  /** Puts away the reason the box's last Download press failed. */
  clearStartError(id: string): void;
  /** A failed job's "Analyse and retry": the box becomes an analysis again. */
  retryJob(id: string, job: Job): void;
  /** Dismisses a box in the job state, and its job with it. */
  dismissJob(id: string, jobId: string): void;
}

export function useBoxes(api: ApiClient, jobs: UseJobs): UseBoxes {
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [revealId, setRevealId] = useState<string | null>(null);
  /** Box ids, waiting order and probe tokens all come off this one counter. */
  const counter = useRef(0);
  // Per box: a box's late answer must not reach another box, nor a box closed
  // or re-analysed since (dl-133 Build 1). Deleted when the wait is abandoned.
  const tokens = useRef(new Map<string, number>());
  /** Each box's stage channel while it analyses, so closing the box closes it. */
  const streams = useRef(new Map<string, EventStream>());
  /** The token of each box's POST while it is out, by box id. */
  const posts = useRef(new Map<string, number>());
  /** Tokens of POSTs still out whose box was closed or re-analysed. */
  const orphans = useRef(new Set<number>());
  /**
   * How many of those there are, and so how many server slots this page still
   * holds with no box to show for them (dl-133 gate 1, F1). The server's
   * per-client gate is held until the POST's handler ends, and the page never
   * aborts the POST: freed on the close itself, the slot started a waiting box
   * straight into a `RATE_LIMITED` refusal. The owner chose this count over an
   * abort signal on `ApiClient.probe` (2026-11-10).
   */
  const [unsettled, setUnsettled] = useState(0);

  const next = useCallback(() => {
    counter.current += 1;
    return counter.current;
  }, []);

  const update = useCallback((id: string, change: (box: Box) => Box) => {
    setBoxes((previous) => previous.map((box) => (box.id === id ? change(box) : box)));
  }, []);

  /** Abandons whatever the box's analysis is still waiting on. */
  const abandon = useCallback((id: string) => {
    tokens.current.delete(id);
    streams.current.get(id)?.close();
    streams.current.delete(id);
    // Its POST still holds a server slot until it settles; it is counted, with
    // no box, until then.
    const out = posts.current.get(id);
    if (out !== undefined) {
      posts.current.delete(id);
      orphans.current.add(out);
      setUnsettled((count) => count + 1);
    }
  }, []);

  const startAnalysis = useCallback(
    async (id: string, url: string) => {
      const token = next();
      tokens.current.set(id, token);
      const current = (): boolean => tokens.current.get(id) === token;
      update(id, () => ({ id, kind: "analysing", url, startedAt: Date.now(), stage: null }));

      // dl-43. Opened before the POST and named by this client, because the
      // request that starts the probe is also the first thing that can produce
      // a stage — there is no moment later at which subscribing would still
      // catch the beginning.
      streams.current.get(id)?.close();
      const probeId = mintProbeId();
      const stream = api.openProbeEvents(probeId, {
        onOpen: () => {},
        onEvent: (event) => {
          if (!current() || event.type !== "stage") return;
          // Only while analysing: a frame that arrives after the answer has no
          // line to reach, and must not resurrect one.
          update(id, (box) =>
            box.kind === "analysing"
              ? { ...box, stage: { stage: event.stage, resolver: event.resolver } }
              : box,
          );
        },
        // Narration is decoration over a request that is still in flight. Losing
        // it leaves the box on its last honest line and changes nothing else.
        onError: () => {},
      });
      streams.current.set(id, stream);

      posts.current.set(id, token);
      try {
        const response = await api.probe({ url, probeId });
        if (!current()) return;
        update(id, () => ({
          id,
          kind: "probed",
          url,
          probe: response.probe,
          cached: response.cached,
          download: { kind: "choosing", error: null },
        }));
      } catch (error) {
        if (!current()) return;
        update(id, () => ({ id, kind: "failed", url, error: AppError.from(error).toPayload() }));
      } finally {
        stream.close();
        if (streams.current.get(id) === stream) streams.current.delete(id);
        if (posts.current.get(id) === token) posts.current.delete(id);
        // The server has let go of the slot an abandoned box was still holding.
        if (orphans.current.delete(token)) setUnsettled((count) => count - 1);
      }
    },
    [api, next, update],
  );

  const { start } = jobs;
  const startDownload = useCallback(
    async (
      id: string,
      url: string,
      options: JobOptions,
      title: string,
      previewPath: string | null,
    ) => {
      update(id, (box) =>
        box.kind === "probed" ? { ...box, download: { kind: "starting" } } : box,
      );
      try {
        const job = await start(url, options, title);
        update(id, (box) =>
          box.kind === "probed" ? { id, kind: "job", url, jobId: job.id, previewPath } : box,
        );
        setRevealId(job.id);
      } catch (error) {
        const payload = AppError.from(error).toPayload();
        update(id, (box) =>
          box.kind === "probed" ? { ...box, download: { kind: "choosing", error: payload } } : box,
        );
      }
    },
    [start, update],
  );

  // The queue. A layout effect, so a box made while a slot is free goes from
  // waiting to analysing before it is painted — it never flashes "Waiting" —
  // and so does a Download pressed with a job slot free. It runs on every
  // change to the boxes or the jobs, which is when a slot can free: an answer,
  // a closed box, a job that ends. Each start changes the boxes it counted, so
  // the next run sees the slot taken.
  //
  // The rule against setting state in an effect is told why it does not apply:
  // each start is a request to the server, which is the external system an
  // effect is for, and the state it sets is the record that the request went
  // out. Nothing here can be derived during render, because a job slot frees
  // on a frame from the job's own stream, which no event handler of this hook
  // sees.
  useLayoutEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    for (const box of analysesToStart(boxes, unsettled)) void startAnalysis(box.id, box.url);
    for (const box of downloadsToStart(boxes, jobs.jobs)) {
      void startDownload(
        box.id,
        box.url,
        box.download.options,
        box.probe.title,
        box.probe.thumbnailPath ?? null,
      );
    }
  }, [boxes, jobs.jobs, unsettled, startAnalysis, startDownload]);

  // A box's channel is closed with the box; these are the boxes still open
  // when the page goes.
  useEffect(() => {
    const open = streams.current;
    return () => {
      for (const stream of open.values()) stream.close();
      open.clear();
    };
  }, []);

  /** A box with nothing sent for it yet; the queue starts it when a slot is free. */
  const waiting = useCallback(
    (id: string, url: string): Box => ({
      id,
      kind: "waiting",
      url,
      order: next(),
      since: Date.now(),
    }),
    [next],
  );

  const analyse = useCallback(
    (url: string) => {
      const box = waiting(`box-${String(next())}`, url);
      // Directly under the address field, older boxes moving down (decision 4).
      setBoxes((previous) => [box, ...previous]);
    },
    [next, waiting],
  );

  const reanalyse = useCallback(
    (id: string) => {
      abandon(id);
      const box = boxes.find((candidate) => candidate.id === id);
      if (box === undefined) return;
      const fresh = waiting(id, box.url);
      update(id, () => fresh);
    },
    [abandon, boxes, update, waiting],
  );

  const close = useCallback(
    (id: string) => {
      abandon(id);
      setBoxes((previous) => previous.filter((box) => box.id !== id));
    },
    [abandon],
  );

  const download = useCallback(
    (id: string, options: JobOptions) => {
      const order = next();
      update(id, (box) =>
        box.kind === "probed" ? { ...box, download: { kind: "waiting", options, order } } : box,
      );
    },
    [next, update],
  );

  const clearStartError = useCallback(
    (id: string) => {
      update(id, (box) =>
        box.kind === "probed" ? { ...box, download: { kind: "choosing", error: null } } : box,
      );
    },
    [update],
  );

  const stopWaitingDownload = useCallback(
    (id: string) => {
      // Only a Download still waiting: one that has started is the job's now.
      update(id, (box) =>
        box.kind === "probed" && box.download.kind === "waiting"
          ? { ...box, download: { kind: "choosing", error: null } }
          : box,
      );
    },
    [update],
  );

  const { remove } = jobs;

  const retryJob = useCallback(
    (id: string, job: Job) => {
      remove(job.id);
      const owned = boxes.some((box) => box.id === id);
      if (owned) {
        const fresh = waiting(id, job.sourceUrl);
        update(id, () => fresh);
        return;
      }
      // A box restored on a reload is not one of this page's: the retry is,
      // so it goes to the top with the rest of them.
      const box = waiting(`box-${String(next())}`, job.sourceUrl);
      setBoxes((previous) => [box, ...previous]);
    },
    [boxes, next, remove, update, waiting],
  );

  const dismissJob = useCallback(
    (id: string, jobId: string) => {
      remove(jobId);
      setBoxes((previous) => previous.filter((box) => box.id !== id));
    },
    [remove],
  );

  const shown = useMemo(() => displayBoxes(boxes, jobs.jobs), [boxes, jobs.jobs]);

  return {
    boxes: shown,
    revealId,
    analyse,
    reanalyse,
    close,
    download,
    clearStartError,
    stopWaitingDownload,
    retryJob,
    dismissJob,
  };
}
