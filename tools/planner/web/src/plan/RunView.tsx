/**
 * Watching a plan being drafted.
 *
 * **"4 of 7 specialists done", not a spinner.** The roster's size is decided
 * before the first request goes out, so the total is genuinely knowable and the
 * repo's rule says to report it. It is also the reason the bar below has no
 * `value` until the roster arrives: between `queued` and the first frame the
 * total really is unknown, and an indeterminate bar is the honest render of
 * that — a percentage there would be invented.
 *
 * Nothing here reports progress *inside* one specialist. A model call has no
 * progress in it, and a bar that crept along while one ran would be the most
 * tempting place in this UI to fake it.
 *
 * The finished plan is deliberately barely rendered. [pl-10] owns the plan view,
 * its provenance and its diff; what this shows is the run's own outcome — it is
 * done, this is how many days it made, and here is what it could not cover.
 */

import { useEffect, useMemo, useState } from "react";
import {
  AppError,
  latestRevision,
  type PlanDetail,
  type Run,
  type RunEvent,
} from "@planner/contract";
import { cancelRun, fetchPlan, watchRun } from "../api/plan.ts";

/** What the page knows about the run right now. */
interface Progress {
  status: Run["status"];
  /** Null until the roster is decided — the state an indeterminate bar is for. */
  total: number | null;
  done: number;
  /** Who is being asked at this moment, for the line under the bar. */
  running: string[];
  message: string | null;
}

const LABELS: Record<Run["status"], string> = {
  queued: "Waiting for a slot",
  "fanning-out": "Asking the specialists",
  grounding: "Checking the details",
  composing: "Packing the days",
  reviewing: "Checking the draft",
  done: "Done",
  failed: "Stopped",
  canceled: "Stopped",
};

/** Titles a user would recognise; the ids are for logs, never for a screen. */
const SPECIALISTS: Record<string, string> = {
  "route-and-logistics": "routes and legs",
  lodging: "lodging",
  activities: "things to do",
  "conditions-and-gear": "conditions and gear",
  food: "food",
  practicalities: "permits and paperwork",
  budget: "budget",
};

function name(specialist: string): string {
  return SPECIALISTS[specialist] ?? specialist;
}

function reduce(current: Progress, event: RunEvent): Progress {
  switch (event.type) {
    case "snapshot":
      return {
        ...current,
        status: event.run.status,
        total: event.run.rosterSize,
        done: event.run.specialistsDone,
      };
    case "status":
      return { ...current, status: event.status };
    case "progress":
      switch (event.progress.type) {
        case "roster":
          return {
            ...current,
            total: event.progress.total,
            done: 0,
            running: event.progress.running.map(name),
          };
        case "specialist-started":
          return current;
        case "specialist-finished":
          return { ...current, done: event.progress.done, total: event.progress.total };
        case "specialist-failed":
          return { ...current, done: event.progress.done, total: event.progress.total };
        case "grounding":
          // The counts change meaning when the status does: specialists while
          // the fan-out runs, lookups from here. The label above the bar
          // changes with them, so the number under it stays true. `running` is
          // emptied because no specialist is being asked any more — leaving the
          // last roster on screen would say otherwise.
          return {
            ...current,
            done: event.progress.done,
            total: event.progress.total,
            running: [],
          };
      }
      return current;
    case "done":
      return { ...current, status: "done", message: null };
    case "failed":
      return { ...current, status: "failed", message: event.error.message };
    case "canceled":
      return { ...current, status: "canceled", message: event.error.message };
    case "heartbeat":
      return current;
  }
}

export function RunView({
  run,
  onExit,
  onOpenPlan,
}: {
  run: Run;
  onExit: () => void;
  onOpenPlan: (planId: string) => void;
}): React.ReactElement {
  const [progress, setProgress] = useState<Progress>({
    status: run.status,
    total: run.rosterSize,
    done: run.specialistsDone,
    running: [],
    message: null,
  });
  const [plan, setPlan] = useState<PlanDetail | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    return watchRun(run.id, (event) => {
      setProgress((current) => reduce(current, event));
    });
  }, [run.id]);

  const finished = progress.status === "done";

  useEffect(() => {
    if (!finished) return;
    const controller = new AbortController();
    fetchPlan(run.planId, controller.signal)
      // The route answers with a `PlanView` as of pl-10. What this screen shows
      // of a finished run is still only its outcome — the document, its
      // provenance and what nothing checked are `PlanView.tsx`'s.
      .then((view) => setPlan(view.plan))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setProgress((current) => ({ ...current, message: AppError.from(error).message }));
      });
    return () => controller.abort();
  }, [finished, run.planId]);

  const revision = useMemo(() => (plan === null ? null : latestRevision(plan)), [plan]);

  const stop = (): void => {
    setBusy(true);
    cancelRun(run.id)
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };

  return (
    <section className="panel run">
      <h2>{LABELS[progress.status]}</h2>

      {progress.status === "done" ? (
        <Finished revision={revision} onExit={onExit} onOpenPlan={() => onOpenPlan(run.planId)} />
      ) : progress.status === "failed" || progress.status === "canceled" ? (
        <>
          <p className="bad">{progress.message ?? "The run did not finish."}</p>
          <div className="actions">
            <button type="button" className="primary" onClick={onExit}>
              Back to the trip
            </button>
          </div>
        </>
      ) : (
        <>
          {/*
            No `value` until the roster is decided: an indeterminate bar is the
            honest render of "the total is not knowable yet".
          */}
          <progress
            className="run-progress"
            {...(progress.total === null ? {} : { value: progress.done, max: progress.total })}
          />
          <p aria-live="polite">
            {progress.total === null
              ? "Working out which specialists this trip needs…"
              : `${String(progress.done)} of ${String(progress.total)} specialists done.`}
          </p>
          {progress.running.length > 0 && (
            <p className="muted">Looking at {progress.running.join(", ")}.</p>
          )}
          <div className="actions">
            <button type="button" onClick={stop} disabled={busy}>
              Stop
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function Finished({
  revision,
  onExit,
  onOpenPlan,
}: {
  revision: ReturnType<typeof latestRevision>;
  onExit: () => void;
  onOpenPlan: () => void;
}): React.ReactElement {
  if (revision === null) {
    return (
      <>
        <p className="muted">Reading the plan back…</p>
      </>
    );
  }

  const items = revision.days.reduce((total, day) => total + day.items.length, 0);

  return (
    <>
      <p>
        A first draft is ready — {revision.days.length}{" "}
        {revision.days.length === 1 ? "day" : "days"}, {String(items)}{" "}
        {items === 1 ? "thing" : "things"} on them.
      </p>

      {/*
        Named, never hidden: a plan that quietly lacks a lodging section is worse
        than one that says lodging was not checked.
      */}
      {revision.gaps.length > 0 && (
        <div className="gaps">
          <h3>What this draft does not cover</h3>
          <ul>
            {revision.gaps.map((gap) => (
              <li key={`${gap.specialist}-${gap.reason}`}>
                <strong>{name(gap.specialist)}</strong> — {gap.detail}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="actions">
        <button type="button" className="primary" onClick={onOpenPlan}>
          Read the plan
        </button>
        <button type="button" onClick={onExit}>
          Back to the trip
        </button>
      </div>
    </>
  );
}
