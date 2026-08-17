/**
 * Reading a plan.
 *
 * Phase 2 could produce a document nobody could read: pl-16 renders the run's
 * own outcome — how many days, what it could not cover — and stops there. This
 * is the document, and its job is not to look finished. Three of this tool's
 * honesty mechanisms are structured data that nothing rendered until now, and
 * each one is a section below:
 *
 * - **Provenance** (§5) — which lines were verified and which are the model
 *   talking, on the candidate and separately on its cost. `Provenance.tsx`.
 * - **Gaps** (§7) — a specialist that failed, was dropped for budget, or was
 *   never on the roster, in the body of the plan where its section would have
 *   been, and never in a toast that disappears.
 * - **What was not checked** — the constraints the composer could not evaluate,
 *   travel time above all. This is the one that matters most and is easiest to
 *   lose, because **a packed plan looks equally finished whether every
 *   constraint was enforced or three were skipped for want of data.** It comes
 *   down the wire on every read, derived from the stored revision, so it does
 *   not depend on having watched the run that produced it.
 *
 * **The diff is Phase 4 and is out of scope.** The revision count is surfaced
 * read-only; what is rendered is the latest draft, which is also the one
 * `unchecked` describes and the one whose items a pin can constrain.
 */

import { useCallback, useEffect, useState } from "react";
import {
  AppError,
  isAnswered,
  latestRevision,
  type Candidate,
  type PlanDay,
  type PlanGap,
  type PlanItem,
  type PlanView as PlanViewDocument,
  type TripShape,
  type UncheckedConstraint,
} from "@planner/contract";
import { fetchPlan, pinItem } from "../api/plan.ts";
import { describeCost, describeLocation, dayHeading, humanise } from "./format.ts";
import { ProvenanceNote } from "./Provenance.tsx";

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

function specialistName(specialist: string): string {
  return SPECIALISTS[specialist] ?? specialist;
}

/**
 * A short label per `PlanGapReason` — and the gap's **own `detail` is still
 * what carries the meaning**.
 *
 * `no-candidates-found` has two producers and two sentences as of pl-5: the
 * orchestrator raises it for a specialist that ran and returned nothing at all,
 * the composer for one that returned candidates and got none of them onto a
 * day. Both already write `detail` for a reader. A view that printed a sentence
 * per *reason* would throw away the half that says which happened — the
 * difference between "there is nothing there" and "there was, and none of it
 * fitted" — so these are headings over the detail, never replacements for it.
 */
const GAP_LABELS: Record<PlanGap["reason"], string> = {
  "specialist-failed": "We tried and could not",
  "specialist-dropped-for-budget": "Not run, to keep this draft affordable",
  "specialist-not-applicable": "Nothing to say on this trip",
  "no-candidates-found": "Nothing usable came back",
};

/**
 * §8, and it is permanent: **never present a plan as a clearance to go.**
 *
 * Keyed on the trip's shape rather than on anything in the plan, because the
 * duty is a property of the trip. `motorised-touring` covers the marine and the
 * winter machine cases — the contract's own comment on it names snowmobile, ATV,
 * motorcycle and boat — so both are here.
 */
const AUTHORITATIVE_SOURCES: Partial<Record<TripShape, string>> = {
  backcountry:
    "Check the avalanche bulletin and the trail or park authority before you go. Nothing here has looked at conditions.",
  "motorised-touring":
    "Check the marine forecast, the trail authority and any ice or closure notices before you go. Nothing here has looked at conditions.",
};

type State =
  | { kind: "loading" }
  | { kind: "failed"; message: string }
  | { kind: "ready"; view: PlanViewDocument };

export function PlanView({
  planId,
  onExit,
}: {
  planId: string;
  onExit: () => void;
}): React.ReactElement {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState<string | null>(null);
  /**
   * A pin that did not take, reported **beside the document rather than instead
   * of it.**
   *
   * Separate from `state` on purpose. Folding it into the page-level `failed`
   * threw the whole loaded plan away over one stale item — and the error most
   * likely to arrive here is `ITEM_NOT_FOUND`, whose own copy tells the reader
   * to reload the plan to see the current draft. Replacing the plan with a bare
   * message and a "back to the plans" button is the one response that makes
   * that advice impossible to follow.
   */
  const [pinFailed, setPinFailed] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    fetchPlan(planId, controller.signal)
      .then((view) => setState({ kind: "ready", view }))
      .catch((error: unknown) => {
        // A cancelled request is the effect being cleaned up, not a failure to
        // report — under StrictMode it happens on every mount in development.
        if (controller.signal.aborted) return;
        setState({ kind: "failed", message: AppError.from(error).message });
      });
    return () => controller.abort();
  }, [planId]);

  const pin = useCallback(
    (item: PlanItem): void => {
      setBusy(item.id);
      setPinFailed(null);
      pinItem(planId, item.id, !item.pinned)
        .then((view) => setState({ kind: "ready", view }))
        .catch((error: unknown) => {
          setPinFailed(AppError.from(error).message);
        })
        .finally(() => setBusy(null));
    },
    [planId],
  );

  if (state.kind === "loading") {
    return (
      <section className="panel plan">
        <p className="muted">Reading the plan…</p>
      </section>
    );
  }

  if (state.kind === "failed") {
    return (
      <section className="panel plan">
        <p className="bad">{state.message}</p>
        <div className="actions">
          <button type="button" className="primary" onClick={onExit}>
            Back to the plans
          </button>
        </div>
      </section>
    );
  }

  return (
    <Document view={state.view} onPin={pin} busyItem={busy} pinFailed={pinFailed} onExit={onExit} />
  );
}

function Document({
  view,
  onPin,
  busyItem,
  pinFailed,
  onExit,
}: {
  view: PlanViewDocument;
  onPin: (item: PlanItem) => void;
  busyItem: string | null;
  pinFailed: string | null;
  onExit: () => void;
}): React.ReactElement {
  const { plan } = view;
  const revision = latestRevision(plan);
  const shape = isAnswered(plan.brief.shape) ? plan.brief.shape.value : null;
  const caution = shape === null ? undefined : AUTHORITATIVE_SOURCES[shape];

  return (
    <section className="panel plan">
      <h2>{plan.title}</h2>

      {revision === null ? (
        // Real and reachable: the plan row is written before the fan-out, so a
        // plan with no revisions is one whose first run has not finished. It is
        // not a missing plan and is not rendered as an error.
        <p className="muted">This plan has no draft yet.</p>
      ) : (
        <>
          <p className="crumb">
            Version {String(revision.revision)} of {String(plan.latestRevision)} · {revision.reason}
          </p>

          {/* Beside the plan, never instead of it — see `pinFailed`. */}
          {pinFailed !== null && (
            <p className="bad" role="alert">
              {pinFailed}
            </p>
          )}

          {caution !== undefined && (
            <p className="notice caution" role="note">
              {caution}
            </p>
          )}

          {revision.days.map((day) => (
            <Day
              key={day.id}
              day={day}
              candidates={plan.candidates}
              onPin={onPin}
              busyItem={busyItem}
            />
          ))}

          <Gaps gaps={revision.gaps} />
          <Unchecked unchecked={view.unchecked} candidates={plan.candidates} />
        </>
      )}

      <div className="actions">
        <button type="button" className="primary" onClick={onExit}>
          Back to the plans
        </button>
      </div>
    </section>
  );
}

/**
 * One day and the things on it.
 *
 * **A plan can hold two hotels for one week** — `BUCKET_OF` makes a lodging
 * candidate one day's anchor, so a specialist that proposes two properties gets
 * both placed, on different days. That is a real gap between what a lodging
 * specialist means and what the packer does with it, and closing it is not
 * pl-10's. What *is* pl-10's is not rendering it as though the party were
 * staying in both at once: an item belongs to the day it is on, and nothing
 * here says a stay continues into the next one.
 */
function Day({
  day,
  candidates,
  onPin,
  busyItem,
}: {
  day: PlanDay;
  candidates: readonly Candidate[];
  onPin: (item: PlanItem) => void;
  busyItem: string | null;
}): React.ReactElement {
  return (
    <article className="day">
      <h3>{dayHeading(day)}</h3>
      {day.items.length === 0 ? (
        <p className="muted">Nothing planned for this day.</p>
      ) : (
        <ol className="items">
          {day.items.map((item) => (
            <Item
              key={item.id}
              item={item}
              candidate={candidates.find((each) => each.id === item.candidateId)}
              onPin={onPin}
              busy={busyItem === item.id}
            />
          ))}
        </ol>
      )}
    </article>
  );
}

function Item({
  item,
  candidate,
  onPin,
  busy,
}: {
  item: PlanItem;
  candidate: Candidate | undefined;
  onPin: (item: PlanItem) => void;
  busy: boolean;
}): React.ReactElement {
  // A placed item whose candidate is gone is not a state the store can produce
  // — a corrupt candidate is a fatal read there — but the resolution happens
  // here and an item rendered blank would be worse than one that says so.
  if (candidate === undefined) {
    return (
      <li className="item">
        <p className="bad">This item points at something the plan no longer holds.</p>
      </li>
    );
  }

  return (
    <li className="item">
      <div className="item-head">
        <h4>{candidate.title}</h4>
        <button
          type="button"
          className={item.pinned ? "pin on" : "pin"}
          onClick={() => onPin(item)}
          disabled={busy}
          aria-pressed={item.pinned}
        >
          {item.pinned ? "Pinned" : "Pin"}
        </button>
      </div>

      <p className="where">{describeLocation(candidate.location)}</p>
      <p>{candidate.summary}</p>

      <p className="muted">
        {specialistName(candidate.specialist)}
        {/*
          A wall-clock start is only ever set when something outside the plan
          fixes it — a ferry, a timed entry. `null` is the normal case and means
          "this is the third thing that day", which the list order already says.
        */}
        {item.startsAt !== null && ` · from ${item.startsAt}`}
        {candidate.durationMinutes !== null && ` · about ${String(candidate.durationMinutes)} min`}
      </p>

      {item.note !== null && <p className="hint">{item.note}</p>}

      {candidate.cost === null ? (
        <p className="muted">Nobody put a cost on this.</p>
      ) : (
        <>
          <p className="cost">{describeCost(candidate.cost)}</p>
          {/*
            The cost's provenance is its own. A real place with a guessed price
            is the common case, and the two are never collapsed into one badge.
          */}
          <ProvenanceNote provenance={candidate.cost.provenance} what="the cost" />
        </>
      )}

      <ProvenanceNote provenance={candidate.provenance} what="this" />
    </li>
  );
}

/**
 * What this draft does not cover, in the body of the plan.
 *
 * Not a toast and not an error panel: §7's whole point is that a plan which
 * says lodging was not checked is more useful than one that quietly omits it,
 * and a warning that disappears is one the reader cannot come back to.
 */
function Gaps({ gaps }: { gaps: readonly PlanGap[] }): React.ReactElement | null {
  if (gaps.length === 0) return null;

  return (
    <section className="gaps">
      <h3>What this draft does not cover</h3>
      <ul>
        {gaps.map((gap) => (
          <li key={`${gap.specialist}-${gap.reason}`}>
            <strong>{specialistName(gap.specialist)}</strong> — {GAP_LABELS[gap.reason]}.{" "}
            {gap.detail}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * What nothing checked, beside the days.
 *
 * Never empty in Phase 2 — travel time is on every plan, because
 * `Place.coordinates` is null until grounding — and that entry is the one to
 * render most plainly. `candidateIds` is empty when the constraint is about the
 * whole plan; when it is not, the affected items are named by title, because an
 * id is not something a reader can find on the page.
 */
function Unchecked({
  unchecked,
  candidates,
}: {
  unchecked: readonly UncheckedConstraint[];
  candidates: readonly Candidate[];
}): React.ReactElement | null {
  if (unchecked.length === 0) return null;

  return (
    <section className="unchecked">
      <h3>What was not checked</h3>
      <ul>
        {unchecked.map((constraint) => {
          const named = constraint.candidateIds
            .map((id) => candidates.find((each) => each.id === id)?.title)
            .filter((title): title is string => title !== undefined);

          return (
            <li key={constraint.kind}>
              <strong>{humanise(constraint.kind)}</strong> — {constraint.detail}
              {named.length > 0 && <span className="muted"> ({named.join("; ")})</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
