/**
 * Paste a statement, read it back, and only then store it (lg-2).
 *
 * Three steps and the user always knows which one they are in:
 *
 * 1. **Paste.** A textarea, and a button that parses it. The parse is the
 *    books' own `parseStatement`, in the browser — it is pure, so the preview
 *    is exactly what the API will parse, with no second implementation to
 *    drift. A paste that does not parse is refused here with the line named.
 * 2. **Preview.** Every parsed row, so a paste that was cut short or picked up
 *    the wrong table is seen before it is stored. Nothing has been sent yet.
 * 3. **Confirm.** The API chains the paste onto what is stored and answers with
 *    a report, or with an error that names the row or the amount. The text
 *    stays in the box on a refusal, so it can be corrected and tried again.
 *
 * After a store the screen says how many of the rows it just added wait in the
 * inbox (lg-54), in the words that matter: such a row counts in neither bucket
 * until it is answered, and nothing is filed to Joint by default. The count is
 * the report's own, so it describes this paste and not the whole inbox. Above
 * it, the screen names each row already stored that the bank dates otherwise
 * than the workbook did, with both dates, and says the workbook's was kept
 * (lg-58).
 *
 * Built for a phone: one column, a text size that does not make iOS zoom the
 * page, and buttons a thumb can hit.
 */

import { useState } from "react";
import { formatCents, parseStatement } from "@ledger/books";
import type { StatementRow } from "@ledger/books";
import { AppError } from "@ledger/contract";
import type { ImportStatementReport } from "@ledger/contract";
import { importStatement } from "../api/statements.ts";

type Step =
  | { kind: "editing" }
  | { kind: "previewing"; rows: StatementRow[] }
  | { kind: "storing"; rows: StatementRow[] }
  | { kind: "stored"; report: ImportStatementReport };

export interface StatementPasteProps {
  /** Called once a paste is stored, so the shell can ask for the inbox's count again. */
  onStored: () => void;
  /** Takes the person to the inbox tab. */
  onOpenInbox: () => void;
}

export function StatementPaste({ onStored, onOpenInbox }: StatementPasteProps): React.ReactElement {
  const [text, setText] = useState("");
  const [step, setStep] = useState<Step>({ kind: "editing" });
  const [problem, setProblem] = useState<string | null>(null);

  const preview = (): void => {
    try {
      const { rows } = parseStatement(text);
      if (rows.length === 0) {
        setProblem("There are no statement rows in what was pasted.");
        setStep({ kind: "editing" });
        return;
      }
      setProblem(null);
      setStep({ kind: "previewing", rows });
    } catch (error: unknown) {
      setProblem(AppError.from(error).message);
      setStep({ kind: "editing" });
    }
  };

  const confirm = (rows: StatementRow[]): void => {
    setProblem(null);
    setStep({ kind: "storing", rows });
    importStatement(text)
      .then((report) => setStep({ kind: "stored", report }))
      // After the store answered, so the shell asks for a count that includes it.
      .then(onStored)
      .catch((error: unknown) => {
        // The API's own sentence: it names the row, or the unexplained amount.
        setProblem(AppError.from(error).message);
        setStep({ kind: "previewing", rows });
      });
  };

  const startOver = (): void => {
    setText("");
    setProblem(null);
    setStep({ kind: "editing" });
  };

  if (step.kind === "stored") {
    const { report } = step;
    return (
      <section className="card" aria-labelledby="paste-title">
        <h2 id="paste-title">Statement stored</h2>
        <output>
          {report.rowsAdded} {report.rowsAdded === 1 ? "row" : "rows"} added,{" "}
          {report.rowsAlreadyPresent} already stored. The account now stands at{" "}
          <strong>{formatCents(report.tailBalanceCents)}</strong>.
        </output>
        <DatesDiffering report={report} />
        <Filing report={report} onOpenInbox={onOpenInbox} />
        <button type="button" onClick={startOver}>
          Paste another
        </button>
      </section>
    );
  }

  const rows = step.kind === "editing" ? null : step.rows;
  const storing = step.kind === "storing";

  return (
    <section className="card" aria-labelledby="paste-title">
      <h2 id="paste-title">Paste a statement</h2>
      <label htmlFor="statement-text">Transactions copied from AccèsD</label>
      <textarea
        id="statement-text"
        value={text}
        rows={rows === null ? 8 : 4}
        spellCheck={false}
        disabled={storing}
        onChange={(event) => {
          setText(event.target.value);
          // An edit makes the preview, and any refusal, about something else.
          setProblem(null);
          setStep({ kind: "editing" });
        }}
      />
      {problem !== null && (
        <p className="bad" role="alert">
          {problem}
        </p>
      )}
      {rows === null && (
        <button className="primary" type="button" onClick={preview} disabled={text.trim() === ""}>
          Preview
        </button>
      )}
      {rows !== null && (
        <>
          <p>
            <strong>{rows.length}</strong> {rows.length === 1 ? "row" : "rows"} read, newest first.
            Nothing is stored until you confirm.
          </p>
          <ol className="rows" aria-label="Parsed rows">
            {rows.toReversed().map((row) => (
              <li key={row.seq}>
                <span className="when">{row.date}</span>
                <span className="what">{row.description}</span>
                <span className={row.amountCents < 0 ? "amount out" : "amount in"}>
                  {formatCents(row.amountCents)}
                </span>
                <span className="balance muted">{formatCents(row.balanceCents)}</span>
              </li>
            ))}
          </ol>
          <button
            className="primary"
            type="button"
            onClick={() => confirm(rows)}
            disabled={storing}
          >
            {storing ? "Storing…" : "Confirm and store"}
          </button>
        </>
      )}
    </section>
  );
}

/**
 * The rows already stored that the bank dates otherwise than the workbook did
 * (lg-58): each by its amount and both dates, since the bank's is how the row is
 * found on the statement and the workbook's is the one the books kept. Nothing
 * is said when the two agree.
 */
function DatesDiffering({ report }: { report: ImportStatementReport }): React.ReactElement | null {
  const differing = report.datesDiffering ?? [];
  if (differing.length === 0) return null;
  return (
    <>
      <p>
        {differing.length === 1 ? (
          "One row already stored is"
        ) : (
          <>
            <strong>{differing.length}</strong> rows already stored are
          </>
        )}{" "}
        dated differently by the bank and by the workbook. The workbook&apos;s date was kept.
      </p>
      <ul aria-label="Dates that differ">
        {differing.map((entry, index) => (
          <li key={`${String(index)}:${entry.bankDate}:${entry.workbookDate}`}>
            {formatCents(entry.amountCents)}: the bank says {entry.bankDate}, the workbook{" "}
            {entry.workbookDate}
          </li>
        ))}
      </ul>
    </>
  );
}

/** What became of the rows just added: nothing said when none was added. */
function Filing({
  report,
  onOpenInbox,
}: {
  report: ImportStatementReport;
  onOpenInbox: () => void;
}): React.ReactElement | null {
  if (report.rowsAdded === 0) return null;
  if (report.rowsInInbox === 0) {
    return <p>Every row added was filed, by a rule or by what you answered before.</p>;
  }
  return (
    <>
      <p>
        {report.rowsInInbox === report.rowsAdded ? (
          report.rowsAdded === 1 ? (
            "The row added waits"
          ) : (
            <>
              All <strong>{report.rowsInInbox}</strong> rows added wait
            </>
          )
        ) : (
          <>
            <strong>{report.rowsInInbox}</strong> of the {report.rowsAdded} rows added{" "}
            {report.rowsInInbox === 1 ? "waits" : "wait"}
          </>
        )}{" "}
        in the inbox. A row in the inbox counts in neither bucket until you answer it with a person
        and a bucket, and nothing is filed to Joint by default.
      </p>
      <button type="button" onClick={onOpenInbox}>
        Open the inbox
      </button>
    </>
  );
}
