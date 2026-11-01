/** Words for the things the books file a row under. */

import type {
  Bucket,
  ClassificationSource,
  InboxHistory,
  InboxReason,
  MortgageSplitMode,
  MortgageSplitOn,
  MortgageSplitPart,
  Rule,
  SpendingCategorySource,
} from "@ledger/contract";
import { formatCents } from "@ledger/books";
import { inShownOrder, shownName } from "./people.tsx";
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

/** Who or what filed a row, after its answer in the history (lg-95). */
export const CLASSIFICATION_SOURCE_LABELS: Record<ClassificationSource, string> = {
  rule: "filed by a rule",
  accepted: "a rule's suggestion, accepted by a person",
  manual: "answered by a person",
  auto: "filed automatically",
};

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

/**
 * A percent as a person types it, `62.5` or `62.5 %`, to parts per million;
 * `null` for anything that is not one, or has more decimals than a share holds.
 * Read as text, so no float decides a digit.
 */
export function parseShare(text: string): number | null {
  const match = /^\s*(\d{1,3})(?:[.,](\d{1,4}))?\s*%?\s*$/u.exec(text);
  if (match === null) return null;
  const parts = Number(match[1]) * 10_000 + Number((match[2] ?? "").padEnd(4, "0"));
  return parts <= 1_000_000 ? parts : null;
}

/** `alex`, `alex and sam`, `alex, casey and sam`. */
function listOf(items: readonly string[]): string {
  if (items.length < 2) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1) ?? ""}`;
}

/** Each person's part, as the salaries screen shows a ratio's: `alex 60.0000 % · sam 40.0000 %`. */
export function partsLabel(parts: readonly MortgageSplitPart[], names: ShownNames): string {
  return inShownOrder(parts, names, (part) => part.personId)
    .map((part) => `${shownName(names, part.personId)} ${formatShare(part.partsPerMillion)}`)
    .join(" · ");
}

/** What each mode is called on the form. */
export const SPLIT_MODE_LABELS: Record<MortgageSplitMode, string> = {
  shares: "By shares",
  equal: "Equally",
  ratio: "At the ratio",
};

/**
 * How a payment on one day splits (lg-63), in a sentence's middle: "by shares:
 * alex 60.0000 % · sam 40.0000 %", "equally between alex and sam", "at the ratio:
 * …", or, at the ratio before any ratio, "equally between …, no ratio being in
 * effect yet".
 */
export function splitLabel(split: MortgageSplitOn, names: ShownNames): string {
  if (split.mode === "shares") return `by shares: ${partsLabel(split.parts, names)}`;
  if (split.mode === "ratio" && !split.noRatio) {
    return `at the ratio: ${partsLabel(split.parts, names)}`;
  }
  const people = inShownOrder(split.parts, names, (part) => part.personId).map((part) =>
    shownName(names, part.personId),
  );
  const equally =
    people.length === 1 ? `all to ${listOf(people)}` : `equally between ${listOf(people)}`;
  return split.noRatio ? `${equally}, no ratio being in effect yet` : equally;
}

/** The same, in a table's cell: the mode alone. */
export function splitShortLabel(split: MortgageSplitOn): string {
  return split.noRatio ? "Equally: no ratio yet" : SPLIT_MODE_LABELS[split.mode];
}
