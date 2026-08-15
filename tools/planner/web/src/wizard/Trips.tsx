/**
 * Every intake this server holds, newest first.
 *
 * Every row is resumable and none is marked finished, which is not a shortcut:
 * refining is somewhere a user comes back to after taking a draft, not a
 * corridor they leave once. An intake past the checkpoint is not done with — it
 * is a trip they can sharpen — so nothing here draws a line between the two.
 *
 * There is no owner model yet, so this list is everyone's. That is an honest gap
 * rather than one to paper over with an unguessable id, and it is recorded in
 * pl-2 and pl-7 as such.
 */

import { useEffect, useState } from "react";
import { AppError, type IntakeSummary } from "@planner/contract";
import { fetchIntakes, startIntake } from "../api/intake.ts";

interface TripsProps {
  onOpen: (id: string) => void;
}

export function Trips({ onOpen }: TripsProps): React.ReactElement {
  const [intakes, setIntakes] = useState<readonly IntakeSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchIntakes(controller.signal)
      .then(setIntakes)
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(AppError.from(cause).message);
      });
    return () => controller.abort();
  }, []);

  const start = (): void => {
    setBusy(true);
    setError(null);
    startIntake()
      .then((state) => onOpen(state.intake.id))
      .catch((cause: unknown) => setError(AppError.from(cause).message))
      .finally(() => setBusy(false));
  };

  return (
    <section className="panel" aria-labelledby="trips-heading">
      <h2 id="trips-heading">Your trips</h2>
      {error !== null && <p className="bad">{error}</p>}

      {intakes === null ? (
        <p>Looking…</p>
      ) : intakes.length === 0 ? (
        <p className="muted">Nothing yet.</p>
      ) : (
        <ul className="answers">
          {intakes.map((intake) => (
            <li key={intake.id}>
              <button type="button" className="link" onClick={() => onOpen(intake.id)}>
                <span className="prompt">{intake.title ?? "A trip, barely started"}</span>
                <span className="value">
                  Last touched {new Date(intake.updatedAt).toLocaleDateString()}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="actions">
        <button type="button" className="primary" disabled={busy} onClick={start}>
          Describe a new trip
        </button>
      </div>
    </section>
  );
}
