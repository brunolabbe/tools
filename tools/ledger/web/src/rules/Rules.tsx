/**
 * The rules screen: add, edit and retire (lg-4).
 *
 * Both people edit the same rules, and nothing is overwritten: an edit files a
 * new version and a retirement files a retirement, so the list shows only what is
 * in force and every row already classified keeps pointing at the rule it was
 * classified by. If the other person changed a rule first, the API says so and
 * the list is reloaded rather than the edit forced through.
 */

import { useCallback, useEffect, useState } from "react";
import { AppError } from "@ledger/contract";
import type { Rule, RuleDraft, SpendingCategory } from "@ledger/contract";
import { createRule, editRule, fetchPeople, fetchRules, retireRule } from "../api/rules.ts";
import { fetchSpendingCategories } from "../api/spending.ts";
import { BUCKET_LABELS, answerLabel, criteriaLabel } from "../labels.ts";
import { spendingNames } from "../spending/Picker.tsx";
import { RuleForm } from "./RuleForm.tsx";

type Load =
  | { state: "loading" }
  | { state: "failed"; message: string }
  | { state: "ready"; rules: Rule[]; people: string[]; categories: SpendingCategory[] };

/** Which form is open: a new rule, or the edit of one. */
type Open = { kind: "none" } | { kind: "new" } | { kind: "edit"; id: number };

const BLANK = {
  descriptionPattern: "",
  category: null,
  amountCents: null,
  personId: null,
  bucket: "current-expenses",
  spendingCategoryId: null,
} as const;

export function Rules(): React.ReactElement {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [open, setOpen] = useState<Open>({ kind: "none" });
  const [problem, setProblem] = useState<string | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal): Promise<void> => {
    try {
      const [rules, people, categories] = await Promise.all([
        fetchRules(signal),
        fetchPeople(signal),
        fetchSpendingCategories(signal),
      ]);
      setLoad({ state: "ready", rules, people, categories });
    } catch (error: unknown) {
      if (signal?.aborted === true) return;
      setLoad({ state: "failed", message: AppError.from(error).message });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  if (load.state === "loading") return <p className="muted">Loading the rules…</p>;
  if (load.state === "failed") {
    return (
      <p className="bad" role="alert">
        {load.message}
      </p>
    );
  }

  const { rules, people, categories } = load;
  const names = spendingNames(categories);

  /**
   * Runs a change, then shows the list as it now is — also when the change was
   * refused, which is how the other person's edit shows up. A refusal is the
   * page's to say, so the form that sent it does not say it again.
   */
  const change = async (run: () => Promise<unknown>): Promise<void> => {
    setProblem(null);
    try {
      await run();
      setOpen({ kind: "none" });
    } catch (error: unknown) {
      setProblem(AppError.from(error).message);
    }
    await refresh();
  };

  const retire = (rule: Rule): void => {
    void change(() => retireRule(rule.id));
  };

  return (
    <section className="card" aria-labelledby="rules-title">
      <h2 id="rules-title">Rules</h2>
      <p className="muted">
        A row takes a rule only when the description, and the category and amount if the rule names
        them, all match. Anything else waits in the inbox.
      </p>
      {problem !== null && (
        <p className="bad" role="alert">
          {problem}
        </p>
      )}
      {rules.length === 0 && <p className="muted">There are no rules yet.</p>}
      <ul className="rules" aria-label="Rules in force">
        {rules.map((rule) => (
          <li key={rule.id}>
            {open.kind === "edit" && open.id === rule.id ? (
              <RuleForm
                initial={rule}
                people={people}
                categories={categories}
                submitLabel="Save"
                onSubmit={(draft: RuleDraft) => change(() => editRule(rule.id, draft))}
                onCancel={() => setOpen({ kind: "none" })}
              />
            ) : (
              <>
                <p className="what">{rule.descriptionPattern}</p>
                <p className="muted">
                  {criteriaLabel(rule)} → {answerLabel(rule)}
                </p>
                {rule.spendingCategoryId !== null && (
                  <p className="muted">
                    Spending category: {names.get(rule.spendingCategoryId) ?? "unknown"}
                  </p>
                )}
                <div className="actions">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setOpen({ kind: "edit", id: rule.id })}
                    aria-label={`Edit ${rule.descriptionPattern}`}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => retire(rule)}
                    aria-label={`Retire ${rule.descriptionPattern}`}
                  >
                    Retire
                  </button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
      {open.kind === "new" ? (
        <RuleForm
          initial={BLANK}
          people={people}
          categories={categories}
          submitLabel="Add rule"
          onSubmit={(draft) => change(() => createRule(draft))}
          onCancel={() => setOpen({ kind: "none" })}
        />
      ) : (
        <button type="button" onClick={() => setOpen({ kind: "new" })}>
          Add a rule
        </button>
      )}
      <p className="muted hint">
        Buckets: {Object.values(BUCKET_LABELS).join(" and ")}. A row with no person is joint.
      </p>
    </section>
  );
}
