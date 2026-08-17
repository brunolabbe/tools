/**
 * Marking which lines were verified and which are the model talking.
 *
 * Analysis §5 calls this "the honest answer to the prices being wrong", and it
 * is the reason `Provenance` is structured data rather than prose. Until
 * something renders the distinction, storing it is bookkeeping — so this
 * component exists to make the difference visible on every line that has one.
 *
 * **A candidate's provenance and its cost's are separate and may disagree.** A
 * real place with a guessed price is the common case, not an oddity, so they
 * are rendered as two statements and never merged into one confidence.
 *
 * **`model-asserted` is the normal state in Phase 2.** Grounding does not exist
 * yet, so every candidate a scripted provider produces is the model talking.
 * That is not a placeholder to be tidied away: a plan built with no grounding
 * configured must still say so on every line.
 */

import type { Provenance, Source } from "@planner/contract";

/**
 * A source, as a link.
 *
 * `rel="noreferrer"` and a new tab because **this URL is untrusted**: it came
 * out of a model that was reading web pages. `sourceSchema`'s `https?` check is
 * a floor — it says the value is a web address at all — and not a reason to
 * hand the page an opener onto this one.
 *
 * The title is the model's text too, and React escapes it. A source with no
 * title falls back to its URL rather than to a made-up label.
 */
function SourceLink({ source }: { source: Source }): React.ReactElement {
  return (
    <a href={source.url} target="_blank" rel="noreferrer noopener">
      {source.title ?? source.url}
    </a>
  );
}

/**
 * One provenance, said plainly.
 *
 * `what` names the claim — "This" for the candidate, "The cost" for its price —
 * so the two readings of one item cannot be confused for each other when they
 * disagree.
 */
export function ProvenanceNote({
  provenance,
  what,
}: {
  provenance: Provenance;
  what: string;
}): React.ReactElement {
  if (provenance.kind === "model-asserted") {
    return (
      <p className="provenance asserted">
        <span className="mark">Unverified</span> {what} is the assistant talking — nothing checked
        it.
      </p>
    );
  }

  return (
    <p className="provenance grounded">
      <span className="mark">Checked</span> {what} was read from{" "}
      {provenance.sources.map((source, index) => (
        <span key={source.url}>
          {index > 0 && ", "}
          <SourceLink source={source} />
          {/*
            When it was read is not decoration: §5 ages a grounded fact out by
            kind, and a source without its timestamp cannot be aged.
          */}{" "}
          <span className="muted">({source.fetchedAt.slice(0, 10)})</span>
        </span>
      ))}
      .
    </p>
  );
}
