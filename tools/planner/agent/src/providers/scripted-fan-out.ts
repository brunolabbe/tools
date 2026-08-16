/**
 * What the scripted provider answers when a specialist asks.
 *
 * The scripted model provider is the default and it must stay the default: a
 * fresh clone plans a trip with no key, no account and no bill, and CI has
 * something deterministic to assert against. That claim was true of one canned
 * sentence and is only worth anything once **the whole fan-out runs offline**,
 * which is this table.
 *
 * ## Keyed by shape and specialist, and by nothing else
 *
 * The provider reads the two machine-readable lines the system prompt opens with
 * — see `readMarkers` — and looks the pair up here. So every road trip gets the
 * same road-trip answers, which is exactly what "scripted" means and is why the
 * provider reports itself as `scripted` in `/api/health`: **a scripted assistant
 * must never be mistakable for a real one.**
 *
 * The six shapes are pl-3's and pl-4's checked-in briefs, and the answers are
 * written for those briefs. A pair with no entry answers with an empty list,
 * which is an honest "nothing to propose" and reaches the plan as a
 * `no-candidates-found` gap rather than as invented content.
 *
 * ## Everything here is inside the day it would be packed into
 *
 * pl-9 composed pl-4's six candidate sets and found the route candidates
 * routinely over the day's drive budget: the road-trip set proposes a 5½-hour
 * leg to a party who answered `half-day`, which is five hours, and the composer
 * drops every one of them. So the legs below are **split** — Montréal to Québec,
 * then Québec to Rimouski — rather than stated end to end, and the Vienna to
 * Ljubljana rail journey is two legs because one of them is over the moderate
 * day this party asked for. That is what a specialist is supposed to do with an
 * appetite answer, and this table is the worked example of it.
 *
 * Costs are bands and are never totalled here: `@planner/itinerary` sums them,
 * in code (§2). Coordinates are `null` throughout — grounding is Phase 3, and
 * this is a scripted provider, not a gazetteer.
 */

import { ALL_YEAR, location, MODEL_ASSERTED } from "@planner/contract";
import type {
  CandidateLocation,
  CostBasis,
  CostEstimate,
  Place,
  Specialist,
  TripShape,
} from "@planner/contract";
import type { CandidateProposal } from "../ask.ts";

// ---------------------------------------------------------------------------
// Shorthands, so the content below reads as content
// ---------------------------------------------------------------------------

function place(name: string, locality: string | null): Place {
  return { name, locality, coordinates: null };
}

function at(name: string, locality: string | null): CandidateLocation {
  return location.at(place(name, locality));
}

function between(from: [string, string | null], to: [string, string | null]): CandidateLocation {
  return location.between(place(from[0], from[1]), place(to[0], to[1]));
}

function money(currency: string, low: number, high: number, basis: CostBasis): CostEstimate {
  return { currency, low, high, basis, provenance: MODEL_ASSERTED };
}

function season(from: string, to: string): { from: string; to: string } {
  return { from, to };
}

interface Draft {
  title: string;
  summary: string;
  location: CandidateLocation;
  durationMinutes?: number;
  cost?: CostEstimate;
  season?: { from: string; to: string };
  bookingLeadTimeDays?: number;
}

/**
 * Every omitted field becomes `null`, which is what `null` means here: nobody
 * established it. Writing the nulls out longhand forty times would bury the
 * three fields that differ between one candidate and the next.
 */
function draft(input: Draft): CandidateProposal {
  return {
    title: input.title,
    summary: input.summary,
    location: input.location,
    durationMinutes: input.durationMinutes ?? null,
    cost: input.cost ?? null,
    season: input.season ?? null,
    bookingLeadTimeDays: input.bookingLeadTimeDays ?? null,
    provenance: MODEL_ASSERTED,
  };
}

// ---------------------------------------------------------------------------
// The script
// ---------------------------------------------------------------------------

export type ScriptedFanOut = Record<TripShape, Partial<Record<Specialist, CandidateProposal[]>>>;

export const SCRIPTED_FAN_OUT: ScriptedFanOut = {
  // A family of four, Montréal to the Gaspésie and back, nine days in July, and
  // a seven-year-old who is miserable after three hours in the car. Their drive
  // appetite is `half-day`, so no leg here is over five hours.
  "road-trip": {
    "route-and-logistics": [
      draft({
        title: "Montréal to Québec City on the 138",
        summary:
          "The river road rather than the 20. Slower by about an hour and it is the first day of the trip rather than a transfer.",
        location: between(["Montréal", "Québec, Canada"], ["Québec City", "Québec, Canada"]),
        durationMinutes: 210,
        cost: money("CAD", 45, 70, "per-party"),
        season: ALL_YEAR,
      }),
      draft({
        title: "Québec City to Rimouski along the 132",
        summary:
          "Four hours with the estuary on your left the whole way, and enough villages to stop in that nobody has to sit still for more than an hour.",
        location: between(["Québec City", "Québec, Canada"], ["Rimouski", "Québec, Canada"]),
        durationMinutes: 240,
        cost: money("CAD", 50, 80, "per-party"),
        season: ALL_YEAR,
      }),
      draft({
        title: "Rimouski to Sainte-Anne-des-Monts",
        summary:
          "The coast road as it turns north and the mountains start. Three hours, and the last hour is the reason for the drive.",
        location: between(
          ["Rimouski", "Québec, Canada"],
          ["Sainte-Anne-des-Monts", "Québec, Canada"],
        ),
        durationMinutes: 180,
        cost: money("CAD", 35, 55, "per-party"),
        season: season("04-15", "11-15"),
      }),
      draft({
        title: "Sainte-Anne-des-Monts to Percé around the tip",
        summary:
          "Four hours around the end of the peninsula. Split it at Grande-Vallée if the seven-year-old has had enough.",
        location: between(["Sainte-Anne-des-Monts", "Québec, Canada"], ["Percé", "Québec, Canada"]),
        durationMinutes: 255,
        cost: money("CAD", 55, 85, "per-party"),
        season: season("05-01", "10-31"),
      }),
    ],
    lodging: [
      draft({
        title: "Motel on the water at Sainte-Anne-des-Monts",
        summary:
          "Simple rooms with private bathrooms and a kitchenette, which makes a cheap dinner possible after a long day. Matches the simple comfort floor you gave.",
        location: at("Sainte-Anne-des-Monts", "Québec, Canada"),
        cost: money("CAD", 145, 210, "per-party"),
        season: season("05-15", "10-15"),
        bookingLeadTimeDays: 60,
      }),
      draft({
        title: "Auberge above the harbour at Percé",
        summary:
          "Family rooms, showers, and a view of the rock. Books out early for July, which is the deadline worth knowing.",
        location: at("Percé", "Québec, Canada"),
        cost: money("CAD", 165, 240, "per-party"),
        season: season("06-01", "10-01"),
        bookingLeadTimeDays: 120,
      }),
      draft({
        title: "Campground with showers at Rimouski",
        summary:
          "You said no more than one night in a campground without showers; this one has them, and a heated pool the children will not leave.",
        location: at("Rimouski", "Québec, Canada"),
        cost: money("CAD", 45, 70, "per-party"),
        season: season("05-20", "09-30"),
        bookingLeadTimeDays: 45,
      }),
    ],
    activities: [
      draft({
        title: "Forillon — Cap Bon Ami and the Mont-Saint-Alban loop",
        summary:
          "Half a day on foot with a lookout a seven-year-old can actually reach, and seals on the beach below most mornings.",
        location: at("Forillon National Park", "Gaspé, Québec"),
        durationMinutes: 240,
        cost: money("CAD", 0, 25, "per-party"),
        season: season("06-01", "10-15"),
        bookingLeadTimeDays: 0,
      }),
      draft({
        title: "Île Bonaventure by boat from Percé",
        summary:
          "The gannet colony, which is the loudest thing on the trip. Three hours including the crossing, and the boats stop for weather.",
        location: at("Île Bonaventure", "Percé, Québec"),
        durationMinutes: 180,
        cost: money("CAD", 90, 130, "per-party"),
        season: season("06-01", "10-10"),
        bookingLeadTimeDays: 7,
      }),
      draft({
        title: "Parc national de la Gaspésie — Lac aux Américains",
        summary:
          "Two hours to a cirque lake on an easy trail. You have not been to this park before, which was the point.",
        location: at("Parc national de la Gaspésie", "Québec, Canada"),
        durationMinutes: 150,
        cost: money("CAD", 0, 20, "per-party"),
        season: season("06-15", "10-01"),
      }),
    ],
    food: [
      draft({
        title: "Poissonnerie counter lunch at Sainte-Thérèse-de-Gaspé",
        summary:
          "Buy shrimp off the boat and eat it at a picnic table. Cheap, quick, and the thing the children will remember.",
        location: at("Sainte-Thérèse-de-Gaspé", "Québec, Canada"),
        durationMinutes: 60,
        cost: money("CAD", 30, 60, "per-party"),
        season: season("05-01", "09-30"),
      }),
      draft({
        title: "Fumoir and bakery stop at Sainte-Flavie",
        summary:
          "Smoked salmon and bread to eat in the car later, which is what makes an hour of driving after lunch bearable.",
        location: at("Sainte-Flavie", "Québec, Canada"),
        durationMinutes: 45,
        cost: money("CAD", 25, 45, "per-party"),
        season: season("05-01", "10-15"),
      }),
    ],
    budget: [
      draft({
        title: "What nine days on this route comes to",
        summary:
          "Roughly two thirds of it is beds and fuel. The figure assumes your own car, one restaurant meal a day and the rest bought in shops — say so if that is wrong, because it is the assumption the estimate turns on.",
        location: at("Gaspésie", "Québec, Canada"),
        cost: money("CAD", 2600, 3900, "per-party"),
      }),
    ],
  },

  // Two people, three nights hut to hut in the Chic-Chocs, some experience,
  // demanding effort, and a stated wish not to learn navigation in cloud.
  backcountry: {
    "route-and-logistics": [
      draft({
        title: "Québec City to the Mont-Albert trailhead",
        summary:
          "The drive in, five hours on the 132 and then the park road. Worth doing the evening before rather than on the first walking day.",
        location: between(
          ["Québec City", "Québec, Canada"],
          ["Gîte du Mont-Albert", "Parc national de la Gaspésie, Québec"],
        ),
        durationMinutes: 300,
        cost: money("CAD", 60, 95, "per-party"),
        season: ALL_YEAR,
      }),
      draft({
        title: "Mont-Albert plateau traverse to Refuge Le Carouge",
        summary:
          "Seven hours over the plateau with a long exposed section. Under cloud there is nothing to navigate by up there, which you said you would rather avoid — turn back at the plateau edge rather than commit.",
        location: between(
          ["Gîte du Mont-Albert", "Parc national de la Gaspésie, Québec"],
          ["Refuge Le Carouge", "Parc national de la Gaspésie, Québec"],
        ),
        durationMinutes: 420,
        season: season("06-24", "09-30"),
      }),
      draft({
        title: "Le Carouge to Refuge du Lac-Cascapédia",
        summary:
          "Six hours, mostly in trees and mostly downhill, with one river crossing that is ankle deep by late August.",
        location: between(
          ["Refuge Le Carouge", "Parc national de la Gaspésie, Québec"],
          ["Refuge du Lac-Cascapédia", "Parc national de la Gaspésie, Québec"],
        ),
        durationMinutes: 360,
        season: season("06-24", "09-30"),
      }),
    ],
    lodging: [
      draft({
        title: "Refuge Le Carouge",
        summary:
          "Bunkroom, wood stove, no plumbing — the rustic floor you gave. SEPAQ opens the season's reservations in January and the Chic-Chocs huts go quickly.",
        location: at("Refuge Le Carouge", "Parc national de la Gaspésie, Québec"),
        cost: money("CAD", 30, 45, "per-person"),
        season: season("06-15", "10-01"),
        bookingLeadTimeDays: 150,
      }),
      draft({
        title: "Refuge du Lac-Cascapédia",
        summary:
          "The same standard, on a lake, and the easier of the two to get a bed in at short notice.",
        location: at("Refuge du Lac-Cascapédia", "Parc national de la Gaspésie, Québec"),
        cost: money("CAD", 30, 45, "per-person"),
        season: season("06-15", "10-01"),
        bookingLeadTimeDays: 120,
      }),
    ],
    activities: [
      draft({
        title: "Mont Xalibu at first light",
        summary:
          "Three hours up and back from the valley for the one summit on this route that is worth a clear morning.",
        location: at("Mont Xalibu", "Parc national de la Gaspésie, Québec"),
        durationMinutes: 180,
        season: season("06-24", "09-30"),
      }),
      draft({
        title: "Caribou watching from the Mont-Albert plateau edge",
        summary:
          "Two hours sitting still. The herd is why parts of the plateau close, so read the closure map before you plan where to sit.",
        location: at("Mont-Albert plateau", "Parc national de la Gaspésie, Québec"),
        durationMinutes: 120,
        season: season("07-01", "09-30"),
      }),
    ],
    "conditions-and-gear": [
      draft({
        title: "Plateau weather, and what to carry for it",
        summary:
          "The plateau makes its own weather and can sit in cloud for a day at a time in either month you are looking at. Carry a compass and a paper map you have used before, full waterproofs, and a warm layer you would be happy to sleep in. This is a description, not a clearance to go: check SEPAQ's own conditions page and the park office on the morning.",
        location: at("Mont-Albert plateau", "Parc national de la Gaspésie, Québec"),
        season: season("06-01", "10-15"),
      }),
      draft({
        title: "The caribou closure, and where it bites",
        summary:
          "Sections of the plateau close for the herd and the closed sections move between seasons. The park authority is the only source for which ones are shut on your dates.",
        location: at("Parc national de la Gaspésie", "Québec, Canada"),
      }),
    ],
    practicalities: [
      draft({
        title: "Park entry and hut reservations through SEPAQ",
        summary:
          "Both huts and the daily park entry go through one account. Reservations for the summer open in the winter and the Chic-Chocs huts are the first to fill.",
        location: at("Parc national de la Gaspésie", "Québec, Canada"),
        cost: money("CAD", 10, 14, "per-person"),
        bookingLeadTimeDays: 150,
      }),
    ],
    budget: [
      draft({
        title: "What three nights out comes to",
        summary:
          "Huts and park entry are the whole fixed cost; food you carry and fuel to the trailhead are the rest. Shoestring is a comfortable answer for this trip.",
        location: at("Parc national de la Gaspésie", "Québec, Canada"),
        cost: money("CAD", 220, 380, "per-party"),
      }),
    ],
  },

  // Four riders out of Saguenay for three nights in deep winter, two of them
  // having never ridden, machines rented, and a stated preference for groomed
  // trail over anything off it.
  "motorised-touring": {
    "route-and-logistics": [
      draft({
        title: "Saguenay to Lac-Saint-Jean on Trans-Québec 83",
        summary:
          "Four hours on a wide groomed trail, which is the right first day for two riders who have not ridden. Fuel at Alma before the long section.",
        location: between(["Saguenay", "Québec, Canada"], ["Alma", "Québec, Canada"]),
        durationMinutes: 240,
        cost: money("CAD", 40, 70, "per-person"),
        season: season("12-20", "03-25"),
      }),
      draft({
        title: "Alma around the lake to Saint-Félicien",
        summary:
          "Five hours with two fuel stops inside your 180 km range and nothing technical on it.",
        location: between(["Alma", "Québec, Canada"], ["Saint-Félicien", "Québec, Canada"]),
        durationMinutes: 300,
        cost: money("CAD", 45, 80, "per-person"),
        season: season("12-20", "03-25"),
      }),
      draft({
        title: "Saint-Félicien back to Saguenay by the north shore trail",
        summary:
          "Three and a half hours home, groomed nightly, and the section most likely to be open at the thin end of the season.",
        location: between(["Saint-Félicien", "Québec, Canada"], ["Saguenay", "Québec, Canada"]),
        durationMinutes: 210,
        cost: money("CAD", 35, 60, "per-person"),
        season: season("12-15", "03-31"),
      }),
    ],
    lodging: [
      draft({
        title: "Relais on the trail at Alma",
        summary:
          "Rooms you can walk to from where the machines are parked, a drying room, and dinner served late. Simple, which is the floor you gave.",
        location: at("Alma", "Québec, Canada"),
        cost: money("CAD", 180, 260, "per-party"),
        season: season("12-01", "04-01"),
        bookingLeadTimeDays: 45,
      }),
      draft({
        title: "Auberge at Saint-Félicien",
        summary:
          "The same standard on the far side of the lake, and the only one on this loop with heated garage space.",
        location: at("Saint-Félicien", "Québec, Canada"),
        cost: money("CAD", 195, 275, "per-party"),
        season: season("12-01", "04-01"),
        bookingLeadTimeDays: 45,
      }),
    ],
    activities: [
      draft({
        title: "Ice fishing on Lac-Saint-Jean, cabin rented for the morning",
        summary:
          "Three hours in a heated hut with the gear included. It is the thing to do on the day the trail is being regroomed.",
        location: at("Lac Saint-Jean", "Québec, Canada"),
        durationMinutes: 180,
        cost: money("CAD", 45, 80, "per-person"),
        season: season("01-10", "03-10"),
        bookingLeadTimeDays: 14,
      }),
      draft({
        title: "Zoo sauvage de Saint-Félicien in the snow",
        summary:
          "Two hours, warm between enclosures, and open all winter — which is more than most of what is out there in February.",
        location: at("Saint-Félicien", "Québec, Canada"),
        durationMinutes: 120,
        cost: money("CAD", 35, 50, "per-person"),
        season: season("12-01", "03-31"),
      }),
    ],
    "conditions-and-gear": [
      draft({
        title: "Trail conditions, and the two riders who have not ridden",
        summary:
          "Trails are groomed on a published schedule and close outright in a thaw. Everyone needs a helmet with a heated visor, a face cover and boots rated well below what the day looks like. Nothing here is clearance to ride: the club that grooms these trails publishes their state daily and that is the only source worth acting on.",
        location: at("Saguenay–Lac-Saint-Jean", "Québec, Canada"),
        season: season("12-01", "04-01"),
      }),
      draft({
        title: "Ice on the lake crossings",
        summary:
          "Parts of the marked route cross the lake and their state changes week to week. The local club's ice report decides whether the crossing is on, and no plan should assume it.",
        location: at("Lac Saint-Jean", "Québec, Canada"),
        season: season("01-01", "03-15"),
      }),
    ],
    practicalities: [
      draft({
        title: "Machine rental, trail passes and the insurance that comes with them",
        summary:
          "Rental includes a daily trail pass in most cases and a damage deductible in all of them. Two of the four have no experience, which some outfitters price differently and some refuse — ask before you book.",
        location: at("Saguenay", "Québec, Canada"),
        cost: money("CAD", 320, 480, "per-person"),
        bookingLeadTimeDays: 60,
      }),
    ],
    budget: [
      draft({
        title: "What a three-night rented tour comes to",
        summary:
          "The machines are more than half of it. Fuel, beds and food are the rest, and 900 per person is comfortable for this loop rather than tight.",
        location: at("Saguenay–Lac-Saint-Jean", "Québec, Canada"),
        cost: money("CAD", 700, 950, "per-person"),
      }),
    ],
  },

  // Two people in their late sixties, a week in Rome in October, a slow pace,
  // cobbles and unhandrailed stairs difficult, nothing before nine, and no
  // guided groups. Every day holds about three hours and about two things.
  "city-and-culture": {
    lodging: [
      draft({
        title: "Hotel in the Campo Marzio, lift to every floor",
        summary:
          "Flat streets around it, a lift rather than the stairs most buildings in the centre have, and inside walking distance of half the list below.",
        location: at("Campo Marzio", "Rome, Italy"),
        cost: money("EUR", 180, 260, "per-party"),
        season: ALL_YEAR,
        bookingLeadTimeDays: 90,
      }),
      draft({
        title: "Apartment near Piazza Navona with a lift",
        summary:
          "Cheaper across a week and a kitchen for the mornings. Confirm the lift reaches the floor rather than the landing below it; that distinction is common here.",
        location: at("Piazza Navona", "Rome, Italy"),
        cost: money("EUR", 150, 220, "per-party"),
        season: ALL_YEAR,
        bookingLeadTimeDays: 120,
      }),
    ],
    activities: [
      draft({
        title: "Palazzo Massimo alle Terme, a whole morning",
        summary:
          "The Roman frescoes and the mosaics, on four floors with a lift. Quiet, seatable, and the one place in Rome where a whole morning in one building is obviously the right idea.",
        location: at("Palazzo Massimo alle Terme", "Rome, Italy"),
        durationMinutes: 150,
        cost: money("EUR", 12, 18, "per-person"),
        season: ALL_YEAR,
        bookingLeadTimeDays: 1,
      }),
      draft({
        title: "Galleria Borghese, booked slot",
        summary:
          "Two hours by the ticket's own rule, which suits a slow day. Baroque painting is most of the upper floor. Entry is timed and sells out weeks ahead.",
        location: at("Galleria Borghese", "Rome, Italy"),
        durationMinutes: 120,
        cost: money("EUR", 15, 25, "per-person"),
        season: ALL_YEAR,
        bookingLeadTimeDays: 30,
      }),
      draft({
        title: "Capitoline Museums by the lift from the back",
        summary:
          "The Cordonata is a long ramp and there is a lift from Via delle Tre Pile that avoids it. Two and a half hours, most of it flat.",
        location: at("Capitoline Museums", "Rome, Italy"),
        durationMinutes: 150,
        cost: money("EUR", 13, 20, "per-person"),
        season: ALL_YEAR,
      }),
      draft({
        title: "Ostia Antica, half a day by train",
        summary:
          "Roman archaeology without the crowds, and the ground is uneven — worth an unhurried three hours and a stick. The train leaves from Porta San Paolo and is step-free at both ends.",
        location: at("Ostia Antica", "Rome, Italy"),
        durationMinutes: 180,
        cost: money("EUR", 18, 26, "per-person"),
        season: season("03-01", "11-15"),
      }),
      draft({
        title: "Mercato di Testaccio, late morning",
        summary:
          "A covered market on flat ground, an hour and a half at a stroll, and it is a market rather than a monument — which is a different sort of day.",
        location: at("Testaccio", "Rome, Italy"),
        durationMinutes: 90,
        season: ALL_YEAR,
      }),
    ],
    food: [
      draft({
        title: "Sit-down lunch in Testaccio",
        summary:
          "The neighbourhood the Roman dishes come from, and lunch there is an hour and a half rather than a queue.",
        location: at("Testaccio", "Rome, Italy"),
        durationMinutes: 90,
        cost: money("EUR", 25, 45, "per-person"),
      }),
      draft({
        title: "Breakfast at the bar on the corner",
        summary:
          "Standing at the counter costs a third of sitting down. Half an hour, and it is how the morning starts here.",
        location: at("Campo Marzio", "Rome, Italy"),
        durationMinutes: 30,
        cost: money("EUR", 3, 8, "per-person"),
      }),
    ],
    practicalities: [
      draft({
        title: "Passports, and the entry authorisation for the EU",
        summary:
          "Canadian passports need six months left on them and the EU's travel authorisation is expected to be in force by then. Check the government's own page nearer the date; this is the one thing on the list that changes.",
        location: at("Toronto", "Ontario, Canada"),
        cost: money("EUR", 7, 14, "per-person"),
        bookingLeadTimeDays: 60,
      }),
    ],
    budget: [
      draft({
        title: "What a slow week in Rome comes to at 350 a day",
        summary:
          "Beds are about half. Two museums a day and one sit-down meal fits inside your figure with room; four museums a day would not, which is a reason to be glad of the pace you asked for.",
        location: at("Rome", "Italy"),
        cost: money("EUR", 1400, 2100, "per-party"),
      }),
    ],
  },

  // A family of five including a two-year-old, a week somewhere warm they do not
  // intend to leave, all-inclusive, and no dates chosen. Nothing here is a
  // transfer: §4 is explicit that a route specialist on a resort week produces
  // noise about airport transfers, and it is not on this roster.
  resort: {
    lodging: [
      draft({
        title: "All-inclusive family property, Riviera Maya",
        summary:
          "Shallow pool a two-year-old can stand in, a kids' club that takes a six-year-old, and a beach you walk onto. Every meal is in the rate, which was the point.",
        location: at("Riviera Maya", "Quintana Roo, Mexico"),
        cost: money("CAD", 3400, 5200, "per-party"),
        season: season("11-15", "04-30"),
        bookingLeadTimeDays: 120,
      }),
      draft({
        title: "All-inclusive on the Atlantic coast, Dominican Republic",
        summary:
          "The same shape for less money and a longer flight. Two connecting pools and a kids' club from four rather than six, which is worth checking against your six-year-old.",
        location: at("Punta Cana", "Dominican Republic"),
        cost: money("CAD", 2900, 4400, "per-party"),
        season: season("12-01", "04-15"),
        bookingLeadTimeDays: 120,
      }),
    ],
    activities: [
      draft({
        title: "Kids' club morning, both older children",
        summary:
          "Three hours that are already paid for, and the reason a resort week is restful for the adults rather than the same week somewhere else.",
        location: at("Riviera Maya", "Quintana Roo, Mexico"),
        durationMinutes: 180,
      }),
      draft({
        title: "Cenote swim, half an hour from the property",
        summary:
          "Two hours including getting there. The one thing on this list that means leaving, and it is worth one morning of the week.",
        location: at("Riviera Maya", "Quintana Roo, Mexico"),
        durationMinutes: 120,
        cost: money("CAD", 120, 200, "per-party"),
        season: ALL_YEAR,
      }),
      draft({
        title: "Beach afternoon with the shallow end of the pool as a fallback",
        summary:
          "Two hours, and the fallback matters: the sea is not always calm enough for a two-year-old and the pool always is.",
        location: at("Riviera Maya", "Quintana Roo, Mexico"),
        durationMinutes: 120,
      }),
    ],
    practicalities: [
      draft({
        title: "Passports for the children, and the entry form",
        summary:
          "Every child needs their own passport and the two-year-old's takes the longest to come back. The entry form is filled online in the week before you fly.",
        location: at("Ottawa", "Ontario, Canada"),
        cost: money("CAD", 57, 120, "per-person"),
        bookingLeadTimeDays: 180,
      }),
    ],
    budget: [
      draft({
        title: "What a week all-inclusive comes to for five",
        summary:
          "The property and the flights are almost the whole of it. Seven thousand is workable for the Riviera Maya in the low season and tight over Christmas, which is the assumption to argue with.",
        location: at("Riviera Maya", "Quintana Roo, Mexico"),
        cost: money("CAD", 6000, 9000, "per-party"),
      }),
    ],
  },

  // Two people, twelve nights, Vienna to Ljubljana to Trieste by train, no
  // internal flights, moderate effort — which is a five-hour day, so the rail
  // journey the fixture stated as one six-hour leg is two legs here.
  "multi-city": {
    "route-and-logistics": [
      draft({
        title: "Vienna to Graz by rail",
        summary:
          "Two and a half hours over the Semmering, which is the good half of this journey to do in daylight. Broken here rather than run through to Ljubljana, because six hours is more than a moderate day holds.",
        location: between(
          ["Wien Hauptbahnhof", "Vienna, Austria"],
          ["Graz Hauptbahnhof", "Graz, Austria"],
        ),
        durationMinutes: 150,
        cost: money("EUR", 20, 45, "per-person"),
        season: ALL_YEAR,
        bookingLeadTimeDays: 60,
      }),
      draft({
        title: "Graz to Ljubljana by rail",
        summary:
          "Three hours with one change at Maribor. Slower than the map suggests and the reason the whole journey wants two days rather than one.",
        location: between(["Graz Hauptbahnhof", "Graz, Austria"], ["Ljubljana", "Slovenia"]),
        durationMinutes: 180,
        cost: money("EUR", 18, 40, "per-person"),
        season: ALL_YEAR,
        bookingLeadTimeDays: 30,
      }),
      draft({
        title: "Ljubljana to Trieste by bus, not train",
        summary:
          "Under two hours by bus against half a day by rail with a change at Villa Opicina. You said no internal flights; you did not say no buses, and this is the leg where that matters.",
        location: between(["Ljubljana bus station", "Ljubljana, Slovenia"], ["Trieste", "Italy"]),
        durationMinutes: 110,
        cost: money("EUR", 10, 18, "per-person"),
        season: ALL_YEAR,
        bookingLeadTimeDays: 7,
      }),
    ],
    lodging: [
      draft({
        title: "Hotel in Vienna's first district",
        summary:
          "Four nights, walkable to everything you would go to Vienna for, and on the tram line from the station.",
        location: at("Innere Stadt", "Vienna, Austria"),
        cost: money("EUR", 140, 200, "per-party"),
        season: ALL_YEAR,
        bookingLeadTimeDays: 60,
      }),
      draft({
        title: "Hotel by the river in Ljubljana",
        summary:
          "Four nights in a small centre you will not need transport inside. Books out in late spring, which is when you are going.",
        location: at("Ljubljana", "Slovenia"),
        cost: money("EUR", 110, 165, "per-party"),
        season: ALL_YEAR,
        bookingLeadTimeDays: 75,
      }),
      draft({
        title: "Hotel on Piazza Unità, Trieste",
        summary:
          "Four nights facing the sea. The city is small enough that where you stay decides most of the walking.",
        location: at("Trieste", "Italy"),
        cost: money("EUR", 120, 180, "per-party"),
        season: ALL_YEAR,
        bookingLeadTimeDays: 60,
      }),
    ],
    activities: [
      draft({
        title: "Kunsthistorisches Museum, Vienna",
        summary:
          "Three hours and you will have seen a third of it, which is the right way to use it.",
        location: at("Kunsthistorisches Museum", "Vienna, Austria"),
        durationMinutes: 180,
        cost: money("EUR", 18, 22, "per-person"),
        season: ALL_YEAR,
      }),
      draft({
        title: "Lake Bled, morning out of Ljubljana",
        summary:
          "Four hours including the bus each way, which is what fits a moderate day. A whole day there is possible and would use the whole day.",
        location: at("Lake Bled", "Slovenia"),
        durationMinutes: 240,
        cost: money("EUR", 20, 45, "per-person"),
        season: season("04-01", "10-31"),
      }),
      draft({
        title: "Miramare castle and the shore path, Trieste",
        summary:
          "Two and a half hours, most of it outside, and the walk back along the water is the better half.",
        location: at("Castello di Miramare", "Trieste, Italy"),
        durationMinutes: 150,
        cost: money("EUR", 10, 15, "per-person"),
        season: season("03-01", "11-15"),
      }),
    ],
    food: [
      draft({
        title: "Osmize in the Carso above Trieste",
        summary:
          "Farmhouses that open for a few weeks a year to sell their own wine and ham. Which ones are open is decided week by week and posted locally.",
        location: at("Carso", "Trieste, Italy"),
        durationMinutes: 180,
        cost: money("EUR", 15, 35, "per-person"),
      }),
      draft({
        title: "Naschmarkt lunch, Vienna",
        summary:
          "An hour and a half at a stall rather than a table, and cheaper than anything inside the Ring.",
        location: at("Naschmarkt", "Vienna, Austria"),
        durationMinutes: 90,
        cost: money("EUR", 12, 28, "per-person"),
        season: ALL_YEAR,
      }),
    ],
    practicalities: [
      draft({
        title: "One booking account for the Austrian and Slovenian legs",
        summary:
          "ÖBB sells the Vienna and Graz legs and the cheap fares are quota-limited months out. The Ljubljana to Trieste bus is bought separately and rarely sells out.",
        location: at("Vienna", "Austria"),
        bookingLeadTimeDays: 90,
      }),
      draft({
        title: "Three countries, one Schengen area",
        summary:
          "Austria, Slovenia and Italy are all inside it, so there is no border formality between them. Canadian passports still need six months left.",
        location: at("Halifax", "Nova Scotia, Canada"),
        bookingLeadTimeDays: 60,
      }),
    ],
    budget: [
      draft({
        title: "What twelve nights across three cities comes to",
        summary:
          "Beds are about half and the trains are less than people expect. Comfortable is a fair description of this itinerary at these prices.",
        location: at("Central Europe", null),
        cost: money("EUR", 3200, 4800, "per-party"),
      }),
    ],
  },
};
