/**
 * The spending categories (lg-15): the list, the map from Desjardins' own
 * categories to it, and a row's own override. Every write is a `POST` that appends.
 *
 * "Category" on a row is Desjardins' text; everything here is a *spending*
 * category, from the one shared list.
 */

import { ROUTES } from "@ledger/contract";
import type {
  RowsResponse,
  SpendingCategoriesResponse,
  SpendingCategory,
  SpendingCategoryMapEntry,
  SpendingCategoryMapResponse,
  SpendingCategoryOverrideResponse,
} from "@ledger/contract";
import { requestJson } from "./client.ts";

function withId(route: string, id: number): string {
  return route.replace(":id", String(id));
}

/** Every category, retired ones too: a retired one is still the name of what picked it. */
export async function fetchSpendingCategories(signal?: AbortSignal): Promise<SpendingCategory[]> {
  return (await requestJson<SpendingCategoriesResponse>(ROUTES.spendingCategories, { signal }))
    .categories;
}

export async function addSpendingCategory(name: string): Promise<SpendingCategory> {
  return await requestJson<SpendingCategory>(ROUTES.spendingCategories, {
    method: "POST",
    body: { name },
  });
}

/** A new version under the same id; what picked the category keeps it. */
export async function renameSpendingCategory(id: number, name: string): Promise<SpendingCategory> {
  return await requestJson<SpendingCategory>(withId(ROUTES.spendingCategory, id), {
    method: "POST",
    body: { name },
  });
}

export async function retireSpendingCategory(id: number): Promise<SpendingCategory> {
  return await requestJson<SpendingCategory>(withId(ROUTES.spendingCategoryRetire, id), {
    method: "POST",
  });
}

export async function fetchSpendingMap(signal?: AbortSignal): Promise<SpendingCategoryMapEntry[]> {
  return (await requestJson<SpendingCategoryMapResponse>(ROUTES.spendingCategoryMap, { signal }))
    .entries;
}

/** A version of one map line; `null` clears it. The earlier versions are kept. */
export async function setSpendingMapEntry(
  desjardinsCategory: string,
  spendingCategoryId: number | null,
): Promise<SpendingCategoryMapEntry> {
  return await requestJson<SpendingCategoryMapEntry>(ROUTES.spendingCategoryMap, {
    method: "POST",
    body: { desjardinsCategory, spendingCategoryId },
  });
}

/** A row's own spending category; `null` withdraws it. */
export async function setRowSpendingCategory(
  rowId: number,
  spendingCategoryId: number | null,
): Promise<SpendingCategoryOverrideResponse> {
  return await requestJson<SpendingCategoryOverrideResponse>(ROUTES.spendingCategoryOverrides, {
    method: "POST",
    body: { rowId, spendingCategoryId },
  });
}

/** The stored rows no spending category has been found for, newest first. */
export async function fetchUncategorisedRows(signal?: AbortSignal): Promise<RowsResponse> {
  return await requestJson<RowsResponse>(`${ROUTES.rows}?spendingCategory=none&limit=50`, {
    signal,
  });
}
