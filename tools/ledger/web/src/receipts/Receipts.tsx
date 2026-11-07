/**
 * The receipt screen (lg-8), mobile first: take photos, have them read or type
 * one in, and file each from the list (lg-102) — as a line for whoever paid, or
 * on the joint-account row it documents. Opening a receipt is where it is
 * corrected; the list is where it is filed.
 *
 * **The photo leaves the house only on the "Read it" tap**, and the screen says
 * so beside that button, naming the model, at the moment it matters: not in a
 * notice on the camera step that nobody rereads (`docs/00-ANALYSIS.md` §6).
 * Taking the photo keeps it on the household's own server; typing the receipt
 * in never sends it anywhere.
 *
 * **Nothing is filed until the person taps a filing button**, and what is filed
 * is the receipt as they left it. The arithmetic check runs on the form as it
 * is edited (`checkReceipt`), and flags; it never corrects. It blocks items that
 * do not make the total (lg-10), which the API refuses too, and Taxable marks
 * that do not give the printed taxes when they move money: an item left out, or,
 * paid with the joint card, items in more than one category (`TAXABLE_MATTERS`).
 * That one the API does not refuse, since it files the form as the person left
 * it. The list holds a receipt for exactly the same reasons (`receiptState`).
 *
 * **Who paid, and whose it is** (lg-102). At the top of the receipt, bound to
 * its row in the list: Paid by is each current member or the joint card, and
 * Whose is Shared or one other member, who owes all of it. They replace lg-8's
 * "File as …'s line", "This was …'s" and lg-91's two "Paid with" buttons. The
 * receipt keeps one **File it** button, for the joint card, which looks up the
 * row and lists the ones it may be; a line is filed from the list.
 *
 * **The items** (lg-10, lg-90): each item has a Shared box, checked until it is
 * left out; unchecked, a select says whose it is, the payer first (Mine, when
 * that is whoever took the photo) and then each other member (someone else's),
 * and the item shows what it takes off. The amounts that come off and the
 * shared amount update as it changes, computed by the same `splitReceipt` the
 * API files with. Each item's category is editable, and the category the
 * merchant was last given is offered first.
 *
 * **Whose** (lg-30). The people offered are the household's current members,
 * from its record (`fetchHousehold`), never every name the books hold. With one
 * other member an item marked someone else's is theirs, as it always was, and
 * names nobody in the request; with more, it carries a picker of the others.
 * **The form is held until the household has loaded** (lg-39): while it is
 * slow, or after it failed, the screen says so with a retry and offers no
 * filing, since without the members it cannot name whose an item is. The
 * categories load on their own, so one request failing drops no other.
 *
 * **Paid with the joint card** (lg-91). The items turn to the joint account:
 * nobody paid, so there is no Mine. An unchecked item's select offers every
 * current member, whoever took the photo included, and nothing is chosen until
 * the person picks; the item becomes a charge that person owes the pot, and the
 * receipt is held until each such item names one. Paid by a member again, an
 * item charged to them, or to nobody yet, becomes theirs to keep (`repick`).
 */

import { useEffect, useId, useState } from "react";
import { formatCents, sharedAmount } from "@ledger/books";
import { AppError } from "@ledger/contract";
import type { ItemShare, ReceiptMatch, SpendingCategory } from "@ledger/contract";
import { fetchHousehold } from "../api/households.ts";
import { fetchMe } from "../api/me.ts";
import { fetchSpendingCategories } from "../api/spending.ts";
import { fetchReceiptMatches, fileReceipt } from "../api/receipts.ts";
import { SpendingCategoryPicker } from "../spending/Picker.tsx";
import { PhotoPickers } from "./PhotoPickers.tsx";
import { PickSelects, ReceiptQueueView, entryOf, useReceiptQueue } from "./Queue.tsx";
import type { QueuedPhoto } from "./Queue.tsx";
import {
  FLAG_LABELS,
  ITEMS_UNREAD,
  NOBODY_CHOSEN,
  NOBODY_ELSE,
  TAXABLE_MATTERS,
  UNPICKED_CHARGE,
  blankItem,
  filedAs,
  receiptState,
  untouched,
} from "./filing.ts";
import type { Draft, ItemDraft, TextField } from "./filing.ts";
import { shownName, usePeopleNames } from "../people.tsx";
import type { ShownNames } from "../people.tsx";

/** The live line's words for a charge no one has been picked for (lg-91, lg-94). */
const NOT_CHOSEN_YET = "Whose not chosen yet";

/**
 * The `Whose is` choice that keeps an item with whoever paid (`not-shared`). The
 * empty string, because it is a value no person id can take: the contract's
 * `chargedTo` is `z.string().min(1).max(100)`, and a member whose id was a word
 * here was filed Mine when picked (lg-90's gate 1).
 */
const MINE = "";

/** The list with the merchant's last category first, which is what proposing it first means. */
function merchantFirst(
  categories: readonly SpendingCategory[],
  merchantCategoryId: number | null,
): SpendingCategory[] {
  const first = categories.filter((category) => category.id === merchantCategoryId);
  return [...first, ...categories.filter((category) => category.id !== merchantCategoryId)];
}

type Stage =
  | { step: "photo" }
  | { step: "queue" }
  | {
      step: "form";
      /** The queue's photo this form came from (lg-92), and which receipt in it. */
      queueKey: number;
      part: number;
      /** Typed in, not read: left untouched, it leaves no row in the list. */
      typed: boolean;
    };

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
    setMatches(null);
    setProblem(null);
    queue.clear();
  };

  /** A receipt opened from the list, its draft and picks the list's own (lg-102). */
  const openQueued = (photo: QueuedPhoto, part: number): void => {
    if (photo.receipt === null) return;
    const typed = photo.entries[part] === undefined;
    if (typed) queue.keep(photo.key, part, entryOf(null, photo.receipt, null));
    setMatches(null);
    setProblem(null);
    setStage({ step: "form", queueKey: photo.key, part, typed });
  };

  /** One photo or several (lg-92): they join the queue, which keeps them one at a time. */
  const chooseMany = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    setProblem(null);
    queue.add(files);
    setStage({ step: "queue" });
  };

  // Even one receipt comes back to the list: what was read is summed up there
  // before any form opens, whatever the batch's size.
  const readAll = async (): Promise<void> => {
    await queue.readAll();
  };

  const problemLine =
    problem === null ? null : (
      <p className="bad" role="alert">
        {problem}
      </p>
    );

  /**
   * Where the household stands, while the screen cannot name whose anything is
   * (lg-39). The list has its own Start over, so only the held form adds one.
   */
  const householdState = (startOverToo: boolean): React.ReactElement | null =>
    members.state === "loaded" ? null : members.state === "loading" ? (
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
          {startOverToo && (
            <button type="button" onClick={startOver}>
              Start over
            </button>
          )}
        </div>
      </>
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
        people={members.state === "loaded" ? members.value : null}
        household={householdState(false)}
        shown={shown}
        problem={problemLine}
        onOpen={openQueued}
        onReadAll={() => void readAll()}
        onChoose={chooseMany}
        onStartOver={startOver}
      />
    );
  }

  const { queueKey, part } = stage;
  const photo = queue.photos.find((each) => each.key === queueKey);
  const receipt = photo?.receipt ?? null;
  const entry = photo?.entries[part];

  /**
   * Back to the list, the receipt's edits kept there (lg-102); one typed in and
   * left blank is dropped. What was filed is said on its row.
   */
  const backToQueue = (filed: boolean): void => {
    if (stage.typed && entry !== undefined && untouched(entry.draft) && !filed) {
      queue.drop(queueKey, part);
    }
    setMatches(null);
    setProblem(null);
    setStage({ step: "queue" });
  };

  // The form is not offered until the household is known (lg-39): without its
  // members the screen cannot say whose an item is, and would file "someone
  // else's" as though the household were two people.
  if (members.state !== "loaded" || receipt === null || entry === undefined) {
    return (
      <section className="card" aria-labelledby={`${id}-title`}>
        <h2 id={`${id}-title`}>Receipt</h2>
        {householdState(true)}
      </section>
    );
  }
  const people = members.value;
  const categories = loadedCategories.state === "loaded" ? loadedCategories.value : [];
  const form = entry.draft;
  const { picks } = entry;
  const state = receiptState(form, picks, people);
  const { proposal, flags, itemsUnread, split, unfileable, whose, unpicked } = state;
  const { payer, others, other, several, alone, joint } = state;
  const offered = merchantFirst(categories, entry.merchantCategoryId);

  const setDraft = (change: (draft: Draft) => Draft): void => queue.edit(queueKey, part, change);
  const set =
    (field: TextField) =>
    (event: React.ChangeEvent<HTMLInputElement>): void => {
      const value = event.target.value;
      setDraft((before) => {
        const next = { ...before, [field]: value };
        // The charge follows the total until it is changed on its own.
        if (field === "total" && before.charged === before.total) next.charged = value;
        return next;
      });
      setMatches(null);
    };

  /** One item changed, the rest as they are. */
  const setItem = (index: number, change: Partial<ItemDraft>): void => {
    setDraft((before) => ({
      ...before,
      items: before.items.map((item, at) => (at === index ? { ...item, ...change } : item)),
    }));
    // Whose an item is moves no row the charge may be (lg-91): picking one
    // after the rows are found keeps them.
    if (
      Object.keys(change).some((key) => key !== "share" && key !== "chargedTo" && key !== "asRead")
    ) {
      setMatches(null);
    }
  };
  const removeItem = (index: number): void => {
    setDraft((before) => ({ ...before, items: before.items.filter((_item, at) => at !== index) }));
  };
  const addItem = (): void => {
    setDraft((before) => ({ ...before, items: [...before.items, blankItem()] }));
  };

  /** The joint card's **File it** (lg-102): the rows the charge may be, to attach it to one. */
  const lookUp = (): void => {
    const { charged } = state;
    if (charged === null || charged === 0 || !state.dated) {
      setProblem("The amount charged and the date are needed to look for the row.");
      return;
    }
    void run(async () => {
      setMatches(await fetchReceiptMatches(receipt.id, charged, form.date));
    });
  };

  const attach = (rowId: number): void => {
    if (state.refusal !== null) {
      setProblem(state.refusal);
      return;
    }
    void run(async () => {
      const filing = await fileReceipt(receipt.id, {
        part,
        proposal,
        destination: { to: "row", rowId },
      });
      // Filing marks that receipt in the queue, with what it became, and returns to the list.
      queue.markFiled(queueKey, part, filedAs(filing, null, shown));
      backToQueue(true);
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
        <PickSelects
          picks={picks}
          people={people}
          shown={shown}
          paidByLabel="Paid by"
          whoseLabel="Whose"
          labelled
          disabled={busy}
          onChange={(next) => {
            queue.pick(queueKey, part, next, people);
            setMatches(null);
          }}
        />
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
                    placeholder="Rebate"
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
                          // Paid jointly there is no Mine, and it starts on nobody (lg-91).
                          {
                            share: event.target.checked
                              ? "shared"
                              : joint
                                ? "theirs"
                                : "not-shared",
                            chargedTo: null,
                            asRead: false,
                          },
                        )
                      }
                    />
                    Shared
                  </label>
                  {item.share !== "shared" && joint && (
                    <select
                      aria-label={`Whose is ${name}`}
                      value={whose(item) ?? ""}
                      onChange={(event) =>
                        setItem(index, {
                          share: "theirs",
                          chargedTo: event.target.value,
                          asRead: false,
                        })
                      }
                    >
                      {whose(item) === null && (
                        <option value="" disabled>
                          Whose?
                        </option>
                      )}
                      {people.map((person) => (
                        <option key={person} value={person}>
                          {shownName(shown, person)}
                        </option>
                      ))}
                    </select>
                  )}
                  {item.share !== "shared" && !joint && (
                    <select
                      aria-label={`Whose is ${name}`}
                      value={
                        item.share === "not-shared" || unpicked(item)
                          ? MINE
                          : (whose(item) ?? other ?? "")
                      }
                      onChange={(event) =>
                        setItem(
                          index,
                          event.target.value === MINE
                            ? { share: "not-shared", chargedTo: null, asRead: false }
                            : { share: "theirs", chargedTo: event.target.value, asRead: false },
                        )
                      }
                    >
                      {/* A read item someone else's in a household of one: said, not hidden. */}
                      {item.share === "theirs" && alone && (
                        <option value="" disabled>
                          Someone else&rsquo;s
                        </option>
                      )}
                      {/*
                        A read charge to nobody current: said first, with the value Mine
                        has, which React matches to this first option (lg-94). A person
                        id cannot be a second sentinel: any 1 to 100 characters is one.
                      */}
                      {unpicked(item) && (
                        <option value="" disabled>
                          Whose?
                        </option>
                      )}
                      {/* The payer keeps it: Mine when that is whoever took the photo (lg-102). */}
                      <option value={MINE}>
                        {payer === receipt.uploadedBy ? "Mine" : shownName(shown, payer)}
                      </option>
                      {others.map((person) => (
                        <option key={person} value={person}>
                          {shownName(shown, person)}
                        </option>
                      ))}
                    </select>
                  )}
                  {item.share !== "shared" && split !== null && (
                    <span className="takes-off">
                      Takes off {formatCents(sharedAmount(proposal, [index]).excludedCents)}
                    </span>
                  )}
                  <SpendingCategoryPicker
                    ariaLabel={`Category of ${name}`}
                    categories={offered}
                    value={item.spendingCategoryId}
                    noneLabel="None"
                    onChange={(value) => setItem(index, { spendingCategoryId: value })}
                  />
                  {/*
                    Small, at the row's end: it is for a line the reader made up or
                    read twice. Leaving an item out of what is shared is the Shared box.
                  */}
                  <button
                    type="button"
                    className="delete-line"
                    aria-label={`Delete ${name}`}
                    title="Delete this line, if it is not on the receipt"
                    onClick={() => removeItem(index)}
                  >
                    ×
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
          {split !== null && joint && (
            <output aria-label="What is shared">
              {/* Paid jointly nothing stays with a payer: each person's part is owed to the pot (lg-91). */}
              {split.charges
                .filter((charge) => charge.cents !== 0 || charge.personId === null)
                .map(
                  (charge) =>
                    `${
                      charge.personId === null
                        ? NOT_CHOSEN_YET
                        : `Owed to the pot by ${shownName(shown, charge.personId)}`
                    } ${formatCents(charge.cents)} · `,
                )
                .join("")}
              Shared {formatCents(split.sharedCents)}
            </output>
          )}
          {split !== null && !joint && (
            <output aria-label="What is shared">
              Not shared {formatCents(split.notSharedCents)} ·{" "}
              {several
                ? split.charges
                    .map(
                      (charge) =>
                        `${charge.personId === null ? NOT_CHOSEN_YET : shareLabel("theirs", charge.personId, shown)} ${formatCents(charge.cents)} · `,
                    )
                    .join("")
                : `${form.items.some(unpicked) ? NOT_CHOSEN_YET : shareLabel("theirs", other, shown)} ${formatCents(split.chargedCents)} · `}
              Shared {formatCents(split.sharedCents)}
            </output>
          )}
          {(itemsUnread ||
            unfileable === ITEMS_UNREAD ||
            unfileable === NOBODY_ELSE ||
            unfileable === NOBODY_CHOSEN ||
            unfileable === UNPICKED_CHARGE ||
            unfileable === TAXABLE_MATTERS) && <p className="hint bad">{unfileable}</p>}
        </fieldset>
        {field("charged", "Charged to the card (with any tip)")}
        <label htmlFor={`${id}-spending`}>Spending category</label>
        <SpendingCategoryPicker
          id={`${id}-spending`}
          categories={offered}
          value={form.spendingCategoryId}
          noneLabel="None"
          onChange={(value) => setDraft((before) => ({ ...before, spendingCategoryId: value }))}
        />
        {joint ? (
          <div className="actions">
            <button className="primary" type="button" disabled={busy} onClick={lookUp}>
              File it
            </button>
          </div>
        ) : (
          <p className="muted hint">
            Filed from the list: go back to the queue, select it and tap File selected.
          </p>
        )}
      </form>
      {joint && matches !== null && matches.length === 0 && (
        <p className="muted hint">No joint-account row of that amount within a few days.</p>
      )}
      {joint && matches !== null && matches.length > 0 && (
        <ul className="matching" aria-label="Rows it may be">
          {matches.map((match) => (
            <li key={match.rowId}>
              <span>
                {match.date} · {match.description} · {formatCents(match.amountCents)}
              </span>
              <button type="button" disabled={busy} onClick={() => attach(match.rowId)}>
                Attach to this row
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="actions">
        <button type="button" disabled={busy} onClick={() => backToQueue(false)}>
          Back to the queue
        </button>
      </div>
      {problemLine}
    </section>
  );
}
