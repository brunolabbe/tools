/**
 * The rules in force (lg-4); who they may name is `GET /api/people`, in
 * `people.ts`. Every write is a `POST` that appends.
 */

import { ROUTES } from "@ledger/contract";
import type { Rule, RuleDraft, RulesResponse } from "@ledger/contract";
import { requestJson } from "./client.ts";

/** `:id` in a route pattern is filled in here; the pattern itself lives in the contract. */
function forRule(route: string, id: number): string {
  return route.replace(":id", String(id));
}

export async function fetchRules(signal?: AbortSignal): Promise<Rule[]> {
  return (await requestJson<RulesResponse>(ROUTES.rules, { signal })).rules;
}

export async function createRule(draft: RuleDraft): Promise<Rule> {
  return await requestJson<Rule>(ROUTES.rules, { method: "POST", body: draft });
}

/** The rule as edited, under a new id: the version it replaces is kept. */
export async function editRule(id: number, draft: RuleDraft): Promise<Rule> {
  return await requestJson<Rule>(forRule(ROUTES.rule, id), { method: "POST", body: draft });
}

export async function retireRule(id: number): Promise<Rule> {
  return await requestJson<Rule>(forRule(ROUTES.ruleRetire, id), { method: "POST" });
}
