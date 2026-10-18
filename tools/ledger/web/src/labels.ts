/** Words for the things the books file a row under. */

import type {
  Bucket,
  InboxHistory,
  InboxReason,
  Rule,
  SpendingCategorySource,
} from "@ledger/contract";
import { formatCents } from "@ledger/books";
import { shownName } from "./people.tsx";
import type { ShownNames } from "./people.tsx";

export const BUCKET_LABELS: Record<Bucket, string> = {
  mortgage: "Mortgage",
  "current-expenses": "Current expenses",
};

/**
 * A person as shown (lg-33), or `Joint` for nobody: a rebate, a shared thing
 * sold, one half of an error pair.
 */
export function personLabel(personId: string | null, names: ShownNames): string {
  return personId === null ? "Joint" : shownName(names, personId);
}

/** What a rule files a row as, in the words a person answers with. */
export function answerLabel(rule: Pick<Rule, "personId" | "bucket">, names: ShownNames): string {
  return `${personLabel(rule.personId, names)} · ${BUCKET_LABELS[rule.bucket]}`;
}

/** What a rule asks of a row, beyond its description. */
export function criteriaLabel(rule: Pick<Rule, "category" | "amountCents">): string {
  const category = rule.category ?? "any category";
  const amount = rule.amountCents === null ? "any amount" : formatCents(rule.amountCents);
  return `${category}, ${amount}`;
}

/** What a person last answered for a description: "alex · Mortgage, the last 3 times". */
export function historyLabel(
  history: Pick<InboxHistory, "personId" | "bucket" | "times">,
  names: ShownNames,
): string {
  const when = history.times === 1 ? "last time" : `the last ${String(history.times)} times`;
  return `${answerLabel(history, names)}, ${when}`;
}

/** Where a row's spending category came from, in the words under the row. */
export const SPENDING_SOURCE_LABELS: Record<SpendingCategorySource, string> = {
  override: "set on this row",
  rule: "from the rule",
  map: "from the bank's category",
};

export const REASON_LABELS: Record<InboxReason, string> = {
  "no-rule": "No rule matches this.",
  differs: "A rule matches the description, but not the category or the amount.",
  ambiguous: "Equally specific rules match this with different answers, so none was applied.",
  matches: "A rule matches this exactly. It was added after the paste.",
};

/**
 * A ratio's share, from parts per million to a percent with the four decimals
 * the owner's ratio has: `600000` is `60.0000 %`. Integer arithmetic, so no
 * float decides a digit.
 */
export function formatShare(partsPerMillion: number): string {
  const whole = Math.floor(partsPerMillion / 10_000);
  const fraction = String(partsPerMillion % 10_000).padStart(4, "0");
  return `${String(whole)}.${fraction} %`;
}
