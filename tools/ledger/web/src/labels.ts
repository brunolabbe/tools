/** Words for the things the books file a row under. */

import type { Bucket, InboxReason, Rule } from "@ledger/contract";
import { formatCents } from "@ledger/books";

export const BUCKET_LABELS: Record<Bucket, string> = {
  mortgage: "Mortgage",
  "current-expenses": "Current expenses",
};

/** `Joint` for nobody: a rebate, a shared thing sold, one half of an error pair. */
export function personLabel(personId: string | null): string {
  return personId ?? "Joint";
}

/** What a rule files a row as, in the words a person answers with. */
export function answerLabel(rule: Pick<Rule, "personId" | "bucket">): string {
  return `${personLabel(rule.personId)} · ${BUCKET_LABELS[rule.bucket]}`;
}

/** What a rule asks of a row, beyond its description. */
export function criteriaLabel(rule: Pick<Rule, "category" | "amountCents">): string {
  const category = rule.category ?? "any category";
  const amount = rule.amountCents === null ? "any amount" : formatCents(rule.amountCents);
  return `${category}, ${amount}`;
}

export const REASON_LABELS: Record<InboxReason, string> = {
  "no-rule": "No rule matches this.",
  differs: "A rule matches the description, but not the category or the amount.",
  ambiguous: "More than one rule matches this, so none was applied.",
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
