/**
 * The plan run, over HTTP and over SSE.
 *
 * Like the intake's client, this returns what the server computed and nothing
 * this file worked out for itself. In particular **the roster's size comes down
 * the wire**: how many specialists a trip needs is a function of the brief, and
 * a browser that guessed at it would be a second copy of the roster table.
 */

import {
  planItemPinUrl,
  planUrl,
  ROUTES,
  runCancelUrl,
  runEventsUrl,
  runEventSchema,
  type PinItemRequest,
  type Plan,
  type PlanListResponse,
  type PlanView,
  type Run,
  type RunEvent,
} from "@planner/contract";
import { requestJson } from "./client.ts";

export async function startRun(intakeId: string): Promise<Run> {
  return await requestJson<Run>(ROUTES.plans, { method: "POST", body: { intakeId } });
}

/**
 * The plans list.
 *
 * `Plan` rows and not documents — the server does the same split, and a client
 * that fetched each plan to show a title would undo the point of it.
 */
export async function fetchPlans(signal?: AbortSignal): Promise<readonly Plan[]> {
  return (await requestJson<PlanListResponse>(ROUTES.plans, { signal })).plans;
}

/**
 * One plan, with what nothing checked about it.
 *
 * The `unchecked` half is computed server-side and comes down the wire for the
 * same reason the intake's progress does: it is decided where the composer's
 * rules live, and a browser working it out for itself would be a second
 * implementation of them that could quietly disagree.
 */
export async function fetchPlan(id: string, signal?: AbortSignal): Promise<PlanView> {
  return await requestJson<PlanView>(planUrl(id), { signal });
}

/**
 * Pin or unpin one item, and take back the whole view.
 *
 * Absolute and not a toggle, matching the request type: what comes back is
 * authoritative, so two tabs on one plan converge instead of flipping each
 * other. This appends no revision — that is the database's rule as much as this
 * client's expectation.
 */
export async function pinItem(planId: string, itemId: string, pinned: boolean): Promise<PlanView> {
  return await requestJson<PlanView>(planItemPinUrl(planId, itemId), {
    method: "POST",
    body: { pinned } satisfies PinItemRequest,
  });
}

export async function cancelRun(id: string): Promise<Run> {
  return await requestJson<Run>(runCancelUrl(id), { method: "POST" });
}

/**
 * Watch a run.
 *
 * Every frame is validated with the contract's own schema before it reaches a
 * component: the server emits the union verbatim, so anything that does not
 * parse is a bug on the other side and is dropped rather than rendered. A
 * `heartbeat` is not dropped by this function — it parses like any other frame,
 * and the caller ignores it — because the whole point of it arriving is that the
 * connection is alive.
 *
 * Returns the unsubscribe. The `EventSource` reconnects on its own if the
 * connection drops, and the server sends a `snapshot` on every connect, so a
 * reconnected client catches up without this file keeping a replay buffer.
 */
export function watchRun(runId: string, onEvent: (event: RunEvent) => void): () => void {
  const source = new EventSource(runEventsUrl(runId));

  source.addEventListener("message", (message: MessageEvent<string>) => {
    let payload: unknown;
    try {
      payload = JSON.parse(message.data);
    } catch {
      return;
    }
    const parsed = runEventSchema.safeParse(payload);
    if (!parsed.success) return;

    onEvent(parsed.data);
    // The stream ends itself on a terminal frame; closing here stops the
    // browser from reconnecting to a run that has nothing left to say.
    if (parsed.data.type === "done" || parsed.data.type === "failed") source.close();
    if (parsed.data.type === "canceled") source.close();
  });

  return () => source.close();
}
