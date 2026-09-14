/**
 * Reading a plan.
 *
 * Phase 2 could produce a document nobody could read: pl-16 renders the run's
 * own outcome — how many days, what it could not cover — and stops there. This
 * is the document, and its job is not to look finished. Three of this tool's
 * honesty mechanisms are structured data that nothing rendered until now, and
 * each one is a section below:
 *
 * - **Provenance** (§5) — which lines were sourced and which are the model
 *   talking, on the candidate and separately on its cost. `Provenance.tsx`.
 * - **Gaps** (§7) — a specialist that failed, was dropped for budget, or was
 *   never on the roster, in the body of the plan where its section would have
 *   been, and never in a toast that disappears.
 * - **What was not checked** — the constraints the composer could not evaluate,
 *   travel time above all. This is the one that matters most and is easiest to
 *   lose, because **a packed plan looks equally finished whether every
 *   constraint was enforced or three were skipped for want of data.** It comes
 *   down the wire on every read, derived from the stored revision, so it does
 *   not depend on having watched the run that produced it. **Latest revision
 *   only** — pl-42's contract says so on `PlanView.diffs`'s doc comment — so it
 *   is shown only when `shownRevision` is the latest, never carried onto an
 *   older page.
 *
 * **The diff is Phase 4, and pl-45 built it.** Every revision after the first
 * has one, resolved against `view.diffs` by `revisionId` rather than by array
 * index — a revision and its diff are appended together, but nothing says a
 * client must trust that they line up positionally, and an off-by-one there
 * would silently show the wrong diff for every later revision.
 */

import { useCallback, useEffect, useState } from "react";
import {
  AppError,
  isAnswered,
  latestRevision,
  MAX_REVISION_NOTE_CHARS,
  SPECIALISTS as ALL_SPECIALISTS,
  type Candidate,
  type DiffEntry,
  type DiffPlacement,
  type ErrorCode,
  type PlanDay,
  type PlanGap,
  type PlanItem,
  type PlanRevision,
  type PlanView as PlanViewDocument,
  type ReviseRequest,
  type RevisionDiff,
  type Run,
  type Source,
  type Specialist,
  type TripShape,
  uncheckedConstraintKey,
  type UncheckedConstraint,
} from "@planner/contract";
import { editPlan, fetchPlan, pinItem, startReplan } from "../api/plan.ts";
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

/** What a synchronous write can fail with, and what the banner needs to know. */
interface ActionError {
  message: string;
  code: ErrorCode;
  /** `PLAN_BUSY` only — the run already in progress on this plan. */
  runId: string | null;
}

function runIdFrom(error: AppError): string | null {
  const run = error.details?.["run"];
  return typeof run === "string" ? run : null;
}

export function PlanView({
  planId,
  onExit,
  onReplan,
  onWatchRun,
}: {
  planId: string;
  onExit: () => void;
  /** A re-plan started: control leaves this component entirely. */
  onReplan: (run: Run) => void;
  /** `PLAN_BUSY`'s "Watch it": open the run already in progress. */
  onWatchRun: (runId: string, planId: string) => void;
}): React.ReactElement {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState<string | null>(null);
  /**
   * Any move, remove, restore or re-plan-start in flight.
   *
   * One flag for the whole document rather than per control: `PLAN_BUSY`'s own
   * invariant is that only one write may be building on the latest revision at
   * a time, so a UI that let a second edit start before the first answered
   * would just be racing toward the error the server already refuses.
   */
  const [writeBusy, setWriteBusy] = useState(false);
  /**
   * A write that did not take, reported **beside the document rather than
   * instead of it.**
   *
   * Separate from `state` on purpose, and shared by the pin route and the
   * revise route: the error most likely to arrive here is one whose own copy
   * tells the reader what to do next — reload, wait, or read `details` — and
   * replacing the loaded plan with a bare message would make that advice
   * impossible to follow. See pl-10's original finding on `pinFailed`.
   */
  const [actionError, setActionError] = useState<ActionError | null>(null);
  /** The revision the reader is looking at. `null` means "the latest". */
  const [shownRevisionNumber, setShownRevisionNumber] = useState<number | null>(null);

  const load = useCallback(
    (signal?: AbortSignal): void => {
      fetchPlan(planId, signal)
        .then((view) => {
          setState({ kind: "ready", view });
          setShownRevisionNumber(null);
          return undefined;
        })
        .catch((error: unknown) => {
          // A cancelled request is the effect being cleaned up, not a failure to
          // report — under StrictMode it happens on every mount in development.
          if (signal?.aborted) return;
          setState({ kind: "failed", message: AppError.from(error).message });
        });
    },
    [planId],
  );

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    load(controller.signal);
    return () => controller.abort();
  }, [planId, load]);

  const pin = useCallback(
    (item: PlanItem): void => {
      setBusy(item.id);
      setActionError(null);
      pinItem(planId, item.id, !item.pinned)
        .then((view) => setState({ kind: "ready", view }))
        .catch((error: unknown) => {
          const appError = AppError.from(error);
          setActionError({ message: appError.message, code: appError.code, runId: null });
        })
        .finally(() => setBusy(null));
    },
    [planId],
  );

  /**
   * Every move, remove and restore lands here: the response is the whole view,
   * and `shownRevisionNumber` resets to `null` (the latest) because all three
   * only ever run while the latest is on screen — see `editable` below.
   */
  const submitEdit = useCallback(
    (request: Exclude<ReviseRequest, { kind: "replan" }>): void => {
      setWriteBusy(true);
      setActionError(null);
      editPlan(planId, request)
        .then((view) => {
          setState({ kind: "ready", view });
          setShownRevisionNumber(null);
          return undefined;
        })
        .catch((error: unknown) => {
          const appError = AppError.from(error);
          setActionError({
            message: appError.message,
            code: appError.code,
            runId: appError.code === "PLAN_BUSY" ? runIdFrom(appError) : null,
          });
        })
        .finally(() => setWriteBusy(false));
    },
    [planId],
  );

  const submitReplan = useCallback(
    (request: Extract<ReviseRequest, { kind: "replan" }>): void => {
      setWriteBusy(true);
      setActionError(null);
      startReplan(planId, request)
        .then((run) => onReplan(run))
        .catch((error: unknown) => {
          const appError = AppError.from(error);
          setActionError({
            message: appError.message,
            code: appError.code,
            runId: appError.code === "PLAN_BUSY" ? runIdFrom(appError) : null,
          });
        })
        .finally(() => setWriteBusy(false));
    },
    [planId, onReplan],
  );

  /** `REVISION_STALE`'s own advice: look again, rather than retry blindly. */
  const reload = useCallback((): void => {
    setActionError(null);
    load();
  }, [load]);

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
    <Document
      view={state.view}
      shownRevisionNumber={shownRevisionNumber}
      onShowRevision={setShownRevisionNumber}
      onPin={pin}
      busyItem={busy}
      writeBusy={writeBusy}
      actionError={actionError}
      onReload={reload}
      onWatchRun={(runId) => onWatchRun(runId, planId)}
      onEdit={submitEdit}
      onReplan={submitReplan}
      onExit={onExit}
    />
  );
}

function Document({
  view,
  shownRevisionNumber,
  onShowRevision,
  onPin,
  busyItem,
  writeBusy,
  actionError,
  onReload,
  onWatchRun,
  onEdit,
  onReplan,
  onExit,
}: {
  view: PlanViewDocument;
  shownRevisionNumber: number | null;
  onShowRevision: (revision: number | null) => void;
  onPin: (item: PlanItem) => void;
  busyItem: string | null;
  writeBusy: boolean;
  actionError: ActionError | null;
  onReload: () => void;
  onWatchRun: (runId: string) => void;
  onEdit: (request: Exclude<ReviseRequest, { kind: "replan" }>) => void;
  onReplan: (request: Extract<ReviseRequest, { kind: "replan" }>) => void;
  onExit: () => void;
}): React.ReactElement {
  const { plan } = view;
  const latest = latestRevision(plan);
  const shape = isAnswered(plan.brief.shape) ? plan.brief.shape.value : null;
  const caution = shape === null ? undefined : AUTHORITATIVE_SOURCES[shape];

  if (latest === null) {
    return (
      <section className="panel plan">
        <h2>{plan.title}</h2>
        {/* Real and reachable: the plan row is written before the fan-out, so a
            plan with no revisions is one whose first run has not finished. It
            is not a missing plan and is not rendered as an error. */}
        <p className="muted">This plan has no draft yet.</p>
        <div className="actions">
          <button type="button" className="primary" onClick={onExit}>
            Back to the plans
          </button>
        </div>
      </section>
    );
  }

  const shownRevision =
    (shownRevisionNumber === null
      ? undefined
      : plan.revisions.find((each) => each.revision === shownRevisionNumber)) ?? latest;
  const isLatest = shownRevision.revision === plan.latestRevision;
  const diff = view.diffs.find((each) => each.revisionId === shownRevision.id);

  return (
    <section className="panel plan">
      <h2>{plan.title}</h2>

      <p className="crumb">
        Version {String(shownRevision.revision)} of {String(plan.latestRevision)} ·{" "}
        {shownRevision.reason}
      </p>

      <VersionPicker
        revisions={plan.revisions}
        shown={shownRevision.revision}
        onShow={onShowRevision}
      />

      {!isLatest && (
        <div className="actions">
          <button
            type="button"
            disabled={writeBusy}
            onClick={() =>
              onEdit({
                kind: "restore",
                baseRevisionId: latest.id,
                revision: shownRevision.revision,
              })
            }
          >
            Restore this version
          </button>
        </div>
      )}

      {/* Beside the plan, never instead of it — see `actionError`. */}
      {actionError !== null && (
        <div className="bad" role="alert">
          <p>{actionError.message}</p>
          <div className="actions">
            {actionError.code === "REVISION_STALE" && (
              <button type="button" onClick={onReload}>
                Reload the plan
              </button>
            )}
            {actionError.code === "PLAN_BUSY" && actionError.runId !== null && (
              <button type="button" onClick={() => onWatchRun(actionError.runId!)}>
                Watch it
              </button>
            )}
          </div>
        </div>
      )}

      {caution !== undefined && (
        <p className="notice caution" role="note">
          {caution}
        </p>
      )}

      {shownRevision.days.map((day) => (
        <Day
          key={day.id}
          day={day}
          days={shownRevision.days}
          candidates={plan.candidates}
          onPin={onPin}
          busyItem={busyItem}
          editable={isLatest}
          writeBusy={writeBusy}
          onMove={(item, toDayIndex, toPosition) =>
            onEdit({
              kind: "move",
              baseRevisionId: latest.id,
              itemId: item.id,
              toDayIndex,
              toPosition,
            })
          }
          onRemove={(item) =>
            onEdit({ kind: "remove", baseRevisionId: latest.id, itemId: item.id })
          }
        />
      ))}

      <Gaps gaps={shownRevision.gaps} />
      {isLatest && <Unchecked unchecked={view.unchecked} candidates={plan.candidates} />}
      <TravelSources days={shownRevision.days} />
      <RouteReading reading={shownRevision.reading} />

      {shownRevision.revision > 1 && (
        <Diff diff={diff} candidates={plan.candidates} operation={shownRevision.operation} />
      )}

      {isLatest ? (
        <ReplanForm
          days={shownRevision.days}
          busy={writeBusy}
          onSubmit={(request) => onReplan({ ...request, baseRevisionId: latest.id })}
        />
      ) : (
        <p className="notice" role="note">
          Editing works on the latest version. Restore this one to bring it back, or open the latest
          to keep going.
        </p>
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
 * A picker over `plan.revisions`, beside the crumb line and never inside it —
 * that line's exact text is load-bearing outside this package (pl-19's
 * `e2e/pin.spec.ts`), and a control rendered into it, or copy added to it,
 * would break a suite this ticket cannot run locally.
 *
 * `plan.revisions` is already the whole history on the document handed to the
 * browser — no per-revision fetch, here or anywhere else in this file.
 */
function VersionPicker({
  revisions,
  shown,
  onShow,
}: {
  revisions: readonly PlanRevision[];
  shown: number;
  onShow: (revision: number | null) => void;
}): React.ReactElement | null {
  if (revisions.length < 2) return null;

  const latest = revisions.at(-1)?.revision ?? shown;

  return (
    <p className="version-picker">
      <label htmlFor="version-picker">Version</label>{" "}
      <select
        id="version-picker"
        className="field"
        value={shown}
        onChange={(event) => {
          const next = Number(event.target.value);
          onShow(next === latest ? null : next);
        }}
      >
        {revisions.map((each) => (
          // Deliberately not the crumb's own "Version N of M · reason" —
          // repeating that exact sentence in an `<option>` would give the
          // page two elements with identical accessible text whenever the
          // selected option is the one shown, and the crumb line's text is
          // the one that must stay unique (see the module comment).
          <option key={each.id} value={each.revision}>
            Version {each.revision} · {each.reason}
          </option>
        ))}
      </select>
    </p>
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
  days,
  candidates,
  onPin,
  busyItem,
  editable,
  writeBusy,
  onMove,
  onRemove,
}: {
  day: PlanDay;
  /** Every day of the revision being shown — the move control's own day list. */
  days: readonly PlanDay[];
  candidates: readonly Candidate[];
  onPin: (item: PlanItem) => void;
  busyItem: string | null;
  /** Move and remove act on the latest revision only (pl-22, extended by pl-45). */
  editable: boolean;
  writeBusy: boolean;
  onMove: (item: PlanItem, toDayIndex: number, toPosition: number) => void;
  onRemove: (item: PlanItem) => void;
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
              fromDayIndex={day.dayIndex}
              days={days}
              candidate={candidates.find((each) => each.id === item.candidateId)}
              onPin={onPin}
              busy={busyItem === item.id}
              editable={editable}
              writeBusy={writeBusy}
              onMove={onMove}
              onRemove={onRemove}
            />
          ))}
        </ol>
      )}
    </article>
  );
}

function Item({
  item,
  fromDayIndex,
  days,
  candidate,
  onPin,
  busy,
  editable,
  writeBusy,
  onMove,
  onRemove,
}: {
  item: PlanItem;
  fromDayIndex: number;
  days: readonly PlanDay[];
  candidate: Candidate | undefined;
  onPin: (item: PlanItem) => void;
  busy: boolean;
  editable: boolean;
  writeBusy: boolean;
  onMove: (item: PlanItem, toDayIndex: number, toPosition: number) => void;
  onRemove: (item: PlanItem) => void;
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
        <span className="item-controls">
          <button
            type="button"
            className={item.pinned ? "pin on" : "pin"}
            onClick={() => onPin(item)}
            disabled={busy}
            aria-pressed={item.pinned}
          >
            {item.pinned ? "Pinned" : "Pin"}
          </button>
          {editable && (
            <>
              <MoveControl
                item={item}
                fromDayIndex={fromDayIndex}
                days={days}
                disabled={writeBusy}
                onMove={(toDayIndex, toPosition) => onMove(item, toDayIndex, toPosition)}
              />
              <button type="button" disabled={writeBusy} onClick={() => onRemove(item)}>
                Remove
              </button>
            </>
          )}
        </span>
      </div>

      <p className="where">{describeLocation(candidate.location)}</p>
      <p>{candidate.summary}</p>

      <p className="muted">
        {specialistName(candidate.specialist)}
        {/*
          A wall-clock start is only ever set when something outside the plan
          fixes it — a ferry, a timed entry. `null` is the normal case and
          means "this is the third thing that day", which the list order already says.
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
 * Move, as a button that opens an inline, keyboard-operable pair of selects —
 * no drag-and-drop, matching every other control in this file.
 *
 * The position options are **scoped to the destination day's current item
 * count**, and shift by one when the destination is the item's own day:
 * `toPosition` is defined as the index in the destination list *after* the
 * item has left its source (`RevisionOperation`'s own comment), so a same-day
 * move has one fewer honest slot than the day's current length.
 */
function MoveControl({
  item,
  fromDayIndex,
  days,
  disabled,
  onMove,
}: {
  item: PlanItem;
  fromDayIndex: number;
  days: readonly PlanDay[];
  disabled: boolean;
  onMove: (toDayIndex: number, toPosition: number) => void;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [toDayIndex, setToDayIndex] = useState(fromDayIndex);
  const [toPosition, setToPosition] = useState(item.position);

  if (!open) {
    return (
      <button type="button" disabled={disabled} onClick={() => setOpen(true)}>
        Move
      </button>
    );
  }

  const destination = days.find((each) => each.dayIndex === toDayIndex);
  const count = destination?.items.length ?? 0;
  const maxPosition = toDayIndex === fromDayIndex ? Math.max(count - 1, 0) : count;
  const positions = Array.from({ length: maxPosition + 1 }, (_, index) => index);

  return (
    <span className="move-control">
      <label>
        Day{" "}
        <select
          className="field"
          value={toDayIndex}
          onChange={(event) => {
            const next = Number(event.target.value);
            setToDayIndex(next);
            setToPosition(0);
          }}
        >
          {days.map((each) => (
            <option key={each.id} value={each.dayIndex}>
              {dayHeading(each)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Spot{" "}
        <select
          className="field"
          value={toPosition}
          onChange={(event) => setToPosition(Number(event.target.value))}
        >
          {positions.map((position) => (
            <option key={position} value={position}>
              {String(position + 1)}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          onMove(toDayIndex, toPosition);
          setOpen(false);
        }}
      >
        Move here
      </button>
      <button type="button" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </span>
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
 *
 * **Latest revision only** (pl-42's contract, pl-45's `isLatest` gate at the
 * call site): an older page must not go on showing the previous unchecked
 * list once nothing here describes it any more.
 */
/**
 * The key is the entry's identity, and it comes from the contract.
 *
 * It was a local `keyFor` here for one round, which is one round too many: this
 * file is not the only reader of an `UncheckedConstraint`, and "when are two
 * entries the same entry" is a statement about the data rather than about how
 * React reconciles a list. `uncheckedConstraintKey` is where it belongs, and
 * `@planner/itinerary`'s suite asserts it is distinct across the entries the
 * composer actually emits for all six checked-in candidate sets — which is a
 * stronger guarantee than anything this file could assert about itself.
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
            <li key={uncheckedConstraintKey(constraint)}>
              <strong>{humanise(constraint.kind)}</strong> — {constraint.detail}
              {named.length > 0 && <span className="muted"> ({named.join("; ")})</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * The distances and travel times this plan measured, deduplicated by source
 * — once for the whole document, not once per leg (pl-35).
 *
 * **Why once, and not `ProvenanceNote` under every item.** Every leg on a
 * plan is measured by the same backend in the same run, so a per-item block
 * would repeat one citation dozens of times over a multi-day trip — the
 * "clutter" pl-35 named as the risk on the other side of "too thin". A single
 * deduplicated list is the document-level attribution a map's own "©
 * OpenStreetMap contributors" caption already is: shown once, wherever the
 * data appears, not once per feature that used it. Rejected: a per-day
 * summary, which would repeat the same one or two sources once per day for no
 * reason — the source does not change with the day, only the leg does.
 *
 * **Reuses `ProvenanceNote`, not a second renderer.** The two callers already
 * in this file render a `Provenance`; this one builds a synthetic `grounded`
 * `Provenance` out of every unique `Source` a measured leg carries and hands
 * it to the same component, so the wording — "is something we read at a
 * source — reading it is not recommending it" — is the one sentence this
 * file has for a grounded fact, not a second one invented for this case that
 * could drift from it.
 *
 * **Only `kind === "measured"` legs contribute.** `not-established` and
 * `over-budget` have no `Provenance` to cite — nothing here would be sourcing
 * a leg nothing measured, which is exactly the thing pl-35's Done-when named
 * as the trap.
 *
 * **Deduplicated on the URL *and* the title** — pl-36, and this changed. A leg
 * now cites the geocoder that placed its two ends as well as the router that
 * measured between them, and the provider gives both the *same* URL: it cites
 * `openstreetmap.org/copyright` for everything, because that is the attribution
 * page the ODbL asks for rather than the deployment's own endpoint, and names
 * the service in the title. Keying on the URL alone kept whichever leg was read
 * first and dropped the other service entirely, so the plan would have credited
 * one of the two backends it actually used.
 */
function travelSourcesOf(days: readonly PlanDay[]): Source[] {
  const distinct = new Map<string, Source>();
  for (const day of days) {
    for (const item of day.items) {
      const travel = item.travelFromPrevious;
      if (travel === null || travel.kind !== "measured") continue;
      if (travel.provenance.kind !== "grounded") continue;
      for (const source of travel.provenance.sources) {
        // First seen wins — every candidate for the same URL and title is the
        // same citation, and a plan measured across one run shares one
        // `fetchedAt` per backend call regardless of which one is kept.
        const key = `${source.url}\u0000${source.title ?? ""}`;
        if (!distinct.has(key)) distinct.set(key, source);
      }
    }
  }
  return [...distinct.values()];
}

function TravelSources({ days }: { days: readonly PlanDay[] }): React.ReactElement | null {
  const sources = travelSourcesOf(days);
  if (sources.length === 0) return null;

  return (
    <section className="travel-sources">
      <ProvenanceNote
        provenance={{ kind: "grounded", sources }}
        what="Distance and travel time on this plan"
      />
    </section>
  );
}

/**
 * What has been written about the route itself, once for the document — pl-33
 * stored it, pl-36 renders it.
 *
 * **The third instance of pl-35's shape, closed the same way.** `coverage`
 * reaches the page through `unchecked`, and a measured leg's citation through
 * `TravelSources`; `PlanRevision.reading` was plumbed end to end by pl-33 —
 * discovery, to the orchestrator, to the `reading_json` column, to the contract
 * — and then rendered nowhere, so a Wikivoyage entry this tool fetched, stored
 * and capped with `MAX_REVISION_READING` was visible only to whoever ran
 * `sqlite3` against the database.
 *
 * **Plan-level because the data is**, which is `PlanRevision.reading`'s own
 * argument and not a layout choice: a Wikivoyage article is about a region the
 * corridor crosses, never about one item on one day, and hanging it under a day
 * would claim a relationship the source does not have.
 *
 * **`what` is "Background on this route"**, taking `TravelSources`'s cadence —
 * a noun phrase naming the claim, so the sentence this component ships reads
 * "Background on this route is something we read at a source — reading it is not
 * recommending it". That trailing clause is doing more work here than anywhere
 * else it is used: editorial coverage of a whole region is the citation a reader
 * is likeliest to mistake for an endorsement of the trip, and §5's amendment is
 * explicit that "OSM says a viewpoint exists; it does not say anyone should go".
 *
 * Deduplication is `runs/discovery.ts`'s, done as the list is built. Repeating
 * it here would be a second answer to a question already settled upstream.
 */
function RouteReading({ reading }: { reading: readonly Source[] }): React.ReactElement | null {
  if (reading.length === 0) return null;

  return (
    <section className="route-reading">
      <ProvenanceNote
        provenance={{ kind: "grounded", sources: [...reading] }}
        what="Background on this route"
      />
    </section>
  );
}

/**
 * What changed since the parent revision, as three short lists and never as
 * prose.
 *
 * **Resolved by `revisionId`, never by array index.** `view.diffs` is appended
 * to alongside `plan.revisions`, but nothing here assumes the two line up
 * positionally — revision 1 has no diff at all, and an off-by-one would
 * silently show the wrong diff for every later revision.
 *
 * **The caption is `shownRevision.reason`, and it is not repeated here** — the
 * crumb line above already renders it. What is not shown anywhere else is a
 * re-plan's own `note`, so that is what this section adds, marked plainly as
 * what the user wrote and not as the tool's own words.
 */
function Diff({
  diff,
  candidates,
  operation,
}: {
  diff: RevisionDiff | undefined;
  candidates: readonly Candidate[];
  operation: PlanRevision["operation"];
}): React.ReactElement | null {
  if (diff === undefined) return null;

  const note = operation.kind === "replan" ? operation.note : null;
  const added = diff.entries.filter((entry) => entry.kind === "added");
  const removed = diff.entries.filter((entry) => entry.kind === "removed");
  const moved = diff.entries.filter((entry) => entry.kind === "moved");

  return (
    <section className="diff">
      <h3>What changed</h3>
      {note !== null && (
        <p className="hint">
          <span className="mark">What was asked</span> “{note}”
        </p>
      )}
      <DiffList label="Added" entries={added} candidates={candidates} />
      <DiffList label="Removed" entries={removed} candidates={candidates} />
      <DiffList label="Moved" entries={moved} candidates={candidates} />
    </section>
  );
}

function candidateTitle(candidates: readonly Candidate[], candidateId: string): string {
  return candidates.find((each) => each.id === candidateId)?.title ?? "Something removed since";
}

/** `dayIndex` is 0-based on the wire, 1-based on the page — `dayHeading`'s rule. */
function dayLabel(placement: DiffPlacement): string {
  return `Day ${String(placement.dayIndex + 1)}`;
}

function DiffList({
  label,
  entries,
  candidates,
}: {
  label: string;
  entries: readonly DiffEntry[];
  candidates: readonly Candidate[];
}): React.ReactElement | null {
  if (entries.length === 0) return null;

  return (
    <div className="diff-group">
      <h4>{label}</h4>
      <ul>
        {entries.map((entry) => (
          <li key={`${entry.kind}-${entry.candidateId}`}>
            {candidateTitle(candidates, entry.candidateId)} —{" "}
            {entry.kind === "added" && dayLabel(entry.to)}
            {entry.kind === "removed" && dayLabel(entry.from)}
            {entry.kind === "moved" && `${dayLabel(entry.from)} → ${dayLabel(entry.to)}`}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Titles a user would recognise, for the re-plan form's checkboxes. */
const SPECIALIST_LABELS: Record<Specialist, string> = {
  "route-and-logistics": "routes and legs",
  lodging: "lodging",
  activities: "things to do",
  "conditions-and-gear": "conditions and gear",
  food: "food",
  practicalities: "permits and paperwork",
  budget: "budget",
};

/**
 * Re-plan named days, on the latest revision only.
 *
 * **Leaving every specialist box unchecked is one of the two choices, not the
 * absence of one.** It re-packs the selected days from candidates the plan
 * already has, with no model call and no new lookups — the copy beside the
 * checkboxes says so, so the empty state does not read as "you forgot
 * something".
 */
/** What this form can honestly build; `Document` supplies `baseRevisionId`. */
type ReplanDraft = Omit<Extract<ReviseRequest, { kind: "replan" }>, "baseRevisionId">;

function ReplanForm({
  days,
  busy,
  onSubmit,
}: {
  days: readonly PlanDay[];
  busy: boolean;
  onSubmit: (request: ReplanDraft) => void;
}): React.ReactElement {
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [selectedSpecialists, setSelectedSpecialists] = useState<Specialist[]>([]);
  const [note, setNote] = useState("");

  const toggleDay = (dayIndex: number): void => {
    setSelectedDays((current) =>
      current.includes(dayIndex)
        ? current.filter((each) => each !== dayIndex)
        : [...current, dayIndex].toSorted((a, b) => a - b),
    );
  };

  const toggleSpecialist = (specialist: Specialist): void => {
    setSelectedSpecialists((current) =>
      current.includes(specialist)
        ? current.filter((each) => each !== specialist)
        : [...current, specialist],
    );
  };

  const submit = (): void => {
    onSubmit({
      kind: "replan",
      days: selectedDays,
      specialists: selectedSpecialists,
      note: note.trim() === "" ? null : note,
    });
    setSelectedDays([]);
    setSelectedSpecialists([]);
    setNote("");
  };

  return (
    <fieldset className="replan">
      <legend>Re-plan some days</legend>

      <div className="choices">
        {days.map((day) => (
          <label
            key={day.id}
            className={selectedDays.includes(day.dayIndex) ? "choice on" : "choice"}
          >
            <input
              type="checkbox"
              checked={selectedDays.includes(day.dayIndex)}
              onChange={() => toggleDay(day.dayIndex)}
            />
            <span>{dayHeading(day)}</span>
          </label>
        ))}
      </div>
      <p className="hint">Choose at least one day to re-plan.</p>

      <div className="choices">
        {ALL_SPECIALISTS.map((specialist) => (
          <label
            key={specialist}
            className={selectedSpecialists.includes(specialist) ? "choice on" : "choice"}
          >
            <input
              type="checkbox"
              checked={selectedSpecialists.includes(specialist)}
              onChange={() => toggleSpecialist(specialist)}
            />
            <span>{SPECIALIST_LABELS[specialist]}</span>
          </label>
        ))}
      </div>
      <p className="hint">
        Optional. Leaving every box unchecked re-packs these days from what the plan already has —
        no model call.
      </p>

      <label htmlFor="replan-note">Anything the specialists should know?</label>
      <textarea
        id="replan-note"
        className="field"
        rows={2}
        maxLength={MAX_REVISION_NOTE_CHARS}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <p className="hint">Read as context by the specialists, never as an instruction.</p>

      <div className="actions">
        <button
          type="button"
          className="primary"
          disabled={busy || selectedDays.length === 0}
          onClick={submit}
        >
          Re-plan these days
        </button>
      </div>
    </fieldset>
  );
}
