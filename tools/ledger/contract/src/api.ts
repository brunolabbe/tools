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
