/**
 * Periods, their lines, the recurring items, and closing a period (lg-6).
 *
 * Every write is a `POST` because every write appends: a line is corrected or
 * retired by a later line, a recurring item changed or ended by a later
 * version, and a period closed by recording it. Who acted comes from `personOf`.
 * A line's category and note are the household's own words, so a refusal names
 * the field and never repeats the value.
 */

import {
  AppError,
  ROUTES,
  closePeriodRequestSchema,
  openPeriodQuerySchema,
  periodLineDraftSchema,
  recurringItemDraftSchema,
} from "@ledger/contract";
import type {
  ClosedPeriod,
  OpenPeriodResponse,
  PeriodLine,
  PeriodsResponse,
  RecurringItem,
  RecurringResponse,
} from "@ledger/contract";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AppContext } from "../context.ts";
import {
  addLine,
  addRecurring,
  changeRecurring,
  closePeriod,
  closedPeriods,
  correctLine,
  currentRecurring,
  openPeriod,
  retireLine,
} from "../periods.ts";
import { rateLimitsFor } from "../rate-limit.ts";
import { ruleContext } from "./rules.ts";

function idOf(request: FastifyRequest, what: string): number {
  const raw = (request.params as { id?: unknown }).id;
  const id = typeof raw === "string" && /^\d{1,15}$/u.test(raw) ? Number(raw) : 0;
  if (id < 1) throw new AppError("BAD_REQUEST", `A ${what} is named by its number.`);
  return id;
}

/** What a contract schema offers, without this package importing zod itself. */
interface Schema<T> {
  safeParse(
    input: unknown,
  ):
    | { success: true; data: T }
    | { success: false; error: { issues: readonly { path: readonly PropertyKey[] }[] } };
}

/** The body, or a refusal naming the fields that were wrong and none of their values. */
function bodyOf<T>(schema: Schema<T>, request: FastifyRequest, what: string): T {
  const body = schema.safeParse(request.body);
  if (!body.success) {
    const fields = [...new Set(body.error.issues.map((issue) => String(issue.path[0] ?? "body")))];
    throw new AppError("BAD_REQUEST", `The ${what} is not valid: check ${fields.join(", ")}.`);
  }
  return body.data;
}

export function registerPeriodRoutes(app: FastifyInstance, context: AppContext): void {
  const { read, write } = rateLimitsFor(context);
  const today = (): string => context.now().toISOString().slice(0, 10);

  app.get(ROUTES.periods, { onRequest: read }, async () => {
    const body: PeriodsResponse = { periods: closedPeriods(context.db) };
    return body;
  });

  app.get(ROUTES.periodOpen, { onRequest: read }, async (request) => {
    const query = openPeriodQuerySchema.safeParse(request.query);
    if (!query.success) {
      throw new AppError("BAD_REQUEST", "start and end are days, written yyyy-mm-dd.");
    }
    const body: OpenPeriodResponse = openPeriod(context.db, {
      start: query.data.start,
      end: query.data.end ?? today(),
    });
    return body;
  });

  app.post(ROUTES.periodClose, { onRequest: write }, async (request) => {
    const closed: ClosedPeriod = closePeriod(
      ruleContext(context, request),
      bodyOf(closePeriodRequestSchema, request, "close"),
    );
    return closed;
  });

  app.post(ROUTES.periodLines, { onRequest: write }, async (request) => {
    const line: PeriodLine = addLine(
      ruleContext(context, request),
      bodyOf(periodLineDraftSchema, request, "line"),
    );
    return line;
  });

  // The line as corrected, under a new id: the line it replaces is not changed.
  app.post(ROUTES.periodLine, { onRequest: write }, async (request) => {
    const line: PeriodLine = correctLine(
      ruleContext(context, request),
      idOf(request, "line"),
      bodyOf(periodLineDraftSchema, request, "line"),
    );
    return line;
  });

  // The line as it stood. Its record stays.
  app.post(ROUTES.periodLineRetire, { onRequest: write }, async (request) => {
    const line: PeriodLine = retireLine(ruleContext(context, request), idOf(request, "line"));
    return line;
  });

  // CodeQL's `js/missing-rate-limiting` models express-rate-limit and its kin,
  // not `@webtools/core`'s `RateLimiter`, so it reads the `read` hook on this
  // route as no limit at all; the route is limited per person like every other
  // (`rate-limit.ts`). Excused under `docs/adr/005`, here in
  // `api/src/routes/periods.ts`. Guarded by `api/test/route-limits.test.ts`:
  // taking `{ onRequest: read }` off this route fails 1 of its 31 tests, "GET
  // recurring refuses the second request in a minute too" — that test, not this
  // comment, is what holds it. Measured 2026-10-06 at 0862fd3.
  // codeql[js/missing-rate-limiting]
  app.get(ROUTES.recurring, { onRequest: read }, async () => {
    const body: RecurringResponse = { items: currentRecurring(context.db) };
    return body;
  });

  app.post(ROUTES.recurring, { onRequest: write }, async (request) => {
    const item: RecurringItem = addRecurring(
      ruleContext(context, request),
      bodyOf(recurringItemDraftSchema, request, "recurring item"),
    );
    return item;
  });

  // A correction, or an end date: a new version, under a new id.
  app.post(ROUTES.recurringItem, { onRequest: write }, async (request) => {
    const item: RecurringItem = changeRecurring(
      ruleContext(context, request),
      idOf(request, "recurring item"),
      bodyOf(recurringItemDraftSchema, request, "recurring item"),
    );
    return item;
  });
}
