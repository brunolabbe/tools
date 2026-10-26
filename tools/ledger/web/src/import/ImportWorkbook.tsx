/**
 * Importing a workbook the reader does not know (lg-66): choose the file, send
 * its samples to a model that describes its layout, read what that description
 * makes of the file, and confirm.
 *
 * **The samples leave the house only on the button**, and the screen says what
 * goes before it is pressed: choosing a file reads it into this page and sends
 * nothing. The file is judged an `.xlsx` by the server, from its bytes, never by
 * its name, so nothing here filters by extension.
 *
 * **What the person checks** before any Confirm control: the date column the
 * description chose, with its header and the oldest and newest rows read, and
 * each bucket label with the bucket it was mapped to, its row count and three
 * of its rows. These are the guards the owner chose (lg-66's Why); the dry
 * run's report is shown below them. When a verification fails there is no
 * Confirm, only the problems and Cancel. Cancel writes nothing.
 */

import { useId, useState } from "react";
import { formatCents } from "@ledger/books";
import { AppError, LAYOUT_SAMPLE_ROWS, MAX_WORKBOOK_BYTES } from "@ledger/contract";
import type { DescribeWorkbookResponse, WorkbookSampleRow } from "@ledger/contract";
import { base64Of, confirmWorkbook, describeWorkbook } from "../api/workbook.ts";
import { BUCKET_LABELS } from "../labels.ts";

type Stage =
  | { step: "choose" }
  | { step: "chosen"; file: string }
  | { step: "read"; file: string; described: DescribeWorkbookResponse }
  | { step: "imported"; report: string };

/** Rows as the confirmation lists them: date and amount, then the detail. */
function SampleRows(props: { rows: readonly WorkbookSampleRow[]; label: string }) {
  return (
    <ol className="rows" aria-label={props.label}>
      {props.rows.map((row) => (
        <li key={`${row.sheet}:${String(row.row)}`}>
          <span className="when">{row.date}</span>
          <span className="what">{row.detail === "" ? "(no detail)" : row.detail}</span>
          <span className={row.amountCents < 0 ? "amount out" : "amount in"}>
            {formatCents(row.amountCents)}
          </span>
          <span className="balance muted">
            {row.sheet}, row {String(row.row)}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function ImportWorkbook(): React.ReactElement {
  const id = useId();
  const [stage, setStage] = useState<Stage>({ step: "choose" });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const run = (work: () => Promise<void>): void => {
    setBusy(true);
    setProblem(null);
    work()
      .catch((error: unknown) => setProblem(AppError.from(error).message))
      .finally(() => setBusy(false));
  };

  const choose = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const chosen = event.target.files?.[0];
    event.target.value = "";
    if (chosen === undefined) return;
    if (chosen.size > MAX_WORKBOOK_BYTES) {
      setProblem(`That file is over ${String(MAX_WORKBOOK_BYTES / 1024 / 1024)} MB.`);
      return;
    }
    // Read into the page only: nothing is sent until the button.
    void run(async () => {
      const bytes = new Uint8Array(await chosen.arrayBuffer());
      setStage({ step: "chosen", file: base64Of(bytes) });
    });
  };

  const cancel = (): void => {
    setProblem(null);
    setStage({ step: "choose" });
  };

  const problemLine =
    problem === null ? null : (
      <p className="bad" role="alert">
        {problem}
      </p>
    );

  if (stage.step === "choose" || stage.step === "imported") {
    return (
      <section className="card" aria-labelledby={`${id}-title`}>
        <h2 id={`${id}-title`}>Import a workbook</h2>
        {stage.step === "imported" && (
          <>
            <output>The workbook was imported.</output>
            <details>
              <summary>The import&rsquo;s report</summary>
              <pre className="report">{stage.report}</pre>
            </details>
          </>
        )}
        <label className="camera">
          {busy ? "Reading the file…" : "Choose an .xlsx workbook"}
          <input type="file" disabled={busy} onChange={choose} />
        </label>
        <p className="muted hint">
          Choosing a file sends nothing. Only an Excel workbook (.xlsx) is read.
        </p>
        {problemLine}
      </section>
    );
  }

  if (stage.step === "chosen") {
    const describe = (): void => {
      void run(async () => {
        const described = await describeWorkbook(stage.file);
        setStage({ step: "read", file: stage.file, described });
      });
    };
    return (
      <section className="card" aria-labelledby={`${id}-title`}>
        <h2 id={`${id}-title`}>Import a workbook</h2>
        <p>File chosen. Nothing has been sent.</p>
        <div className="offer" role="note" aria-label="What is sent">
          <p className="hint">
            Pressing the button sends to Anthropic, where a model describes how the file is laid
            out: <strong>the names of its sheets</strong> and, from each sheet,{" "}
            <strong>
              its first {String(LAYOUT_SAMPLE_ROWS.first)} rows, {String(LAYOUT_SAMPLE_ROWS.middle)}{" "}
              rows from the middle and its last {String(LAYOUT_SAMPLE_ROWS.last)}
            </strong>
            , with their figures and any formula text. Nothing else leaves the house. The model
            proposes where things are, never the rows: you check what it found before anything is
            imported.
          </p>
          <div className="actions">
            <button type="button" disabled={busy} onClick={describe}>
              {busy ? "Describing…" : "Send the samples and describe"}
            </button>
            <button type="button" disabled={busy} onClick={cancel}>
              Cancel
            </button>
          </div>
        </div>
        {problemLine}
      </section>
    );
  }

  const { described, file } = stage;
  const { dateColumn, buckets } = described.confirmation;
  const confirm = (): void => {
    void run(async () => {
      const done = await confirmWorkbook(file, described.layout);
      setStage({ step: "imported", report: done.report });
    });
  };
  return (
    <>
      <section className="card" aria-labelledby={`${id}-date`}>
        <h2 id={`${id}-date`}>The date of each row</h2>
        <p>
          Read from column <strong>{dateColumn.column}</strong>
          {dateColumn.header === null ? (
            ", which has no header."
          ) : (
            <>
              , headed <strong>&ldquo;{dateColumn.header}&rdquo;</strong>.
            </>
          )}{" "}
          Check that these are the dates the money moved.
        </p>
        <h3>The oldest rows read</h3>
        <SampleRows rows={dateColumn.oldest} label="The oldest rows read" />
        <h3>The newest rows read</h3>
        <SampleRows rows={dateColumn.newest} label="The newest rows read" />
      </section>
      {buckets.length > 0 && (
        <section className="card" aria-labelledby={`${id}-buckets`}>
          <h2 id={`${id}-buckets`}>Which bucket each label files in</h2>
          {buckets.map((entry) => (
            <div key={entry.label} className="offer">
              <h3>
                &ldquo;{entry.label}&rdquo; → {BUCKET_LABELS[entry.bucket]}
              </h3>
              <p className="muted">
                {String(entry.rows)} {entry.rows === 1 ? "row" : "rows"}
              </p>
              <SampleRows rows={entry.examples} label={`Rows labelled ${entry.label}`} />
            </div>
          ))}
        </section>
      )}
      <section className="card" aria-labelledby={`${id}-checks`}>
        <h2 id={`${id}-checks`}>The checks</h2>
        {described.ok ? (
          <p>Every verification held on a dry run. Nothing has been written yet.</p>
        ) : (
          <>
            <p className="bad">Read this way, the workbook does not pass every check:</p>
            <ul aria-label="What failed">
              {described.problems.map((line) => (
                <li key={line} className="bad">
                  {line}
                </li>
              ))}
            </ul>
          </>
        )}
        <details>
          <summary>The dry run&rsquo;s report</summary>
          <pre className="report">{described.report}</pre>
        </details>
        <div className="actions">
          {described.ok && (
            <button type="button" disabled={busy} onClick={confirm}>
              {busy ? "Importing…" : "Confirm and import"}
            </button>
          )}
          <button type="button" disabled={busy} onClick={cancel}>
            Cancel
          </button>
        </div>
        {problemLine}
      </section>
    </>
  );
}
