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

export function StatementPaste(): React.ReactElement {
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
        <button type="button" onClick={preview} disabled={text.trim() === ""}>
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
          <button type="button" onClick={() => confirm(rows)} disabled={storing}>
            {storing ? "Storing…" : "Confirm and store"}
          </button>
        </>
      )}
    </section>
  );
}
