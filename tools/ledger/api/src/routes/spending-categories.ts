/**
 * Spending categories (lg-15): the list, the map from Desjardins' own categories
 * to it, a row's own override, and the stored rows with theirs.
 *
 * Every write is a `POST` because every write appends: a rename files a version of
 * the category, a retirement another, a map line and an override a record each.
 * Who acted comes from `personOf`. A Desjardins category is bank text, so a
 * refusal names the field and never repeats the value.
 */

import {
  AppError,
  ROUTES,
  rowsQuerySchema,
  setSpendingCategoryMapRequestSchema,
  spendingCategoryDraftSchema,
  spendingCategoryOverrideRequestSchema,
} from "@ledger/contract";
import type {
  RowsResponse,
  SpendingCategoriesResponse,
  SpendingCategory,
  SpendingCategoryMapEntry,
  SpendingCategoryMapResponse,
  SpendingCategoryOverrideResponse,
} from "@ledger/contract";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AppContext } from "../context.ts";
import { rateLimitsFor } from "../rate-limit.ts";
import { listRows, setSpendingCategoryOverride } from "../rows.ts";
import {
  createSpendingCategory,
  renameSpendingCategory,
  retireSpendingCategory,
  setSpendingCategoryMap,
  spendingCategories,
  spendingCategoryMap,
} from "../spending-categories.ts";
import { ruleContext } from "./rules.ts";

function categoryId(request: FastifyRequest): number {
  const raw = (request.params as { id?: unknown }).id;
  const id = typeof raw === "string" && /^\d{1,15}$/u.test(raw) ? Number(raw) : 0;
  if (id < 1) throw new AppError("BAD_REQUEST", "A spending category is named by its number.");
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

/** The input, or a refusal naming the fields that were wrong and none of their values. */
function parsed<T>(schema: Schema<T>, input: unknown, what: string): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const fields = [
      ...new Set(result.error.issues.map((issue) => String(issue.path[0] ?? "body"))),
    ];
    throw new AppError("BAD_REQUEST", `The ${what} is not valid: check ${fields.join(", ")}.`);
  }
  return result.data;
}

export function registerSpendingCategoryRoutes(app: FastifyInstance, context: AppContext): void {
  const { read, write } = rateLimitsFor(context);

  app.get(ROUTES.spendingCategories, { onRequest: read }, async () => {
    const body: SpendingCategoriesResponse = { categories: spendingCategories(context.db) };
    return body;
  });

  app.post(ROUTES.spendingCategories, { onRequest: write }, async (request) => {
    const category: SpendingCategory = createSpendingCategory(
      ruleContext(context, request),
      parsed(spendingCategoryDraftSchema, request.body, "spending category"),
    );
    return category;
  });

  // Renamed: a new version of the category, under the same id.
  app.post(ROUTES.spendingCategory, { onRequest: write }, async (request) => {
    const category: SpendingCategory = renameSpendingCategory(
      ruleContext(context, request),
      categoryId(request),
      parsed(spendingCategoryDraftSchema, request.body, "spending category"),
    );
    return category;
  });

  // Retired, not deleted: what already picked it keeps it.
  app.post(ROUTES.spendingCategoryRetire, { onRequest: write }, async (request) => {
    const category: SpendingCategory = retireSpendingCategory(
      ruleContext(context, request),
      categoryId(request),
    );
    return category;
  });

  app.get(ROUTES.spendingCategoryMap, { onRequest: read }, async () => {
    const body: SpendingCategoryMapResponse = { entries: spendingCategoryMap(context.db) };
    return body;
  });

  app.post(ROUTES.spendingCategoryMap, { onRequest: write }, async (request) => {
    const entry: SpendingCategoryMapEntry = setSpendingCategoryMap(
      ruleContext(context, request),
      parsed(setSpendingCategoryMapRequestSchema, request.body, "map entry"),
    );
    return entry;
  });

  app.post(ROUTES.spendingCategoryOverrides, { onRequest: write }, async (request) => {
    const response: SpendingCategoryOverrideResponse = setSpendingCategoryOverride(
      ruleContext(context, request),
      parsed(spendingCategoryOverrideRequestSchema, request.body, "override"),
    );
    return response;
  });

  app.get(ROUTES.rows, { onRequest: read }, async (request) => {
    const query = parsed(rowsQuerySchema, request.query, "query");
    const body: RowsResponse = listRows(context.db, {
      ...(query.spendingCategory === "none" ? { uncategorised: true } : {}),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
    });
    return body;
  });
}
