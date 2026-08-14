/**
 * The shell, and a live check that it is talking to its backend.
 *
 * Deliberately not a mocked-up chat: an empty transcript and a disabled input
 * would look like progress without being any. What it renders instead is the
 * one thing that is true today — which assistant this server is running — so
 * the first real screen replaces something honest rather than something staged.
 */

import { useEffect, useState } from "react";
import { AppError } from "@planner/contract";
import { fetchHealth } from "./api/health.ts";
import type { HealthSummary } from "./api/health.ts";

type Status =
  | { state: "loading" }
  | { state: "ready"; health: HealthSummary }
  | { state: "failed"; message: string };

export function App(): React.ReactElement {
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
    <main className="shell">
      <h1>Planner</h1>
      <p className="lede">Plan a trip anywhere, with an assistant that remembers the details.</p>

      <section className="status" aria-live="polite">
        {status.state === "loading" && <p>Checking the server…</p>}
        {status.state === "failed" && <p className="bad">{status.message}</p>}
        {status.state === "ready" && (
          <dl>
            <dt>Server</dt>
            <dd>v{status.health.version}</dd>
            <dt>Assistant</dt>
            <dd>
              {status.health.provider}
              {status.health.model !== status.health.provider && ` · ${status.health.model}`}
            </dd>
          </dl>
        )}
      </section>
    </main>
  );
}
