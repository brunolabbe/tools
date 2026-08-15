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
import { AppError } from "@planner/contract";
import { fetchHealth } from "./api/health.ts";
import type { HealthSummary } from "./api/health.ts";
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

  const open = useCallback((id: string | null): void => {
    rememberOpenIntake(id);
    setOpenIntake(id);
  }, []);

  return (
    <main className="shell">
      <h1>Planner</h1>
      <p className="lede">
        Describe a trip, answer what the plan actually needs, and keep what comes back.
      </p>

      {openIntake === null ? (
        <Trips onOpen={(id) => open(id)} />
      ) : (
        <>
          <p className="crumb">
            <button type="button" className="link inline" onClick={() => open(null)}>
              ← All trips
            </button>
          </p>
          <Wizard intakeId={openIntake} onExit={() => open(null)} />
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
