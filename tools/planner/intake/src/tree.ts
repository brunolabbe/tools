/**
 * The question tree. This file is **content**, and it is reviewed as content.
 *
 * Three questions to ask of any node here, from `00-ANALYSIS.md` §1 and §3:
 * would a real person know the answer, does the answer change what a specialist
 * would do, and does it earn its place ahead of the draft? A question whose
 * answer changes nothing downstream is a question to cut — the tool's whole
 * argument for an authored intake is that it asks less, not more.
 *
 * ## The order is the asking order
 *
 * Every `core` node comes before every `refine` node, because the wizard stops
 * at the checkpoint: when nothing reachable and `core` is unanswered it says the
 * essentials are done and offers the draft. Eight questions get most shapes
 * there — §3's "perhaps eight to ten".
 *
 * ## Shape first
 *
 * `shape` is question one because every branch hangs off it, and a condition may
 * only reference a question that came earlier. It also makes a shape change
 * cheap in the direction that matters: the fixed core sits *after* it and is
 * shape-independent, so switching from a road trip to a hiking trip costs the
 * shape's own answers and nothing else — the same rule `withShape` encodes in
 * the contract, and the one `prune` generalises.
 */

import {
  BACKCOUNTRY_EXPERIENCE,
  BOARD_BASES,
  CITY_PACES,
  COMFORT_FLOORS,
  EFFORT_APPETITES,
  INTER_CITY_TRANSPORT,
  MACHINE_SOURCES,
  MACHINES,
  MAX_CONTEXT_CHARS,
  MAX_LIST_ITEMS,
  MAX_NOTE_CHARS,
  MAX_PARTY_SIZE,
  MAX_TRIP_NIGHTS,
  RESORT_SETTINGS,
  ROAD_VEHICLES,
  ROUTE_STYLES,
  SHELTER_KINDS,
  TRIP_SHAPES,
  type Choice,
  type Condition,
  type QuestionNode,
  type QuestionTree,
  type TripShape,
} from "@planner/contract";

/**
 * Choices from an enum and a label per member.
 *
 * Written this way so the two cannot drift: a label for a member that does not
 * exist, or a member with no label, is a compile error. Hand-written choice
 * lists are how a tree ends up offering "hotel" for a slot whose schema spells
 * it "hotels".
 */
function choicesOf<T extends string>(values: readonly T[], labels: Record<T, string>): Choice[] {
  return values.map((value) => ({ value, label: labels[value] }));
}

/** The condition every shape branch hangs off. Named so a typo cannot spread. */
function ofShape(shape: TripShape): Condition {
  return { kind: "equals", question: "shape", value: shape };
}

const NODES: readonly QuestionNode[] = [
  // -------------------------------------------------------------------------
  // The fixed core (§3: "a small fixed core, then branch on shape")
  // -------------------------------------------------------------------------
  {
    id: "shape",
    prompt: "What kind of trip is this?",
    help: "It decides what we ask next, and which specialists work on the plan.",
    when: null,
    fills: { scope: "core", slot: "shape" },
    stage: "core",
    kind: "single-choice",
    choices: choicesOf(TRIP_SHAPES, {
      "road-trip": "A road trip — driving, sleeping somewhere different most nights",
      backcountry: "Backcountry — on foot, away from a road, carrying what you need",
      "motorised-touring": "Touring on a machine — snowmobile, ATV, motorcycle or boat",
      "city-and-culture": "One city, for what is in it",
      resort: "A resort, and mostly not leaving it",
      "multi-city": "Several places, with travel between them",
    }),
  },
  {
    id: "origin",
    prompt: "Where are you leaving from?",
    help: "A city or an airport is enough. It decides what is a day away and what is a flight.",
    when: null,
    fills: { scope: "core", slot: "origin" },
    stage: "core",
    kind: "text",
    maxLength: MAX_NOTE_CHARS,
  },
  {
    id: "dates",
    prompt: "When are you going?",
    help: "Exact dates if you have them. “Ten nights sometime in spring” is a real answer, and a better one than a date you invented.",
    when: null,
    fills: { scope: "core", slot: "dates" },
    stage: "core",
    kind: "dates",
  },
  {
    id: "travellers",
    prompt: "How many people are going?",
    help: null,
    when: null,
    fills: { scope: "core", slot: "travellers" },
    stage: "core",
    kind: "number",
    min: 1,
    max: MAX_PARTY_SIZE,
    integer: true,
    unit: "people",
  },
  {
    id: "budget",
    prompt: "What is the budget?",
    help: "A figure or a feeling. Either is an answer, and neither is a price we will quote back.",
    when: null,
    fills: { scope: "core", slot: "budget" },
    stage: "core",
    kind: "budget",
  },
  {
    id: "effort",
    prompt: "How full should a day be?",
    help: "This is the number behind “not too much”, and the composer plans to it.",
    when: null,
    fills: { scope: "core", slot: "effort" },
    stage: "core",
    kind: "single-choice",
    choices: choicesOf(EFFORT_APPETITES, {
      gentle: "Gentle — a stroll and a long lunch",
      moderate: "Moderate — a full day out, and a sit down after it",
      demanding: "Demanding — long days, and the doing is the point",
      strenuous: "Strenuous — dawn starts under load, several days running",
    }),
  },

  // -------------------------------------------------------------------------
  // The shape's own essentials — still `core`, so they come before the draft
  // -------------------------------------------------------------------------
  {
    id: "road-trip.drive-hours",
    prompt: "How many hours behind the wheel on a normal day?",
    help: "Four is a comfortable day. Eight is a day you remember for the wrong reason.",
    when: ofShape("road-trip"),
    fills: { scope: "shape", shape: "road-trip", slot: "maxDailyDriveHours" },
    stage: "core",
    kind: "number",
    min: 1,
    // Below the slot's 24: a plan that puts sixteen hours of driving in a day is
    // not a plan, and refusing the answer is cheaper than composing around it.
    max: 14,
    integer: false,
    unit: "hours",
  },
  {
    id: "road-trip.vehicle",
    prompt: "What are you driving?",
    help: "A camper sleeps you; a rental has a one-way fee. Both change where a day can end.",
    when: ofShape("road-trip"),
    fills: { scope: "shape", shape: "road-trip", slot: "vehicle" },
    stage: "core",
    kind: "single-choice",
    choices: choicesOf(ROAD_VEHICLES, {
      "own-car": "Our own car",
      "rental-car": "A rental car",
      "camper-van": "A camper van",
      motorhome: "A motorhome",
    }),
  },
  {
    id: "backcountry.nights-out",
    prompt: "How many nights away from a road?",
    help: "It sets the pack, the food and the water, before anything else is decided.",
    when: ofShape("backcountry"),
    fills: { scope: "shape", shape: "backcountry", slot: "nightsOut" },
    stage: "core",
    kind: "number",
    min: 1,
    max: MAX_TRIP_NIGHTS,
    integer: true,
    unit: "nights",
  },
  {
    id: "backcountry.shelter",
    prompt: "Where are you sleeping out there?",
    help: "Huts book months ahead, so this is usually the deadline the whole trip runs on.",
    when: ofShape("backcountry"),
    fills: { scope: "shape", shape: "backcountry", slot: "shelter" },
    stage: "core",
    kind: "single-choice",
    choices: choicesOf(SHELTER_KINDS, {
      hut: "Huts — booked ahead, and worth the deadline",
      tent: "A tent, wherever we end up",
      either: "Either, whichever the route wants",
    }),
  },
  {
    id: "motorised-touring.machine",
    prompt: "What are you riding?",
    help: null,
    when: ofShape("motorised-touring"),
    fills: { scope: "shape", shape: "motorised-touring", slot: "machine" },
    stage: "core",
    kind: "single-choice",
    choices: choicesOf(MACHINES, {
      snowmobile: "A snowmobile",
      atv: "An ATV or side-by-side",
      motorcycle: "A motorcycle",
      boat: "A boat",
    }),
  },
  {
    id: "motorised-touring.machine-source",
    prompt: "Do you have the machine, or does it need renting?",
    help: "Rental availability is usually what decides where this trip can go, and when.",
    when: ofShape("motorised-touring"),
    fills: { scope: "shape", shape: "motorised-touring", slot: "machineSource" },
    stage: "core",
    kind: "single-choice",
    choices: choicesOf(MACHINE_SOURCES, {
      own: "We have our own",
      rental: "We will need to rent",
    }),
  },
  {
    id: "city-and-culture.pace",
    prompt: "How much should a day hold?",
    help: "Before opening hours are even consulted. Three things a day is a packed day.",
    when: ofShape("city-and-culture"),
    fills: { scope: "shape", shape: "city-and-culture", slot: "pace" },
    stage: "core",
    kind: "single-choice",
    choices: choicesOf(CITY_PACES, {
      packed: "Packed — we came to see it all",
      steady: "Steady — a couple of things, properly",
      slow: "Slow — one thing, and a long lunch after it",
    }),
  },
  {
    id: "city-and-culture.interests",
    prompt: "What are you there for?",
    help: "Pick as many as fit. Without this a city plan is a list of the obvious.",
    when: ofShape("city-and-culture"),
    fills: { scope: "shape", shape: "city-and-culture", slot: "interests" },
    stage: "core",
    kind: "multi-choice",
    choices: [
      { value: "museums", label: "Museums and galleries" },
      { value: "history", label: "History and ruins" },
      { value: "architecture", label: "Architecture" },
      { value: "food", label: "Food and drink" },
      { value: "music", label: "Music and nightlife" },
      { value: "markets", label: "Markets and shopping" },
      { value: "parks", label: "Parks and gardens" },
      { value: "walking", label: "Walking the place itself" },
    ],
  },
  {
    id: "resort.board-basis",
    prompt: "What should the rate include?",
    help: "It moves the budget more than anything else on a resort week.",
    when: ofShape("resort"),
    fills: { scope: "shape", shape: "resort", slot: "boardBasis" },
    stage: "core",
    kind: "single-choice",
    choices: choicesOf(BOARD_BASES, {
      "all-inclusive": "All-inclusive",
      "half-board": "Half board — breakfast and dinner",
      "bed-and-breakfast": "Bed and breakfast",
      "room-only": "Room only",
      any: "Whichever works out best",
    }),
  },
  {
    id: "multi-city.cities",
    prompt: "Which places, and in what order?",
    help: "One per line. Leave it to us if the order is not settled.",
    when: ofShape("multi-city"),
    fills: { scope: "shape", shape: "multi-city", slot: "cities" },
    stage: "core",
    kind: "text-list",
    maxLength: MAX_NOTE_CHARS,
    // Twelve stops is already a different kind of holiday; past that the tool
    // would be planning a tour, and it is not that tool.
    maxItems: 12,
  },
  {
    id: "multi-city.transport",
    prompt: "How are you getting between them?",
    help: "It decides which legs are possible at all, and how long each one eats.",
    when: ofShape("multi-city"),
    fills: { scope: "shape", shape: "multi-city", slot: "interCityTransport" },
    stage: "core",
    kind: "single-choice",
    choices: choicesOf(INTER_CITY_TRANSPORT, {
      train: "By train",
      plane: "By plane",
      car: "By car",
      bus: "By bus",
      any: "Whatever is best for each leg",
    }),
  },

  // -------------------------------------------------------------------------
  // Refining — everything past the checkpoint. Each of these improves a plan;
  // none of them prevents one, which is the bar `REQUIRED_*` draws.
  // -------------------------------------------------------------------------
  {
    id: "destination",
    prompt: "Where are you going?",
    help: "“Somewhere warm, you pick” is a real answer — skip this and we will treat choosing as part of the job.",
    when: null,
    fills: { scope: "core", slot: "destination" },
    stage: "refine",
    kind: "text",
    maxLength: MAX_NOTE_CHARS,
  },
  {
    id: "comfort",
    // Two ancestors, which is why the tree is a flat list with conditions
    // rather than a nested one: someone tenting in the backcountry has already
    // answered this, and asking again is how a guided intake looks careless.
    prompt: "What is the roughest night you would accept?",
    help: "A floor, not a preference. Lodging filters on it.",
    when: {
      kind: "not",
      of: {
        kind: "all",
        of: [
          ofShape("backcountry"),
          {
            kind: "equals",
            question: "backcountry.shelter",
            value: "tent",
          },
        ],
      },
    },
    fills: { scope: "core", slot: "comfort" },
    stage: "refine",
    kind: "single-choice",
    choices: choicesOf(COMFORT_FLOORS, {
      hotel: "A hotel bed and our own bathroom",
      simple: "Simple — motel, hostel, guesthouse; a shared bathroom is fine",
      rustic: "Rustic — a hut, a bunkroom, a cabin without plumbing",
      wild: "Wild — a tent, and whatever the ground is",
    }),
  },
  {
    id: "ages",
    prompt: "Are there ages that change the plan?",
    help: "A toddler, a teenager, a grandparent. Skip it if nobody's age matters.",
    when: null,
    fills: { scope: "core", slot: "ages" },
    stage: "refine",
    kind: "number-list",
    min: 0,
    max: 120,
    integer: true,
    maxItems: MAX_LIST_ITEMS,
    unit: "years",
  },
  {
    id: "access-needs",
    prompt: "Does anyone need something to be able to do this trip at all?",
    help: "Step-free access, a wheelchair, a medical or dietary need. It is a constraint, not a preference.",
    when: null,
    fills: { scope: "core", slot: "accessNeeds" },
    stage: "refine",
    kind: "text",
    maxLength: MAX_NOTE_CHARS,
  },
  {
    id: "deal-breakers",
    prompt: "Anything that would make this trip a failure?",
    help: "One per line. A plan that breaks one of these is not a plan we will show you.",
    when: null,
    fills: { scope: "core", slot: "dealBreakers" },
    stage: "refine",
    kind: "text-list",
    maxLength: MAX_NOTE_CHARS,
    maxItems: 10,
  },
  {
    id: "road-trip.route-style",
    prompt: "Does the drive come back to where it started?",
    help: "A one-way rental carries a fee worth planning around.",
    when: ofShape("road-trip"),
    fills: { scope: "shape", shape: "road-trip", slot: "routeStyle" },
    stage: "refine",
    kind: "single-choice",
    choices: choicesOf(ROUTE_STYLES, {
      loop: "A loop, back where we started",
      "one-way": "One way, finishing somewhere else",
    }),
  },
  {
    id: "road-trip.must-see",
    prompt: "Anywhere you already know you want to stop?",
    help: "Names, one per line — not an itinerary. Where they land is our problem.",
    when: ofShape("road-trip"),
    fills: { scope: "shape", shape: "road-trip", slot: "mustSee" },
    stage: "refine",
    kind: "text-list",
    maxLength: MAX_NOTE_CHARS,
    maxItems: 10,
  },
  {
    id: "backcountry.daily-distance",
    prompt: "How far are you willing to walk on a big day?",
    help: "Distance on a map, not on the flat — the route's climb is ours to account for.",
    when: ofShape("backcountry"),
    fills: { scope: "shape", shape: "backcountry", slot: "maxDailyDistanceKm" },
    stage: "refine",
    kind: "number",
    min: 1,
    max: 60,
    integer: false,
    unit: "km",
  },
  {
    id: "backcountry.experience",
    prompt: "How much of this have you done before?",
    help: "It changes what we propose, and what we say about the risk of it.",
    when: ofShape("backcountry"),
    fills: { scope: "shape", shape: "backcountry", slot: "experience" },
    stage: "refine",
    kind: "single-choice",
    choices: choicesOf(BACKCOUNTRY_EXPERIENCE, {
      "first-time": "This would be our first",
      some: "A few trips behind us",
      seasoned: "Seasoned — we know what we are doing",
    }),
  },
  {
    id: "motorised-touring.range-km",
    prompt: "How far can you go between fuel stops?",
    help: "The number that decides where a day can end.",
    when: ofShape("motorised-touring"),
    fills: { scope: "shape", shape: "motorised-touring", slot: "rangeKm" },
    stage: "refine",
    kind: "number",
    min: 20,
    max: 2_000,
    integer: false,
    unit: "km",
  },
  {
    id: "resort.setting",
    prompt: "What should it look out at?",
    help: null,
    when: ofShape("resort"),
    fills: { scope: "shape", shape: "resort", slot: "setting" },
    stage: "refine",
    kind: "single-choice",
    choices: choicesOf(RESORT_SETTINGS, {
      beach: "A beach",
      lake: "A lake",
      mountain: "Mountains",
      "spa-town": "A spa town",
      any: "No preference",
    }),
  },
  {
    id: "resort.on-site-musts",
    prompt: "What has to be on the property?",
    help: "Pick as many as fit. These are filters, so keep them to what you would move hotel over.",
    when: ofShape("resort"),
    fills: { scope: "shape", shape: "resort", slot: "onSiteMusts" },
    stage: "refine",
    kind: "multi-choice",
    choices: [
      { value: "pool", label: "A pool" },
      { value: "kids-club", label: "A kids' club" },
      { value: "spa", label: "A spa" },
      { value: "beach-access", label: "Direct beach access" },
      { value: "gym", label: "A gym" },
      { value: "several-restaurants", label: "More than one restaurant" },
      { value: "quiet", label: "Somewhere quiet — no entertainment programme" },
    ],
  },
  {
    id: "multi-city.min-nights",
    // Asked only once the places are named: "the fewest nights in any one of
    // them" is a question about a list, and there is no list until they say so.
    prompt: "What is the fewest nights worth spending in any one of them?",
    help: "It is how we stop a plan that spends a day and a half somewhere you wanted two nights.",
    when: {
      kind: "all",
      of: [ofShape("multi-city"), { kind: "answered", question: "multi-city.cities" }],
    },
    fills: { scope: "shape", shape: "multi-city", slot: "minNightsPerCity" },
    stage: "refine",
    kind: "number",
    min: 1,
    max: 14,
    integer: true,
    unit: "nights",
  },

  // -------------------------------------------------------------------------
  // The free-text slot per shape, last.
  //
  // §3's amendment names this as the mitigation for the one thing an authored
  // tree cannot do — follow up on something nobody anticipated — and is equally
  // clear that it is the weaker answer. It is context for a specialist to read,
  // never a place to smuggle structure back out of.
  // -------------------------------------------------------------------------
  {
    id: "road-trip.context",
    prompt: "Anything else about this drive we should know?",
    help: "Who is driving, what the car is like, roads you would rather avoid.",
    when: ofShape("road-trip"),
    fills: { scope: "shape", shape: "road-trip", slot: "context" },
    stage: "refine",
    kind: "text",
    maxLength: MAX_CONTEXT_CHARS,
  },
  {
    id: "backcountry.context",
    prompt: "Anything else about this route we should know?",
    help: "Fitness, gear you do not have, water you are worried about, a pass you have been warned off.",
    when: ofShape("backcountry"),
    fills: { scope: "shape", shape: "backcountry", slot: "context" },
    stage: "refine",
    kind: "text",
    maxLength: MAX_CONTEXT_CHARS,
  },
  {
    id: "motorised-touring.context",
    prompt: "Anything else about this ride we should know?",
    help: "Time on the machine, gear you own, trails or waters you already have in mind.",
    when: ofShape("motorised-touring"),
    fills: { scope: "shape", shape: "motorised-touring", slot: "context" },
    stage: "refine",
    kind: "text",
    maxLength: MAX_CONTEXT_CHARS,
  },
  {
    id: "city-and-culture.context",
    prompt: "Anything else about this week we should know?",
    help: "Somewhere you have already been, something you would rather avoid, a booking already made.",
    when: ofShape("city-and-culture"),
    fills: { scope: "shape", shape: "city-and-culture", slot: "context" },
    stage: "refine",
    kind: "text",
    maxLength: MAX_CONTEXT_CHARS,
  },
  {
    id: "resort.context",
    prompt: "Anything else about this stay we should know?",
    help: "An occasion, a property you already like, something that ruined the last one.",
    when: ofShape("resort"),
    fills: { scope: "shape", shape: "resort", slot: "context" },
    stage: "refine",
    kind: "text",
    maxLength: MAX_CONTEXT_CHARS,
  },
  {
    id: "multi-city.context",
    prompt: "Anything else about this route we should know?",
    help: "A stop you are unsure about, somewhere you have already been, a leg you would rather not take.",
    when: ofShape("multi-city"),
    fills: { scope: "shape", shape: "multi-city", slot: "context" },
    stage: "refine",
    kind: "text",
    maxLength: MAX_CONTEXT_CHARS,
  },
];

/**
 * The tree, versioned.
 *
 * **Bump `version` whenever `NODES` changes** — an added node, a changed
 * condition, a re-worded prompt. It is stored on an intake, so a tree that moved
 * under someone's saved answers is a fact the API can see rather than a silence.
 * Reusing an existing `id` for a different question is the one edit no version
 * bump can rescue: every saved answer under that id silently becomes an answer
 * to something else.
 */
export const QUESTION_TREE: QuestionTree = {
  version: 1,
  nodes: NODES,
};
