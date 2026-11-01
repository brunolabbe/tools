/**
 * A household's title with a Rename beside it (lg-77), on the member's screen
 * and on the admin's card. Its members and an admin can rename a household; the
 * API keeps the name it was created with and appends each rename, so the name
 * shown is the latest. The title is what each screen titles the household by
 * (the member's, its name; the admin's, its name and its people), and the field
 * opens on the name alone.
 */

import { useId, useState } from "react";
import { AppError } from "@ledger/contract";

export interface HouseholdNameProps {
  /** The heading's element: the member's screen titles its card with an h2, the admin's with an h3. */
  level: "h2" | "h3";
  /** The heading's id, for the card's `aria-labelledby`. */
  headingId: string;
  /** What the heading says. */
  title: string;
  /** The household's name now, which the field opens on. */
  name: string;
  /** Rejects with an `AppError` to put the server's own sentence in front of the person. */
  onRename: (name: string) => Promise<void>;
}

/** The most a household's name holds, as the API refuses it (`renameHouseholdRequestSchema`). */
const NAME_LENGTH = 80;

export function HouseholdName(props: HouseholdNameProps): React.ReactElement {
  const { level: Heading, headingId, title, name, onRename } = props;
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [typed, setTyped] = useState(name);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (wanted: string): Promise<void> => {
    setBusy(true);
    setProblem(null);
    try {
      await onRename(wanted);
      setEditing(false);
    } catch (error: unknown) {
      setProblem(AppError.from(error).message);
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: React.SyntheticEvent): void => {
    event.preventDefault();
    const wanted = typed.trim();
    if (wanted === "") {
      setProblem("Give the name to call the household by.");
      return;
    }
    void save(wanted);
  };

  return (
    <>
      <div className="titled">
        <Heading id={headingId}>{title}</Heading>
        {!editing && (
          <button
            type="button"
            className="small"
            aria-label={`Rename ${title}`}
            onClick={() => {
              setTyped(name);
              setProblem(null);
              setEditing(true);
            }}
          >
            Rename
          </button>
        )}
      </div>
      {editing && (
        <form className="member-form" onSubmit={submit}>
          <label htmlFor={`${id}-name`}>New name for {title}</label>
          <input
            id={`${id}-name`}
            autoComplete="off"
            maxLength={NAME_LENGTH}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
          />
          {problem !== null && (
            <p className="bad" role="alert">
              {problem}
            </p>
          )}
          <div className="actions">
            <button type="submit" className="small" disabled={busy}>
              Save
            </button>
            <button
              type="button"
              className="small"
              disabled={busy}
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </>
  );
}
