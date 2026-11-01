/**
 * The person and bucket a row is answered with, and the button that sends them.
 *
 * The inbox, the rows filed automatically and the history (lg-95) all answer a
 * row the same way, so they share this one: it only reports the choice, and
 * each screen decides what sending it does.
 */

import { useState } from "react";
import { BUCKETS } from "@ledger/contract";
import type { Bucket } from "@ledger/contract";
import { BUCKET_LABELS, personLabel } from "../labels.ts";
import { shownName, usePeopleNames } from "../people.tsx";

export interface AnswerControlsProps {
  people: readonly string[];
  /** What the controls start on; `null` is nobody, the joint account. */
  initial: { personId: string | null; bucket: Bucket };
  /** The button's words: "Classify", "Change", "Save". */
  submitLabel: string;
  disabled?: boolean;
  onAnswer: (personId: string | null, bucket: Bucket) => void;
}

export function AnswerControls({
  people,
  initial,
  submitLabel,
  disabled = false,
  onAnswer,
}: AnswerControlsProps): React.ReactElement {
  const shown = usePeopleNames();
  const [person, setPerson] = useState(initial.personId ?? "");
  const [bucket, setBucket] = useState<Bucket>(initial.bucket);

  return (
    <div className="answer">
      <label>
        Belongs to
        <select value={person} onChange={(event) => setPerson(event.target.value)}>
          <option value="">{personLabel(null, shown)}</option>
          {people.map((name) => (
            <option key={name} value={name}>
              {shownName(shown, name)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Bucket
        <select value={bucket} onChange={(event) => setBucket(event.target.value as Bucket)}>
          {BUCKETS.map((value) => (
            <option key={value} value={value}>
              {BUCKET_LABELS[value]}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onAnswer(person === "" ? null : person, bucket)}
      >
        {submitLabel}
      </button>
    </div>
  );
}
