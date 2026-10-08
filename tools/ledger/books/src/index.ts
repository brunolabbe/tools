/**
 * `@ledger/books` — the household's arithmetic, with no database, no network
 * and no clock in it. Today that is the statement parser (lg-1), the rule
 * matching that files a row under a bucket (lg-4), and what each bucket holds and
 * whose it is, with the ratio derived from the salaries (lg-5); and periods of
 * personal-card spending, with the settlement closing one computes (lg-6).
 */

export { formatCents, parseAmountCents, parseTypedAmountCents } from "./amount.ts";
export { bufferAsOf, mortgageAsOf, splitCents } from "./buckets.ts";
export type { BufferPosition, Contribution, FiledRow, Lead, MortgagePosition } from "./buckets.ts";
export { PARTS_PER_MILLION, ratioFromSalaries, ratioInEffect } from "./ratio.ts";
export type { SalaryInput, Share } from "./ratio.ts";
export {
  cumulativeSettlement,
  dayAfter,
  enteredLate,
  matchDeposits,
  periodIndexOf,
  recurringDates,
} from "./periods.ts";
export type {
  CandidateRow,
  ClosedSpan,
  DepositInput,
  DepositMatch,
  Expectation,
  LineInput,
  PeriodSpan,
  RecurringInput,
  WeighedPeriod,
} from "./periods.ts";
export { CURRENT_FORMULA, settleStretches, settlement } from "./settlement.ts";
export type { Charge, PersonCents, Settlement, Stretch } from "./settlement.ts";
export { classify, matchesPattern, normalize as normalizeDescription } from "./classify.ts";
export type { ClassifiableRow, MatchableRule, RuleMatch } from "./classify.ts";
export { fromHistory } from "./history.ts";
export type { HistoryAnswer, HistorySuggestion } from "./history.ts";
export { parseStatement } from "./statement.ts";
export type { ParsedStatement, StatementRow } from "./statement.ts";
export {
  NO_CORRECTIONS,
  cellRef,
  noteOf,
  readCorrections,
  readWorkbook,
  toCents,
  workbookFigures,
} from "./workbook.ts";
export type {
  CarryOver,
  Cell,
  CellValue,
  Correction,
  Corrections,
  Movement,
  OutOfOrder,
  ReadOptions,
  Repair,
  Sheet,
  Skip,
  WorkbookFigures,
  WorkbookLine,
  WorkbookPeriod,
  WorkbookReading,
  WorkbookSettlement,
} from "./workbook.ts";
