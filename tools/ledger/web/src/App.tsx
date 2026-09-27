/**
 * The shell, and nothing else yet.
 *
 * The books arrive with their design — `docs/00-ANALYSIS.md` first, then the
 * tickets it produces — and a screen guessed at before then is one more thing
 * to unpick. What is here proves the bundle is served and reaches its API.
 */

import { useEffect, useState } from "react";
import { AppError } from "@ledger/contract";
import type { HealthResponse } from "@ledger/contract";
import { fetchHealth } from "./api/health.ts";

export function App(): React.ReactElement {
  return (
    <div className="shell">
      <header>
        <h1>Ledger</h1>
        <p className="muted">The household&rsquo;s shared account.</p>
      </header>
      <main>
        <p>Nothing is recorded here yet.</p>
      </main>
      <Health />
    </div>
  );
}

type Status =
  | { state: "loading" }
  | { state: "ready"; health: HealthResponse }
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
    <footer className="health muted" aria-live="polite">
      {status.state === "loading" && <p>Checking the server…</p>}
      {status.state === "failed" && <p className="bad">{status.message}</p>}
      {status.state === "ready" && <p>Server v{status.health.version}</p>}
    </footer>
  );
}
