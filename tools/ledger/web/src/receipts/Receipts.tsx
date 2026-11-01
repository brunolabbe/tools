/**
 * The receipt screen (lg-8), mobile first: take a photo, have it read or type
 * it in, correct what was read, and file it — as a line for whoever took the
 * photo, or on the joint-account row it documents.
 *
 * **The photo leaves the house only on the "Read it" tap**, and the screen says
 * so beside that button, naming the model, at the moment it matters: not in a
 * notice on the camera step that nobody rereads (`docs/00-ANALYSIS.md` §6).
 * Taking the photo keeps it on the household's own server; typing the receipt
 * in never sends it anywhere.
 *
 * **Nothing is filed until the person taps a filing button**, and what is filed
 * is the form as they left it. The arithmetic check runs on the form as it is
 * edited (`checkReceipt`), and flags; it never corrects, and blocks only items
 * that do not make the total (lg-10), which the API refuses too.
 *
 * **The items** (lg-10, lg-90): each item has a Shared box, checked until it is
 * left out; unchecked, a select says whose it is, Mine (not shared) first and
 * then each other member (someone else's), and the item shows what it takes off.
 * The amounts that come off and the shared amount update as it changes,
 * computed by the same `splitReceipt` the API files with. Each item's
 * category is editable, and the category the merchant was last given is offered
 * first.
 *
 * **Whose** (lg-30). The people offered are the household's current members,
 * from its record (`fetchHousehold`), never every name the books hold. With one
 * other member an item marked someone else's is theirs, as it always was, and
 * names nobody in the request; with more, it carries a picker of the others, and
 * so does the whole receipt. **The form is held until the household has loaded**
 * (lg-39): while it is slow, or after it failed, the screen says so with a retry
 * and offers no filing, since without the members it cannot name whose an item
 * is. The categories load on their own, so one request failing drops no other.
 */

import { useEffect, useId, useState } from "react";
import {
  checkReceipt,
  formatCents,
  itemsAddUp,
  parseTypedAmountCents,
  sharedAmount,
  splitReceipt,
} from "@ledger/books";
import type { ReceiptSplit } from "@ledger/books";
import { AppError } from "@ledger/contract";
import type {
  CheckedProposal,
  ItemShare,
  ReceiptFlag,
  ReceiptItem,
  ReceiptMatch,
  ReceiptProposal,
  SpendingCategory,
  UploadedReceipt,
} from "@ledger/contract";
import { fetchHousehold } from "../api/households.ts";
import { fetchMe } from "../api/me.ts";
import { fetchSpendingCategories } from "../api/spending.ts";
import { fetchReceiptMatches, fileReceipt } from "../api/receipts.ts";
import { SpendingCategoryPicker } from "../spending/Picker.tsx";
import { PhotoPickers } from "./PhotoPickers.tsx";
import { ReceiptQueueView, useReceiptQueue } from "./Queue.tsx";
import type { QueuedPhoto } from "./Queue.tsx";
import { shownName, usePeopleNames } from "../people.tsx";
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

/** One item's fields, as typed. */
interface ItemDraft {
  /** The list's key: an item has no id until filed, and the list adds and removes. */
  key: number;
  text: string;
  price: string;
  taxable: boolean;
  deposit: string;
  /** The rebates folded into it (lg-89), negative on a purchase; blank for none. */
  discount: string;
  spendingCategoryId: number | null;
  share: ItemShare;
  /** Whose a `theirs` item is, as picked; `null` until picked, and with one other member. */
  chargedTo: string | null;
}

/** The form's fields, as typed. Amounts are text until filed. */
interface Draft {
  merchant: string;
  date: string;
  subtotal: string;
  gst: string;
  qst: string;
  total: string;
  /** What the card was charged: the total, unless a tip was added under it. */
  charged: string;
  items: ItemDraft[];
}

/** The form's fields that are a line of text. */
type TextField = Exclude<keyof Draft, "items">;

const NOBODY_ELSE = "There is nobody else in the household to charge an item to.";

/**
 * The `Whose is` choice that keeps an item with whoever paid (`not-shared`). The
 * empty string, because it is a value no person id can take: the contract's
 * `chargedTo` is `z.string().min(1).max(100)`, and a member whose id was a word
 * here was filed Mine when picked (lg-90's gate 1).
 */
const MINE = "";

let lastItemKey = 0;

function itemKey(): number {
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
    discount: centsText(item.discount),
    spendingCategoryId: item.spendingCategoryId,
    share: item.share,
    chargedTo: item.chargedTo,
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

function draftOf(proposal: ReceiptProposal | null, receipt: UploadedReceipt): Draft {
  return {
    merchant: proposal?.merchant ?? "",
    date: proposal?.date ?? dayOf(receipt.uploadedAt),
    subtotal: centsText(proposal?.subtotal ?? null),
    gst: centsText(proposal?.gst ?? null),
    qst: centsText(proposal?.qst ?? null),
    total: centsText(proposal?.total ?? null),
    charged: centsText(proposal?.total ?? null),
    items: (proposal?.items ?? []).map(itemDraftOf),
  };
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
  const discount = amountOf(draft.discount);
  if (draft.text.trim() === "" || price === null) return null;
  if (draft.deposit.trim() !== "" && deposit === null) return null;
  if (draft.discount.trim() !== "" && discount === null) return null;
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

/** The list with the merchant's last category first, which is what proposing it first means. */
function merchantFirst(
  categories: readonly SpendingCategory[],
  merchantCategoryId: number | null,
): SpendingCategory[] {
  const first = categories.filter((category) => category.id === merchantCategoryId);
  return [...first, ...categories.filter((category) => category.id !== merchantCategoryId)];
}

/**
 * Where a photo stands: what was read from it, if anything, and which of the
 * receipts it holds are filed. A photo of two receipts files each as its own
 * part, from 1 (gate 1, F2).
 */
interface Photo {
  receipt: UploadedReceipt;
  read: CheckedProposal[] | null;
  filed: number[];
}

type Stage =
  | { step: "photo" }
  | { step: "queue"; said: string | null }
  | ({
      step: "form";
      part: number;
      merchantCategoryId: number | null;
      /** The queue's photo this form came from (lg-92). */
      queueKey: number;
    } & Photo);

/** An item's share as the live line reads it: someone else's names whose, when known. */
function shareLabel(share: ItemShare, person: string | null, shown: ShownNames): string {
  return share === "shared"
    ? "Shared"
    : share === "not-shared"
      ? "Not shared"
      : person === null
        ? "The other's"
        : `${shownName(shown, person)}'s`;
}

/** "a", "a and b", "a, b and c". */
function listed(names: readonly string[]): string {
  const last = names.at(-1) ?? "";
  return names.length < 2 ? last : `${names.slice(0, -1).join(", ")} and ${last}`;
}

/** A request's answer as the screen holds it: not yet, failed with what to say, or in. */
type Loaded<T> =
  | { state: "loading" }
  | { state: "failed"; message: string }
  | { state: "loaded"; value: T };

/**
 * One request, run on its own so that another's failure drops nothing it
 * returned (lg-39), and again on `retry`. `load` must be a stable function.
 */
function useLoad<T>(load: (signal: AbortSignal) => Promise<T>): [Loaded<T>, () => void] {
  const [loaded, setLoaded] = useState<Loaded<T>>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  // What the answer in state is for. A new `load` or a retry starts from
  // "loading" — derived state, set during render, so the last answer is never
  // painted for the new request — and the effect runs on this pair alone, which
  // is how `attempt` reaches it without being read inside it.
  const [asked, setAsked] = useState({ load, attempt });
  if (asked.load !== load || asked.attempt !== attempt) {
    setAsked({ load, attempt });
    setLoaded({ state: "loading" });
  }
  useEffect(() => {
    const controller = new AbortController();
    const run = async (): Promise<void> => {
      try {
        const value = await asked.load(controller.signal);
        if (!controller.signal.aborted) setLoaded({ state: "loaded", value });
      } catch (error: unknown) {
        if (!controller.signal.aborted) {
          setLoaded({ state: "failed", message: AppError.from(error).message });
        }
      }
    };
    void run();
    return () => controller.abort();
  }, [asked]);
  return [loaded, () => setAttempt((before) => before + 1)];
}

/**
 * The current members, from the household's record (lg-30): the books'
 * `fetchPeople` holds every name ever enrolled, one who has left included.
 */
async function loadMembers(signal: AbortSignal): Promise<string[]> {
  const me = await fetchMe(signal);
  const household = await fetchHousehold(me.person.household, signal);
  return [...new Set(household.members.map((member) => member.person))];
}

export function Receipts(): React.ReactElement {
  const id = useId();
  const shown = usePeopleNames();
  const [stage, setStage] = useState<Stage>({ step: "photo" });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [spendingCategoryId, setSpendingCategoryId] = useState<number | null>(null);
  const [theirs, setTheirs] = useState(false);
  /** Whose the whole receipt is, when it is someone's among several (lg-30). */
  const [wholeChosen, setWholeChosen] = useState("");
  const [matches, setMatches] = useState<ReceiptMatch[] | null>(null);
  const [members, retryMembers] = useLoad(loadMembers);
  const [loadedCategories, retryCategories] = useLoad(fetchSpendingCategories);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const queue = useReceiptQueue();

  const run = async (step: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setProblem(null);
    try {
      await step();
    } catch (error: unknown) {
      setProblem(AppError.from(error).message);
    } finally {
      setBusy(false);
    }
  };

  const startOver = (): void => {
    setStage({ step: "photo" });
    setDraft(null);
    setSpendingCategoryId(null);
    setTheirs(false);
    setWholeChosen("");
    setMatches(null);
    setProblem(null);
    queue.clear();
  };

  const open = (
    photo: Photo,
    part: number,
    checked: CheckedProposal | null,
    queueKey: number,
  ): void => {
    const merchantCategoryId = checked?.merchantCategoryId ?? null;
    setDraft(draftOf(checked?.proposal ?? null, photo.receipt));
    // The merchant's last category is proposed for the line (lg-10).
    setSpendingCategoryId(merchantCategoryId);
    setTheirs(false);
    setWholeChosen("");
    setMatches(null);
    // The photo's own three fields, not a stage spread in whole: its `step` would win.
    setStage({
      step: "form",
      part,
      merchantCategoryId,
      queueKey,
      receipt: photo.receipt,
      read: photo.read,
      filed: photo.filed,
    });
  };

  /** One photo or several (lg-92): they join the queue, which keeps them one at a time. */
  const chooseMany = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    setProblem(null);
    queue.add(files);
    setStage((before) => ({ step: "queue", said: before.step === "queue" ? before.said : null }));
  };

  /** Back to the queue, the form's draft dropped: what was filed is marked there. */
  const backToQueue = (said: string | null): void => {
    setDraft(null);
    setMatches(null);
    setProblem(null);
    setStage({ step: "queue", said });
  };

  const openQueued = (photo: QueuedPhoto, part: number, checked: CheckedProposal | null): void => {
    if (photo.receipt === null) return;
    open(
      { receipt: photo.receipt, read: photo.read, filed: photo.filed },
      part,
      checked,
      photo.key,
    );
  };

  const readAll = async (): Promise<void> => {
    const photos = await queue.readAll();
    // One photo of one receipt opens straight into its form: there is no list to pick from.
    const [only] = photos;
    const [checked] = only?.read ?? [];
    if (photos.length !== 1 || only?.read?.length !== 1 || checked === undefined) return;
    if (only.filed.length === 0) openQueued(only, 1, checked);
  };

  const problemLine =
    problem === null ? null : (
      <p className="bad" role="alert">
        {problem}
      </p>
    );

  if (stage.step === "photo") {
    return (
      <section className="card" aria-labelledby={`${id}-title`}>
        <h2 id={`${id}-title`}>Receipt</h2>
        <PhotoPickers disabled={busy} onChoose={chooseMany} />
        <p className="muted hint">
          Photos stay on the household&rsquo;s server until you ask for them to be read.
        </p>
        {problemLine}
      </section>
    );
  }

  if (stage.step === "queue") {
    return (
      <ReceiptQueueView
        id={id}
        queue={queue}
        said={stage.said}
        problem={problemLine}
        onOpen={openQueued}
        onReadAll={() => void readAll()}
        onChoose={chooseMany}
        onStartOver={startOver}
      />
    );
  }

  // The form is not offered until the household is known (lg-39): without its
  // members the screen cannot say whose an item is, and would file "someone
  // else's" as though the household were two people.
  if (members.state !== "loaded") {
    return (
      <section className="card" aria-labelledby={`${id}-title`}>
        <h2 id={`${id}-title`}>Receipt</h2>
        {members.state === "loading" ? (
          <output className="muted hint">Loading the household…</output>
        ) : (
          <>
            <p className="bad" role="alert">
              The household did not load: {members.message}
            </p>
            <div className="actions">
              <button type="button" onClick={retryMembers}>
                Try again
              </button>
              <button type="button" onClick={startOver}>
                Start over
              </button>
            </div>
          </>
        )}
      </section>
    );
  }
  const people = members.value;
  const categories = loadedCategories.state === "loaded" ? loadedCategories.value : [];
  const { receipt, part } = stage;
  const form = draft ?? draftOf(null, receipt);
  const payer = receipt.uploadedBy;
  const others = people.filter((person) => person !== payer);
  const [other = null] = others;
  // With one other member "someone else's" is theirs and the request names
  // nobody, as it always did; with more, each item names whose (lg-30).
  const several = others.length > 1;
  // With nobody else, nothing can be someone else's: an item cannot be charged
  // and the receipt cannot be, and filing either would name no one (lg-39).
  const alone = other === null;
  const whose = (item: ItemDraft): string | null =>
    !several
      ? null
      : item.chargedTo !== null && others.includes(item.chargedTo)
        ? item.chargedTo
        : other;
  const wholeWhose = others.includes(wholeChosen) ? wholeChosen : other;
  const proposal = proposalOf(form, whose);
  const flags = checkReceipt(proposal);
  const offered = merchantFirst(categories, stage.merchantCategoryId);
  // An item whose text or price is not one yet is left out of the proposal.
  const itemsUnread = proposal.items.length !== form.items.length;
  const set =
    (field: TextField) =>
    (event: React.ChangeEvent<HTMLInputElement>): void => {
      const value = event.target.value;
      setDraft((before) => {
        const next = { ...(before ?? form), [field]: value };
        // The charge follows the total until it is changed on its own.
        if (field === "total" && (before ?? form).charged === (before ?? form).total) {
          next.charged = value;
        }
        return next;
      });
      setMatches(null);
    };

  const charged = parseTypedAmountCents(form.charged);
  const dated = /^\d{4}-\d{2}-\d{2}$/u.test(form.date);

  /** One item changed, the rest as they are. */
  const setItem = (index: number, change: Partial<ItemDraft>): void => {
    setDraft((before) => {
      const current = before ?? form;
      return {
        ...current,
        items: current.items.map((item, at) => (at === index ? { ...item, ...change } : item)),
      };
    });
    setMatches(null);
  };
  const removeItem = (index: number): void => {
    setDraft((before) => {
      const current = before ?? form;
      return { ...current, items: current.items.filter((_item, at) => at !== index) };
    });
  };
  const addItem = (): void => {
    setDraft((before) => {
      const current = before ?? form;
      const blank: ItemDraft = {
        key: itemKey(),
        text: "",
        price: "",
        taxable: false,
        deposit: "",
        discount: "",
        spendingCategoryId: null,
        share: "shared",
        chargedTo: null,
      };
      return { ...current, items: [...current.items, blank] };
    });
  };

  /**
   * What comes off and what stays shared, live: `null` until the items make the
   * total, when no split is meaningful, and for a receipt with no items.
   */
  const split: ReceiptSplit | null =
    proposal.items.length > 0 && !itemsUnread && itemsAddUp(proposal) && charged !== null
      ? splitReceipt(proposal, undefined, charged)
      : null;
  /** Why the form cannot be filed yet, or `null`. */
  const unfileable = itemsUnread
    ? "An item needs its text and its price before the receipt can be filed."
    : flags.includes("items-differ")
      ? FLAG_LABELS["items-differ"]
      : alone && form.items.some((item) => item.share === "theirs")
        ? NOBODY_ELSE
        : null;

  const lookUp = (): void => {
    if (charged === null || charged === 0 || !dated) {
      setProblem("The amount charged and the date are needed to look for the row.");
      return;
    }
    void run(async () => {
      setMatches(await fetchReceiptMatches(receipt.id, charged, form.date));
    });
  };

  const fileAs = (destination: "line" | number): void => {
    if (charged === null || charged === 0 || !dated) {
      setProblem("The amount charged and the date are needed to file it.");
      return;
    }
    if (unfileable !== null) {
      setProblem(unfileable);
      return;
    }
    if (destination !== "line" && proposal.items.some((item) => item.share !== "shared")) {
      setProblem(
        "A receipt on a joint-account row is shared whole: every item on it stays shared.",
      );
      return;
    }
    void run(async () => {
      const filing = await fileReceipt(receipt.id, {
        part,
        proposal,
        destination:
          destination === "line"
            ? {
                to: "line",
                date: form.date,
                amountCents: charged,
                spendingCategoryId,
                note: form.merchant.trim() === "" ? null : form.merchant.trim(),
                chargedTo: theirs && !alone ? wholeWhose : null,
              }
            : { to: "row", rowId: destination },
      });
      // Each person charged, by the filing's own record of whose (lg-30).
      const chargedPeople = filing.charges.map(
        (charge) => `${shownName(shown, charge.chargedTo)}'s`,
      );
      const said =
        destination !== "line"
          ? "Attached to the joint-account row."
          : chargedPeople.length === 0
            ? `Filed as ${shownName(shown, payer)}'s line in the period.`
            : `Filed as ${shownName(shown, payer)}'s line in the period, and ${listed(chargedPeople)} items as ${
                chargedPeople.length === 1 ? "a charge" : "charges"
              }.`;
      // Filing marks that receipt in the queue and returns to the list.
      queue.markFiled(stage.queueKey, part);
      backToQueue(said);
    });
  };

  const field = (name: TextField, label: string, mode: "text" | "decimal" = "decimal") => (
    <>
      <label htmlFor={`${id}-${name}`}>{label}</label>
      <input id={`${id}-${name}`} value={form[name]} inputMode={mode} onChange={set(name)} />
    </>
  );

  return (
    <section className="card" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>Receipt</h2>
      {loadedCategories.state === "failed" && (
        <div role="alert" className="bad">
          <p>The spending categories did not load: {loadedCategories.message}</p>
          <button type="button" onClick={retryCategories}>
            Try again
          </button>
        </div>
      )}
      <form
        className="rule-form"
        aria-label="The receipt"
        onSubmit={(event) => event.preventDefault()}
      >
        {field("merchant", "Merchant", "text")}
        <label htmlFor={`${id}-date`}>Date</label>
        <input id={`${id}-date`} type="date" value={form.date} onChange={set("date")} />
        {field("subtotal", "Subtotal")}
        {field("gst", "GST (TPS)")}
        {field("qst", "QST (TVQ)")}
        {field("total", "Total")}
        {flags.length === 0 ? (
          <p className="hint">It adds up.</p>
        ) : (
          <ul className="hint bad" aria-label="What does not add up">
            {flags.map((flag) => (
              <li key={flag}>{FLAG_LABELS[flag]}</li>
            ))}
          </ul>
        )}
        <fieldset className="items">
          <legend>Items</legend>
          {form.items.length === 0 && (
            <p className="muted hint">No items: the receipt is filed on its total.</p>
          )}
          <ul aria-label="The items">
            {form.items.map((item, index) => {
              const name = item.text.trim() === "" ? `item ${String(index + 1)}` : item.text;
              return (
                <li key={item.key} className={`item ${item.share}`}>
                  <input
                    aria-label={`Text of ${name}`}
                    value={item.text}
                    onChange={(event) => setItem(index, { text: event.target.value })}
                  />
                  <input
                    aria-label={`Price of ${name}`}
                    inputMode="decimal"
                    value={item.price}
                    onChange={(event) => setItem(index, { price: event.target.value })}
                  />
                  <input
                    aria-label={`Deposit on ${name}`}
                    inputMode="decimal"
                    placeholder="Deposit"
                    value={item.deposit}
                    onChange={(event) => setItem(index, { deposit: event.target.value })}
                  />
                  <input
                    aria-label={`Rebate on ${name}`}
                    inputMode="decimal"
                    placeholder="Rebate, -2.00"
                    value={item.discount}
                    onChange={(event) => setItem(index, { discount: event.target.value })}
                  />
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={item.taxable}
                      onChange={(event) => setItem(index, { taxable: event.target.checked })}
                    />
                    Taxable
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      aria-label={`${name} is shared`}
                      checked={item.share === "shared"}
                      onChange={(event) =>
                        setItem(
                          index,
                          // Unchecked starts on Mine: a charge is the person's choice (lg-90).
                          {
                            share: event.target.checked ? "shared" : "not-shared",
                            chargedTo: null,
                          },
                        )
                      }
                    />
                    Shared
                  </label>
                  {item.share !== "shared" && (
                    <>
                      <select
                        aria-label={`Whose is ${name}`}
                        value={item.share === "not-shared" ? MINE : (whose(item) ?? other ?? "")}
                        onChange={(event) =>
                          setItem(
                            index,
                            event.target.value === MINE
                              ? { share: "not-shared", chargedTo: null }
                              : { share: "theirs", chargedTo: event.target.value },
                          )
                        }
                      >
                        {/* A read item someone else's in a household of one: said, not hidden. */}
                        {item.share === "theirs" && alone && (
                          <option value="" disabled>
                            Someone else&rsquo;s
                          </option>
                        )}
                        <option value={MINE}>Mine</option>
                        {others.map((person) => (
                          <option key={person} value={person}>
                            {shownName(shown, person)}
                          </option>
                        ))}
                      </select>
                      {split !== null && (
                        <span className="takes-off">
                          Takes off {formatCents(sharedAmount(proposal, [index]).excludedCents)}
                        </span>
                      )}
                    </>
                  )}
                  <SpendingCategoryPicker
                    ariaLabel={`Category of ${name}`}
                    categories={offered}
                    value={item.spendingCategoryId}
                    noneLabel="None"
                    onChange={(value) => setItem(index, { spendingCategoryId: value })}
                  />
                  <button
                    type="button"
                    aria-label={`Remove ${name}`}
                    onClick={() => removeItem(index)}
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="actions">
            <button type="button" onClick={addItem}>
              Add an item
            </button>
          </div>
          {split !== null && (
            <output aria-label="What is shared">
              Not shared {formatCents(split.notSharedCents)} ·{" "}
              {several
                ? split.charges
                    .map(
                      (charge) =>
                        `${shareLabel("theirs", charge.personId, shown)} ${formatCents(charge.cents)} · `,
                    )
                    .join("")
                : `${shareLabel("theirs", other, shown)} ${formatCents(split.chargedCents)} · `}
              Shared {formatCents(split.sharedCents)}
            </output>
          )}
          {(itemsUnread || unfileable === NOBODY_ELSE) && <p className="hint bad">{unfileable}</p>}
        </fieldset>
        {field("charged", "Charged to the card (with any tip)")}
        <label htmlFor={`${id}-spending`}>Spending category</label>
        <SpendingCategoryPicker
          id={`${id}-spending`}
          categories={offered}
          value={spendingCategoryId}
          noneLabel="None"
          onChange={setSpendingCategoryId}
        />
        {other !== null && (
          <label className="check">
            <input
              type="checkbox"
              checked={theirs}
              onChange={(event) => setTheirs(event.target.checked)}
            />
            {several ? "This was someone else's" : `This was ${shownName(shown, other)}'s`}
          </label>
        )}
        {theirs && several && (
          <>
            <label htmlFor={`${id}-whose`}>Whose it was</label>
            <select
              id={`${id}-whose`}
              value={wholeWhose ?? ""}
              onChange={(event) => setWholeChosen(event.target.value)}
            >
              {others.map((person) => (
                <option key={person} value={person}>
                  {shownName(shown, person)}
                </option>
              ))}
            </select>
          </>
        )}
        <div className="actions">
          <button className="primary" type="button" disabled={busy} onClick={() => fileAs("line")}>
            File as {shownName(shown, payer)}&rsquo;s line
          </button>
          <button type="button" disabled={busy} onClick={lookUp}>
            Paid with the joint card?
          </button>
        </div>
      </form>
      {matches !== null && matches.length === 0 && (
        <p className="muted hint">No joint-account row of that amount within a few days.</p>
      )}
      {matches !== null && matches.length > 0 && (
        <ul className="matching" aria-label="Rows it may be">
          {matches.map((match) => (
            <li key={match.rowId}>
              <span>
                {match.date} · {match.description} · {formatCents(match.amountCents)}
              </span>
              <button type="button" disabled={busy} onClick={() => fileAs(match.rowId)}>
                Attach to this row
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="actions">
        <button type="button" disabled={busy} onClick={() => backToQueue(null)}>
          Back to the queue
        </button>
      </div>
      {problemLine}
    </section>
  );
}
