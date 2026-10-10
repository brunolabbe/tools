/**
 * HTTP API contract.
 *
 * The API app validates requests with these schemas; the web app derives its
 * client types from the same file. Neither side hand-writes a duplicate shape —
 * which is why `HealthResponse` lives here rather than beside its route: the UI
 * reads it too.
 */

import { z } from "zod";
import { ERROR_CODES } from "./errors.ts";
import type { AppErrorPayload } from "./errors.ts";

/** One prefix, named once, so the UI and the dev proxy cannot disagree about it. */
export const API_PREFIX = "/api";

/**
 * Every path this API answers on, as **Fastify patterns**: `:id` is a parameter
 * and not a literal. The server registers these strings directly and the client
 * fills them in, so a path exists once.
 */
export const ROUTES = {
  health: `${API_PREFIX}/health`,
  me: `${API_PREFIX}/me`,
  statements: `${API_PREFIX}/statements`,
  // lg-4: the rules, the inbox of unclassified rows, and who the rules may name.
  rules: `${API_PREFIX}/rules`,
  rule: `${API_PREFIX}/rules/:id`,
  ruleRetire: `${API_PREFIX}/rules/:id/retire`,
  inbox: `${API_PREFIX}/inbox`,
  // lg-17: the rows history filed with nobody tapping, for a person to review.
  autoFiled: `${API_PREFIX}/inbox/auto-filed`,
  classifications: `${API_PREFIX}/classifications`,
  people: `${API_PREFIX}/people`,
  // lg-5: what each bucket holds and whose it is, the salaries, and the ratio.
  buckets: `${API_PREFIX}/buckets`,
  salaries: `${API_PREFIX}/salaries`,
  ratios: `${API_PREFIX}/ratios`,
  // lg-6: periods of personal-card spending, their lines, the recurring items,
  // and closing a period with the settlement it computes.
  periods: `${API_PREFIX}/periods`,
  periodOpen: `${API_PREFIX}/periods/open`,
  periodClose: `${API_PREFIX}/periods/close`,
  periodLines: `${API_PREFIX}/period-lines`,
  periodLine: `${API_PREFIX}/period-lines/:id`,
  periodLineRetire: `${API_PREFIX}/period-lines/:id/retire`,
  recurring: `${API_PREFIX}/recurring`,
  recurringItem: `${API_PREFIX}/recurring/:id`,
  // lg-15: the one list of spending categories, the map from Desjardins' own
  // categories to it, a row's own override, and the stored rows with theirs.
  spendingCategories: `${API_PREFIX}/spending-categories`,
  spendingCategory: `${API_PREFIX}/spending-categories/:id`,
  spendingCategoryRetire: `${API_PREFIX}/spending-categories/:id/retire`,
  spendingCategoryMap: `${API_PREFIX}/spending-category-map`,
  spendingCategoryOverrides: `${API_PREFIX}/spending-category-overrides`,
  rows: `${API_PREFIX}/rows`,
} as const;

/**
 * Who a request is from: the Access identity, mapped to a person by the API's
 * configuration (lg-3). `id` is the configured name for the person, which is
 * what anything that records "who did this" keys on; `email` is the address
 * Access vouched for.
 */
export interface Person {
  id: string;
  email: string;
}

/** `GET /api/me`: the caller, as the API identified them. */
export interface MeResponse {
  person: Person;
}

/** `POST /api/statements`: an AccèsD paste, exactly as the clipboard held it. */
export const importStatementRequestSchema = z.object({
  text: z.string().min(1),
}) satisfies z.ZodType<ImportStatementRequest>;

export interface ImportStatementRequest {
  text: string;
}

/**
 * What storing a paste did. `rowsAdded + rowsAlreadyPresent` is every row the
 * paste held, so a paste pasted twice reads `0` and all of them the second time.
 * `tailBalanceCents` is the account's balance after the newest stored row, which
 * is what the user checks against the bank's own figure.
 */
export interface ImportStatementReport {
  rowsAdded: number;
  rowsAlreadyPresent: number;
  tailBalanceCents: number;
}

/**
 * `GET /api/health`.
 *
 * **Never a path, never a key.** The database's location is infrastructure
 * detail, and this tool will hold the household's bank history — so health
 * says whether the database is open and nothing about where it is.
 */
export interface HealthResponse {
  ok: boolean;
  shuttingDown: boolean;
  version: string;
  uptimeSec: number;
  database: { open: boolean };
}

export const errorPayloadSchema = z.object({
  code: z.enum(ERROR_CODES),
  message: z.string(),
  retryable: z.boolean(),
  details: z.record(z.string(), z.unknown()).optional(),
}) satisfies z.ZodType<AppErrorPayload>;

/** What every failed request returns, whatever its status. */
export interface ErrorResponse {
  error: AppErrorPayload;
}

/**
 * The two buckets every row belongs to one of (`docs/00-ANALYSIS.md` §1). The
 * mortgage is split 50/50 and current expenses by the salary ratio, which is
 * lg-5's arithmetic; here a bucket is only a label a row is filed under.
 */
export const BUCKETS = ["mortgage", "current-expenses"] as const;
export type Bucket = (typeof BUCKETS)[number];

/**
 * A classification rule, as it stands now (lg-4). Rules are data, edited by both
 * people and kept in the database only: caisse names identify a household.
 *
 * **A row takes a rule only on an exact match** — the whole description matches
 * `descriptionPattern`, the category equals `category` when the rule names one,
 * and the amount equals `amountCents` when it names one. `null` means "any".
 * A pattern is the description as the bank writes it, compared with case, accents
 * and runs of spaces ignored, in which `*` stands for any run of characters.
 *
 * `id` names one *version*: editing a rule files a new version under a new id
 * and retiring one files a retirement, so the id a classification cites is
 * always the rule as it read then. `personId` is a configured person, and
 * `null` is **joint**: a rebate, the sale of a shared thing, one half of an
 * error pair.
 */
export interface Rule {
  id: number;
  descriptionPattern: string;
  /** Desjardins' own category for the row, not a spending category. */
  category: string | null;
  amountCents: number | null;
  personId: string | null;
  bucket: Bucket;
  /**
   * The spending category (lg-15) every row this rule files takes, over the map's;
   * `null` leaves the row to the map. Part of the version: editing it supersedes
   * the rule like any other field.
   */
  spendingCategoryId: number | null;
  createdAt: string;
  createdBy: string;
}

/** What a person fills in to add a rule, or to replace one. */
export interface RuleDraft {
  descriptionPattern: string;
  category: string | null;
  amountCents: number | null;
  personId: string | null;
  bucket: Bucket;
  spendingCategoryId: number | null;
}

export const ruleDraftSchema = z.object({
  descriptionPattern: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(200).nullable(),
  amountCents: z.number().int().nullable(),
  personId: z.string().min(1).max(100).nullable(),
  bucket: z.enum(BUCKETS),
  spendingCategoryId: z.number().int().positive().nullable(),
}) satisfies z.ZodType<RuleDraft>;

/** `GET /api/rules`: the rules in force, oldest first. */
export interface RulesResponse {
  rules: Rule[];
}

/**
 * `GET /api/people`: who a rule, a classification or a salary may name. Each is a
 * configured name (`Person.id`), kept in the database's `people` table from lg-5
 * on, so a row that names someone still does after the configuration changes.
 */
export interface PeopleResponse {
  people: string[];
}

/**
 * Why a row is in the inbox. `no-rule`: no rule's description pattern matches.
 * `differs`: one does, and its category or its fixed amount does not — a transfer
 * that is not its usual amount is a question, not a guess — including when a
 * broader rule matches exactly, because a narrower rule whose fixed amount it
 * does not have outranks it (lg-16; a category the row is not in never does). `ambiguous`: several rules level at the top rank, the most
 * specific that match exactly, give different answers, and no row goes to the
 * first of them. `matches`: the top rank matches exactly with one answer but the
 * row has not been classified, because the rule was added after the paste.
 */
export const INBOX_REASONS = ["no-rule", "differs", "ambiguous", "matches"] as const;
export type InboxReason = (typeof INBOX_REASONS)[number];

/**
 * What a person said the last times this row's description came up (lg-16). Only
 * a person's answers count — never a classification a rule applied. Taking it is
 * an ordinary `POST /api/classifications` with this `personId` and `bucket`,
 * which stores a `manual` answer by whoever tapped.
 */
export interface InboxHistory {
  personId: string | null;
  bucket: Bucket;
  /** How many of the latest answers agree, counting back and stopping at one that does not. */
  times: number;
}

/** A stored row nobody has classified, with the nearest rule offered as an answer. */
export interface InboxRow {
  id: number;
  date: string;
  category: string;
  description: string;
  amountCents: number;
  balanceCents: number;
  reason: InboxReason;
  suggestion: Rule | null;
  /** The earlier answer to this description, or `null` when no person ever gave one. */
  history: InboxHistory | null;
  /**
   * The rules at the top rank among those matching exactly: more than one only
   * when the reason is `ambiguous`.
   */
  matching: Rule[];
  /**
   * The row's spending category (lg-15), or `null`, which never holds a row in
   * the inbox. The rule that counts is the one `classify` returned, filed yet or
   * not, so a row whose reason is `matches` already has its rule's; a rule that
   * is only the nearest suggestion says nothing.
   */
  spendingCategory: RowSpendingCategory | null;
}

/** `GET /api/inbox`: the unclassified rows, newest first. */
export interface InboxResponse {
  rows: InboxRow[];
}

/**
 * One person-given answer an automatic filing rests on (lg-17): the record as it
 * was appended, and the row it was about. A later answer to that row does not
 * change what the filing rested on.
 */
export interface AutoFilingGround {
  classificationId: number;
  rowId: number;
  date: string;
  description: string;
  amountCents: number;
  bucket: Bucket;
  personId: string | null;
  source: "manual" | "accepted";
  classifiedAt: string;
  classifiedBy: string;
}

/**
 * A row history filed with nobody tapping (lg-17), whose standing classification
 * is still that filing: nobody has confirmed or changed it. Confirming is an
 * ordinary `POST /api/classifications` with the same `personId` and `bucket`,
 * which stores a `manual` answer; changing it is the same call with others.
 */
export interface AutoFiledRow {
  id: number;
  date: string;
  category: string;
  description: string;
  amountCents: number;
  balanceCents: number;
  /** The automatic classification itself. */
  classification: { id: number; bucket: Bucket; personId: string | null; classifiedAt: string };
  /** The three answers it rests on, latest first. */
  restsOn: AutoFilingGround[];
  /** As every stored row has one: an automatic filing cites no rule, so override, then map. */
  spendingCategory: RowSpendingCategory | null;
}

/** `GET /api/inbox/auto-filed`: the rows filed automatically and not yet reviewed, newest first. */
export interface AutoFiledResponse {
  rows: AutoFiledRow[];
}

/**
 * `POST /api/classifications`: classify a row, or classify it again.
 *
 * Either accept a rule (`ruleId`, which must be a rule in force) and take its
 * person and bucket, or answer with a person and a bucket (`personId: null` is
 * joint). Either way a new record is appended and the earlier ones stay.
 */
export type ClassifyRequest =
  | { rowId: number; ruleId: number }
  | { rowId: number; personId: string | null; bucket: Bucket };

export const classifyRequestSchema = z.union([
  z.strictObject({ rowId: z.number().int().positive(), ruleId: z.number().int().positive() }),
  z.strictObject({
    rowId: z.number().int().positive(),
    personId: z.string().min(1).max(100).nullable(),
    bucket: z.enum(BUCKETS),
  }),
]) satisfies z.ZodType<ClassifyRequest>;

/**
 * How a classification came to be: `rule` is the paste applying a rule by itself,
 * `accepted` a person taking a suggested rule, `manual` a person's own answer.
 * `auto` is the paste filing a row on the three latest person-given answers for
 * its description (lg-17): no person made it, and it is never counted as an
 * answer itself.
 */
export const CLASSIFICATION_SOURCES = ["rule", "accepted", "manual", "auto"] as const;
export type ClassificationSource = (typeof CLASSIFICATION_SOURCES)[number];

/**
 * One classification a request appended. The latest for a row is the one that
 * stands. A request is always someone's, so it is never `auto`.
 */
export interface ClassificationRecord {
  id: number;
  rowId: number;
  bucket: Bucket;
  personId: string | null;
  /** The rule version applied or accepted; `null` for a person's own answer. */
  ruleId: number | null;
  source: Exclude<ClassificationSource, "auto">;
  classifiedAt: string;
  classifiedBy: string;
}

/** `yyyy-mm-dd`, a real calendar day. */
export const isoDateSchema = z.iso.date();

/**
 * The query `GET /api/buckets` and `GET /api/ratios` take. With no `asOf` the
 * API answers for today, by its own clock.
 */
export const asOfQuerySchema = z.strictObject({ asOf: isoDateSchema.optional() });

/** One person's own money in the mortgage bucket: their deposits less half of every payment. */
export interface OwnMoney {
  personId: string;
  ownCents: number;
}

/** `GET /api/buckets`: what each bucket holds as of a date, and whose it is (lg-5). */
export interface BucketsResponse {
  /** `yyyy-mm-dd`: every row dated on or before it, classified as it now stands. */
  asOf: string;
  /**
   * The mortgage bucket is not shared money (`docs/00-ANALYSIS.md` §4): each
   * person's own amounts sum to `balanceCents` exactly. `lead` is who has paid
   * more in, and by how much; `null` when the two are level.
   */
  mortgage: {
    balanceCents: number;
    own: OwnMoney[];
    lead: { personId: string; byCents: number } | null;
  };
  /** The current-expenses bucket: shared money, and what each person has put in. */
  buffer: {
    balanceCents: number;
    contributions: { personId: string; contributedCents: number }[];
  };
  /** Rows no classification has filed yet, which neither bucket counts. */
  unclassified: number;
}

/**
 * One salary record: a person's salary for a year (lg-5). Never edited: a
 * correction is a later record that supersedes this one, and both are kept.
 */
export interface Salary {
  id: number;
  personId: string;
  year: number;
  amountCents: number;
  /** The record this one corrects, if any. */
  supersedes: number | null;
  enteredAt: string;
  enteredBy: string;
}

/** `GET /api/salaries`: the salaries that stand, newest year first. */
export interface SalariesResponse {
  salaries: Salary[];
}

/** `POST /api/salaries`: a year's salaries, one per person. */
export interface SalaryEntry {
  year: number;
  salaries: { personId: string; amountCents: number }[];
}

export const salaryEntrySchema = z.strictObject({
  year: z.number().int().min(1900).max(2200),
  salaries: z
    .array(
      z.strictObject({
        personId: z.string().min(1).max(100),
        amountCents: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
      }),
    )
    .min(1)
    .max(10),
}) satisfies z.ZodType<SalaryEntry>;

/** A person's share of a ratio, in parts per million, and the salary it came from. */
export interface RatioShare {
  personId: string;
  partsPerMillion: number;
  /** `null` for a ratio that was not derived from a salary. */
  salaryId: number | null;
}

/** What the API derives from a year's salaries, for a person to confirm. Nothing is stored yet. */
export interface RatioProposal {
  /** Proposed: the day the salaries were entered. The person may choose another. */
  effectiveFrom: string;
  shares: RatioShare[];
}

/** What `POST /api/salaries` answers: the year's salaries as they now stand, and the ratio they give. */
export interface SalaryEntryResponse {
  salaries: Salary[];
  /** `null` when the year does not yet hold a salary for each of the two people. */
  proposal: RatioProposal | null;
}

/**
 * A ratio, as confirmed (lg-5). It is stored as well as derived, because a
 * settlement must be recomputable with the ratio it actually used. Never edited:
 * confirming another ratio for the same day supersedes this one.
 */
export interface Ratio {
  id: number;
  effectiveFrom: string;
  /** In id order; the parts sum to exactly 1 000 000. */
  shares: RatioShare[];
  supersedes: number | null;
  enteredAt: string;
  enteredBy: string;
}

/**
 * `POST /api/ratios`: confirm the ratio derived from these salary records,
 * taking effect on `effectiveFrom`. The API derives it again from the records
 * named, so what is stored is what those salaries give.
 */
export interface ConfirmRatioRequest {
  effectiveFrom: string;
  salaryIds: number[];
}

export const confirmRatioRequestSchema = z.strictObject({
  effectiveFrom: isoDateSchema,
  salaryIds: z.array(z.number().int().positive()).min(1).max(10),
}) satisfies z.ZodType<ConfirmRatioRequest>;

/** `GET /api/ratios`: every ratio that stands, oldest first, and the one in effect on `asOf`. */
export interface RatiosResponse {
  asOf: string;
  ratios: Ratio[];
  inEffect: Ratio | null;
}

/**
 * Where a period line came from. `manual` is a person's own entry (lg-6) and
 * `workbook` a line of one of the old workbook's period sheets, imported once
 * (lg-7); receipts (lg-8) add their own.
 */
export const PERIOD_LINE_SOURCES = ["manual", "workbook"] as const;
export type PeriodLineSource = (typeof PERIOD_LINE_SOURCES)[number];

/**
 * One amount paid on a person's own card toward the household (lg-6). Never
 * edited: a correction is a later line that supersedes it, and a mistaken one is
 * retired the same way. A period holds the lines dated inside it.
 *
 * `chargedTo: null` is **shared**, at the ratio. A person is a **charge**: the
 * thing was entirely theirs, and they owe its full price to whoever paid
 * (`docs/00-ANALYSIS.md` §5, _Charges between the two_).
 */
export interface PeriodLine {
  id: number;
  /** Who paid. */
  personId: string;
  /** `yyyy-mm-dd`. */
  date: string;
  /** Positive for a purchase; a refund on a shared purchase is negative. */
  amountCents: number;
  /**
   * Free text, from before the list (lg-6) or the workbook (lg-7). Kept as it was
   * stored; a line charts by `spendingCategoryId`, and `null` there is uncategorised.
   */
  category: string | null;
  /** The spending category (lg-15) picked from the list, or `null`. */
  spendingCategoryId: number | null;
  note: string | null;
  source: PeriodLineSource;
  chargedTo: string | null;
  supersedes: number | null;
  enteredAt: string;
  enteredBy: string;
}

/** What a person fills in to add a line, or to correct one. */
export interface PeriodLineDraft {
  personId: string;
  date: string;
  amountCents: number;
  category: string | null;
  spendingCategoryId: number | null;
  note: string | null;
  chargedTo: string | null;
}

/** A billion dollars: far past any household amount, and well inside a safe integer. */
const MAX_CENTS = 100_000_000_000;

export const periodLineDraftSchema = z.strictObject({
  personId: z.string().min(1).max(100),
  date: z.iso.date(),
  amountCents: z
    .number()
    .int()
    .min(-MAX_CENTS)
    .max(MAX_CENTS)
    .refine((cents) => cents !== 0),
  category: z.string().trim().min(1).max(100).nullable(),
  spendingCategoryId: z.number().int().positive().nullable(),
  note: z.string().trim().min(1).max(500).nullable(),
  chargedTo: z.string().min(1).max(100).nullable(),
}) satisfies z.ZodType<PeriodLineDraft>;

/**
 * A fixed monthly item paid on a person's own card: insurance, Internet, a
 * subscription (lg-6). It generates one shared line a month, on its start's day
 * of the month, from its start date through its end date if it has one.
 * Correcting or ending one files a version that supersedes it; the earlier
 * version stays.
 */
export interface RecurringItem {
  id: number;
  personId: string;
  monthlyCents: number;
  /** `yyyy-mm-dd`. */
  startDate: string;
  /** `yyyy-mm-dd`, the last day it can generate a line on; `null` while it runs. */
  endDate: string | null;
  label: string;
  supersedes: number | null;
  enteredAt: string;
  enteredBy: string;
}

export interface RecurringItemDraft {
  personId: string;
  monthlyCents: number;
  startDate: string;
  endDate: string | null;
  label: string;
}

export const recurringItemDraftSchema = z
  .strictObject({
    personId: z.string().min(1).max(100),
    monthlyCents: z.number().int().min(1).max(MAX_CENTS),
    startDate: z.iso.date(),
    endDate: z.iso.date().nullable(),
    label: z.string().trim().min(1).max(100),
  })
  .refine(
    (draft) => draft.endDate === null || draft.endDate >= draft.startDate,
  ) satisfies z.ZodType<RecurringItemDraft>;

/** `GET /api/recurring`: the recurring items that stand, oldest first. */
export interface RecurringResponse {
  items: RecurringItem[];
}

/**
 * The formula a settlement was computed with. `v1` and `v2` are the workbook's
 * two historical formulas, imported as they happened (lg-7); `v3` is the
 * tool's: the matching rule over cumulative contributions, with charges, each
 * period at its own ratio, divided by the recipient's share and rounded half-up
 * once (`docs/00-ANALYSIS.md` §5).
 */
export const SETTLEMENT_FORMULAS = ["v1", "v2", "v3"] as const;
export type SettlementFormula = (typeof SETTLEMENT_FORMULAS)[number];

/** What closing a period computes, or would compute if it closed now. */
export interface SettlementFigures {
  formula: SettlementFormula;
  /** The ratio in effect on the period's last day, which the deposit is divided by. */
  ratioId: number;
  shares: RatioShare[];
  /** Who owes, and to whom; both `null` when the two stand at the ratio to within half a cent. */
  payerId: string | null;
  recipientId: string | null;
  /**
   * Into the buffer. `null` when the recipient's share is zero, so that only a
   * direct transfer can settle it.
   */
  depositCents: number | null;
  /** The same debt paid directly to the recipient instead. */
  netCents: number;
}

/**
 * What became of a closed period's deposit. `matched`: a paste brought it in.
 * `expected`: not seen yet. `folded`: not seen, and a later close, being
 * cumulative, asked for it again. `none`: nothing was owed. `direct`: only a
 * direct transfer could settle it.
 */
export const DEPOSIT_STATUSES = ["matched", "expected", "folded", "none", "direct"] as const;
export type DepositStatus = (typeof DEPOSIT_STATUSES)[number];

/** A line the open period holds: one stored, or one a recurring item generates. */
export interface OpenPeriodLine {
  date: string;
  personId: string;
  amountCents: number;
  chargedTo: string | null;
  /** The free-text category, or the recurring item's label. */
  category: string | null;
  /** The line's spending category; `null` for a generated line, and for any stored before lg-15. */
  spendingCategoryId: number | null;
  note: string | null;
  /** The stored line, or `null` for a generated one. */
  lineId: number | null;
  /** The recurring item that generated it, or `null` for a stored one. */
  recurringItemId: number | null;
  /**
   * Dated inside a period already closed, and first entered after the last
   * close: no settlement has counted it yet, so the next close does. A
   * correction of a line or an item that was on time is not late.
   */
  late: boolean;
}

/**
 * `GET /api/periods/open?end=yyyy-mm-dd`: the period not yet closed, as if it
 * ended on `end` (today by default).
 */
export interface OpenPeriodResponse {
  /** The day after the last closed period, or the start asked for the first; `null` is from the beginning. */
  start: string | null;
  end: string;
  /** No period has closed yet, so this one's start is the closer's to choose. */
  first: boolean;
  /** Oldest first. */
  lines: OpenPeriodLine[];
  /** What closing it on `end` would settle; `null` when no ratio is in effect on `end`. */
  settlement: SettlementFigures | null;
}

export const openPeriodQuerySchema = z.strictObject({
  start: z.iso.date().optional(),
  end: z.iso.date().optional(),
});

/**
 * `POST /api/periods/close`. `start` is the open period's start as the closer
 * saw it, so a period closed meanwhile by the other person is not closed twice;
 * for the first period it is the closer's choice, `null` being from the
 * beginning.
 */
export interface ClosePeriodRequest {
  start: string | null;
  end: string;
}

export const closePeriodRequestSchema = z
  .strictObject({ start: z.iso.date().nullable(), end: z.iso.date() })
  .refine(
    (request) => request.start === null || request.start <= request.end,
  ) satisfies z.ZodType<ClosePeriodRequest>;

/** A closed period, the settlement it recorded, and whether its deposit has been seen. */
export interface ClosedPeriod {
  id: number;
  start: string | null;
  end: string;
  closedAt: string;
  closedBy: string;
  settlement: SettlementFigures;
  deposit: {
    status: DepositStatus;
    /** The statement row that brought it in, when `matched`. */
    rowId: number | null;
  };
}

/** `GET /api/periods`: the closed periods, newest first. */
export interface PeriodsResponse {
  periods: ClosedPeriod[];
}

/**
 * One spending category (lg-15): a word like groceries, from the one list that
 * bank rows, rules, period lines and (lg-10) receipt items all pick from. Not
 * Desjardins' own category, which is the `category` text on a row and a rule.
 *
 * `id` names the category for good: renaming files a new version and keeps the
 * id, so everything that picked it still has. `retired` leaves it out of what a
 * person can pick and keeps it on what already did.
 */
export interface SpendingCategory {
  id: number;
  name: string;
  retired: boolean;
  /** When and by whom the current version was filed. */
  createdAt: string;
  createdBy: string;
}

export interface SpendingCategoryDraft {
  name: string;
}

export const spendingCategoryDraftSchema = z.strictObject({
  name: z.string().trim().min(1).max(60),
}) satisfies z.ZodType<SpendingCategoryDraft>;

/** `GET /api/spending-categories`: every category, retired ones too, oldest first. */
export interface SpendingCategoriesResponse {
  categories: SpendingCategory[];
}

/**
 * Where a row's spending category came from, in the order the books try them
 * (`spendingCategory` in `@ledger/books`): the row's own `override`, the
 * classifying `rule`'s, the `map`'s entry for Desjardins' category.
 */
export const SPENDING_CATEGORY_SOURCES = ["override", "rule", "map"] as const;
export type SpendingCategorySource = (typeof SPENDING_CATEGORY_SOURCES)[number];

/** A row's spending category and why it has it. `null` where it is used means uncategorised. */
export interface RowSpendingCategory {
  id: number;
  source: SpendingCategorySource;
}

/**
 * One line of the map: what a spending category is for rows in a Desjardins
 * category. `spendingCategoryId: null` is no entry. `rows` counts the stored
 * rows in that category, however its case and accents were written.
 */
export interface SpendingCategoryMapEntry {
  desjardinsCategory: string;
  spendingCategoryId: number | null;
  rows: number;
}

/** `GET /api/spending-category-map`: one entry per Desjardins category seen in stored rows. */
export interface SpendingCategoryMapResponse {
  entries: SpendingCategoryMapEntry[];
}

/** `POST /api/spending-category-map`: file a version of one entry. `null` clears it. */
export interface SetSpendingCategoryMapRequest {
  desjardinsCategory: string;
  spendingCategoryId: number | null;
}

export const setSpendingCategoryMapRequestSchema = z.strictObject({
  desjardinsCategory: z.string().trim().min(1).max(200),
  spendingCategoryId: z.number().int().positive().nullable(),
}) satisfies z.ZodType<SetSpendingCategoryMapRequest>;

/**
 * `POST /api/spending-category-overrides`: a row's own spending category, over
 * its rule's and the map's. `null` withdraws the override, leaving the row to
 * its rule and the map. Appended, with who and when; the latest stands.
 */
export interface SpendingCategoryOverrideRequest {
  rowId: number;
  spendingCategoryId: number | null;
}

export const spendingCategoryOverrideRequestSchema = z.strictObject({
  rowId: z.number().int().positive(),
  spendingCategoryId: z.number().int().positive().nullable(),
}) satisfies z.ZodType<SpendingCategoryOverrideRequest>;

/** What the override leaves the row with. */
export interface SpendingCategoryOverrideResponse {
  rowId: number;
  spendingCategory: RowSpendingCategory | null;
}

/** A stored row, filed or not, with the spending category it now has. */
export interface StoredRow {
  id: number;
  date: string;
  /** Desjardins' own category. */
  category: string;
  description: string;
  amountCents: number;
  balanceCents: number;
  /** The classification that stands, or `null` while the row is in the inbox. */
  classification: {
    bucket: Bucket;
    personId: string | null;
    source: ClassificationSource;
  } | null;
  spendingCategory: RowSpendingCategory | null;
}

/**
 * `GET /api/rows`: stored rows, newest first. `spendingCategory=none` lists the
 * uncategorised ones. `limit` caps the page (100 by default).
 */
export const rowsQuerySchema = z.strictObject({
  spendingCategory: z.literal("none").optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export interface RowsResponse {
  rows: StoredRow[];
  /** How many rows match, before the limit. */
  total: number;
}
