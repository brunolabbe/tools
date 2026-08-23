/**
 * How this tool identifies a place when it asks anything outside the process
 * about one.
 *
 * **One normaliser, and the grounding seam owns it.** It was `cache.ts`'s
 * private `placePart` until pl-27 needed the same identity to deduplicate the
 * place list a run sends to `travel` — and reached for the fixture provider's
 * `fixturePlaceKey` instead, which is a *different* question with a *different*
 * answer. That went wrong in the way a second normaliser always does; the
 * argument is below, and it is why this is a file of its own rather than one
 * more export on the cache. pl-28 will key places too.
 *
 * ## Why the fixture provider's key is not this key
 *
 * `fixturePlaceKey` is `placeKey(name)`: accent-stripped, lower-cased, and
 * **name only**. That is right for what it does — it decides whether one small
 * checked-in table happens to hold an answer, and its own comment says it earns
 * the licence by being small enough that no two places in it share a name.
 *
 * It is wrong for identity. Dropping `locality` merges Saint-Jean in Québec
 * with Saint-Jean in New Brunswick, and merging them does not merely lose a
 * lookup: the survivor's coordinates are written onto both candidates and
 * persisted — non-null thereafter, so no later run re-locates them — and both
 * index the same matrix cell, so the plan reports a `measured`, `grounded`
 * transition to somewhere the traveller is not going. A fabricated fact with a
 * source on it is the worst failure this tool has, and it is exactly what
 * `Provenance` exists to make impossible.
 *
 * `LocateRequest` carries the whole `Place` for this reason, and says so.
 *
 * ## Locality **narrows** the collision class; it does not close it
 *
 * Two genuinely different places can still share a normalised name and a
 * normalised locality — including both being `null`, which the contract permits
 * and a model routinely emits. Two inns called "Le Manoir" with no locality are
 * one key here and there is nothing in this file that could tell them apart.
 *
 * That is stated rather than hidden because **the remedy is not a longer key**.
 * A caller that refused to merge them would send `locate({ name: "Le Manoir",
 * locality: null })` twice, and a backend would answer the identical question
 * identically — two rows, one answer, both possibly the wrong inn. The
 * ambiguity is in the *question*, not in the deduplication, and it is not
 * resolvable until a candidate can carry something a model does not currently
 * produce: an identifier, or a seam that can answer "more than one place
 * matches". `GroundingProvider` has no vocabulary for the second today, and
 * pl-28 is where it would go.
 *
 * What *is* resolvable is handled, in `runPlaceKey`: coordinates that differ
 * are proof the two are different places, and proof is never merged away.
 *
 * ## What it drops, in full, so nobody has to read the code to find out
 *
 * 1. **Case.** `Rimouski` and `rimouski` are one question.
 * 2. **Surrounding whitespace**, and
 * 3. **repeated whitespace inside** — `"Québec  City"` is the same question as
 *    `"Québec City"`, and a model writes both.
 * 4. **Control characters**, which are less a normalisation than a defence:
 *    they are what a name would need to contain to forge a separator and be
 *    answered with another place's row.
 *
 * And what it deliberately does **not** drop, because each of these turns two
 * different questions into one:
 *
 * - **Accents.** `Montréal` and `Montreal` are two different strings and a real
 *   backend may well answer them differently.
 * - **Punctuation, articles, abbreviations.** `Saint-Anne` is not
 *   `Sainte Anne`, and `Mt Albert` is not `Mont Albert`. Guessing here is how a
 *   cache starts lying rather than missing.
 */

import type { Place } from "@planner/contract";

/**
 * Joins the parts of a key. A NUL, because nothing survives `normalisePart`
 * carrying one — control characters are stripped — so no place name can forge
 * another question's key by containing the separator. Each kind of key has a
 * fixed number of parts, so one separator is unambiguous.
 */
export const KEY_SEPARATOR = "\u0000";

/**
 * A part that is not there at all, distinct from one that is empty.
 *
 * A `Place` with no `locality` and a `Place` whose locality is `"  "` are
 * different questions — the first says nothing, the second says something
 * unusable — and collapsing them would be this file's own version of two
 * questions sharing an answer.
 */
export const ABSENT = "\u0001";

export function normalisePart(value: string): string {
  return value
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

/**
 * Which place this is, as far as anything reaching outside is concerned.
 *
 * Name **and** locality, because `locality` is what separates
 * Sainte-Anne-des-Monts in Québec from every other one — the sentence
 * `LocateRequest` already carries. It is the cache's key for `locate`, half of
 * its key for `travel`, and the identity the travel pass deduplicates its place
 * list by; those three must be the same string or two of them disagree about
 * what one place is.
 *
 * `coordinates` is deliberately not in it: they are what `locate` is *for*, and
 * a candidate that already has them asks a different question only in the sense
 * that it need not ask at all.
 */
export function placeIdentity(place: Place): string {
  return `${normalisePart(place.name)}${KEY_SEPARATOR}${
    place.locality === null ? ABSENT : normalisePart(place.locality)
  }`;
}
