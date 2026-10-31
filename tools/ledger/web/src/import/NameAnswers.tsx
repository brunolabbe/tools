/**
 * The names a workbook uses that resolve to no one the household holds
 * (lg-78), each with a choice: someone the household holds, a member who has
 * left included, or **a new person**, under the file's name or another typed,
 * who is added with no email and never signs in (lg-74). The import screen
 * offers Confirm only once every name is answered (`answersOf`).
 *
 * A person is permanent in the books, so a name in a file never makes one on
 * its own: nothing is chosen for the person, and "Choose…" is where each
 * starts.
 */

import { useId } from "react";
import type { HeldName, NameAnswer, UnresolvedName } from "@ledger/contract";

/** What the person has chosen for one name so far: nothing, someone held, or a new person. */
export interface NameChoice {
  /** `""` before a choice, `held:<id>`, or `new`. */
  choice: string;
  /** The new person's name, the file's until edited. */
  shownAs: string;
}

/** What each name starts as: unanswered, a new person's name the file's. */
export function initialChoices(unresolved: readonly UnresolvedName[]): NameChoice[] {
  return unresolved.map((entry) => ({ choice: "", shownAs: entry.name }));
}

/** The answers Confirm sends, or `null` while any name is unanswered. */
export function answersOf(
  unresolved: readonly UnresolvedName[],
  choices: readonly NameChoice[],
): NameAnswer[] | null {
  const answers: NameAnswer[] = [];
  for (const [index, entry] of unresolved.entries()) {
    const chosen = choices[index];
    if (chosen === undefined || chosen.choice === "") return null;
    if (chosen.choice === "new") {
      if (chosen.shownAs.trim() === "") return null;
      answers.push({ name: entry.name, as: "new", shownAs: chosen.shownAs.trim() });
    } else {
      answers.push({ name: entry.name, as: "held", person: chosen.choice.slice("held:".length) });
    }
  }
  return answers;
}

/** The most a new person's name holds, as the directory checks it. */
const NAME_LENGTH = 64;

export function NameAnswers(props: {
  unresolved: readonly UnresolvedName[];
  held: readonly HeldName[];
  choices: readonly NameChoice[];
  onChange: (choices: NameChoice[]) => void;
  disabled: boolean;
}): React.ReactElement {
  const id = useId();
  const change = (index: number, next: Partial<NameChoice>): void => {
    props.onChange(
      props.choices.map((chosen, at) => (at === index ? { ...chosen, ...next } : chosen)),
    );
  };
  return (
    <section className="card" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>Names the household does not have</h2>
      <p>
        The workbook names {props.unresolved.length === 1 ? "someone" : "people"} this household
        does not hold. Say who each one is: someone the household holds, or a new person, who is
        added with no email and never signs in.
      </p>
      <ul className="names" aria-label="Names to answer">
        {props.unresolved.map((entry, index) => {
          const chosen = props.choices[index] ?? { choice: "", shownAs: entry.name };
          const field = `${id}-name-${String(index)}`;
          return (
            <li key={entry.name} className="offer">
              <h3>&ldquo;{entry.name}&rdquo;</h3>
              <p className="muted">
                First in {entry.where}; {String(entry.rows)} {entry.rows === 1 ? "row" : "rows"}
              </p>
              <label htmlFor={field}>Who is &ldquo;{entry.name}&rdquo;?</label>
              <select
                id={field}
                value={chosen.choice}
                disabled={props.disabled}
                onChange={(event) => change(index, { choice: event.target.value })}
              >
                <option value="">Choose…</option>
                {props.held.map((person) => (
                  <option key={person.person} value={`held:${person.person}`}>
                    {person.name}
                  </option>
                ))}
                <option value="new">A new person</option>
              </select>
              {chosen.choice === "new" && (
                <>
                  <label htmlFor={`${field}-shown`}>The new person&rsquo;s name</label>
                  <input
                    id={`${field}-shown`}
                    type="text"
                    maxLength={NAME_LENGTH}
                    value={chosen.shownAs}
                    disabled={props.disabled}
                    onChange={(event) => change(index, { shownAs: event.target.value })}
                  />
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
