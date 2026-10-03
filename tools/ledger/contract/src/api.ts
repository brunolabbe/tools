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
  classifications: `${API_PREFIX}/classifications`,
  people: `${API_PREFIX}/people`,
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
  category: string | null;
  amountCents: number | null;
  personId: string | null;
  bucket: Bucket;
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
}

export const ruleDraftSchema = z.object({
  descriptionPattern: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(200).nullable(),
  amountCents: z.number().int().nullable(),
  personId: z.string().min(1).max(100).nullable(),
  bucket: z.enum(BUCKETS),
}) satisfies z.ZodType<RuleDraft>;

/** `GET /api/rules`: the rules in force, oldest first. */
export interface RulesResponse {
  rules: Rule[];
}

/** `GET /api/people`: who a rule or a classification may name, from the API's configuration. */
export interface PeopleResponse {
  people: string[];
}

/**
 * Why a row is in the inbox. `no-rule`: no rule's description pattern matches.
 * `differs`: one does, and its category or its fixed amount does not — a transfer
 * that is not its usual amount is a question, not a guess. `ambiguous`: more than
 * one rule matches exactly, and no row goes to the first of them. `matches`: one
 * rule matches exactly but the row has not been classified, because the rule was
 * added after the paste.
 */
export const INBOX_REASONS = ["no-rule", "differs", "ambiguous", "matches"] as const;
export type InboxReason = (typeof INBOX_REASONS)[number];

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
  /** The rules that match exactly: more than one only when the reason is `ambiguous`. */
  matching: Rule[];
}

/** `GET /api/inbox`: the unclassified rows, newest first. */
export interface InboxResponse {
  rows: InboxRow[];
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
 */
export const CLASSIFICATION_SOURCES = ["rule", "accepted", "manual"] as const;
export type ClassificationSource = (typeof CLASSIFICATION_SOURCES)[number];

/** One classification, as appended. The latest for a row is the one that stands. */
export interface ClassificationRecord {
  id: number;
  rowId: number;
  bucket: Bucket;
  personId: string | null;
  /** The rule version applied or accepted; `null` for a person's own answer. */
  ruleId: number | null;
  source: ClassificationSource;
  classifiedAt: string;
  classifiedBy: string;
}
