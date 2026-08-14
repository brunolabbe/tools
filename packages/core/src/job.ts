/**
 * Job state-machine rules.
 *
 * The *states* belong to each tool — the downloader passes through `muxing`,
 * which nothing else will — but the rules about a transition table are the
 * same everywhere, and so is the mistake worth preventing: a hand-maintained
 * list of terminal states that drifts out of step with the table it describes.
 * `terminalStatuses()` derives it instead.
 */

/** For each state, the states it may legally move to. Terminal states map to `[]`. */
export type TransitionTable<Status extends string> = Readonly<Record<Status, readonly Status[]>>;

export function isLegalTransition<Status extends string>(
  table: TransitionTable<Status>,
  from: Status,
  to: Status,
): boolean {
  return table[from].includes(to);
}

/**
 * Statuses with no outgoing transition. Derived from the table rather than
 * listed separately, so the two cannot disagree.
 */
export function terminalStatuses<Status extends string>(
  table: TransitionTable<Status>,
): ReadonlySet<Status> {
  const keys = Object.keys(table) as Status[];
  return new Set(keys.filter((status) => table[status].length === 0));
}
