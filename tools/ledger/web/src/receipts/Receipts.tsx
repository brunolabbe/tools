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
 * edited (`checkReceipt`), and flags; it never corrects and never blocks.
 */

import { useEffect, useId, useState } from "react";
import { checkReceipt, formatCents, parseTypedAmountCents } from "@ledger/books";
import { AppError, MAX_RECEIPT_PHOTO_BYTES, MAX_RECEIPTS_PER_PHOTO } from "@ledger/contract";
import type {
  CheckedProposal,
  ReceiptFlag,
  ReceiptMatch,
  ReceiptProposal,
  SpendingCategory,
  UploadedReceipt,
} from "@ledger/contract";
import { fetchPeople } from "../api/rules.ts";
import { fetchSpendingCategories } from "../api/spending.ts";
import { fetchReceiptMatches, fileReceipt, readReceipt, uploadReceipt } from "../api/receipts.ts";
import { SpendingCategoryPicker } from "../spending/Picker.tsx";

export const FLAG_LABELS: Record<ReceiptFlag, string> = {
  "total-missing": "The total was not read.",
  "subtotal-missing": "The subtotal was not read.",
  "tax-missing": "One tax was read and the other was not.",
  "parts-differ": "The subtotal and the taxes do not add up to the total.",
  "tax-differs": "The taxes are not 5 % and 9.975 % of the same amount.",
  "signs-differ": "Some amounts are a purchase and some a refund.",
};

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
  };
}

function amountOf(text: string): number | null {
  return text.trim() === "" ? null : parseTypedAmountCents(text);
}

/** The form as a proposal; an amount that is not one is `null`, and the check says so. */
function proposalOf(draft: Draft): ReceiptProposal {
  return {
    merchant: draft.merchant.trim() === "" ? null : draft.merchant.trim(),
    date: /^\d{4}-\d{2}-\d{2}$/u.test(draft.date) ? draft.date : null,
    subtotal: amountOf(draft.subtotal),
    gst: amountOf(draft.gst),
    qst: amountOf(draft.qst),
    total: amountOf(draft.total),
  };
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
  | ({ step: "kept"; said: string | null } & Photo)
  | ({ step: "form"; part: number } & Photo)
  | ({ step: "filed"; said: string } & Photo);

/** The first part of the photo not filed yet. */
function nextPart(filed: readonly number[]): number {
  let part = 1;
  while (filed.includes(part)) part += 1;
  return part;
}

export function Receipts(): React.ReactElement {
  const id = useId();
  const [stage, setStage] = useState<Stage>({ step: "photo" });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [spendingCategoryId, setSpendingCategoryId] = useState<number | null>(null);
  const [theirs, setTheirs] = useState(false);
  const [matches, setMatches] = useState<ReceiptMatch[] | null>(null);
  const [people, setPeople] = useState<string[]>([]);
  const [categories, setCategories] = useState<SpendingCategory[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const load = async (): Promise<void> => {
      try {
        const [loadedPeople, loadedCategories] = await Promise.all([
          fetchPeople(controller.signal),
          fetchSpendingCategories(controller.signal),
        ]);
        setPeople(loadedPeople);
        setCategories(loadedCategories);
      } catch (error: unknown) {
        if (!controller.signal.aborted) setProblem(AppError.from(error).message);
      }
    };
    void load();
    return () => controller.abort();
  }, []);

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
    setMatches(null);
    setProblem(null);
  };

  const open = (photo: Photo, part: number, proposal: ReceiptProposal | null): void => {
    setDraft(draftOf(proposal, photo.receipt));
    setSpendingCategoryId(null);
    setTheirs(false);
    setMatches(null);
    // The photo's own three fields, not a stage spread in whole: its `step` would win.
    setStage({ step: "form", part, receipt: photo.receipt, read: photo.read, filed: photo.filed });
  };

  const choose = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const photo = event.target.files?.[0];
    event.target.value = "";
    if (photo === undefined) return;
    if (photo.size > MAX_RECEIPT_PHOTO_BYTES) {
      setProblem("That photo is over 7 MB. Take it again, closer.");
      return;
    }
    void run(async () => {
      const receipt = await uploadReceipt(photo);
      setStage({ step: "kept", receipt, read: null, filed: [], said: null });
    });
  };

  const problemLine =
    problem === null ? null : (
      <p className="bad" role="alert">
        {problem}
      </p>
    );

  if (stage.step === "photo" || stage.step === "filed") {
    return (
      <section className="card" aria-labelledby={`${id}-title`}>
        <h2 id={`${id}-title`}>Receipt</h2>
        {stage.step === "filed" && <output>{stage.said}</output>}
        {stage.step === "filed" && nextPart(stage.filed) <= MAX_RECEIPTS_PER_PHOTO && (
          <div className="actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => open(stage, nextPart(stage.filed), null)}
            >
              Type another receipt from this photo
            </button>
          </div>
        )}
        <label className="camera">
          {busy ? "Keeping the photo…" : "Take a photo of a receipt"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            disabled={busy}
            onChange={choose}
          />
        </label>
        <p className="muted hint">
          The photo stays on the household&rsquo;s server until you ask for it to be read.
        </p>
        {problemLine}
      </section>
    );
  }

  if (stage.step === "kept") {
    const { receipt, read, filed } = stage;
    const ask = (): void => {
      void run(async () => {
        const answer = await readReceipt(receipt.id);
        const photo = { receipt, read: answer.proposals, filed };
        const [only] = answer.proposals;
        if (answer.proposals.length === 1 && only !== undefined) open(photo, 1, only.proposal);
        else setStage({ step: "kept", ...photo, said: null });
      });
    };
    // Each receipt read keeps its place in the photo as its part, filed or not.
    const waiting = (read ?? [])
      .map((checked, index) => ({ checked, part: index + 1 }))
      .filter(({ part }) => !filed.includes(part));
    return (
      <section className="card" aria-labelledby={`${id}-title`}>
        <h2 id={`${id}-title`}>Receipt</h2>
        {stage.said === null ? <p>Photo kept.</p> : <output>{stage.said}</output>}
        {read !== null && read.length === 0 && (
          <p className="bad">Nothing in the photo was read as a receipt. Type it in instead.</p>
        )}
        {read !== null && (read.length > 1 || filed.length > 0) && waiting.length > 0 && (
          <div className="offer">
            <h3>
              {filed.length === 0
                ? `The photo holds ${String(read.length)} receipts`
                : `The photo holds ${String(waiting.length)} more to file`}
            </h3>
            {waiting.map(({ checked, part }) => (
              <button key={part} type="button" onClick={() => open(stage, part, checked.proposal)}>
                {checked.proposal.merchant ?? "Unnamed"}
                {checked.proposal.total === null ? "" : `, ${formatCents(checked.proposal.total)}`}
              </button>
            ))}
          </div>
        )}
        {read === null && filed.length === 0 && receipt.reader !== null && (
          <div className="offer">
            <p className="hint">
              Reading sends this photo out of the house, to Anthropic, where{" "}
              <strong>{receipt.reader}</strong> reads it. Typing it in sends nothing.
            </p>
            <div className="actions">
              <button type="button" disabled={busy} onClick={ask}>
                {busy ? "Reading…" : "Read it"}
              </button>
            </div>
          </div>
        )}
        {receipt.reader === null && (
          <p className="muted hint">
            Reading receipts is not set up here, so this one is typed in.
          </p>
        )}
        <div className="actions">
          <button type="button" disabled={busy} onClick={() => open(stage, nextPart(filed), null)}>
            Type it in
          </button>
          <button type="button" disabled={busy} onClick={startOver}>
            Start over
          </button>
        </div>
        {problemLine}
      </section>
    );
  }

  const { receipt, part } = stage;
  const form = draft ?? draftOf(null, receipt);
  const flags = checkReceipt(proposalOf(form));
  const payer = receipt.uploadedBy;
  const other = people.find((person) => person !== payer) ?? null;
  const set =
    (field: keyof Draft) =>
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
    void run(async () => {
      await fileReceipt(receipt.id, {
        part,
        proposal: proposalOf(form),
        destination:
          destination === "line"
            ? {
                to: "line",
                date: form.date,
                amountCents: charged,
                spendingCategoryId,
                note: form.merchant.trim() === "" ? null : form.merchant.trim(),
                chargedTo: theirs ? other : null,
              }
            : { to: "row", rowId: destination },
      });
      const said =
        destination === "line"
          ? `Filed as ${payer}'s line in the period.`
          : "Attached to the joint-account row.";
      const photo = { receipt, read: stage.read, filed: [...stage.filed, part] };
      setDraft(null);
      setMatches(null);
      // A photo of two receipts goes back to the one not filed yet.
      const more = (photo.read ?? []).some((_checked, index) => !photo.filed.includes(index + 1));
      setStage(more ? { step: "kept", ...photo, said } : { step: "filed", ...photo, said });
    });
  };

  const field = (name: keyof Draft, label: string, mode: "text" | "decimal" = "decimal") => (
    <>
      <label htmlFor={`${id}-${name}`}>{label}</label>
      <input id={`${id}-${name}`} value={form[name]} inputMode={mode} onChange={set(name)} />
    </>
  );

  return (
    <section className="card" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>Receipt</h2>
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
        {field("charged", "Charged to the card (with any tip)")}
        <label htmlFor={`${id}-spending`}>Spending category</label>
        <SpendingCategoryPicker
          id={`${id}-spending`}
          categories={categories}
          value={spendingCategoryId}
          noneLabel="None"
          onChange={setSpendingCategoryId}
        />
        <label className="check">
          <input
            type="checkbox"
            checked={theirs}
            onChange={(event) => setTheirs(event.target.checked)}
          />
          {other === null ? "This was the other person's" : `This was ${other}'s`}
        </label>
        <div className="actions">
          <button type="button" disabled={busy} onClick={() => fileAs("line")}>
            File as {payer}&rsquo;s line
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
        <button type="button" disabled={busy} onClick={startOver}>
          Start over
        </button>
      </div>
      {problemLine}
    </section>
  );
}
