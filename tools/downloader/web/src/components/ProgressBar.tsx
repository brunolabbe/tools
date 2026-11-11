interface ProgressBarProps {
  /** `null` means the total is genuinely unknown — render indeterminate, never a guess. */
  percent: number | null;
  label: string;
  /** Extra context announced with the value, e.g. "12.4 MB/s". */
  valueText?: string;
  /**
   * Nothing has been sent yet (dl-133): a box waiting in this browser for a
   * slot. Still indeterminate, but announced as not started rather than as work
   * in progress, which would be a claim about a request that does not exist.
   */
  waiting?: boolean;
}

/**
 * A native `<progress>`: omitting `value` is exactly the indeterminate state,
 * with the platform's own animation and assistive-technology semantics, which
 * beats re-implementing `role="progressbar"` by hand.
 */
export function ProgressBar({
  percent,
  label,
  valueText,
  waiting = false,
}: ProgressBarProps): React.JSX.Element {
  const indeterminate = percent === null;
  const clamped = indeterminate ? 0 : Math.min(100, Math.max(0, percent));
  let description = indeterminate
    ? `${label}: in progress, total unknown`
    : `${label}: ${Math.round(clamped)} percent${valueText ? `, ${valueText}` : ""}`;
  if (indeterminate && waiting) description = `${label}: not started yet`;

  return (
    <progress
      className={`progress${indeterminate ? " progress--indeterminate" : ""}`}
      max={100}
      aria-label={description}
      {...(indeterminate ? {} : { value: clamped })}
    />
  );
}
