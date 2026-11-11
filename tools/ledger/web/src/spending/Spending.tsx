/**
 * The spending categories screen (lg-15): the one list, the map from Desjardins'
 * own categories to it, and the stored rows that still have none.
 *
 * Three different things are on this screen and the words keep them apart.
 * **Desjardins' category** is the bank's text on a row (`Épicerie`, `Virements`);
 * a **spending category** is the household's word from the list below
 * (groceries, pharmacy). The map says which spending category a Desjardins
 * category means, a rule can say otherwise for one merchant, and a row's own
 * choice beats both.
 *
 * Nothing is edited: a rename, a retirement, a map line and a row's choice are
 * each a record appended, and a category is retired and not deleted, so whatever
 * picked it keeps it. A row with no spending category is filed as ever and never
 * waits in the inbox for want of one.
 */

import { useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatCents } from "@ledger/books";
import { AppError } from "@ledger/contract";
import { categoriesQuery, failureOf, spendingMapQuery, uncategorisedQuery } from "../queries.ts";
import { SPENDING, invalidate, useWrite } from "../writes.ts";
import { SpendingCategoryPicker } from "./Picker.tsx";

export function Spending(): React.ReactElement {
  const id = useId();
  const client = useQueryClient();
  const [problem, setProblem] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null);
  const listed = useQuery(categoriesQuery);
  const mapped = useQuery(spendingMapQuery);
  const rows = useQuery(uncategorisedQuery);
  const addSpendingCategory = useWrite("addSpendingCategory");
  const renameSpendingCategory = useWrite("renameSpendingCategory");
  const retireSpendingCategory = useWrite("retireSpendingCategory");
  const setSpendingMapEntry = useWrite("setSpendingMapEntry");
  const setRowSpendingCategory = useWrite("setRowSpendingCategory");

  const failure = failureOf(listed, mapped, rows);
  if (failure !== null) {
    return (
      <p className="bad" role="alert">
        {failure}
      </p>
    );
  }
  if (listed.data === undefined || mapped.data === undefined || rows.data === undefined) {
    return <p className="muted">Loading the spending categories…</p>;
  }

  const [categories, map] = [listed.data, mapped.data];
  const { rows: uncategorised, total } = rows.data;

  /**
   * Runs a change, which shows what the API now says (`writes.ts`) — also when it
   * was refused, which is how the other person's retirement shows up.
   */
  const change = async (run: () => Promise<unknown>): Promise<void> => {
    setProblem(null);
    try {
      await run();
    } catch (error: unknown) {
      setProblem(AppError.from(error).message);
      await invalidate(client, SPENDING);
    }
  };

  const submitName = (event: React.SyntheticEvent): void => {
    event.preventDefault();
    if (name.trim() === "") {
      setProblem("Give the spending category a name.");
      return;
    }
    void change(async () => {
      await addSpendingCategory(name.trim());
      setName("");
    });
  };

  return (
    <>
      <section className="card" aria-labelledby={`${id}-list`}>
        <h2 id={`${id}-list`}>Spending categories</h2>
        <p className="muted">
          The words the spending is charted by. They never change who owes what, and a row with none
          is filed as ever.
        </p>
        {problem !== null && (
          <p className="bad" role="alert">
            {problem}
          </p>
        )}
        <ul className="rules" aria-label="Spending categories">
          {categories.map((category) => (
            <li key={category.id}>
              {renaming !== null && renaming.id === category.id ? (
                <form
                  className="rule-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void change(async () => {
                      await renameSpendingCategory(category.id, renaming.name.trim());
                      setRenaming(null);
                    });
                  }}
                >
                  <label htmlFor={`${id}-rename-${String(category.id)}`}>New name</label>
                  <input
                    id={`${id}-rename-${String(category.id)}`}
                    value={renaming.name}
                    onChange={(event) => setRenaming({ id: category.id, name: event.target.value })}
                  />
                  <div className="actions">
                    <button type="submit">Save</button>
                    <button type="button" onClick={() => setRenaming(null)}>
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <p className="what">
                    {category.name}
                    {category.retired && <span className="muted"> (retired)</span>}
                  </p>
                  {!category.retired && (
                    <div className="actions">
                      <button
                        type="button"
                        aria-label={`Rename ${category.name}`}
                        onClick={() => setRenaming({ id: category.id, name: category.name })}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        aria-label={`Retire ${category.name}`}
                        onClick={() => void change(() => retireSpendingCategory(category.id))}
                      >
                        Retire
                      </button>
                    </div>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
        <form className="rule-form" onSubmit={submitName} aria-label="Add a spending category">
          <label htmlFor={`${id}-name`}>New spending category</label>
          <input id={`${id}-name`} value={name} onChange={(event) => setName(event.target.value)} />
          <div className="actions">
            <button className="primary" type="submit">
              Add
            </button>
          </div>
        </form>
      </section>

      <section className="card" aria-labelledby={`${id}-map`}>
        <h2 id={`${id}-map`}>From the bank&rsquo;s categories</h2>
        <p className="muted">
          Which spending category the bank&rsquo;s own category means. A rule can say otherwise for
          one merchant, and a row&rsquo;s own choice beats both.
        </p>
        {map.length === 0 ? (
          <p className="muted hint">No row is stored yet, so there is no bank category to map.</p>
        ) : (
          <ul className="figures" aria-label="Bank categories">
            {map.map((entry) => (
              <li key={entry.desjardinsCategory}>
                <span>
                  {entry.desjardinsCategory}
                  <span className="muted"> · {String(entry.rows)} rows</span>
                </span>
                <SpendingCategoryPicker
                  ariaLabel={`Spending category for ${entry.desjardinsCategory}`}
                  categories={categories}
                  value={entry.spendingCategoryId}
                  noneLabel="None"
                  onChange={(value) =>
                    void change(() => setSpendingMapEntry(entry.desjardinsCategory, value))
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" aria-labelledby={`${id}-rows`}>
        <h2 id={`${id}-rows`}>Rows with no spending category</h2>
        {total === 0 ? (
          <p className="muted hint">Every stored row has one.</p>
        ) : (
          <>
            <p className="muted hint">
              {total === uncategorised.length
                ? `${String(total)} rows, newest first.`
                : `${String(total)} rows; the newest ${String(uncategorised.length)} are here.`}
            </p>
            <ul className="figures" aria-label="Rows with no spending category">
              {uncategorised.map((row) => (
                <li key={row.id}>
                  <span>
                    {row.date} · {row.description}
                    <span className="muted">
                      {" "}
                      · {row.category} · {formatCents(row.amountCents)}
                    </span>
                  </span>
                  <SpendingCategoryPicker
                    ariaLabel={`Spending category for ${row.date} ${row.description}`}
                    categories={categories}
                    value={null}
                    noneLabel="None"
                    onChange={(value) => void change(() => setRowSpendingCategory(row.id, value))}
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </>
  );
}
