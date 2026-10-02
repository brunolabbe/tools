/**
 * The ledger's error taxonomy.
 *
 * Every failure this tool can produce maps to exactly one `ErrorCode`. Layers
 * must not invent codes locally — add them to `LEDGER_ERROR_CODES` below so the
 * UI can render one consistent message per cause, and so the retry policy has a
 * single place to decide what is worth retrying.
 *
 * The generic half — bad request, unreachable, timed out, rate limited,
 * canceled — comes from `@webtools/core` and is shared with every other tool in
 * the repo. Only codes that are *about the household's books* belong here: a
 * paste that does not parse, a running balance that does not chain, a receipt
 * that cannot be read. If a new code would make sense to a tool that has never
 * heard of a bank account, it belongs in core instead.
 *
 * **The list grows one ticket at a time.** A code written ahead of the thing
 * that raises it is a guess at a sentence nobody has had to say, so each one
 * arrives with the ticket that first throws it — the same way `ITEM_NOT_FOUND`
 * arrived with pl-10 in the planner's catalog. The first four are the statement
 * parser's (lg-1); the two after them are the store's (lg-2).
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

export const LEDGER_ERROR_CODES = [
  // --- The statement paste ---
  //
  // All four are about one pasted text and are terminal: the same text fails
  // the same way, so the caller has to change the paste, never retry it. Each
  // carries `details.line`, the 1-based line of the text it names, so the UI
  // can point at the place rather than say "something is wrong".
  /**
   * A line the parser does not recognise — or a row cut short, an amount that is
   * not an amount, a date that is not a day. Nothing is ever skipped, because a
   * skipped line is a row that silently vanishes from the books.
   */
  "STATEMENT_UNRECOGNIZED_LINE",
  /**
   * A row's balance is not the previous row's balance plus its amount. The
   * paste is missing a row, or one was altered; `details` carries the unexplained
   * amount, since "how much money went missing" is the question the user has.
   */
  "STATEMENT_CHAIN_BROKEN",
  /** A month's `Total` line is not the sum of that month's rows, or is absent. */
  "STATEMENT_TOTAL_MISMATCH",
  /** A row's echo line does not repeat its own date, description and amount. */
  "STATEMENT_ECHO_MISMATCH",
  // --- Chaining a paste onto what is stored (lg-2) ---
  //
  // A gap between a paste and the stored tail is `STATEMENT_CHAIN_BROKEN` again:
  // the same proof failing, one boundary further out, with the same
  // `unexplainedCents` in its details. These two are what that code cannot say.
  /**
   * A pasted row and a stored row disagree about the same place in the history:
   * the same identity with another category, or another row where the stored
   * history has this one — or the same paste fits what is stored two ways that
   * would store different rows, because a date, description, amount and balance
   * can repeat. `details` names both rows, or both readings, so nothing is
   * overwritten and nothing is guessed at.
   */
  "STATEMENT_ROW_CONFLICT",
  /**
   * The paste reaches back past the oldest stored row. A stored row's position
   * is never changed, and adding older history means numbering rows below the
   * oldest, which this ticket does not do; a later one may.
   */
  "STATEMENT_BEFORE_HISTORY",
] as const;

/** Core codes first, so the generic ones keep their familiar order. */
export const ERROR_CODES = [...CORE_ERROR_CODES, ...LEDGER_ERROR_CODES] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Default user-facing copy. Layers may override with something more specific. */
export const DEFAULT_ERROR_MESSAGES: Record<ErrorCode, string> = {
  ...CORE_ERROR_MESSAGES,
  STATEMENT_UNRECOGNIZED_LINE: "A line in the pasted statement was not recognised.",
  STATEMENT_CHAIN_BROKEN:
    "The pasted statement does not add up: a row's balance does not follow from the one before it.",
  STATEMENT_TOTAL_MISMATCH: "A month's total in the pasted statement does not match its rows.",
  STATEMENT_ECHO_MISMATCH: "A row in the pasted statement does not match its own repeated line.",
  STATEMENT_ROW_CONFLICT: "A pasted row disagrees with the row already stored in its place.",
  STATEMENT_BEFORE_HISTORY:
    "The pasted statement starts before the oldest stored row, and older history cannot be added.",
};

/**
 * Codes worth an automatic retry, on top of the core ones. Everything else is
 * terminal for the attempt: either the caller must change something, or it will
 * never work.
 */
export const RETRYABLE_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>(CORE_RETRYABLE_CODES);

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
