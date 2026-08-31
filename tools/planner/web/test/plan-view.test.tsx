// @vitest-environment jsdom

/**
 * The plan view's claims, held to.
 *
 * Every one of these is an honesty rule with a place in the analysis, and each
 * fails silently if it is dropped — a plan that has quietly stopped saying
 * which lines were checked still renders perfectly.
 *
 * - **A dateless day renders as a day.** `PlanDay.date` is null on every
 *   flexible-dates trip, which is a normal trip. No invented dates anywhere.
 * - **Provenance is per claim, and the two may disagree.** A real place with a
 *   guessed price is the common case.
 * - **A cost is a band, never a figure.** §5.
 * - **A gap says which of the two things happened**, from its own `detail`.
 * - **What was not checked is on the page**, beside the days.
 * - **A leg carries both its ends** (pl-15).
 * - **A plan is never a clearance to go** (§8).
 *
 * **The fake is the API client module, never `fetch`** — the same rule
 * `wizard.test.tsx` states and for the same reason.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  AppError,
  location,
  uncheckedConstraintKey,
  type Provenance,
  type UncheckedConstraint,
} from "@planner/contract";
import { fetchPlan, pinItem } from "../src/api/plan.ts";
import { PlanView } from "../src/plan/PlanView.tsx";
import { brief, candidate, day, item, planView, revision } from "./plan-fixtures.ts";

vi.mock("../src/api/plan.ts", () => ({
  fetchPlan: vi.fn(),
  pinItem: vi.fn(),
  fetchPlans: vi.fn(),
}));

const fetched = vi.mocked(fetchPlan);
const pinned = vi.mocked(pinItem);

beforeEach(() => {
  vi.clearAllMocks();
});

// `globals: false`, so Testing Library registers no cleanup of its own.
afterEach(cleanup);

const GROUNDED: Provenance = {
  kind: "grounded",
  sources: [
    {
      url: "https://example.org/museum",
      title: "The museum",
      fetchedAt: "2027-01-01T00:00:00.000Z",
    },
  ],
};

function show(): ReturnType<typeof render> {
  return render(<PlanView planId="plan-1" onExit={() => undefined} />);
}

describe("the days", () => {
  /**
   * A brief whose dates are a window or open has no calendar to hang a plan on,
   * and the day's identity is its index. A view that assumed one would break on
   * every flexible trip — and worse, would show a date nobody chose.
   */
  test("a dateless day renders by its index, and invents no date", async () => {
    const activity = candidate({ title: "A long walk" });
    fetched.mockResolvedValue(
      planView({
        brief: brief({ dates: { kind: "open", nights: 2 } }),
        candidates: [activity],
        revisions: [revision([day(0, [item({ candidateId: activity.id })], null)])],
      }),
    );

    show();

    expect(await screen.findByText("Day 1")).toBeDefined();
    // Nothing that looks like a date is on the page.
    expect(screen.queryByText(/\d{4}-\d{2}-\d{2}/)).toBeNull();
  });

  test("a day with a date shows it beside the index", async () => {
    const activity = candidate({ title: "A long walk" });
    fetched.mockResolvedValue(
      planView({
        candidates: [activity],
        revisions: [revision([day(0, [item({ candidateId: activity.id })], "2027-07-05")])],
      }),
    );

    show();

    expect(await screen.findByText("Day 1 · 2027-07-05")).toBeDefined();
  });

  /**
   * pl-15 made `location` a union so a drive stops hiding its endpoints in its
   * title. Rendering only `from` silently drops where it goes.
   */
  test("a leg shows both of its ends", async () => {
    const leg = candidate({
      specialist: "route-and-logistics",
      title: "The drive north",
      location: location.between(
        { name: "Montréal", locality: null, coordinates: null },
        { name: "Rimouski", locality: null, coordinates: { latitude: 48.4, longitude: -68.5 } },
      ),
    });
    fetched.mockResolvedValue(
      planView({
        candidates: [leg],
        revisions: [revision([day(0, [item({ candidateId: leg.id })])])],
      }),
    );

    show();

    expect(await screen.findByText(/Montréal → Rimouski/)).toBeDefined();
    // A leg can be half-grounded — coordinates on one end and not the other —
    // and the decision is to say nothing about coordinates until Phase 3 uses
    // them, rather than to report a distinction a reader cannot act on.
    expect(screen.queryByText(/48\.4|-68\.5|coordinate/i)).toBeNull();
  });
});

describe("provenance", () => {
  /**
   * §5's product decision: the UI can mark which lines were verified instead of
   * presenting everything with the same confidence. A candidate's provenance
   * and its cost's are **separate** and may disagree — a real place with a
   * guessed price — and the view has to be able to say exactly that.
   */
  test("a verified place with a guessed price says both", async () => {
    const museum = candidate({
      title: "The city museum",
      provenance: GROUNDED,
      cost: {
        currency: "EUR",
        low: 12,
        high: 18,
        basis: "per-person",
        provenance: { kind: "model-asserted" },
      },
    });
    fetched.mockResolvedValue(
      planView({
        candidates: [museum],
        revisions: [revision([day(0, [item({ candidateId: museum.id })])])],
      }),
    );

    show();

    expect(await screen.findByText(/this is something we read at a source/i)).toBeDefined();
    expect(screen.getByText(/the cost is the assistant talking/i)).toBeDefined();
    // The source is a link, and the page it points at is untrusted text.
    const link = screen.getByRole("link", { name: "The museum" });
    expect(link.getAttribute("href")).toBe("https://example.org/museum");
    expect(link.getAttribute("rel")).toContain("noreferrer");
  });

  test("an ungrounded candidate says so plainly", async () => {
    const guess = candidate({ title: "Some restaurant" });
    fetched.mockResolvedValue(
      planView({
        candidates: [guess],
        revisions: [revision([day(0, [item({ candidateId: guess.id })])])],
      }),
    );

    show();

    expect(await screen.findByText(/this is the assistant talking/i)).toBeDefined();
  });

  /**
   * pl-29: discovery makes `grounded` genuinely ambiguous — a database row
   * nobody vouched for is `grounded` in exactly the same sense a routing
   * engine's measured distance is. `Provenance` gains no member for the
   * difference, so the one sentence every grounded line renders has to be
   * true of both, and a reader must not be able to read it as an
   * endorsement — which the old "Checked ... was read from" wording, with its
   * checkmark-shaped badge, invited.
   */
  test("a sourced line never reads as a recommendation", async () => {
    const poi = candidate({ title: "A viewpoint nobody has reviewed", provenance: GROUNDED });
    fetched.mockResolvedValue(
      planView({
        candidates: [poi],
        revisions: [revision([day(0, [item({ candidateId: poi.id })])])],
      }),
    );

    show();

    expect(await screen.findByText(/is not recommending it/i)).toBeDefined();
    expect(screen.queryByText(/^Checked$/)).toBeNull();
  });
});

describe("costs", () => {
  /**
   * §5 ranks prices the fastest-ageing thing this tool touches, which is why
   * `CostEstimate` has no field for a single number. Rendering the midpoint or
   * the low end turns an estimate into a quote.
   */
  test("a cost renders as a band and never as one figure", async () => {
    const priced = candidate({
      title: "A boat trip",
      cost: {
        currency: "EUR",
        low: 40,
        high: 60,
        basis: "per-person",
        provenance: { kind: "model-asserted" },
      },
    });
    fetched.mockResolvedValue(
      planView({
        candidates: [priced],
        revisions: [revision([day(0, [item({ candidateId: priced.id })])])],
      }),
    );

    show();

    expect(await screen.findByText(/40–60 EUR, per person/)).toBeDefined();
    // The midpoint is the quote this rule exists to prevent.
    expect(screen.queryByText(/\b50 EUR\b/)).toBeNull();
  });

  /**
   * `low === high` is a genuinely fixed price — a museum's posted admission —
   * and the contract allows it as a *different claim* from a narrow estimate.
   * The acceptance line is about no **estimate** being shown as one figure, so
   * the figure is kept and labelled as posted. Flagged as an untested
   * interpretation by pl-10's review; this is the test that pins it.
   */
  test("a genuinely fixed price is labelled as posted, not shown as a bare figure", async () => {
    const museum = candidate({
      title: "The city museum",
      cost: {
        currency: "EUR",
        low: 20,
        high: 20,
        basis: "per-person",
        provenance: { kind: "model-asserted" },
      },
    });
    fetched.mockResolvedValue(
      planView({
        candidates: [museum],
        revisions: [revision([day(0, [item({ candidateId: museum.id })])])],
      }),
    );

    show();

    expect(await screen.findByText(/20 EUR, a posted price, per person/)).toBeDefined();
    // Never as a band it is not: "20–20" would read as an estimate.
    expect(screen.queryByText(/20–20/)).toBeNull();
  });

  test("a candidate nobody costed says so rather than showing nothing", async () => {
    const free = candidate({ title: "A wander" });
    fetched.mockResolvedValue(
      planView({
        candidates: [free],
        revisions: [revision([day(0, [item({ candidateId: free.id })])])],
      }),
    );

    show();

    expect(await screen.findByText(/nobody put a cost on this/i)).toBeDefined();
  });
});

describe("what is missing", () => {
  /**
   * `no-candidates-found` has two producers and two sentences: a specialist
   * that ran and returned nothing at all, and one that returned candidates and
   * got none of them onto a day. Both write `detail` for a reader, so the view
   * renders the gap's own words — a sentence per *reason* would throw away the
   * half that says which happened.
   */
  test("a gap shows its own sentence, in the plan body", async () => {
    const activity = candidate({ title: "A long walk" });
    fetched.mockResolvedValue(
      planView({
        candidates: [activity],
        revisions: [
          revision(
            [day(0, [item({ candidateId: activity.id })])],
            [
              {
                specialist: "lodging",
                reason: "no-candidates-found",
                detail:
                  "Nothing from this part of the plan made it onto a day: nothing it found fitted the days this trip has.",
              },
            ],
          ),
        ],
      }),
    );

    show();

    expect(await screen.findByText(/What this draft does not cover/i)).toBeDefined();
    expect(screen.getByText(/nothing it found fitted the days this trip has/i)).toBeDefined();
  });

  test("distinct reasons read as distinct sentences", async () => {
    const activity = candidate({ title: "A long walk" });
    fetched.mockResolvedValue(
      planView({
        candidates: [activity],
        revisions: [
          revision(
            [day(0, [item({ candidateId: activity.id })])],
            [
              {
                specialist: "lodging",
                reason: "specialist-failed",
                detail: "We could not reach the part of the plan that finds places to sleep.",
              },
              {
                specialist: "budget",
                reason: "specialist-not-applicable",
                detail: "This trip had nothing for the budget specialist to say.",
              },
            ],
          ),
        ],
      }),
    );

    show();

    expect(await screen.findByText(/We tried and could not/)).toBeDefined();
    expect(screen.getByText(/Nothing to say on this trip/)).toBeDefined();
  });

  /**
   * The one that matters most and is easiest to lose: a packed plan looks
   * equally finished whether every constraint was enforced or three were
   * skipped for want of data.
   */
  test("what was not checked is rendered beside the days", async () => {
    const activity = candidate({ title: "A long walk" });
    fetched.mockResolvedValue(
      planView({
        candidates: [activity],
        revisions: [revision([day(0, [item({ candidateId: activity.id })])])],
      }),
    );

    show();

    expect(await screen.findByText(/What was not checked/i)).toBeDefined();
    expect(screen.getByText(/Nothing here measured a distance/i)).toBeDefined();
  });

  /**
   * Two entries of one kind, which pl-27 made ordinary.
   *
   * `uncheckedFor` emitted at most one entry per kind until then, so the list
   * was keyed by `kind` and that was safe. `travel-time` now arrives up to
   * three times on one plan — moves within a day nothing could measure, the
   * overnight hops nothing ever measures, and lookups a run could not afford —
   * and **every plan a default deployment produces today has at least two**.
   *
   * Keyed by kind, React reconciles the second under the first: it warns on
   * every render, and on a re-render one entry's text can appear under the
   * other's position or an entry can vanish.
   *
   * Three assertions, and the middle one is load-bearing. Both sentences must
   * be on the page — but duplicate keys still render both children on a first
   * mount, so that alone proves nothing. The keys must be **distinct**, which
   * is a fact about the data and depends on no library's behaviour. And React
   * must have had nothing to say, which is the belt to that braces: kept, but
   * on its own it is a filter over a warning's prose, and a reworded message
   * would empty it silently.
   *
   * The same distinctness is asserted over the entries the composer actually
   * emits, for all six checked-in sets, in `@planner/itinerary`'s suite. This
   * one covers the pair this component renders.
   */
  test("renders two entries of the same kind, with no duplicate keys", async () => {
    const stop = candidate({ title: "The ferry at Matane", id: "cand-ferry" });
    const entries: UncheckedConstraint[] = [
      {
        kind: "travel-time",
        detail: "How long it takes to get to these from the thing before them was not checked.",
        candidateIds: [stop.id],
      },
      {
        kind: "travel-time",
        detail: "Getting from the end of one day to the start of the next was not checked.",
        candidateIds: [stop.id],
      },
    ];
    const warnings: unknown[][] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      warnings.push(args);
    });

    try {
      fetched.mockResolvedValue(
        planView({
          candidates: [stop],
          revisions: [revision([day(0, [item({ candidateId: stop.id })])])],
          unchecked: entries,
        }),
      );

      show();

      expect(await screen.findByText(/from the thing before them/)).toBeDefined();
      expect(screen.getByText(/end of one day to the start of the next/)).toBeDefined();
      expect(screen.getAllByText(/Travel time/i)).toHaveLength(2);

      // What the rendering above actually depends on, asserted directly: two
      // entries are two keys. Keyed by `kind` — what this component did until
      // pl-27 — they are one, which the second line states as a counterfactual
      // so the first cannot be mistaken for something trivially true.
      const keys = entries.map(uncheckedConstraintKey);
      expect(keys).toHaveLength(new Set(keys).size);
      expect(new Set(entries.map((each) => each.kind)).size).toBe(1);
    } finally {
      spy.mockRestore();
    }

    const duplicates = warnings.filter((args) =>
      args.some((arg) => typeof arg === "string" && arg.includes("same key")),
    );
    expect(duplicates).toEqual([]);
  });

  test("a constraint about particular items names them by title, never by id", async () => {
    const vague = candidate({ title: "An unmarked trail", id: "cand-vague" });
    fetched.mockResolvedValue(
      planView({
        candidates: [vague],
        revisions: [revision([day(0, [item({ candidateId: vague.id })])])],
        unchecked: [
          {
            kind: "season-unknown",
            detail: "Nobody established when these are open, so they were left in.",
            candidateIds: [vague.id],
          },
        ],
      }),
    );

    show();

    // Twice: once as the item's own title, once naming what the constraint
    // applies to. The id appears neither time.
    expect(await screen.findAllByText(/An unmarked trail/)).toHaveLength(2);
    expect(screen.queryByText(/cand-vague/)).toBeNull();
  });
});

describe("safety", () => {
  /**
   * §8, and it is permanent. The tool plans and hands off; it never implies it
   * has checked conditions.
   */
  test("a backcountry plan points at the authority and claims no clearance", async () => {
    const hike = candidate({ title: "The col" });
    fetched.mockResolvedValue(
      planView({
        brief: brief({ shape: "backcountry" }),
        candidates: [hike],
        revisions: [revision([day(0, [item({ candidateId: hike.id })])])],
      }),
    );

    show();

    expect(await screen.findByText(/avalanche bulletin/i)).toBeDefined();
    expect(screen.getByText(/Nothing here has looked at conditions/i)).toBeDefined();
  });

  test("an ordinary road trip carries no such notice", async () => {
    const stop = candidate({ title: "A diner" });
    fetched.mockResolvedValue(
      planView({
        candidates: [stop],
        revisions: [revision([day(0, [item({ candidateId: stop.id })])])],
      }),
    );

    show();

    await screen.findByText("A diner");
    expect(screen.queryByText(/avalanche|marine forecast/i)).toBeNull();
  });
});

describe("pinning", () => {
  test("pins through the client and renders what comes back", async () => {
    const activity = candidate({ title: "A long walk" });
    const placed = item({ candidateId: activity.id });
    fetched.mockResolvedValue(
      planView({
        candidates: [activity],
        revisions: [revision([day(0, [placed])])],
      }),
    );
    pinned.mockResolvedValue(
      planView({
        candidates: [activity],
        revisions: [revision([day(0, [{ ...placed, pinned: true }])])],
      }),
    );

    const user = userEvent.setup();
    show();

    await user.click(await screen.findByRole("button", { name: "Pin" }));

    expect(pinned).toHaveBeenCalledWith("plan-1", placed.id, true);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Pinned" })).toBeDefined();
    });
  });

  /**
   * The error most likely to arrive here is `ITEM_NOT_FOUND`, whose own copy
   * tells the reader to reload the plan and see the current draft. Throwing the
   * loaded document away over one stale item is the single response that makes
   * that advice impossible to follow — found by pl-10's review.
   */
  test("a pin that fails keeps the plan on screen and reports beside it", async () => {
    const activity = candidate({ title: "A long walk" });
    const placed = item({ candidateId: activity.id });
    fetched.mockResolvedValue(
      planView({
        candidates: [activity],
        revisions: [revision([day(0, [placed])])],
      }),
    );
    pinned.mockRejectedValue(
      new AppError("ITEM_NOT_FOUND", "That item is no longer part of this plan."),
    );

    const user = userEvent.setup();
    show();

    await user.click(await screen.findByRole("button", { name: "Pin" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/no longer part of this plan/i);
    });
    // The document is still there, and so is the item the pin was aimed at.
    expect(screen.getByText("A long walk")).toBeDefined();
    expect(screen.getByRole("button", { name: "Pin" })).toBeDefined();
  });
});

describe("a plan whose run has not finished", () => {
  test("says it has no draft rather than rendering an empty one", async () => {
    fetched.mockResolvedValue(planView({ revisions: [] }));

    show();

    expect(await screen.findByText(/no draft yet/i)).toBeDefined();
  });
});

/**
 * pl-35: a measured leg's OSM attribution is stored (`ItemTravel.measured`'s
 * `Provenance`) and was never shown. These pin that it now reaches the page —
 * once for the plan, not once per leg (see `TravelSources`'s own comment in
 * `PlanView.tsx` for why that shape was chosen and what was rejected).
 */
describe("travel sources", () => {
  const MEASURED_SOURCE = {
    url: "https://www.openstreetmap.org/copyright",
    title: "OpenStreetMap, routed by Valhalla",
    fetchedAt: "2027-01-01T00:00:00.000Z",
  };

  /**
   * Positive, and it is the half of the pair that actually proves something:
   * a negative-only suite (`queryByText(...).toBeNull()`) passes just as well
   * if `TravelSources` were deleted outright or never wired into `Document`.
   * This fails in exactly that case.
   */
  test("shows where a measured leg's distance and travel time came from, once for two legs that share a source", async () => {
    const first = candidate({ title: "A viewpoint" });
    const second = candidate({ title: "A lighthouse" });
    const third = candidate({ title: "A harbour" });
    const measured = {
      kind: "measured" as const,
      distanceMeters: 12_000,
      durationMinutes: 15,
      provenance: { kind: "grounded" as const, sources: [MEASURED_SOURCE] },
    };
    fetched.mockResolvedValue(
      planView({
        candidates: [first, second, third],
        revisions: [
          revision([
            day(0, [
              item({ candidateId: first.id }),
              // Two legs, both citing the exact same source -- the case that
              // actually exercises deduplication. A fixture with only one
              // measured leg would pass the "one link" assertion below
              // whether or not dedup exists at all.
              item({ candidateId: second.id, position: 1, travelFromPrevious: measured }),
              item({ candidateId: third.id, position: 2, travelFromPrevious: measured }),
            ]),
          ]),
        ],
      }),
    );

    show();

    expect(await screen.findByText(/distance and travel time on this plan/i)).toBeDefined();
    // The copy rule from pl-29's Provenance fix applies here too: a measured
    // leg is not an endorsement of anything, and the same sentence says so.
    expect(screen.getByText(/is not recommending it/i)).toBeDefined();
    // One link, not two, for the two legs that cite the same source -- dedup
    // is the point of the feature, not an incidental property of the fixture.
    expect(screen.getAllByRole("link", { name: "OpenStreetMap, routed by Valhalla" })).toHaveLength(
      1,
    );
  });

  test("shows nothing when nothing on the plan was measured", async () => {
    const activity = candidate({ title: "A long walk" });
    fetched.mockResolvedValue(
      planView({
        candidates: [activity],
        revisions: [
          revision([
            day(0, [
              item({ candidateId: activity.id, travelFromPrevious: { kind: "not-established" } }),
            ]),
          ]),
        ],
      }),
    );

    show();

    await screen.findByText("A long walk");
    expect(screen.queryByText(/distance and travel time on this plan/i)).toBeNull();
  });

  /**
   * pl-33 stored `PlanRevision.reading` and nothing rendered it — the third
   * instance of pl-35's "stored is not shown" shape, folded into pl-36 rather
   * than filed, because the render mirrors `TravelSources` two functions above
   * it and reuses the same `ProvenanceNote`.
   *
   * Positive first, and it is the half that proves something: it fails if
   * `RouteReading` were deleted or never wired into `Document`, which is
   * exactly the state this ticket found the field in.
   */
  test("shows what has been written about the route, without endorsing it", async () => {
    const activity = candidate({ title: "A long walk" });
    fetched.mockResolvedValue(
      planView({
        candidates: [activity],
        revisions: [
          revision(
            [day(0, [item({ candidateId: activity.id })])],
            [],
            [],
            [
              {
                url: "https://en.wikivoyage.org/wiki/Gasp%C3%A9sie",
                title: "Gaspésie — Wikivoyage",
                fetchedAt: "2027-01-01T00:00:00.000Z",
              },
            ],
          ),
        ],
      }),
    );

    show();

    expect(await screen.findByText(/background on this route/i)).toBeDefined();
    expect(screen.getAllByRole("link", { name: "Gaspésie — Wikivoyage" })).toHaveLength(1);
    // pl-29 Build step 6's copy rule, which matters more for this citation than
    // for any other: editorial coverage of a region is the one a reader is
    // likeliest to read as "the tool recommends going here".
    expect(screen.getAllByText(/is not recommending it/i).length).toBeGreaterThan(0);
  });

  test("shows nothing about the route when nothing was read about it", async () => {
    const activity = candidate({ title: "A long walk" });
    fetched.mockResolvedValue(
      planView({
        candidates: [activity],
        revisions: [revision([day(0, [item({ candidateId: activity.id })])])],
      }),
    );

    show();

    await screen.findByText("A long walk");
    expect(screen.queryByText(/background on this route/i)).toBeNull();
  });

  /**
   * pl-36. The two OSM services this tool talks to cite the **same** URL —
   * `openstreetmap.org/copyright` is the attribution page the ODbL asks for,
   * and deliberately not the deployment's own endpoint — and are told apart
   * only by their title. `travelSourcesOf` deduplicated on the URL alone, so
   * the moment a leg started citing its geocoder as well as its router (which
   * is the other half of this ticket) the plan would have credited one of the
   * two backends it actually used and silently dropped the other.
   */
  test("credits both OSM services when they share one attribution URL", async () => {
    const first = candidate({ title: "A ferry terminal" });
    const second = candidate({ title: "A lighthouse" });
    const measured = {
      kind: "measured" as const,
      distanceMeters: 12_000,
      durationMinutes: 15,
      provenance: {
        kind: "grounded" as const,
        sources: [
          MEASURED_SOURCE,
          {
            url: MEASURED_SOURCE.url,
            title: "OpenStreetMap, geocoded by Nominatim",
            fetchedAt: "2027-01-01T00:00:00.000Z",
          },
        ],
      },
    };
    fetched.mockResolvedValue(
      planView({
        candidates: [first, second],
        revisions: [
          revision([
            day(0, [
              item({ candidateId: first.id }),
              item({ candidateId: second.id, position: 1, travelFromPrevious: measured }),
            ]),
          ]),
        ],
      }),
    );

    // `ProvenanceNote` keys its source list, and a key of the URL alone is a
    // collision for exactly this pair. React does not fail on one — it warns
    // and renders both anyway — so the assertion above would stay green while
    // the list quietly became "unsupported and could change in a future
    // version". Spying is the only way to see it from here.
    const warned = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      show();

      await screen.findByText(/distance and travel time on this plan/i);
      expect(
        screen.getAllByRole("link", { name: "OpenStreetMap, routed by Valhalla" }),
      ).toHaveLength(1);
      expect(
        screen.getAllByRole("link", { name: "OpenStreetMap, geocoded by Nominatim" }),
      ).toHaveLength(1);
      expect(warned).not.toHaveBeenCalled();
    } finally {
      warned.mockRestore();
    }
  });
});
