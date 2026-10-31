/**
 * The characters no one can see or type back, and what to do with one.
 *
 * Refused where a name or an address is written (lg-52, lg-57, lg-82) and
 * escaped where a name already stored is printed (lg-82): a directory made
 * before the refusal may hold a row with one, and no UPDATE can clean it.
 */

/**
 * The C0 controls and DEL (lg-52), the C1 controls and the zero-width characters
 * (lg-57). An address carrying one is stored and then no Access token can name
 * it; a name carrying one prints as a terminal control sequence or as a blank.
 * The BOM is White_Space to `\s` and an address was refused it before; it is
 * listed so the set reads whole.
 */
// oxlint-disable-next-line no-control-regex -- the controls are the point
const UNSEEN = /[\u0000-\u001f\u007f-\u009f\u200b-\u200d\ufeff]/u;
// oxlint-disable-next-line no-control-regex -- the controls are the point
const EVERY_UNSEEN = /[\u0000-\u001f\u007f-\u009f\u200b-\u200d\ufeff]/gu;

/** Whether `text` holds a character of the set. */
export function hasUnseen(text: string): boolean {
  return UNSEEN.test(text);
}

/**
 * `text` with each character of the set written as its six-character escape,
 * `\u001b` for ESC, so a terminal or a log shows what is there and runs nothing.
 * Text with none of them comes back as it was. The escape is ambiguous: a name
 * typed as the six literal characters `\u001b` is accepted and prints the same as a
 * stored ESC. That is safe, since neither runs anything on a terminal.
 */
export function escapeUnseen(text: string): string {
  return text.replace(
    EVERY_UNSEEN,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}
