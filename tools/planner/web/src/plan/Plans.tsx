/**
 * The plans someone has kept.
 *
 * This is what closes the loop pl-16 left open: a run that finished is watched
 * once and then unreachable, because a run is a live job and restoring one from
 * `localStorage` would mean re-attaching to something that may have finished,
 * failed or never existed on this server. Coming back to a finished plan is a
 * list problem, and this is the list.
 *
 * It reads `Plan` rows and not documents — the split exists so a page of titles
 * does not load every revision of every plan, and a client that fetched each
 * one to show its title would undo it.
 */

import { useEffect, useState } from "react";
import { AppError, type Plan } from "@planner/contract";
import { fetchPlans } from "../api/plan.ts";

type State =
  | { kind: "loading" }
  | { kind: "failed"; message: string }
  | { kind: "ready"; plans: readonly Plan[] };

export function Plans({ onOpen }: { onOpen: (id: string) => void }): React.ReactElement {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    fetchPlans(controller.signal)
      .then((plans) => setState({ kind: "ready", plans }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ kind: "failed", message: AppError.from(error).message });
      });
    return () => controller.abort();
  }, []);

  if (state.kind === "loading") return <p className="muted">Reading your plans…</p>;
  if (state.kind === "failed") return <p className="bad">{state.message}</p>;
  if (state.plans.length === 0) return <p className="muted">No plans yet.</p>;

  return (
    <ul className="plans">
      {state.plans.map((plan) => (
        <li key={plan.id}>
          <button type="button" className="link" onClick={() => onOpen(plan.id)}>
            {plan.title}
          </button>{" "}
          <span className="muted">
            {/*
              A plan with no revisions is one whose first run has not finished —
              a real state, and the one someone is most likely to be waiting on.
              It is listed, and it says what it is rather than claiming a draft.
            */}
            {plan.latestRevision === 0
              ? "no draft yet"
              : `${String(plan.latestRevision)} ${plan.latestRevision === 1 ? "version" : "versions"}`}
            {" · "}
            {plan.updatedAt.slice(0, 10)}
          </span>
        </li>
      ))}
    </ul>
  );
}
