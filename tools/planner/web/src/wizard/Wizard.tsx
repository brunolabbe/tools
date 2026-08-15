/**
 * One question per screen, and the fork at the end of the essentials.
 *
 * The tree branches, so a single long form would have to show and hide sections
 * as answers change — the same invalidation problem, rendered badly. One
 * question at a time makes the branch invisible, which is the point of a guided
 * intake.
 *
 * Three rules hold this component together, and each is a rule from the tool's
 * `CLAUDE.md` rendered:
 *
 * - **Nothing is decided here.** Which questions are open, what to ask next,
 *   whether the essentials are done and what an edit discards all arrive in the
 *   response. This file renders them.
 * - **No answer is discarded silently.** Every write that could strand something
 *   is previewed first, against the same `prune` the write runs, and the user
 *   confirms a list of prompts before anything is lost.
 * - **Progress is honest.** The reachable set moves as branches open and close,
 *   so "question 4 of 18" is a number the tool cannot stand behind. What is
 *   answered, and that more remain, is what it can say — and "the essentials are
 *   done" is a truthful milestone where a percentage is not.
 */

import { useCallback, useEffect, useState } from "react";
import {
  AppError,
  type Answer,
  type AnswerValue,
  type DiscardedAnswer,
  type IntakeState,
  type QuestionId,
  type QuestionNode,
} from "@planner/contract";
import { fetchIntake, previewAnswer, submitAnswer } from "../api/intake.ts";
import { Brief } from "./Brief.tsx";
import { QuestionField } from "./controls.tsx";
import { describeAnswer } from "./format.ts";

interface WizardProps {
  intakeId: string;
  /** Leaving with a complete intake behind, which is what this phase can offer. */
  onExit: () => void;
}

/** An answer waiting on the user's confirmation, and what it would cost. */
interface PendingWrite {
  question: QuestionNode;
  answer: Answer;
  discarded: readonly DiscardedAnswer[];
}

export function Wizard({ intakeId, onExit }: WizardProps): React.ReactElement {
  const [state, setState] = useState<IntakeState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<QuestionId | null>(null);
  const [draft, setDraft] = useState<AnswerValue | null>(null);
  const [pending, setPending] = useState<PendingWrite | null>(null);
  /** Set by the user at the checkpoint. Never stored: it is a choice, not a state. */
  const [refining, setRefining] = useState(false);
  const [discarded, setDiscarded] = useState<readonly DiscardedAnswer[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    const load = async (): Promise<void> => {
      try {
        const loaded = await fetchIntake(intakeId, controller.signal);
        setState(loaded);
        // A load can discard answers too: the tree may have moved in a release
        // while this intake sat here.
        setDiscarded(loaded.discarded);
      } catch (cause: unknown) {
        // A cancelled request is the effect being cleaned up, not a failure to
        // report — under StrictMode it happens on every mount in development.
        if (controller.signal.aborted) return;
        setError(AppError.from(cause).message);
      }
    };
    void load();
    return () => controller.abort();
  }, [intakeId]);

  const accept = useCallback((next: IntakeState): void => {
    setState(next);
    setDiscarded(next.discarded);
    setDraft(null);
    setEditing(null);
    setPending(null);
  }, []);

  const run = useCallback(async (work: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (cause: unknown) {
      setError(AppError.from(cause).message);
    } finally {
      setBusy(false);
    }
  }, []);

  if (error !== null && state === null) return <p className="bad">{error}</p>;
  if (state === null) return <p>Loading the trip…</p>;

  const current: QuestionNode | null =
    editing === null
      ? state.progress.question
      : (state.questions.find((node) => node.id === editing) ?? null);

  const answered = state.questions.filter((node) => state.answers[node.id] !== undefined);
  const atCheckpoint = state.progress.coreComplete && !refining && editing === null;

  const save = (question: QuestionNode, answer: Answer): void => {
    void run(async () => {
      // Nothing can be stranded by the first answer, so the round trip is worth
      // skipping — after that, every write is previewed, because a change one
      // question deep can close a branch eight answers long.
      if (Object.keys(state.answers).length > 0) {
        const cost = await previewAnswer(intakeId, question.id, answer);
        if (cost.length > 0) {
          setPending({ question, answer, discarded: cost });
          return;
        }
      }
      accept(await submitAnswer(intakeId, question.id, answer));
    });
  };

  const confirm = (write: PendingWrite): void => {
    void run(async () => {
      accept(await submitAnswer(intakeId, write.question.id, write.answer));
    });
  };

  return (
    <div className="wizard">
      <div className="main">
        <ProgressLine answered={answered.length} coreComplete={state.progress.coreComplete} />
        {discarded.length > 0 && <DiscardNotice discarded={discarded} />}
        {error !== null && <p className="bad">{error}</p>}

        {pending !== null ? (
          <ConfirmDiscard
            write={pending}
            busy={busy}
            onCancel={() => setPending(null)}
            onConfirm={() => confirm(pending)}
          />
        ) : atCheckpoint ? (
          <Checkpoint
            hasMore={state.progress.question !== null}
            onRefine={() => setRefining(true)}
            onExit={onExit}
          />
        ) : current === null ? (
          <section className="panel">
            <h2>Every question is answered.</h2>
            <p className="muted">There is nothing left to ask about this trip.</p>
            <button type="button" className="primary" onClick={onExit}>
              Done for now
            </button>
          </section>
        ) : (
          <QuestionCard
            key={current.id}
            question={current}
            existing={state.answers[current.id] ?? null}
            editing={editing !== null}
            busy={busy}
            draft={draft}
            onDraft={setDraft}
            onSave={(answer) => save(current, answer)}
            onCancel={() => {
              setEditing(null);
              setDraft(null);
            }}
          />
        )}
      </div>

      <aside className="aside">
        <Brief brief={state.brief} />
        <AnsweredList
          questions={answered}
          state={state}
          onEdit={(id) => {
            setEditing(id);
            setDraft(null);
            setPending(null);
          }}
        />
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Progress, honestly
// ---------------------------------------------------------------------------

function ProgressLine({
  answered,
  coreComplete,
}: {
  answered: number;
  coreComplete: boolean;
}): React.ReactElement {
  return (
    <p className="progress" aria-live="polite">
      {answered === 0
        ? "Nothing answered yet."
        : `${String(answered)} answered${coreComplete ? " — the essentials are done" : ", and more to come"}.`}
    </p>
  );
}

// ---------------------------------------------------------------------------
// The question
// ---------------------------------------------------------------------------

interface QuestionCardProps {
  question: QuestionNode;
  existing: Answer | null;
  editing: boolean;
  busy: boolean;
  draft: AnswerValue | null;
  onDraft: (value: AnswerValue | null) => void;
  onSave: (answer: Answer) => void;
  onCancel: () => void;
}

function QuestionCard({
  question,
  existing,
  editing,
  busy,
  draft,
  onDraft,
  onSave,
  onCancel,
}: QuestionCardProps): React.ReactElement {
  const initial = existing !== null && existing.state === "answered" ? existing.value : null;

  return (
    <section className="panel question">
      <h2>{question.prompt}</h2>
      {question.help !== null && <p className="help">{question.help}</p>}

      <QuestionField question={question} initial={initial} onChange={onDraft} />

      <div className="actions">
        <button
          type="button"
          className="primary"
          disabled={busy || draft === null}
          onClick={() => draft !== null && onSave({ state: "answered", value: draft })}
        >
          {editing ? "Save the change" : "Next"}
        </button>

        {/* Never on a `core` question: the engine refuses to decline one, and
            offering a button that cannot work is worse than not offering it. */}
        {question.stage === "refine" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onSave({ state: "declined" })}
            title="We will not ask again."
          >
            Not important
          </button>
        )}

        {editing && (
          <button type="button" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The checkpoint — a screen, not a banner
// ---------------------------------------------------------------------------

function Checkpoint({
  hasMore,
  onRefine,
  onExit,
}: {
  hasMore: boolean;
  onRefine: () => void;
  onExit: () => void;
}): React.ReactElement {
  return (
    <section className="panel checkpoint">
      <h2>The essentials are done.</h2>
      <p>
        There is enough here to plan from. Everything after this sharpens the plan rather than
        making one possible{hasMore ? "" : " — and there is nothing left to sharpen"}.
      </p>
      <div className="actions">
        {hasMore && (
          <button type="button" className="primary" onClick={onRefine}>
            Keep refining
          </button>
        )}
        {/*
          Phase 2 owns the other half of this fork — the button that drafts a
          plan. Until it exists, the honest second way on is out, with a complete
          intake left behind and nothing pretending a plan was made.
        */}
        <button type="button" className={hasMore ? undefined : "primary"} onClick={onExit}>
          That is enough for now
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Never discard an answer silently
// ---------------------------------------------------------------------------

/**
 * Named by prompt and never by id, and the list is the server's — the same
 * `prune` the write would run. "road-trip.drive-hours" is not a sentence anyone
 * said, and an answer with no prompt at all is one the tree no longer has.
 */
function discardedNames(discarded: readonly DiscardedAnswer[]): {
  named: readonly string[];
  unnamed: number;
} {
  const named = discarded
    .map((entry) => entry.prompt)
    .filter((prompt): prompt is string => prompt !== null);
  return { named, unnamed: discarded.length - named.length };
}

function ConfirmDiscard({
  write,
  busy,
  onCancel,
  onConfirm,
}: {
  write: PendingWrite;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}): React.ReactElement {
  const { named, unnamed } = discardedNames(write.discarded);

  return (
    <section className="panel warn" role="alertdialog" aria-labelledby="discard-heading">
      <h2 id="discard-heading">
        That change costs {String(write.discarded.length)}{" "}
        {write.discarded.length === 1 ? "answer" : "answers"}.
      </h2>
      <p>Changing “{write.question.prompt}” means these no longer apply:</p>
      <ul>
        {named.map((prompt) => (
          <li key={prompt}>{prompt}</li>
        ))}
        {unnamed > 0 && <li>Some earlier answers no longer apply.</li>}
      </ul>
      <div className="actions">
        <button type="button" className="primary" disabled={busy} onClick={onConfirm}>
          Change it anyway
        </button>
        <button type="button" disabled={busy} onClick={onCancel}>
          Keep what I had
        </button>
      </div>
    </section>
  );
}

/** What a write or a load has already discarded. Past tense: it is done. */
function DiscardNotice({
  discarded,
}: {
  discarded: readonly DiscardedAnswer[];
}): React.ReactElement {
  const { named, unnamed } = discardedNames(discarded);
  return (
    <p className="notice" aria-live="polite">
      {named.length > 0 && `No longer needed: ${named.join(", ")}.`}
      {unnamed > 0 && " Some earlier answers no longer apply."}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Back, and edit
// ---------------------------------------------------------------------------

function AnsweredList({
  questions,
  state,
  onEdit,
}: {
  questions: readonly QuestionNode[];
  state: IntakeState;
  onEdit: (id: QuestionId) => void;
}): React.ReactElement | null {
  if (questions.length === 0) return null;

  return (
    <section className="panel" aria-labelledby="answers-heading">
      <h2 id="answers-heading">Your answers</h2>
      <ul className="answers">
        {questions.map((question) => {
          const answer = state.answers[question.id];
          if (answer === undefined) return null;
          return (
            <li key={question.id}>
              <button type="button" className="link" onClick={() => onEdit(question.id)}>
                <span className="prompt">{question.prompt}</span>
                <span className="value">{describeAnswer(question, answer)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
