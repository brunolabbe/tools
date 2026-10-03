/**
 * Money as it appears in an AccèsD paste, and as it is shown back.
 *
 * Cents are integers everywhere in the books. A float cannot hold 0,10 $ and
 * the running-balance proof is an exact equality, so one rounding error would
 * read as a missing row.
 */

/**
 * `−700,00 $`, `+400,00 $`, `2 100,00 $`.
 *
 * The sign is U+2212 in the real paste, a hyphen when someone retypes it, and
 * absent on a plain positive. The thousands separator is "a space" to the eye
 * and U+00A0 or U+202F on the clipboard, all of which `\s` matches — the paste
 * is never trusted to pick one. The decimal separator is a comma and the cents
 * are always two digits, so `1,5` is refused rather than read as a guess.
 */
const AMOUNT = /^([+\-−])?\s*(\d{1,3}(?:\s\d{3})+|\d+),(\d{2})\s*\$$/u;

/** The amount in cents, or `null` when the text is not an amount. */
export function parseAmountCents(text: string): number | null {
  const match = AMOUNT.exec(text.trim());
  if (!match) return null;
  const [, sign, whole, fraction] = match;
  const magnitude = Number((whole ?? "").replace(/\s/gu, "")) * 100 + Number(fraction);
  if (!Number.isSafeInteger(magnitude)) return null;
  // `0 - x` rather than `-x`: a negated zero is `-0`, which `toEqual` and
  // `Object.is` both tell apart from `0`.
  return sign === "-" || sign === "−" ? 0 - magnitude : magnitude;
}

/** `-700.00` — for an error message, where the reader is a person. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")} $`;
}

/**
 * An amount as a person types it into a form: `400`, `400.50`, `-1 100,00`, with
 * or without the `$`. The bank's format stays strict because a paste must never
 * be guessed at; a form field is the person's own, so a decimal point is read as
 * the comma it means and a missing `$` is supplied. A bare `400` is four hundred
 * dollars, never four hundred cents. Anything else is `null`.
 */
export function parseTypedAmountCents(text: string): number | null {
  let typed = text.trim();
  if (typed.endsWith("$")) typed = typed.slice(0, -1).trimEnd();
  if (/^[+\-−]?\s*\d+$/u.test(typed)) typed = `${typed},00`;
  else typed = typed.replace(/^([+\-−]?\s*\d+)\.(\d{2})$/u, "$1,$2");
  return parseAmountCents(`${typed} $`);
}
