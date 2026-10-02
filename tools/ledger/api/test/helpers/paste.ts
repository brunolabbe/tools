/**
 * A synthetic AccèsD paste, rendered from rows, so a test can say "this stretch
 * of the account" instead of carrying a wall of text.
 *
 * The shape is the one `00-ANALYSIS.md` §2 describes — newest first, a month
 * header, six lines a row, a `Total` per month — with invented descriptions and
 * amounts. Nothing here is a real row.
 */

export interface PasteRow {
  /** `yyyy-mm-dd`. */
  date: string;
  category?: string;
  description: string;
  amountCents: number;
}

const NAMES = [
  ["JAN", "Janvier"],
  ["FEV", "Février"],
  ["MAR", "Mars"],
  ["AVR", "Avril"],
  ["MAI", "Mai"],
  ["JUN", "Juin"],
  ["JUL", "Juillet"],
  ["AOU", "Août"],
  ["SEP", "Septembre"],
  ["OCT", "Octobre"],
  ["NOV", "Novembre"],
  ["DEC", "Décembre"],
] as const;

/** `1 100,00 $` with U+2212 for a minus and an explicit `+`, as the bank writes it. */
function money(cents: number, signed: boolean): string {
  const abs = Math.abs(cents);
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/gu, " ");
  const text = `${whole},${String(abs % 100).padStart(2, "0")} $`;
  if (cents < 0) return `−${text}`;
  return signed && cents > 0 ? `+${text}` : text;
}

/** A row with its balance, which is what the account carries after it. */
export interface BalancedRow extends PasteRow {
  balanceCents: number;
}

/** Gives each row, oldest first, the balance that follows from `opening`. */
export function withBalances(rows: readonly PasteRow[], opening: number): BalancedRow[] {
  let balance = opening;
  return rows.map((row) => {
    balance += row.amountCents;
    return { ...row, balanceCents: balance };
  });
}

/**
 * Renders rows given oldest first as a paste, newest first. A row list that
 * spans months is cut into one section per month, each ending in its own total.
 */
export function renderPaste(rows: readonly BalancedRow[]): string {
  const newestFirst = rows.toReversed();
  const lines: string[] = [];
  let month = "";
  let sum = 0;
  const closeMonth = (): void => {
    if (month !== "") lines.push(`Total\t${money(sum, false)}`);
  };
  for (const row of newestFirst) {
    const [year, monthNumber, dayText] = row.date.split("-");
    const [abbreviation, name] = NAMES[Number(monthNumber) - 1] ?? NAMES[0];
    const header = `${name} ${year}`;
    if (header !== month) {
      closeMonth();
      month = header;
      sum = 0;
      lines.push(header, "Date\tDescription\tMontant\tSolde\tlien");
    }
    const day = String(Number(dayText));
    lines.push(
      `${day} ${abbreviation}${day} ${name}`,
      row.category ?? "Virements",
      row.description,
      "",
      `${money(row.amountCents, true)}\t${money(row.balanceCents, false)}\t`,
      `${day} ${name} ${row.description} ${money(row.amountCents, true)}`,
    );
    sum += row.amountCents;
  }
  closeMonth();
  return `${lines.join("\n")}\n`;
}
