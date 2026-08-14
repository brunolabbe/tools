/**
 * The planner's error taxonomy.
 *
 * Every failure this tool can produce maps to exactly one `ErrorCode`. Layers
 * must not invent codes locally — add them to `PLANNER_ERROR_CODES` below so the
 * UI can render one consistent message per cause, and so the retry policy has a
 * single place to decide what is worth retrying.
 *
 * The generic half — bad URL, unreachable, timed out, rate limited, canceled —
 * comes from `@webtools/core` and is shared with every other tool in the repo.
 * Only codes that are *about planning a trip, or about the model that helps do
 * it*, belong here.
 *
 * The `AGENT_*` codes look general enough to belong in core, and one day they
 * will: this is the first tool in the repo that talks to a language model, and
 * shared code moves to `packages/` on the second real consumer, not the first
 * guess. When a second tool needs them, lift them.
 *
 * This catalog is a starting point, sized to what the tool certainly does —
 * hold a conversation, remember a trip. Extend it here as the domain lands.
 */

import {
  AppErrorBase,
  CORE_ERROR_CODES,
  CORE_ERROR_MESSAGES,
  CORE_RETRYABLE_CODES,
  type AppErrorOptions,
  type AppErrorPayload as CoreAppErrorPayload,
  type ErrorCatalog,
} from "@webtools/core";

export type { AppErrorOptions } from "@webtools/core";

export const PLANNER_ERROR_CODES = [
  // --- The model ---
  /**
   * No model provider is configured, or the one named does not exist. Distinct
   * from `AGENT_UNAVAILABLE`: nothing was ever reachable, so retrying is
   * pointless until an operator changes something.
   */
  "AGENT_UNCONFIGURED",
  /** The provider was configured but refused us: bad key, revoked, out of credit. */
  "AGENT_UNAVAILABLE",
  /** The model declined to answer, or stopped on its own safety grounds. */
  "AGENT_REFUSED",
  /** The reply did not parse into the shape the caller asked for, past the retry budget. */
  "AGENT_MALFORMED_REPLY",
  /** The conversation no longer fits the model's context window. */
  "CONTEXT_LIMIT",

  // --- The trip ---
  // "Trip" is the journey the user is taking; "Plan" is the document this tool
  // keeps about it. The aggregate, and therefore the code, is the plan.
  "CONVERSATION_NOT_FOUND",
  "PLAN_NOT_FOUND",
  /**
   * The brief is too thin to draft from: `missingRequiredSlots` is not empty
   * and something asked for a plan anyway.
   *
   * Not covered by anything existing. Core has no "your input was incomplete"
   * code at all — its input codes are about a URL — and the request that raises
   * this one is *well formed*: it is the document behind it that is not ready.
   * `details` carries the missing slot ids, which is what lets the UI send
   * someone back to the right question instead of to the start of the wizard.
   */
  "BRIEF_INCOMPLETE",
  /**
   * Return before departure, a date in the past, a span longer than
   * `MAX_TRIP_NIGHTS`, or a flexible window too narrow to hold the nights asked
   * for.
   *
   * That last case arrives with the brief's date flexibility and deliberately
   * does *not* get a code of its own: it is the same cause as the others —
   * these dates contradict each other — and it wants the same sentence in front
   * of a user. What distinguishes it is `details`, not the taxonomy, and
   * `AppError` already carries those.
   */
  "INVALID_DATES",
] as const;

/** Core codes first, so the generic ones keep their familiar order. */
export const ERROR_CODES = [...CORE_ERROR_CODES, ...PLANNER_ERROR_CODES] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * Default user-facing copy. Layers may override with something more specific.
 *
 * A few core codes are re-worded here rather than inherited: core has to say
 * "the job", because it does not know what this tool runs.
 */
export const DEFAULT_ERROR_MESSAGES: Record<ErrorCode, string> = {
  ...CORE_ERROR_MESSAGES,
  JOB_NOT_FOUND: "That planning session could not be found.",
  JOB_CANCELED: "The planning session was canceled.",

  AGENT_UNCONFIGURED: "No planning assistant is configured on this server.",
  AGENT_UNAVAILABLE: "The planning assistant is not answering right now.",
  AGENT_REFUSED: "The assistant declined to answer that.",
  AGENT_MALFORMED_REPLY: "The assistant’s answer could not be understood.",
  CONTEXT_LIMIT: "This conversation has grown too long to continue. Start a new one.",
  CONVERSATION_NOT_FOUND: "That conversation could not be found.",
  PLAN_NOT_FOUND: "That plan could not be found.",
  BRIEF_INCOMPLETE: "There are still a few essentials to answer before this trip can be planned.",
  INVALID_DATES: "Those travel dates do not make sense.",
};

/**
 * Codes worth an automatic retry, on top of the core ones. Everything else is
 * terminal for the attempt: either the caller must change something, or it will
 * never work.
 *
 * `AGENT_MALFORMED_REPLY` is absent on purpose. Re-asking a model that just
 * produced unparseable output is worth doing — but *inside* the agent, with the
 * failure fed back, not by replaying the same request from the top.
 */
export const RETRYABLE_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  ...CORE_RETRYABLE_CODES,
  "AGENT_UNAVAILABLE",
]);

/**
 * The three lists above as one value. `satisfies` is what makes a code added
 * without a message a compile error, rather than `undefined` reaching a user as
 * their entire error text.
 */
export const ERROR_CATALOG = {
  codes: ERROR_CODES,
  messages: DEFAULT_ERROR_MESSAGES,
  retryable: RETRYABLE_CODES,
} satisfies ErrorCatalog<ErrorCode>;

export type AppErrorPayload = CoreAppErrorPayload<ErrorCode>;

/** Typed error carrying an `ErrorCode`. Throw this, never a bare `Error`. */
export class AppError extends AppErrorBase<ErrorCode> {
  constructor(code: ErrorCode, message?: string, options?: AppErrorOptions) {
    super(code, message ?? ERROR_CATALOG.messages[code], {
      ...options,
      retryable: options?.retryable ?? ERROR_CATALOG.retryable.has(code),
    });
  }

  static from(error: unknown): AppError {
    if (error instanceof AppError) return error;
    return new AppError("INTERNAL", undefined, { cause: error });
  }
}
