/**
 * The trip brief — the intake's output, and the only thing a specialist reads.
 *
 * `00-ANALYSIS.md` §3: the intake's job is not to collect answers, it is to
 * produce a structured, validated document. That indirection is what makes the
 * fan-out testable — given a checked-in brief, the roster is deterministic and a
 * unit test can assert it — and it is why swapping the model interview for an
 * authored question tree (§3's amendment) cost nothing downstream.
 *
 * ## Why the schemas live here rather than in `api.ts`
 *
 * `api.ts` is the HTTP contract: what a request body must look like. A brief is
 * validated in places that have no HTTP in them — `@planner/intake` assembles
 * one with no network at all, and a specialist reads one it was handed. So the
 * types and their schemas sit together, and each schema is still written
 * `satisfies z.ZodType<T>` against its interface, which is the property that
 * actually matters: a field added to a type without a matching field in its
 * schema is a compile error rather than a silent validation hole.
 *
 * ## Every slot is three-state
 *
 * A slot is `unknown`, `declined` or `answered` — never just "empty". "The user
 * does not care" is an answer, and a slot that cannot record it gets re-asked
 * forever, which is the most visible way this tool can look stupid. See `Slot`.
 *
 * ## What is *not* here
 *
 * No clock. "Is that departure in the past" is time-dependent and belongs to
 * `@planner/intake`'s `validateAnswer`, which takes `now` as an argument. The
 * schemas below enforce only what is true without one — a return that is not
 * before its departure, a night count inside its bounds.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

export const SLOT_STATES = [
  /** Never asked, or asked and not yet reached. */
  "unknown",
  /** Asked, and the user declined to answer. **Never ask again.** */
  "declined",
  "answered",
] as const;

export type SlotState = (typeof SLOT_STATES)[number];

/**
 * One answer's worth of the brief.
 *
 * `declined` is the state the whole design hangs on. It is the difference
 * between "we have not asked yet" and "we asked, they shrugged" — the first is
 * a question to put next, the second is settled forever. Downstream neither is
 * a value, which is deliberate: a specialist cannot tell a declined slot from
 * an unasked one, and should not try to.
 */
export type Slot<T> =
  | { state: "unknown" }
  | { state: "declined" }
  | { state: "answered"; value: T };

/**
 * Constructors, so no caller hand-writes the discriminant.
 *
 * The two value-less ones return their own narrow type rather than `Slot<T>`:
 * both are assignable to a slot of any value type, so they need no type
 * argument at a call site, and a helper that only ever clears a slot can say so
 * in its signature.
 */
export const slot = {
  unknown: (): { state: "unknown" } => ({ state: "unknown" }),
  declined: (): { state: "declined" } => ({ state: "declined" }),
  answered: <T>(value: T): Slot<T> => ({ state: "answered", value }),
};

export function isAnswered<T>(value: Slot<T>): value is { state: "answered"; value: T } {
  return value.state === "answered";
}

/**
 * True once the question behind this slot has been put to the user, however
 * they replied. This — not `isAnswered` — is what "do not ask again" and "does
 * this block a draft" both mean.
 *
 * Takes `Slot<unknown>` rather than a generic `Slot<T>`: it never looks at the
 * value, and a generic would fail to infer over `brief[id]` where `id` ranges
 * across slots of different value types — which is exactly how
 * `missingRequiredSlots` calls it.
 */
export function isSettled(value: Slot<unknown>): boolean {
  return value.state !== "unknown";
}

/**
 * A `Slot<T>` schema around a value schema.
 *
 * Written as a factory with an explicit return type rather than a
 * `satisfies` — for a generic there is no concrete `T` to satisfy against, and
 * the annotation buys the same proof.
 */
export function slotSchema<T>(value: z.ZodType<T>): z.ZodType<Slot<T>> {
  return z.discriminatedUnion("state", [
    z.object({ state: z.literal("unknown") }),
    z.object({ state: z.literal("declined") }),
    z.object({ state: z.literal("answered"), value }),
  ]);
}

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

/**
 * Ceiling on the per-shape free-text slot.
 *
 * Not a guess about how much someone might type. This text is carried into
 * every specialist's prompt, so one run re-sends it once per specialist on the
 * roster: an unbounded field is an unbounded bill as well as an unbounded row.
 */
export const MAX_CONTEXT_CHARS = 2_000;

/** Short prose slots — an accessibility need, one deal-breaker, one interest. */
export const MAX_NOTE_CHARS = 500;

/** Items in any list-valued slot. Past this it is prose, not a list. */
export const MAX_LIST_ITEMS = 20;

/** Longest trip this tool will plan. `INVALID_DATES` covers anything past it. */
export const MAX_TRIP_NIGHTS = 60;

/** Largest party this tool will plan for. */
export const MAX_PARTY_SIZE = 30;

const noteSchema = z.string().trim().min(1).max(MAX_NOTE_CHARS);
const noteListSchema = z.array(noteSchema).max(MAX_LIST_ITEMS);
const nightsSchema = z.number().int().min(1).max(MAX_TRIP_NIGHTS);

// ---------------------------------------------------------------------------
// The trip's shape
// ---------------------------------------------------------------------------

/**
 * What kind of trip this is. §1's table, as an enum: these six share almost
 * nothing, and which questions get asked and which specialists run are both
 * functions of this value.
 */
export const TRIP_SHAPES = [
  /** Point to point by car, sleeping somewhere different most nights. */
  "road-trip",
  /** On foot, away from a road, carrying what you need. */
  "backcountry",
  /** Snowmobile, ATV, motorcycle or boat — the machine is the trip. */
  "motorised-touring",
  /** One place, on foot, for what is in it. */
  "city-and-culture",
  /** One property, and mostly not leaving it. */
  "resort",
  /** Several bases with travel between them. */
  "multi-city",
] as const;

export type TripShape = (typeof TRIP_SHAPES)[number];

// ---------------------------------------------------------------------------
// Core slot value types
// ---------------------------------------------------------------------------

/**
 * When the trip happens, with flexibility as a first-class case rather than a
 * missing date.
 *
 * "A weekend in February" and "two weeks sometime in spring" are `window`s —
 * a range the trip must fall inside, plus how long it is. A brief that can only
 * hold exact dates forces every user to invent them, and an invented date is
 * then planned against as though it were real.
 */
export type TripDates =
  | { kind: "exact"; departure: string; return: string }
  /** Somewhere inside `[earliest, latest]`, for `nights` nights. */
  | { kind: "window"; earliest: string; latest: string; nights: number }
  /** Duration only. The honest state for "whenever is best". */
  | { kind: "open"; nights: number };

/**
 * ISO dates sort lexicographically, so a string compare *is* the date compare —
 * no parsing, and no timezone to get wrong. Ordering is all this can check
 * without a clock; "in the past" belongs to `@planner/intake`.
 */
export const tripDatesSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("exact"), departure: z.iso.date(), return: z.iso.date() })
    .refine((dates) => dates.return >= dates.departure, {
      message: "The return date is before the departure date.",
      path: ["return"],
    }),
  z
    .object({
      kind: z.literal("window"),
      earliest: z.iso.date(),
      latest: z.iso.date(),
      nights: nightsSchema,
    })
    .refine((dates) => dates.latest >= dates.earliest, {
      message: "The window ends before it starts.",
      path: ["latest"],
    }),
  z.object({ kind: z.literal("open"), nights: nightsSchema }),
]) satisfies z.ZodType<TripDates>;

export const BUDGET_BASES = ["total", "per-person", "per-day"] as const;
export type BudgetBasis = (typeof BUDGET_BASES)[number];

/** For someone who thinks in a feeling rather than a figure, which is most people. */
export const BUDGET_BANDS = ["shoestring", "moderate", "comfortable", "unconstrained"] as const;
export type BudgetBand = (typeof BUDGET_BANDS)[number];

/**
 * "Budget shape" from §3, and shape is the operative word: a number with a
 * basis, or a band. Both are answers; neither is a price we may quote back.
 */
export type TripBudget =
  | { kind: "amount"; currency: string; amount: number; basis: BudgetBasis }
  | { kind: "band"; band: BudgetBand };

export const tripBudgetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("amount"),
    /** ISO-4217, upper case. */
    currency: z.string().regex(/^[A-Z]{3}$/),
    amount: z.number().positive().finite(),
    basis: z.enum(BUDGET_BASES),
  }),
  z.object({ kind: z.literal("band"), band: z.enum(BUDGET_BANDS) }),
]) satisfies z.ZodType<TripBudget>;

/**
 * How much a day is allowed to hold. §1: "not too much driving" means four
 * hours a day to one person and ninety minutes to another, and this is the slot
 * that settles which — for the composer, in `itinerary`, not for a model.
 */
export const EFFORT_APPETITES = [
  /** A stroll and a long lunch. */
  "gentle",
  /** A full day out, and a sit down after it. */
  "moderate",
  /** Long days, and the point of the trip is the doing. */
  "demanding",
  /** Dawn starts under load, several days running. */
  "strenuous",
] as const;

export type EffortAppetite = (typeof EFFORT_APPETITES)[number];

/**
 * The roughest night the party will accept — appetite for discomfort, stated as
 * a floor so lodging has something it can filter on.
 */
export const COMFORT_FLOORS = [
  /** A hotel bed and a private bathroom. */
  "hotel",
  /** Motel, hostel, guesthouse; a shared bathroom is fine. */
  "simple",
  /** Hut, bunkroom, cabin without plumbing. */
  "rustic",
  /** A tent, and whatever the ground is. */
  "wild",
] as const;

export type ComfortFloor = (typeof COMFORT_FLOORS)[number];

// ---------------------------------------------------------------------------
// Per-shape extension slot value types
// ---------------------------------------------------------------------------

/**
 * How much road a day is allowed to hold, as a band rather than a decimal.
 *
 * Hours are the right unit and a number is the wrong control: nobody types 3.5,
 * and distance would be worse — 400 km is a lazy afternoon on an interstate and
 * a full day on a mountain pass, so a distance answer forces the composer to
 * invent a speed to convert it back into the thing it actually needs. Named for
 * the day and not for a number, the way `EFFORT_APPETITES` is.
 */
export const DRIVE_APPETITES = ["short-hops", "half-day", "long-day", "all-day"] as const;
export type DriveAppetite = (typeof DRIVE_APPETITES)[number];

/**
 * What is being driven, with no claim about who owns it.
 *
 * Split from ownership on 2026-08-16 (pl-14): a single enum of
 * `own-car | rental-car | camper-van | motorhome` cannot say *rented camper
 * van*, which in most markets is the commonest camper trip there is — so every
 * rental constraint went missing on the case where they bite hardest.
 */
export const ROAD_VEHICLE_KINDS = ["car", "camper-van", "motorhome"] as const;
export type RoadVehicleKind = (typeof ROAD_VEHICLE_KINDS)[number];

/**
 * The other half of that split: whose it is.
 *
 * This duplicates `MACHINE_SOURCES` member for member and stays its own enum on
 * purpose. One list covering a motorhome and a snowmobile couples two shapes'
 * content, and the two are free to diverge — a car can gain `borrowed`, a
 * machine can gain an outfitter.
 */
export const VEHICLE_SOURCES = ["own", "rental"] as const;
export type VehicleSource = (typeof VEHICLE_SOURCES)[number];

/** One-way rental fees are a real line item, so the loop/one-way answer is a slot. */
export const ROUTE_STYLES = ["loop", "one-way"] as const;
export type RouteStyle = (typeof ROUTE_STYLES)[number];

export const SHELTER_KINDS = ["hut", "tent", "either"] as const;
export type ShelterKind = (typeof SHELTER_KINDS)[number];

export const BACKCOUNTRY_EXPERIENCE = ["first-time", "some", "seasoned"] as const;
export type BackcountryExperience = (typeof BACKCOUNTRY_EXPERIENCE)[number];

export const MACHINES = ["snowmobile", "atv", "motorcycle", "boat"] as const;
export type Machine = (typeof MACHINES)[number];

/** Rental availability is usually the binding constraint, so it is asked early. */
export const MACHINE_SOURCES = ["own", "rental"] as const;
export type MachineSource = (typeof MACHINE_SOURCES)[number];

export const CITY_PACES = ["packed", "steady", "slow"] as const;
export type CityPace = (typeof CITY_PACES)[number];

export const BOARD_BASES = [
  "all-inclusive",
  "half-board",
  "bed-and-breakfast",
  "room-only",
  "any",
] as const;
export type BoardBasis = (typeof BOARD_BASES)[number];

export const RESORT_SETTINGS = ["beach", "lake", "mountain", "spa-town", "any"] as const;
export type ResortSetting = (typeof RESORT_SETTINGS)[number];

export const INTER_CITY_TRANSPORT = ["train", "plane", "car", "bus", "any"] as const;
export type InterCityTransport = (typeof INTER_CITY_TRANSPORT)[number];

// ---------------------------------------------------------------------------
// The per-shape extensions
// ---------------------------------------------------------------------------

/**
 * Every extension carries a `context` slot: free text about *this shape* of
 * trip, carried into the brief and read by specialists as prose.
 *
 * It is the §3 amendment's stated mitigation for the one thing an authored tree
 * cannot do — follow up on something nobody anticipated — and the amendment is
 * equally clear that it is a weaker answer than a model asking the follow-up.
 *
 * It is **not** a `notes` blob to be parsed back out later. Nothing may read
 * structure out of it. The moment something wants a field from in here, the
 * field belongs on the brief; add it.
 *
 * These are written as `type` rather than `interface` on purpose: a type alias
 * carries an implicit index signature, which is what lets
 * `missingRequiredSlots` look a slot up by id without an assertion.
 */
export type RoadTripDetails = {
  shape: "road-trip";
  /** How much road a normal day holds — §2's failure 1, in the brief. */
  driveAppetite: Slot<DriveAppetite>;
  vehicleKind: Slot<RoadVehicleKind>;
  /** Whether it is theirs. A rental carries a pickup point and a fee. */
  vehicleSource: Slot<VehicleSource>;
  routeStyle: Slot<RouteStyle>;
  /** Stops the party already wants. Names, not an itinerary. */
  mustSee: Slot<string[]>;
  context: Slot<string>;
};

export type BackcountryDetails = {
  shape: "backcountry";
  /** Nights away from a road. Zero would make this a day hike, not this shape. */
  nightsOut: Slot<number>;
  /** Huts book months out, which is the lead-time deadline this shape lives on. */
  shelter: Slot<ShelterKind>;
  maxDailyDistanceKm: Slot<number>;
  experience: Slot<BackcountryExperience>;
  context: Slot<string>;
};

export type MotorisedTouringDetails = {
  shape: "motorised-touring";
  machine: Slot<Machine>;
  machineSource: Slot<MachineSource>;
  /** Fuel range between stops — the constraint that decides where a day can end. */
  rangeKm: Slot<number>;
  context: Slot<string>;
};

export type CityAndCultureDetails = {
  shape: "city-and-culture";
  /** How many things a day holds, before opening hours are even consulted. */
  pace: Slot<CityPace>;
  /** Museums, food, architecture, music — what an activities specialist filters on. */
  interests: Slot<string[]>;
  context: Slot<string>;
};

export type ResortDetails = {
  shape: "resort";
  boardBasis: Slot<BoardBasis>;
  setting: Slot<ResortSetting>;
  /** Pool, kids' club, spa, beach access. */
  onSiteMusts: Slot<string[]>;
  context: Slot<string>;
};

export type MultiCityDetails = {
  shape: "multi-city";
  /** The stops, in order if the party has one in mind. */
  cities: Slot<string[]>;
  interCityTransport: Slot<InterCityTransport>;
  minNightsPerCity: Slot<number>;
  context: Slot<string>;
};

/** Discriminated on `shape`, so an extension can never belong to two shapes. */
export type TripShapeDetails =
  | RoadTripDetails
  | BackcountryDetails
  | MotorisedTouringDetails
  | CityAndCultureDetails
  | ResortDetails
  | MultiCityDetails;

const contextSlotSchema = slotSchema(z.string().trim().min(1).max(MAX_CONTEXT_CHARS));

export const tripShapeDetailsSchema = z.discriminatedUnion("shape", [
  z.object({
    shape: z.literal("road-trip"),
    driveAppetite: slotSchema(z.enum(DRIVE_APPETITES)),
    vehicleKind: slotSchema(z.enum(ROAD_VEHICLE_KINDS)),
    vehicleSource: slotSchema(z.enum(VEHICLE_SOURCES)),
    routeStyle: slotSchema(z.enum(ROUTE_STYLES)),
    mustSee: slotSchema(noteListSchema),
    context: contextSlotSchema,
  }),
  z.object({
    shape: z.literal("backcountry"),
    nightsOut: slotSchema(nightsSchema),
    shelter: slotSchema(z.enum(SHELTER_KINDS)),
    maxDailyDistanceKm: slotSchema(z.number().positive().max(200)),
    experience: slotSchema(z.enum(BACKCOUNTRY_EXPERIENCE)),
    context: contextSlotSchema,
  }),
  z.object({
    shape: z.literal("motorised-touring"),
    machine: slotSchema(z.enum(MACHINES)),
    machineSource: slotSchema(z.enum(MACHINE_SOURCES)),
    rangeKm: slotSchema(z.number().positive().max(2_000)),
    context: contextSlotSchema,
  }),
  z.object({
    shape: z.literal("city-and-culture"),
    pace: slotSchema(z.enum(CITY_PACES)),
    interests: slotSchema(noteListSchema),
    context: contextSlotSchema,
  }),
  z.object({
    shape: z.literal("resort"),
    boardBasis: slotSchema(z.enum(BOARD_BASES)),
    setting: slotSchema(z.enum(RESORT_SETTINGS)),
    onSiteMusts: slotSchema(noteListSchema),
    context: contextSlotSchema,
  }),
  z.object({
    shape: z.literal("multi-city"),
    cities: slotSchema(noteListSchema),
    interCityTransport: slotSchema(z.enum(INTER_CITY_TRANSPORT)),
    minNightsPerCity: slotSchema(nightsSchema),
    context: contextSlotSchema,
  }),
]) satisfies z.ZodType<TripShapeDetails>;

// ---------------------------------------------------------------------------
// The brief
// ---------------------------------------------------------------------------

/**
 * The fixed core, asked of every trip whatever its shape (§3: "a small fixed
 * core, then branch on shape").
 *
 * `shape` lives here rather than on the extension so that changing it is a
 * sibling assignment: the trap in pl-3 is that people describe a road trip and
 * turn out to mean a hiking trip with a drive at each end, and swapping
 * `details` must not disturb anything else. `withShape` is that operation, and
 * the structure is what makes it one line.
 */
export type TripBriefCore = {
  shape: Slot<TripShape>;
  /** Where the party leaves from. */
  origin: Slot<string>;
  /**
   * Where they are going — deliberately **not** required. "Somewhere warm, you
   * pick" is a real trip to plan, and §1's list of hard facts a user knows does
   * not include the destination. A declined destination is an instruction, not
   * a hole.
   */
  destination: Slot<string>;
  dates: Slot<TripDates>;
  travellers: Slot<number>;
  /** Ages that change the plan — a toddler, a teenager, a grandparent. */
  ages: Slot<number[]>;
  /** What the party needs to be able to do this trip at all. */
  accessNeeds: Slot<string>;
  budget: Slot<TripBudget>;
  effort: Slot<EffortAppetite>;
  comfort: Slot<ComfortFloor>;
  /** Hard constraints. A plan that violates one is not shipped (§7). */
  dealBreakers: Slot<string[]>;
};

/**
 * What the intake produces and every specialist reads. Nothing downstream sees
 * the answers, the tree, or another specialist's output — only this.
 *
 * `details` is null until the shape is known, and always matches `shape` once
 * it is; the schema enforces the pair, and `withShape` is the only constructor
 * that needs to maintain it.
 */
export type TripBrief = TripBriefCore & {
  details: TripShapeDetails | null;
};

export const tripBriefSchema = z
  .object({
    shape: slotSchema(z.enum(TRIP_SHAPES)),
    origin: slotSchema(noteSchema),
    destination: slotSchema(noteSchema),
    dates: slotSchema(tripDatesSchema),
    travellers: slotSchema(z.number().int().min(1).max(MAX_PARTY_SIZE)),
    ages: slotSchema(z.array(z.number().int().min(0).max(120)).max(MAX_LIST_ITEMS)),
    accessNeeds: slotSchema(noteSchema),
    budget: slotSchema(tripBudgetSchema),
    effort: slotSchema(z.enum(EFFORT_APPETITES)),
    comfort: slotSchema(z.enum(COMFORT_FLOORS)),
    dealBreakers: slotSchema(noteListSchema),
    details: tripShapeDetailsSchema.nullable(),
  })
  // A brief whose extension is not the extension for its shape is a brief that
  // was assembled by hand somewhere. Rejecting it here means nothing downstream
  // has to consider the case.
  .refine(
    (brief) =>
      brief.details === null ||
      (brief.shape.state === "answered" && brief.shape.value === brief.details.shape),
    { message: "The shape extension does not match the trip's shape.", path: ["details"] },
  ) satisfies z.ZodType<TripBrief>;

// ---------------------------------------------------------------------------
// Slot ids, and what a first draft cannot do without
// ---------------------------------------------------------------------------

/** Every slot key on a shape extension — `shape` itself is the discriminant, not a slot. */
export type ShapeSlotKeys<D> = Exclude<keyof D, "shape"> & string;

export type CoreSlotId = keyof TripBriefCore;

/** Distributed over the union: `keyof (A | B)` would give the intersection. */
export type ShapeSlotId = {
  [S in TripShape]: ShapeSlotKeys<Extract<TripShapeDetails, { shape: S }>>;
}[TripShape];

/** What `missingRequiredSlots` names, and what a question tree node fills. */
export type BriefSlotId = CoreSlotId | ShapeSlotId;

/**
 * The core slots without which no first draft can exist.
 *
 * "Required" here is not a wish about data quality — decided 2026-08-14, it is
 * the line where a user is allowed to leave: the wizard stops asking when
 * `missingRequiredSlots` is empty and offers the draft there. So the bar is
 * "a first draft is genuinely impossible without it", and anything the plan is
 * merely better for knowing is a `refine` question behind the checkpoint.
 *
 * That bar is why `destination`, `comfort`, `ages`, `accessNeeds` and
 * `dealBreakers` are absent. Each improves a plan; none of them prevents one.
 *
 * **`destination` is absent and still asked third** (pl-18). Being off this list
 * is what lets it be skipped — "somewhere warm, you pick" is a trip this tool
 * plans — and where it is asked is a separate decision, made on the 95% of
 * people who already know. Absent from here never meant asked late; it meant
 * never blocking. See `QUESTION_STAGES` in `tree.ts`.
 *
 * **`budget` is absent too**, removed in the content review of 2026-08-16
 * (pl-14). It is still a question — it moves hotel tier, whether flights are in
 * scope, whether an activity makes the list — but a first draft is entirely
 * possible from a `moderate` default, which is §3's "draft early, interview
 * less" exactly. `comfort` drives lodging tier the same way and was already
 * `refine`, so keeping budget here was inconsistent as well as too strict. It is
 * also the question people are least able to answer honestly up front, because
 * the true answer is "depends what it buys" — which is the thing a draft
 * supplies.
 */
export const REQUIRED_CORE_SLOTS = [
  "shape",
  "origin",
  "dates",
  "travellers",
  "effort",
] as const satisfies readonly CoreSlotId[];

/**
 * The same bar, per shape. Two questions past the core for most shapes, which
 * puts a draftable brief at seven answers — inside §3's "perhaps eight to ten".
 *
 * The type ties each row to that shape's own slot keys, so a slot renamed on an
 * extension breaks this table rather than silently dropping a requirement.
 *
 * **Every slot here must be filled by a `core` node** in `@planner/intake` — a
 * required slot no `core` node fills makes the wizard offer a draft
 * `missingRequiredSlots` will refuse. The converse stopped holding in pl-18: a
 * `core` node whose slot is not here is an early optional question, and
 * `destination` is one.
 */
export const REQUIRED_SHAPE_SLOTS: {
  [S in TripShape]: readonly ShapeSlotKeys<Extract<TripShapeDetails, { shape: S }>>[];
} = {
  // How much road a day holds decides every leg; what it is driven in decides
  // where a day can end, because a camper sleeps you and a car does not.
  // `vehicleSource` is deliberately not here: whether the camper is rented moves
  // a pickup point and a fee, and a draft exists without knowing it.
  "road-trip": ["driveAppetite", "vehicleKind"],
  // Nights out sets the pack, and hut-or-tent sets the booking deadline.
  backcountry: ["nightsOut", "shelter"],
  // Which machine, and whether it must be rented — rentals are the binding constraint.
  "motorised-touring": ["machine", "machineSource"],
  // Without interests a city plan is a list of the obvious; pace decides how long it is.
  "city-and-culture": ["pace", "interests"],
  // Board basis moves the whole budget and most of what there is to plan.
  resort: ["boardBasis"],
  // The stops, and how the party moves between them.
  "multi-city": ["cities", "interCityTransport"],
};

/**
 * Which slots still block a first draft.
 *
 * A **declined** slot does not count as missing: the user was asked and said it
 * does not matter, and treating that as a hole re-asks it forever. Only
 * `unknown` blocks.
 *
 * Empty means draftable, and that is behaviour rather than a report — it is
 * where the wizard stops asking and offers the draft, and where the
 * orchestrator's readiness check passes. It lives in the contract because both
 * sides read it and neither should own it.
 *
 * When the shape itself is not answered there is no extension to check, so the
 * result names the core slots only. `shape` is required, so such a brief is
 * never draftable and the list is never empty.
 */
export function missingRequiredSlots(brief: TripBrief): BriefSlotId[] {
  const missing: BriefSlotId[] = [];

  for (const id of REQUIRED_CORE_SLOTS) {
    if (!isSettled(brief[id])) missing.push(id);
  }

  const { details } = brief;
  if (details === null) return missing;

  // Every extension property but `shape` is a `Slot`, and the table's type keys
  // each id to this shape's own slots — so the lookup is sound. The `typeof`
  // guard is what narrows `shape` back out of it for the compiler.
  const slots: Record<string, Slot<unknown> | TripShape> = details;
  for (const id of REQUIRED_SHAPE_SLOTS[details.shape]) {
    const value = slots[id];
    if (typeof value === "object" && !isSettled(value)) missing.push(id);
  }

  return missing;
}

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

/** Every slot of a shape's extension, unknown. */
export function emptyShapeDetails(shape: TripShape): TripShapeDetails {
  switch (shape) {
    case "road-trip":
      return {
        shape,
        driveAppetite: slot.unknown(),
        vehicleKind: slot.unknown(),
        vehicleSource: slot.unknown(),
        routeStyle: slot.unknown(),
        mustSee: slot.unknown(),
        context: slot.unknown(),
      };
    case "backcountry":
      return {
        shape,
        nightsOut: slot.unknown(),
        shelter: slot.unknown(),
        maxDailyDistanceKm: slot.unknown(),
        experience: slot.unknown(),
        context: slot.unknown(),
      };
    case "motorised-touring":
      return {
        shape,
        machine: slot.unknown(),
        machineSource: slot.unknown(),
        rangeKm: slot.unknown(),
        context: slot.unknown(),
      };
    case "city-and-culture":
      return {
        shape,
        pace: slot.unknown(),
        interests: slot.unknown(),
        context: slot.unknown(),
      };
    case "resort":
      return {
        shape,
        boardBasis: slot.unknown(),
        setting: slot.unknown(),
        onSiteMusts: slot.unknown(),
        context: slot.unknown(),
      };
    case "multi-city":
      return {
        shape,
        cities: slot.unknown(),
        interCityTransport: slot.unknown(),
        minNightsPerCity: slot.unknown(),
        context: slot.unknown(),
      };
  }
}

/** A brief with nothing asked yet. Where an intake starts. */
export function emptyBrief(): TripBrief {
  return {
    shape: slot.unknown(),
    origin: slot.unknown(),
    destination: slot.unknown(),
    dates: slot.unknown(),
    travellers: slot.unknown(),
    ages: slot.unknown(),
    accessNeeds: slot.unknown(),
    budget: slot.unknown(),
    effort: slot.unknown(),
    comfort: slot.unknown(),
    dealBreakers: slot.unknown(),
    details: null,
  };
}

/**
 * Change the trip's shape, keeping every core answer and swapping only the
 * extension.
 *
 * The trap this exists for: people describe a road trip and turn out to mean a
 * hiking trip with a drive at each end. Who is coming, when, from where and on
 * what budget did not change, and re-asking them is the failure. The abandoned
 * extension's answers *are* discarded — they are answers to questions nobody
 * would now ask — which is the same rule `@planner/intake`'s `prune`
 * generalises to the whole tree, here at the level of one branch.
 *
 * Setting the shape it already has is a no-op, so a re-answer that changed
 * nothing does not silently empty the extension.
 */
export function withShape(brief: TripBrief, shape: TripShape): TripBrief {
  if (isAnswered(brief.shape) && brief.shape.value === shape && brief.details !== null) {
    return brief;
  }
  return { ...brief, shape: slot.answered(shape), details: emptyShapeDetails(shape) };
}
