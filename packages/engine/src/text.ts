/**
 * Small string helpers shared by header replay and filename sanitisation.
 *
 * Control characters are handled by code point rather than by a regex literal:
 * a source file containing raw C0 bytes is easy to introduce by accident and
 * impossible to review, and an escaped character class is easy to get subtly
 * wrong. Comparing numbers is neither.
 */

const DEL = 0x7f;
const FIRST_PRINTABLE = 0x20;

export function isControlCodePoint(code: number): boolean {
  return code < FIRST_PRINTABLE || code === DEL;
}

/** Removes C0 controls and DEL. This is what makes a CRLF-joined blob safe. */
export function stripControlChars(value: string): string {
  let out = "";
  for (const char of value) {
    const code = char.codePointAt(0);
    if (code !== undefined && isControlCodePoint(code)) continue;
    out += char;
  }
  return out;
}
