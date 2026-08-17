/**
 * `@planner/itinerary` — everything about a plan that must be exact.
 *
 * The analysis's central decision (§2) as a package: **models generate
 * candidates; code schedules, sums and checks.** Drive budgets, day packing,
 * season windows, booking deadlines and budget totals are arithmetic and
 * constraint satisfaction, and they live here in ordinary TypeScript with
 * ordinary unit tests — because a model asked to add up a budget is being asked
 * to be bad at something a computer is perfect at, and that is the single most
 * common way an AI itinerary embarrasses itself.
 *
 * **No model, no network, no clock.** The same three prohibitions
 * `@planner/intake` carries, for a different reason: the intake must be
 * deterministic so the interview is reproducible, and this package must be
 * deterministic because the same brief and the same candidates have to produce
 * the same plan twice. `test/purity.test.ts` scans for it rather than trusting
 * this paragraph.
 *
 * The one call most callers want is `compose`:
 *
 * ```
 * const { revision, unchecked } = compose({ brief, candidates, revision: {...}, now })
 * const plan = appendRevision(existing, revision)
 * ```
 *
 * `unchecked` is not optional decoration. It is the list of constraints this
 * composer could not evaluate — travel time above all, which Phase 2 has no
 * coordinates for — and dropping it on the floor turns an honest plan into one
 * that merely looks finished.
 */

export { compose, pinnedPlacements, type ComposeInput, type ComposeResult } from "./compose.ts";
export {
  critique,
  isHard,
  CRITIC_FINDINGS,
  type CriticFinding,
  type CriticFindingKind,
} from "./critic.ts";
export {
  pack,
  dayCapacity,
  BUCKETS,
  BUCKET_OF,
  EXCLUSION_REASONS,
  type Bucket,
  type Excluded,
  type ExclusionReason,
  type PackedDay,
  type PackedItem,
  type PackInput,
  type PackResult,
  type PinnedPlacement,
} from "./pack.ts";
export {
  couldBeInSeason,
  filterBySeason,
  inSeasonOn,
  inSeasonOnDay,
  type SeasonSplit,
} from "./season.ts";
export {
  budgetCeiling,
  isOverBudget,
  partySize,
  totalCost,
  type CostBand,
  type CostTotal,
} from "./cost.ts";
export {
  daysUntilDeparture,
  monthDay,
  possibleMonthDays,
  tripSpan,
  type TripSpan,
} from "./dates.ts";
export {
  unchecked,
  uncheckedFor,
  uncheckedForRevision,
  UNCHECKED_CONSTRAINTS,
  type UncheckedConstraint,
  type UncheckedConstraintKind,
} from "./unchecked.ts";
export {
  ACTIVITY_MINUTES_PER_DAY,
  ASSUMED_EFFORT,
  DRIVE_MINUTES_PER_DAY,
  ITEMS_PER_CITY_DAY,
  MAX_CRITIC_ROUNDS,
} from "./limits.ts";
