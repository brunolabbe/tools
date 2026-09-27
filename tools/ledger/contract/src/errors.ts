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
 * **The list is empty, and that is the honest state of a scaffold.** The domain
 * has not been designed yet, and a code written ahead of the thing that raises
 * it is a guess at a sentence nobody has had to say. Each one arrives with the
 * ticket that first throws it — the same way `ITEM_NOT_FOUND` arrived with pl-10
 * in the planner's catalog.
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

export const LEDGER_ERROR_CODES = [] as const;

/** Core codes first, so the generic ones keep their familiar order. */
export const ERROR_CODES = [...CORE_ERROR_CODES, ...LEDGER_ERROR_CODES] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Default user-facing copy. Layers may override with something more specific. */
export const DEFAULT_ERROR_MESSAGES: Record<ErrorCode, string> = {
  ...CORE_ERROR_MESSAGES,
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
