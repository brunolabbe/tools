/**
 * Every route the API answers, with the verb a request to it takes — walked by
 * the rate-limit suite (lg-4) and the identity suite (lg-20). The `satisfies`
 * makes a route added to the contract without a line here a compile error, and
 * `route-limits.test.ts` checks the keys at run time too.
 */

import { ROUTES } from "@ledger/contract";

export const VERBS = {
  health: ["GET", ROUTES.health],
  me: ["GET", ROUTES.me],
  statements: ["POST", ROUTES.statements],
  rules: ["GET", ROUTES.rules],
  rule: ["POST", ROUTES.rule.replace(":id", "1")],
  ruleRetire: ["POST", ROUTES.ruleRetire.replace(":id", "1")],
  inbox: ["GET", ROUTES.inbox],
  autoFiled: ["GET", ROUTES.autoFiled],
  classifications: ["POST", ROUTES.classifications],
  people: ["GET", ROUTES.people],
  buckets: ["GET", ROUTES.buckets],
  salaries: ["POST", ROUTES.salaries],
  ratios: ["POST", ROUTES.ratios],
  periods: ["GET", ROUTES.periods],
  periodOpen: ["GET", ROUTES.periodOpen],
  periodClose: ["POST", ROUTES.periodClose],
  periodLines: ["POST", ROUTES.periodLines],
  periodLine: ["POST", ROUTES.periodLine.replace(":id", "1")],
  periodLineRetire: ["POST", ROUTES.periodLineRetire.replace(":id", "1")],
  recurring: ["POST", ROUTES.recurring],
  recurringItem: ["POST", ROUTES.recurringItem.replace(":id", "1")],
  spendingCategories: ["GET", ROUTES.spendingCategories],
  spendingCategory: ["POST", ROUTES.spendingCategory.replace(":id", "1")],
  spendingCategoryRetire: ["POST", ROUTES.spendingCategoryRetire.replace(":id", "1")],
  spendingCategoryMap: ["GET", ROUTES.spendingCategoryMap],
  spendingCategoryOverrides: ["POST", ROUTES.spendingCategoryOverrides],
  rows: ["GET", ROUTES.rows],
  statsMortgagePayments: ["GET", ROUTES.statsMortgagePayments],
  statsSalaries: ["GET", ROUTES.statsSalaries],
  statsContributions: ["GET", ROUTES.statsContributions],
  statsMortgageOwn: ["GET", ROUTES.statsMortgageOwn],
  statsBuffer: ["GET", ROUTES.statsBuffer],
  statsSpending: ["GET", ROUTES.statsSpending],
  statsFixedItems: ["GET", ROUTES.statsFixedItems],
  statsSettlements: ["GET", ROUTES.statsSettlements],
} as const satisfies Record<keyof typeof ROUTES, readonly ["GET" | "POST", string]>;
