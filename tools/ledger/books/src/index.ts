/**
 * `@ledger/books` — the household's arithmetic, with no database, no network
 * and no clock in it. Today that is the statement parser (lg-1), the rule
 * matching that files a row under a bucket (lg-4), and what each bucket holds and
 * whose it is, with the ratio derived from the salaries (lg-5).
 */

export { formatCents, parseAmountCents, parseTypedAmountCents } from "./amount.ts";
export { bufferAsOf, mortgageAsOf, splitCents } from "./buckets.ts";
export type { BufferPosition, Contribution, FiledRow, Lead, MortgagePosition } from "./buckets.ts";
export { PARTS_PER_MILLION, ratioFromSalaries, ratioInEffect } from "./ratio.ts";
export type { SalaryInput, Share } from "./ratio.ts";
export { classify, matchesPattern } from "./classify.ts";
export type { ClassifiableRow, MatchableRule, RuleMatch } from "./classify.ts";
export { parseStatement } from "./statement.ts";
export type { ParsedStatement, StatementRow } from "./statement.ts";
