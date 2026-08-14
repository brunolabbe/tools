interface ProgressBarProps {
  /** `null` means the total is genuinely unknown — render indeterminate, never a guess. */
  percent: number | null;
  label: string;
  /** Extra context announced with the value, e.g. "12.4 MB/s". */
  valueText?: string;
}

/**
 * A native `<progress>`: omitting `value` is exactly the indeterminate state,
 * with the platform's own animation and assistive-technology semantics, which
 * beats re-implementing `role="progressbar"` by hand.
 */
export function ProgressBar({ percent, label, valueText }: ProgressBarProps): React.JSX.Element {
  const indeterminate = percent === null;
  const clamped = indeterminate ? 0 : Math.min(100, Math.max(0, percent));
  const description = indeterminate
    ? `${label}: in progress, total unknown`
    : `${label}: ${Math.round(clamped)} percent${valueText ? `, ${valueText}` : ""}`;

  return (
    <progress
      className={`progress${indeterminate ? " progress--indeterminate" : ""}`}
      max={100}
      aria-label={description}
      {...(indeterminate ? {} : { value: clamped })}
    />
  );
}
