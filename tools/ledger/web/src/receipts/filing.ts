/**
 * What a receipt is filed from, and whether it may be (lg-102): the form's
 * draft, the two picks the queue and the receipt view share — who paid, and
 * whose the receipt is — and the checks the screen holds a filing on. One
 * module, so a receipt filed from the list is refused for exactly what its
 * opened form refuses (`refusal`), and is sent as the form would send it.
 *
 * Nothing here talks to the API or renders: `Receipts.tsx` is the form,
 * `Queue.tsx` the list and the batch.
 */

import {
  checkReceipt,
  formatCents,
  itemsAddUp,
  parseTypedAmountCents,
  splitReceipt,
} from "@ledger/books";
import type { ReceiptSplit } from "@ledger/books";
import type {
  FileReceiptRequest,
  ItemShare,
  ReceiptFiling,
  ReceiptFlag,
  ReceiptItem,
  ReceiptProposal,
  UploadedReceipt,
} from "@ledger/contract";
import { shownName } from "../people.tsx";
import type { ShownNames } from "../people.tsx";

export const FLAG_LABELS: Record<ReceiptFlag, string> = {
  "total-missing": "The total was not read.",
  "subtotal-missing": "The subtotal was not read.",
  "tax-missing": "One tax was read and the other was not.",
  "parts-differ": "The subtotal and the taxes do not add up to the total.",
  "tax-differs": "The taxes are not 5 % and 9.975 % of the same amount.",
  "signs-differ": "Some amounts are a purchase and some a refund.",
  "items-differ":
    "The items, deposits, rebates and taxes do not add up to the total. Correct them to file.",
  "taxable-differs":
    "The items marked taxable do not give the taxes printed. Check which items are taxable.",
};

/**
 * The Taxable marks refused only where they move money: an item left out takes
 * off its price and the taxes on it if it is marked taxable, and a joint-account
 * row's categories are given the same figures (`splitByCategory`). A line keeps
 * its one category, so its items' categories divide nothing. On a receipt that
 * is all shared, and filed as a line or all in one category, a wrong mark
 * changes nothing filed. A store that rounds tax per line flags marks that are
 * right, which is why the flag held nothing before (lg-26).
 */
export const TAXABLE_MATTERS =
  "The items marked taxable do not give the taxes printed, and they set what an item left out or each category comes to. Check which items are taxable to file.";

export const NOBODY_ELSE = "There is nobody else in the household to charge an item to.";

export const NOBODY_CHOSEN =
  "Choose whose each item left out is: a joint-account purchase has no payer to keep one.";

/** A read item marked someone else's that names no current member: nobody may be assumed (lg-94). */
export const UNPICKED_CHARGE =
  "Choose whose each item left out is: the receipt's charge for it names no other member of the household.";

export const ITEMS_UNREAD = "An item needs its text and its price before the receipt can be filed.";

export const NEEDS_CHARGE_AND_DATE = "The amount charged and the date are needed to file it.";

/** One item's fields, as typed. */
export interface ItemDraft {
  /** The list's key: an item has no id until filed, and the list adds and removes. */
  key: number;
  text: string;
  price: string;
  taxable: boolean;
  deposit: string;
  /**
   * The rebates folded into it (lg-89), as a magnitude: a phone's decimal keypad
   * has no minus sign, so it is typed positive and takes the price's opposite
   * sign in `itemOf`. Blank for none.
   */
  discount: string;
  spendingCategoryId: number | null;
  share: ItemShare;
  /** Whose a `theirs` item is, as picked; `null` until picked, and with one other member. */
  chargedTo: string | null;
  /**
   * Still someone else's as the read proposed it, no choice of the person's
   * touching it (lg-94): going back from the joint card leaves such an item as
   * it was, so it stays unpicked rather than turning into Mine unchosen.
   */
  asRead: boolean;
}

/** The form's fields, as typed. Amounts are text until filed. */
export interface Draft {
  merchant: string;
  date: string;
  subtotal: string;
  gst: string;
  qst: string;
  total: string;
  /** What the card was charged: the total, unless a tip was added under it. */
  charged: string;
  items: ItemDraft[];
  /** The line's spending category: the merchant's last one until changed (lg-10). */
  spendingCategoryId: number | null;
}

/** The form's fields that are a line of text. */
export type TextField = Exclude<keyof Draft, "items" | "spendingCategoryId">;

/**
 * The two picks a receipt is filed under (lg-102), the same in the list and in
 * the opened receipt.
 */
export interface Picks {
  /** Paid with the joint card (lg-91): attached to the row it documents, never a line. */
  joint: boolean;
  /** Who paid, when not the joint card: a current member, whoever took the photo until changed. */
  payer: string;
  /**
   * Whose the whole receipt is: `null` for shared, or a member other than the
   * payer, who owes all of it (the line's `chargedTo`, as lg-8 filed it).
   */
  whose: string | null;
}

/**
 * The value of the Paid by select's Joint card, and of the Whose select's
 * Shared: the empty string, which no person id can be (the contract's ids are
 * `min(1)`), so a member is never mistaken for either.
 */
export const JOINT_CARD = "";
export const SHARED = "";

let lastItemKey = 0;

export function itemKey(): number {
  lastItemKey += 1;
  return lastItemKey;
}

function itemDraftOf(item: ReceiptItem): ItemDraft {
  return {
    key: itemKey(),
    text: item.text,
    price: centsText(item.price),
    taxable: item.taxable,
    deposit: centsText(item.deposit),
    discount: centsText(item.discount === null ? null : Math.abs(item.discount)),
    spendingCategoryId: item.spendingCategoryId,
    share: item.share,
    chargedTo: item.chargedTo,
    asRead: item.share === "theirs",
  };
}

export function blankItem(): ItemDraft {
  return {
    key: itemKey(),
    text: "",
    price: "",
    taxable: false,
    deposit: "",
    discount: "",
    spendingCategoryId: null,
    share: "shared",
    chargedTo: null,
    asRead: false,
  };
}

function centsText(cents: number | null): string {
  return cents === null ? "" : (cents / 100).toFixed(2);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** The upload's day by the phone's calendar: where the form starts a date the photo did not show. */
function dayOf(instant: string): string {
  const at = new Date(instant);
  return `${String(at.getFullYear())}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

export function draftOf(
  proposal: ReceiptProposal | null,
  receipt: UploadedReceipt,
  merchantCategoryId: number | null,
): Draft {
  return {
    merchant: proposal?.merchant ?? "",
    date: proposal?.date ?? dayOf(receipt.uploadedAt),
    subtotal: centsText(proposal?.subtotal ?? null),
    gst: centsText(proposal?.gst ?? null),
    qst: centsText(proposal?.qst ?? null),
    total: centsText(proposal?.total ?? null),
    charged: centsText(proposal?.total ?? null),
    items: (proposal?.items ?? []).map(itemDraftOf),
    // The merchant's last category is proposed for the line (lg-10).
    spendingCategoryId: merchantCategoryId,
  };
}

/** Nothing typed into a receipt typed in: leaving it keeps no row for it in the list. */
export function untouched(draft: Draft): boolean {
  return (
    draft.merchant.trim() === "" &&
    draft.subtotal.trim() === "" &&
    draft.gst.trim() === "" &&
    draft.qst.trim() === "" &&
    draft.total.trim() === "" &&
    draft.charged.trim() === "" &&
    draft.items.length === 0
  );
}

/** Whoever took the photo paid it, and it is shared, until a pick says otherwise. */
export function picksOf(receipt: UploadedReceipt): Picks {
  return { joint: false, payer: receipt.uploadedBy, whose: null };
}

/** A receipt as its row in the list reads: its merchant and total, as last edited. */
export function draftLabel(draft: Draft): string {
  const merchant = draft.merchant.trim();
  const total = amountOf(draft.total);
  return `${merchant === "" ? "Unnamed" : merchant}${total === null ? "" : `, ${formatCents(total)}`}`;
}

function amountOf(text: string): number | null {
  return text.trim() === "" ? null : parseTypedAmountCents(text);
}

/**
 * An item as the contract has it, or `null` while its text or price is not one:
 * the form then says so and files nothing, rather than file the item as
 * something it is not. `whose` names a `theirs` item's person, or `null`.
 */
function itemOf(draft: ItemDraft, whose: (draft: ItemDraft) => string | null): ReceiptItem | null {
  const price = amountOf(draft.price);
  const deposit = amountOf(draft.deposit);
  const typed = amountOf(draft.discount);
  if (draft.text.trim() === "" || price === null) return null;
  if (draft.deposit.trim() !== "" && deposit === null) return null;
  if (draft.discount.trim() !== "" && typed === null) return null;
  // A rebate lowers what the item costs: negative on a purchase, positive on a refund.
  // A typed minus is read as the same rebate, not as one that raises the price.
  const discount =
    typed === null || typed === 0 ? typed : price < 0 ? Math.abs(typed) : -Math.abs(typed);
  return {
    text: draft.text.trim(),
    price,
    taxable: draft.taxable,
    deposit,
    discount,
    spendingCategoryId: draft.spendingCategoryId,
    share: draft.share,
    chargedTo: draft.share === "theirs" ? whose(draft) : null,
  };
}

/** The form as a proposal; an amount that is not one is `null`, and the check says so. */
function proposalOf(draft: Draft, whose: (draft: ItemDraft) => string | null): ReceiptProposal {
  return {
    merchant: draft.merchant.trim() === "" ? null : draft.merchant.trim(),
    date: /^\d{4}-\d{2}-\d{2}$/u.test(draft.date) ? draft.date : null,
    subtotal: amountOf(draft.subtotal),
    gst: amountOf(draft.gst),
    qst: amountOf(draft.qst),
    total: amountOf(draft.total),
    items: draft.items.flatMap((item) => itemOf(item, whose) ?? []),
  };
}

/** A draft under its picks, as the form shows it and as a filing sends it. */
export interface ReceiptState {
  proposal: ReceiptProposal;
  flags: ReceiptFlag[];
  /** An item whose text or price is not one yet, left out of the proposal. */
  itemsUnread: boolean;
  /** What the card was charged, or `null` while it is not an amount. */
  charged: number | null;
  dated: boolean;
  payer: string;
  joint: boolean;
  /** The current members other than the payer. */
  others: string[];
  other: string | null;
  several: boolean;
  alone: boolean;
  /** Whose the whole receipt is, when it is someone's (lg-102's Whose). */
  wholeWhose: string | null;
  whose: (item: ItemDraft) => string | null;
  unpicked: (item: ItemDraft) => boolean;
  /**
   * What comes off and what stays shared: `null` until the items make the
   * total, when no split is meaningful, and for a receipt with no items.
   */
  split: ReceiptSplit | null;
  /** Why the items hold filing, as the form says it beside them, or `null`. */
  unfileable: string | null;
  /** Why filing is held, the amount charged and the date included, or `null`. */
  refusal: string | null;
}

/** `people` is the household's current members, from its record (lg-30). */
export function receiptState(draft: Draft, picks: Picks, people: readonly string[]): ReceiptState {
  const { joint, payer } = picks;
  const others = people.filter((person) => person !== payer);
  const [other = null] = others;
  // With one other member "someone else's" is theirs and the request names
  // nobody, as it always did; with more, each item names whose (lg-30).
  const several = others.length > 1;
  // With nobody else, nothing can be someone else's: an item cannot be charged
  // and the receipt cannot be, and filing either would name no one (lg-39).
  const alone = other === null;
  // Paid with the joint card, an item names any current member, and nobody
  // until one is picked (lg-91): a row has no payer to be "the other" of.
  // Not paid jointly, a charge to someone who has left, or to nobody, is not
  // filed to the first other either: it is nobody's until the person picks (lg-94).
  // The select's own picks always name a current other, so only a read brings one.
  const whose = (item: ItemDraft): string | null =>
    joint
      ? item.chargedTo !== null && people.includes(item.chargedTo)
        ? item.chargedTo
        : null
      : !several
        ? null
        : item.chargedTo !== null && others.includes(item.chargedTo)
          ? item.chargedTo
          : null;
  // With nobody else the item is refused as it always was (NOBODY_ELSE), not unpicked.
  // With one other member a charge to nobody is that member's, as the request has
  // always read it; a charge naming someone who is not a current member never is.
  const unpicked = (item: ItemDraft): boolean =>
    !joint &&
    !alone &&
    item.share === "theirs" &&
    (item.chargedTo === null ? several : !others.includes(item.chargedTo));
  const wholeWhose =
    !joint && picks.whose !== null && others.includes(picks.whose) ? picks.whose : null;
  const proposal = proposalOf(draft, whose);
  const flags = checkReceipt(proposal);
  const itemsUnread = proposal.items.length !== draft.items.length;
  const charged = parseTypedAmountCents(draft.charged);
  const dated = /^\d{4}-\d{2}-\d{2}$/u.test(draft.date);
  const split =
    proposal.items.length > 0 && !itemsUnread && itemsAddUp(proposal) && charged !== null
      ? splitReceipt(proposal, undefined, charged)
      : null;
  // Only a joint-account row is split by its items' categories: a line has one.
  const marksMatter =
    proposal.items.some((item) => item.share !== "shared") ||
    (joint && new Set(proposal.items.map((item) => item.spendingCategoryId)).size > 1);
  const unfileable = itemsUnread
    ? ITEMS_UNREAD
    : flags.includes("items-differ")
      ? FLAG_LABELS["items-differ"]
      : flags.includes("taxable-differs") && marksMatter
        ? TAXABLE_MATTERS
        : joint && draft.items.some((item) => item.share !== "shared" && whose(item) === null)
          ? NOBODY_CHOSEN
          : !joint && alone && draft.items.some((item) => item.share === "theirs")
            ? NOBODY_ELSE
            : draft.items.some(unpicked)
              ? UNPICKED_CHARGE
              : null;
  const refusal = charged === null || charged === 0 || !dated ? NEEDS_CHARGE_AND_DATE : unfileable;
  return {
    proposal,
    flags,
    itemsUnread,
    charged,
    dated,
    payer,
    joint,
    others,
    other,
    several,
    alone,
    wholeWhose,
    whose,
    unpicked,
    split,
    unfileable,
    refusal,
  };
}

/**
 * The request that files a draft as a line, under its picks. `paidBy` is sent
 * only when someone other than whoever took the photo paid, so a receipt filed
 * as it always was sends the request it always sent.
 */
export function lineRequest(
  state: ReceiptState,
  draft: Draft,
  receipt: UploadedReceipt,
  part: number,
): FileReceiptRequest {
  const merchant = draft.merchant.trim();
  return {
    part,
    proposal: state.proposal,
    destination: {
      to: "line",
      date: draft.date,
      amountCents: state.charged ?? 0,
      spendingCategoryId: draft.spendingCategoryId,
      note: merchant === "" ? null : merchant,
      chargedTo: state.alone ? null : state.wholeWhose,
      paidBy: state.payer === receipt.uploadedBy ? null : state.payer,
    },
  };
}

/** Joint card, or no other change than the whole receipt's Whose, as one pick. */
export function samePayment(before: Picks, after: Picks): boolean {
  return before.joint === after.joint && (after.joint || before.payer === after.payer);
}

/**
 * The picks as they may stand: on the joint card the whole receipt is nobody's
 * (its items say whose, lg-91), and a receipt is never wholly its payer's.
 */
export function settledPicks(picks: Picks): Picks {
  return picks.joint || picks.whose === picks.payer ? { ...picks, whose: null } : picks;
}

/**
 * The items as a change of who paid leaves them (lg-102). An item's choice is a
 * person, and the payer only decides how it is filed:
 *
 * - **to the joint card** (lg-91's "Paid with the joint card?"): one left as
 *   the payer's names nobody, since a joint purchase has no payer to keep it.
 * - **from the joint card** (lg-91's "Paid with my own card"): one charged to
 *   the new payer, or to nobody by the person's own choice, is theirs to keep;
 *   a read charge nobody chose stays as it was (lg-94).
 * - **from one member to another**: one the old payer kept is now charged to
 *   them, and one charged to the new payer is now theirs to keep. With two
 *   members a charge to nobody meant the old payer's one other, so it is kept
 *   by the new payer when that is who it was.
 */
export function repick(
  draft: Draft,
  before: Picks,
  after: Picks,
  people: readonly string[],
): Draft {
  if (samePayment(before, after)) return draft;
  const items = draft.items.map((item): ItemDraft => {
    if (item.share === "shared") return item;
    if (after.joint) {
      return item.share === "not-shared" ? { ...item, share: "theirs", chargedTo: null } : item;
    }
    if (before.joint) {
      return item.share === "theirs" &&
        !item.asRead &&
        (item.chargedTo === null || item.chargedTo === after.payer)
        ? { ...item, share: "not-shared", chargedTo: null }
        : item;
    }
    if (item.share === "not-shared") {
      return { ...item, share: "theirs", chargedTo: before.payer, asRead: false };
    }
    const othersBefore = people.filter((person) => person !== before.payer);
    const owner = item.chargedTo ?? (othersBefore.length === 1 ? (othersBefore[0] ?? null) : null);
    return owner === after.payer
      ? { ...item, share: "not-shared", chargedTo: null, asRead: false }
      : item;
  });
  return { ...draft, items };
}

/** "a", "a and b", "a, b and c". */
function listed(names: readonly string[]): string {
  const last = names.at(-1) ?? "";
  return names.length < 2 ? last : `${names.slice(0, -1).join(", ")} and ${last}`;
}

/**
 * What a filing became, in words: the payer's line, or the joint-account row
 * when `payer` is `null`, and each person charged, by the filing's own record of whose (lg-30).
 * A person is named once however many charges they hold: a joint-account row
 * files one per category their items fall in (lg-100).
 *
 * A line filed from items says its amounts (the owner, 2026-11-08): the row's
 * label is the receipt's printed total, so without them a receipt with an item
 * unchecked read as filed whole. `split` is the one the request was built from,
 * which the server computes the same way (`splitReceipt`).
 */
export function filedAs(
  filing: ReceiptFiling,
  payer: string | null,
  shown: ShownNames,
  split: ReceiptSplit | null = null,
): string {
  const chargedPeople = [...new Set(filing.charges.map((charge) => charge.chargedTo))].map(
    (person) => `${shownName(shown, person)}'s`,
  );
  const charges = filing.charges.length === 1 ? "a charge" : "charges";
  if (payer === null) {
    return chargedPeople.length === 0
      ? "Attached to the joint-account row."
      : `Attached to the joint-account row, and ${listed(chargedPeople)} items as ${charges} to the pot.`;
  }
  const payerName = shownName(shown, payer);
  if (split !== null) {
    // With one other member a charge names nobody and is theirs (`chargedToOf`): the filing says who.
    const [sole = null, ...more] = new Set(filing.charges.map((charge) => charge.chargedTo));
    return filedSplit(split, payerName, shown, more.length === 0 ? sole : null);
  }
  return chargedPeople.length === 0
    ? `Filed as ${payerName}'s line in the period.`
    : `Filed as ${payerName}'s line in the period, and ${listed(chargedPeople)} items as ${charges}.`;
}

/** A line's filing by its amounts: shared, charged to each person, and kept by the payer. */
function filedSplit(
  split: ReceiptSplit,
  payerName: string,
  shown: ShownNames,
  sole: string | null,
): string {
  // A charge that came to nothing files no line (`fileLines`), so it is not named.
  const charged = split.charges.flatMap((charge) => {
    const person = charge.personId ?? sole;
    return charge.cents === 0 || person === null
      ? []
      : [`${shownName(shown, person)}'s ${formatCents(charge.cents)}`];
  });
  const asCharges = charged.length === 1 ? "as a charge" : "as charges";
  const filed =
    split.sharedCents !== 0
      ? `Filed ${formatCents(split.sharedCents)} as ${payerName}'s line in the period${
          charged.length === 0 ? "" : `, and ${listed(charged)} ${asCharges}`
        }`
      : `Filed ${listed(charged)} ${asCharges}`;
  const kept =
    split.notSharedCents === 0
      ? ""
      : `; ${formatCents(split.notSharedCents)} kept as ${payerName}'s own`;
  return `${filed}${kept}.`;
}
