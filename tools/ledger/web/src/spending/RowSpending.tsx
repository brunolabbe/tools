/**
 * A row's spending category, shown where the row is and editable there (lg-15).
 *
 * What it shows is the API's answer for the row, with where it came from; what it
 * writes is the row's own override, which beats the rule's and the bank category's.
 * Choosing nothing can only withdraw an override, so on a row that has none it
 * does nothing rather than pretend to clear what the map or the rule says.
 */

import type { RowSpendingCategory, SpendingCategory } from "@ledger/contract";
import { SPENDING_SOURCE_LABELS } from "../labels.ts";
import { SpendingCategoryPicker } from "./Picker.tsx";

export interface RowSpendingProps {
  /** Names the select for a screen reader: the row's description. */
  description: string;
  spending: RowSpendingCategory | null;
  categories: readonly SpendingCategory[];
  /** Writes the override: a category, or `null` to withdraw it. */
  onSet: (spendingCategoryId: number | null) => void;
  disabled?: boolean;
}

export function RowSpending(props: RowSpendingProps): React.ReactElement {
  const { spending } = props;
  const own = spending?.source === "override";
  return (
    <p className="line">
      <span>Spending category</span>
      <SpendingCategoryPicker
        ariaLabel={`Spending category for ${props.description}`}
        categories={props.categories}
        value={spending?.id ?? null}
        noneLabel={spending === null ? "None" : own ? "Withdraw my choice" : "No choice of my own"}
        disabled={props.disabled === true}
        onChange={(value) => {
          if (value === null && !own) return;
          props.onSet(value);
        }}
      />
      {spending !== null && (
        <span className="muted">{SPENDING_SOURCE_LABELS[spending.source]}</span>
      )}
    </p>
  );
}
