/**
 * The population of characters lg-82 refuses in a name and escapes where one is
 * printed. Built with `String.fromCharCode`, never typed: an escape typed into a
 * file can land as the character itself (lg-57).
 */

import Database from "better-sqlite3";
import { Directory } from "../../src/directory.ts";

/** The 32 C0 controls, DEL, the 32 C1 controls, U+200B to U+200D, and U+FEFF. */
export const UNSEEN_CHARACTERS: readonly string[] = [
  ...Array.from({ length: 0x20 }, (_, code) => code),
  0x7f,
  ...Array.from({ length: 0x20 }, (_, code) => 0x80 + code),
  0x200b,
  0x200c,
  0x200d,
  0xfeff,
].map((code) => String.fromCharCode(code));

/** The six-character text that stands for `character`, `\u001b` for ESC. */
export function escaped(character: string): string {
  return `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`;
}

/** The character between two letters: a U+FEFF at an end is trimmed, so it sits inside. */
export function around(character: string, open = "a", close = "b"): string {
  return `${open}${character}${close}`;
}

/** What `around(character, open, close)` prints as once its character is escaped. */
export function aroundEscaped(character: string, open = "a", close = "b"): string {
  return `${open}${escaped(character)}${close}`;
}

/**
 * A directory file holding household `home` with one member per character of the
 * population, `p<n>`, whose shown name is `s<character>s`: written past `Directory`,
 * as a directory made before lg-82 holds a name it would now refuse.
 */
export function writeUnseenMembers(file: string, at: Date): void {
  const directory = Directory.open(file);
  const change = { by: "operator", at };
  directory.addHousehold({ id: "home", name: "Home", ...change });
  UNSEEN_CHARACTERS.forEach((_, index) => {
    directory.addMember({
      household: "home",
      address: `m${String(index)}@example.test`,
      person: `p${String(index)}`,
      ...change,
    });
  });
  directory.close();
  const db = new Database(file);
  const named = db.prepare(
    `INSERT INTO person_names (household_id, person, name, named_at, named_by)
     VALUES ('home', ?, ?, 'x', 'operator')`,
  );
  UNSEEN_CHARACTERS.forEach((character, index) => {
    named.run(`p${String(index)}`, around(character, "s", "s"));
  });
  db.close();
}
