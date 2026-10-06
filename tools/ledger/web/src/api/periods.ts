/**
 * Periods, their lines and recurring items, and closing one (lg-6). Every write
 * is a `POST` that appends.
 */

import { ROUTES } from "@ledger/contract";
import type {
  ClosePeriodRequest,
  ClosedPeriod,
  MeResponse,
  OpenPeriodResponse,
  PeriodLine,
  PeriodLineDraft,
  PeriodsResponse,
  RecurringItem,
  RecurringItemDraft,
  RecurringResponse,
} from "@ledger/contract";
import { requestJson } from "./client.ts";

function withId(route: string, id: number): string {
  return route.replace(":id", String(id));
}

/** Who is signed in: the person a new line is paid by, unless they choose another. */
export async function fetchMe(signal?: AbortSignal): Promise<string> {
  return (await requestJson<MeResponse>(ROUTES.me, { signal })).person.id;
}

/**
 * The open period as if it ended on `end` (today by the API's clock when left
 * out). `start` is only read for the first period, whose start is chosen.
 */
export async function fetchOpenPeriod(
  range: { start?: string | null; end?: string },
  signal?: AbortSignal,
): Promise<OpenPeriodResponse> {
  const query = new URLSearchParams();
  if (range.start !== undefined && range.start !== null) query.set("start", range.start);
  if (range.end !== undefined) query.set("end", range.end);
  const text = query.toString();
  return await requestJson<OpenPeriodResponse>(
    text === "" ? ROUTES.periodOpen : `${ROUTES.periodOpen}?${text}`,
    { signal },
  );
}

/** The closed periods, newest first, each with whether its deposit has been seen. */
export async function fetchPeriods(signal?: AbortSignal): Promise<ClosedPeriod[]> {
  return (await requestJson<PeriodsResponse>(ROUTES.periods, { signal })).periods;
}

export async function closePeriod(request: ClosePeriodRequest): Promise<ClosedPeriod> {
  return await requestJson<ClosedPeriod>(ROUTES.periodClose, { method: "POST", body: request });
}

export async function addLine(draft: PeriodLineDraft): Promise<PeriodLine> {
  return await requestJson<PeriodLine>(ROUTES.periodLines, { method: "POST", body: draft });
}

/** The line as it stood; its record is kept. */
export async function retireLine(id: number): Promise<PeriodLine> {
  return await requestJson<PeriodLine>(withId(ROUTES.periodLineRetire, id), { method: "POST" });
}

export async function fetchRecurring(signal?: AbortSignal): Promise<RecurringItem[]> {
  return (await requestJson<RecurringResponse>(ROUTES.recurring, { signal })).items;
}

export async function addRecurring(draft: RecurringItemDraft): Promise<RecurringItem> {
  return await requestJson<RecurringItem>(ROUTES.recurring, { method: "POST", body: draft });
}

/** A correction or an end date, as a new version; the earlier one is kept. */
export async function changeRecurring(
  id: number,
  draft: RecurringItemDraft,
): Promise<RecurringItem> {
  return await requestJson<RecurringItem>(withId(ROUTES.recurringItem, id), {
    method: "POST",
    body: draft,
  });
}
