/**
 * Marking which lines came from somewhere and which are the model talking.
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
 *
 * **`grounded` no longer means "worth doing"**, and the copy below is worded
 * for that (pl-29, `00-ANALYSIS.md` §5's 2026-08-22 amendment). A measured
 * distance is "yes, this road is this long"; an OSM node is "a stranger tagged
 * this and nobody reviewed it". `Provenance` gains no member for the difference
 * on purpose (see pl-29's Build step 6): the type cannot tell a routing engine's
 * answer from a database row, so the one sentence every `grounded` line renders
 * has to be true of both. It used to read "was read from", which a badge reading
 * "Checked" sits over — and a checkmark next to a nobody-vouched-for POI is the
 * exact "recommended" a reader is not supposed to take from it.
 *
 * ## What this comment used to claim, and why that is worth recording
 *
 * It said, in the present tense, that "discovery turns a database row into a
 * `Candidate` a specialist judged worth writing about, and that candidate's
 * `provenance` is `grounded`". **No code path has ever made that true**, and
 * under pl-36 none ever will: a candidate a specialist wrote from a `Find` is
 * `model-asserted`, permanently, for the reasons in pl-36's Log. The sentence
 * was not describing this file — it was describing a plumbing change one package
 * away, in `agent`, that pl-29 did not make and no later ticket picked up.
 *
 * **Why it survived a review, since that is the part that will happen again.**
 * It arrived inside a change that was entirely correct: pl-29 really did soften
 * this component's copy so a `grounded` line cannot read as an endorsement, and
 * the sentence reads as the *motivation* for that softening rather than as a
 * claim about behaviour. A reviewer checking the diff finds the copy fix present
 * and right, and the motivating clause is prose in a doc comment — there is
 * nothing to run and nothing to fail. A statement about a *different package*,
 * written in the present tense, in a comment justifying a change to *this* one,
 * is invisible to every gate this repo has: the tests cover the file the comment
 * is in. So the tell is grammatical, not technical — **a doc comment describing
 * what some other package does is an assertion nothing here can check**, and it
 * should be written as the intent it is, with the ticket that would deliver it,
 * or not written at all.
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
      <span className="mark">Sourced</span> {what} is something we read at a source — reading it is
      not recommending it:{" "}
      {provenance.sources.map((source, index) => (
        // Keyed on the URL **and** the title — pl-36. One backend can cite one
        // URL for two services and tell them apart in the title only, which
        // this tool's own grounding provider does: `openstreetmap.org/copyright`
        // for both "routed by Valhalla" and "geocoded by Nominatim". A key of
        // the URL alone is a duplicate-key warning and two nodes React treats
        // as one.
        <span key={`${source.url}\u0000${source.title ?? ""}`}>
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
