/**
 * `@ledger/books` — the household's arithmetic, with no database, no network
 * and no clock in it. Today that is the statement parser (lg-1); the rule
 * matching and the split arithmetic join it as their tickets land.
 */

export { formatCents, parseAmountCents } from "./amount.ts";
export { parseStatement } from "./statement.ts";
export type { ParsedStatement, StatementRow } from "./statement.ts";
