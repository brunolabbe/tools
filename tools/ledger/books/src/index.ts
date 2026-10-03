/**
 * `@ledger/books` — the household's arithmetic, with no database, no network
 * and no clock in it. Today that is the statement parser (lg-1) and the rule
 * matching that files a row under a bucket (lg-4); the split arithmetic joins it
 * as its ticket lands.
 */

export { formatCents, parseAmountCents, parseTypedAmountCents } from "./amount.ts";
export { classify, matchesPattern } from "./classify.ts";
export type { ClassifiableRow, MatchableRule, RuleMatch } from "./classify.ts";
export { parseStatement } from "./statement.ts";
export type { ParsedStatement, StatementRow } from "./statement.ts";
