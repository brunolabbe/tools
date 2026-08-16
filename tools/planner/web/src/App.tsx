/**
 * The shell: the list of trips, the wizard over one of them, and the health
 * readout underneath both.
 *
 * The intake being open survives a reload, because that is the claim pl-7 makes:
 * someone describes a trip over an evening, closes the tab, and comes back to
 * it. The answers survive on the server; **which** intake they were in the
 * middle of is a browser-local preference, so it is remembered here rather than
 * given a column.
 *
 * The health readout moved down the page and was not dropped. Which assistant
 * this server is running is the first question anyone asks about a bad plan, and
 * a scripted one must never be mistakable for a real one.
 */

import { useCallback, useEffect, useState } from "react";
import { AppError, type Run } from "@planner/contract";
import { fetchHealth } from "./api/health.ts";
import type { HealthSummary } from "./api/health.ts";
import { PlanView } from "./plan/PlanView.tsx";
import { Plans } from "./plan/Plans.tsx";
import { RunView } from "./plan/RunView.tsx";
import { Trips } from "./wizard/Trips.tsx";
import { Wizard } from "./wizard/Wizard.tsx";

/** Where the browser remembers which intake was open. Not authoritative. */
const OPEN_INTAKE_KEY = "planner.open-intake";

function readOpenIntake(): string | null {
  try {
    return window.localStorage.getItem(OPEN_INTAKE_KEY);
  } catch {
    // Storage can be denied outright — a private window, a locked-down profile.
    // Losing the resume is a smaller failure than refusing to render.
    return null;
  }
}

function rememberOpenIntake(id: string | null): void {
  try {
    if (id === null) window.localStorage.removeItem(OPEN_INTAKE_KEY);
    else window.localStorage.setItem(OPEN_INTAKE_KEY, id);
  } catch {
    return;
  }
}

export function App(): React.ReactElement {
  const [openIntake, setOpenIntake] = useState<string | null>(readOpenIntake);
  /**
   * The run being watched, if any.
   *
   * Deliberately **not** remembered across a reload the way the open intake is.
   * A run is a job with a live stream attached and a cancel button beside it,
   * and restoring one from `localStorage` would mean re-attaching to something
   * that may have finished, failed or never existed on this server. Coming back
   * to a finished plan is a plan-list problem, which is pl-10's.
   */
  const [watching, setWatching] = useState<Run | null>(null);
  /**
   * The plan being read, if any.
   *
   * Not remembered across a reload either, and for a plainer reason than the
   * run: a plan is addressable and the list is one click away, so restoring one
   * would only be guessing at what someone wanted to see. pl-10 stops at the
   * list and the document; routing is not its business.
   */
  const [reading, setReading] = useState<string | null>(null);

  const open = useCallback((id: string | null): void => {
    rememberOpenIntake(id);
    setWatching(null);
    setReading(null);
    setOpenIntake(id);
  }, []);

  /**
   * Read a plan, **without forgetting where the reader came from.**
   *
   * `watching` is deliberately left alone. Clearing it here looked tidy and was
   * a bug: the two ways into a plan are the list and a finished run's "Read the
   * plan", and closing the plan has to go back to whichever it was. With
   * `watching` cleared, backing out of a plan reached from a finished run fell
   * through to `openIntake` still being set and re-opened the *wizard* — an
   * already-drafted trip asking its questions again, with the run's outcome no
   * longer reachable at all.
   */
  const read = useCallback((planId: string): void => {
    setReading(planId);
  }, []);

  return (
    <main className="shell">
      <h1>Planner</h1>
      <p className="lede">
        Describe a trip, answer what the plan actually needs, and keep what comes back.
      </p>

      {reading !== null ? (
        <>
          <p className="crumb">
            <button type="button" className="link inline" onClick={() => setReading(null)}>
              ← Back
            </button>
          </p>
          <PlanView planId={reading} onExit={() => setReading(null)} />
        </>
      ) : openIntake === null ? (
        <>
          <Trips onOpen={(id) => open(id)} />
          <section className="panel">
            <h2>Plans</h2>
            <Plans onOpen={read} />
          </section>
        </>
      ) : (
        <>
          <p className="crumb">
            <button type="button" className="link inline" onClick={() => open(null)}>
              ← All trips
            </button>
          </p>
          {watching === null ? (
            <Wizard
              intakeId={openIntake}
              onExit={() => open(null)}
              onDraft={(run) => setWatching(run)}
            />
          ) : (
            <RunView run={watching} onExit={() => setWatching(null)} onOpenPlan={read} />
          )}
        </>
      )}

      <Health />
    </main>
  );
}

type Status =
  | { state: "loading" }
  | { state: "ready"; health: HealthSummary }
  | { state: "failed"; message: string };

function Health(): React.ReactElement {
  const [status, setStatus] = useState<Status>({ state: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    fetchHealth(controller.signal)
      .then((health) => setStatus({ state: "ready", health }))
      .catch((error: unknown) => {
        // A cancelled request is the effect being cleaned up, not a failure to
        // report — under StrictMode it happens on every mount in development.
        if (controller.signal.aborted) return;
        setStatus({ state: "failed", message: AppError.from(error).message });
      });
    return () => controller.abort();
  }, []);

  return (
    <footer className="health" aria-live="polite">
      {status.state === "loading" && <p>Checking the server…</p>}
      {status.state === "failed" && <p className="bad">{status.message}</p>}
      {status.state === "ready" && (
        <p>
          Server v{status.health.version} · assistant {status.health.provider}
          {status.health.model !== status.health.provider && ` · ${status.health.model}`}
        </p>
      )}
    </footer>
  );
}
