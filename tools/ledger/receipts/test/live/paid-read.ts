/**
 * What `read-rebate-fixtures.ts` decides before it spends anything, and what it
 * is allowed to print, held apart from the script so
 * `receipts/test/rebate-live-gate.test.ts` proves them without a key, a file or
 * a request. Not a suite: nothing here is named `.test.ts`.
 */

import { AppError } from "@ledger/contract";

export interface PaidRead {
  keyFile: string;
  out: string;
}

/**
 * Refuses unless the read was asked for in so many words: `--paid`, a key file
 * and an output path. It refuses `ANTHROPIC_CUSTOM_HEADERS` too, as the
 * ledger's layout run does (`api/test/live/layout-run.ts`, pl-39): the SDK
 * applies it to every request whatever the client is given, and a header in it
 * can replace the key or change what a request bills. Blank is unset, as the
 * SDK reads it. The value is never repeated: it may carry a key.
 */
export function assertPaidReadConsent(args: readonly string[], env: NodeJS.ProcessEnv): PaidRead {
  const [flag, keyFile, out] = args;
  if (flag !== "--paid" || keyFile === undefined || out === undefined) {
    throw new Error(
      "usage: read-rebate-fixtures.ts --paid <key-file> <out.json>\n" +
        "Three paid reads: --paid is the consent, and nothing is sent without it.",
    );
  }
  if ((env["ANTHROPIC_CUSTOM_HEADERS"]?.trim() ?? "") !== "") {
    throw new Error(
      "Refusing: ANTHROPIC_CUSTOM_HEADERS is set. The Anthropic SDK applies it to every request and it can replace the key. Unset it.",
    );
  }
  return { keyFile, out };
}

/**
 * The key in a key file: its `LEDGER=` line, or the whole file when it holds
 * one line. A file of several lines and no `LEDGER=` among them is refused
 * rather than sent as one key, since every line of it would be the key and the
 * SDK would print it whole in its invalid-header error. The message never
 * holds any of the file's text.
 */
export function keyFrom(text: string): string {
  const lines = text.split(/\r?\n/u);
  const line = lines.find((each) => each.startsWith("LEDGER="));
  if (line !== undefined) return line.slice("LEDGER=".length).trim();
  if (lines.filter((each) => each.trim() !== "").length > 1) {
    throw new Error(
      "Refusing: the key file holds several lines and none starts LEDGER=. Add the LEDGER=<key> line, or give a file with the key alone.",
    );
  }
  return text.trim();
}

/** What may be printed of a failed read: the code of a typed error, never its message or cause. */
export function failureNote(error: unknown): string {
  return error instanceof AppError ? error.code : "an error with no code";
}
