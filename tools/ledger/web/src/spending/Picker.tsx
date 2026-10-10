/**
 * A select over the spending categories (lg-15), shared by every screen that
 * picks one: the map, a rule, a row, a period line.
 *
 * A person can pick only what is not retired, but what is already picked stays
 * in the list under its name, marked retired, so a form editing a rule that
 * names one does not show it as nothing.
 */

import type { SpendingCategory } from "@ledger/contract";

export interface PickerProps {
  id?: string;
  /** Read by a screen reader when the visible label is somewhere else. */
  ariaLabel?: string;
  categories: readonly SpendingCategory[];
  value: number | null;
  /** What `null` is called here: "None", "Not set", "Use the map's". */
  noneLabel: string;
  onChange: (value: number | null) => void;
  disabled?: boolean;
}

export function SpendingCategoryPicker(props: PickerProps): React.ReactElement {
  const { categories, value } = props;
  const shown = categories.filter((category) => !category.retired || category.id === value);
  return (
    <select
      {...(props.id === undefined ? {} : { id: props.id })}
      {...(props.ariaLabel === undefined ? {} : { "aria-label": props.ariaLabel })}
      value={value === null ? "" : String(value)}
      disabled={props.disabled === true}
      onChange={(event) =>
        props.onChange(event.target.value === "" ? null : Number(event.target.value))
      }
    >
      <option value="">{props.noneLabel}</option>
      {shown.map((category) => (
        <option key={category.id} value={String(category.id)}>
          {category.retired ? `${category.name} (retired)` : category.name}
        </option>
      ))}
    </select>
  );
}

/** A category's name by id, for a line of text; an id nobody holds reads as nothing. */
export function spendingNames(
  categories: readonly SpendingCategory[],
): ReadonlyMap<number, string> {
  return new Map(categories.map((category) => [category.id, category.name]));
}
