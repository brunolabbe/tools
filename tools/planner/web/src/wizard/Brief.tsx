/**
 * The brief, as it fills.
 *
 * **Not a debug view.** It is how a user notices the tool misheard them, which
 * is the whole reason §3 wanted the brief visible while the questions are still
 * being asked. It renders the document the specialists will read, not the
 * answers that produced it — those are two different things on purpose, and this
 * is the one that gets planned from.
 *
 * A slot that has never been asked is simply absent. A slot the user **declined**
 * says so, because "we asked, they shrugged" and "we have not asked yet" are not
 * the same state and the difference is the whole point of the three-state slot.
 */

import {
  type BriefSlotId,
  type CoreSlotId,
  type Slot,
  type TripBrief,
  type TripShapeDetails,
} from "@planner/contract";
import { describeBudget, describeDates, humanise } from "./format.ts";

const CORE_LABELS: Record<CoreSlotId, string> = {
  shape: "Kind of trip",
  origin: "Leaving from",
  destination: "Going to",
  dates: "When",
  travellers: "Travellers",
  ages: "Ages",
  accessNeeds: "Access needs",
  budget: "Budget",
  effort: "Effort",
  comfort: "Comfort",
  dealBreakers: "Deal breakers",
};

/** Every slot a shape extension can carry. `context` is shared by all six. */
const SHAPE_LABELS: Record<string, string> = {
  maxDailyDriveHours: "Driving a day",
  vehicle: "Vehicle",
  routeStyle: "Route",
  mustSee: "Must see",
  nightsOut: "Nights out",
  shelter: "Shelter",
  maxDailyDistanceKm: "Distance a day",
  experience: "Experience",
  machine: "Machine",
  machineSource: "Machine from",
  rangeKm: "Range",
  pace: "Pace",
  interests: "Interests",
  boardBasis: "Board",
  setting: "Setting",
  onSiteMusts: "On site",
  cities: "Stops",
  interCityTransport: "Between stops",
  minNightsPerCity: "Nights per stop",
  context: "Anything else",
};

/** Everything a slot can hold, once the composites are formatted out. */
function describe(value: unknown): string {
  if (Array.isArray(value)) return value.map((each: unknown) => describe(each)).join(", ");
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return humanise(value);
  if (value !== null && typeof value === "object" && "kind" in value) {
    const composite = value as { kind: string };
    if (composite.kind === "amount" || composite.kind === "band") {
      return describeBudget(value as Parameters<typeof describeBudget>[0]);
    }
    return describeDates(value as Parameters<typeof describeDates>[0]);
  }
  return String(value);
}

function Row({ label, value }: { label: string; value: Slot<unknown> }): React.ReactElement | null {
  if (value.state === "unknown") return null;
  return (
    <>
      <dt>{label}</dt>
      <dd className={value.state === "declined" ? "muted" : undefined}>
        {value.state === "declined" ? "Not important" : describe(value.value)}
      </dd>
    </>
  );
}

/** The extension's slots, in the order the type declares them. */
function detailRows(details: TripShapeDetails): React.ReactElement[] {
  return Object.entries(details)
    .filter(([key]) => key !== "shape")
    .map(([key, value]) => (
      <Row key={key} label={SHAPE_LABELS[key] ?? key} value={value as Slot<unknown>} />
    ))
    .filter((row): row is React.ReactElement => row !== null);
}

export function Brief({ brief }: { brief: TripBrief }): React.ReactElement {
  const settled = (Object.keys(CORE_LABELS) as BriefSlotId[]).some(
    (id) => brief[id as CoreSlotId].state !== "unknown",
  );

  return (
    <section className="panel" aria-labelledby="brief-heading">
      <h2 id="brief-heading">The trip so far</h2>
      {settled ? (
        <dl>
          {(Object.keys(CORE_LABELS) as CoreSlotId[]).map((id) => (
            <Row key={id} label={CORE_LABELS[id]} value={brief[id]} />
          ))}
          {brief.details !== null && detailRows(brief.details)}
        </dl>
      ) : (
        <p className="muted">Nothing yet. It fills in as you answer.</p>
      )}
    </section>
  );
}
