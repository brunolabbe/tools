/**
 * `@ledger/books` — the household's arithmetic, with no database, no network
 * and no clock in it. Today that is the statement parser (lg-1), the rule
 * matching that files a row under a bucket (lg-4), and what each bucket holds and
 * whose it is, with the ratio derived from the salaries (lg-5); and periods of
 * personal-card spending, with the settlement closing one computes (lg-6); and
 * the spending category a bank row has (lg-15); and what a person answered
 * before, offered (lg-16) or filed on (lg-17); and the history's series (lg-9);
 * and whether a receipt adds up, and which rows it may document (lg-8);
 * and a row's amount divided among its receipt's item categories (lg-27).
 */

export { formatCents, parseAmountCents, parseTypedAmountCents } from "./amount.ts";
export { bufferAsOf, mortgageAsOf, splitCents } from "./buckets.ts";
export type { BufferPosition, Contribution, FiledRow, Lead, MortgagePosition } from "./buckets.ts";
export { PARTS_PER_MILLION, ratioFromSalaries, ratioInEffect } from "./ratio.ts";
export type { SalaryInput, Share } from "./ratio.ts";
export {
  cumulativeHouseholdSettlement,
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
export {
  CURRENT_FORMULA,
  asPair,
  netsOf,
  settleHousehold,
  settleStretches,
  settlement,
} from "./settlement.ts";
export type {
  Charge,
  HouseholdSettlement,
  PersonCents,
  Settlement,
  Stretch,
} from "./settlement.ts";
export { classify, matchesPattern, normalize as normalizeDescription } from "./classify.ts";
export type { ClassifiableRow, MatchableRule, RuleMatch } from "./classify.ts";
export { spendingCategory, spendingMap } from "./spending.ts";
export type {
  SpendingChoice,
  SpendingMap,
  SpendingMapVersion,
  SpendingRule,
  SpendingSource,
} from "./spending.ts";
export { autoFile, fromHistory } from "./history.ts";
export type {
  AutoFilableRow,
  AutoFileRefusal,
  AutoFiling,
  HistoryAnswer,
  HistorySuggestion,
} from "./history.ts";
export {
  bufferSeries,
  contributionSeries,
  everyone,
  fixedItemsByMonth,
  inRange,
  mortgageOwnSeries,
  mortgagePayments,
  salariesByYear,
  settlementsInRange,
  spendingByPeriod,
} from "./stats.ts";
export type {
  FixedItemInput,
  RatioRecord,
  SalaryRecord,
  SpendingEntry,
  SpendingSpan,
  StatRow,
} from "./stats.ts";
export {
  RATE_SCALE,
  RECEIPT_MATCH_DAYS,
  SALES_TAX_RATES,
  checkReceipt,
  itemsAddUp,
  matchReceipt,
  ratesOn,
  sharedAmount,
  splitByCategory,
  splitReceipt,
} from "./receipts.ts";
export type {
  CategoryAmount,
  MatchableRow,
  ReceiptChargeSplit,
  ReceiptSplit,
  RowMatch,
  SalesTaxRates,
} from "./receipts.ts";
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
  PeriodDeposit,
  WorkbookReading,
  WorkbookSettlement,
} from "./workbook.ts";
