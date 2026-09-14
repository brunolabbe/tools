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
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  AppError,
  location,
  uncheckedConstraintKey,
  type Provenance,
  type Run,
  type UncheckedConstraint,
} from "@planner/contract";
import { editPlan, fetchPlan, pinItem, startReplan } from "../src/api/plan.ts";
import { PlanView } from "../src/plan/PlanView.tsx";
import {
  addedEntry,
  brief,
  candidate,
  day,
  diffPlacement,
  item,
  movedEntry,
  planView,
  removedEntry,
  revision,
  revisionDiff,
} from "./plan-fixtures.ts";

vi.mock("../src/api/plan.ts", () => ({
  fetchPlan: vi.fn(),
  pinItem: vi.fn(),
  fetchPlans: vi.fn(),
  editPlan: vi.fn(),
  startReplan: vi.fn(),
}));

const fetched = vi.mocked(fetchPlan);
const pinned = vi.mocked(pinItem);
const edited = vi.mocked(editPlan);
const replanned = vi.mocked(startReplan);

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

function show(
  options: {
    onReplan?: (run: Run) => void;
    onWatchRun?: (runId: string, planId: string) => void;
  } = {},
): ReturnType<typeof render> {
  return render(
    <PlanView
      planId="plan-1"
      onExit={() => undefined}
      onReplan={options.onReplan ?? (() => undefined)}
      onWatchRun={options.onWatchRun ?? (() => undefined)}
    />,
  );
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

    // A heading, not a bare text match: pl-45's re-plan form names its own
    // day checkbox the same way (`dayHeading`, reused on purpose), so a plain
    // `findByText` is ambiguous the moment that control is on the page too.
    expect(await screen.findByRole("heading", { name: "Day 1", level: 3 })).toBeDefined();
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

    expect(
      await screen.findByRole("heading", { name: "Day 1 · 2027-07-05", level: 3 }),
    ).toBeDefined();
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

/**
 * pl-45: revise, pick a version, and read the diff.
 *
 * The fake is the API client module here too — `editPlan` and `startReplan`
 * beside `pinItem`, never `fetch`.
 */
describe("versions", () => {
  test("the picker moves between revisions, and the crumb's text at the latest is unchanged", async () => {
    const activity = candidate({ title: "A long walk" });
    const first = revision([day(0, [item({ candidateId: activity.id })])]);
    const second = revision([day(0, [item({ candidateId: activity.id })])], [], [], [], {
      revision: 2,
      reason: "Moved the hike to Thursday.",
    });
    fetched.mockResolvedValue(planView({ candidates: [activity], revisions: [first, second] }));

    const user = userEvent.setup();
    show();

    // Literal-string, not a substring: this is the text pl-19's e2e checks.
    expect(await screen.findByText("Version 2 of 2 · Moved the hike to Thursday.")).toBeDefined();

    await user.selectOptions(screen.getByLabelText("Version"), "1");

    expect(await screen.findByText("Version 1 of 2 · The first draft.")).toBeDefined();
  });

  test("restoring an older version sends baseRevisionId from the latest revision, not the one on screen", async () => {
    const activity = candidate({ title: "A long walk" });
    const first = revision([day(0, [item({ candidateId: activity.id })])]);
    const second = revision([day(0, [item({ candidateId: activity.id })])], [], [], [], {
      revision: 2,
      reason: "Moved the hike to Thursday.",
    });
    fetched.mockResolvedValue(planView({ candidates: [activity], revisions: [first, second] }));
    edited.mockResolvedValue(planView({ candidates: [activity], revisions: [first, second] }));

    const user = userEvent.setup();
    show();

    await user.selectOptions(await screen.findByLabelText("Version"), "1");
    await user.click(screen.getByRole("button", { name: "Restore this version" }));

    expect(edited).toHaveBeenCalledWith("plan-1", {
      kind: "restore",
      baseRevisionId: second.id,
      revision: 1,
    });
  });

  test("what was not checked only ever describes the latest revision", async () => {
    const activity = candidate({ title: "A long walk" });
    const first = revision([day(0, [item({ candidateId: activity.id })])]);
    const second = revision([day(0, [item({ candidateId: activity.id })])], [], [], [], {
      revision: 2,
    });
    fetched.mockResolvedValue(planView({ candidates: [activity], revisions: [first, second] }));

    const user = userEvent.setup();
    show();

    expect(await screen.findByText(/What was not checked/i)).toBeDefined();

    await user.selectOptions(screen.getByLabelText("Version"), "1");

    expect(screen.queryByText(/What was not checked/i)).toBeNull();
  });

  test("move, remove and re-plan are absent on an older revision, with copy saying why", async () => {
    const activity = candidate({ title: "A long walk" });
    const first = revision([day(0, [item({ candidateId: activity.id })])]);
    const second = revision([day(0, [item({ candidateId: activity.id })])], [], [], [], {
      revision: 2,
    });
    fetched.mockResolvedValue(planView({ candidates: [activity], revisions: [first, second] }));

    const user = userEvent.setup();
    show();

    await user.selectOptions(await screen.findByLabelText("Version"), "1");

    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Move" })).toBeNull();
    expect(screen.queryByText("Re-plan some days")).toBeNull();
    expect(await screen.findByText(/Editing works on the latest version/i)).toBeDefined();
  });

  test("Restore this version is absent when the latest revision is shown", async () => {
    const activity = candidate({ title: "A long walk" });
    const first = revision([day(0, [item({ candidateId: activity.id })])]);
    const second = revision([day(0, [item({ candidateId: activity.id })])], [], [], [], {
      revision: 2,
    });
    fetched.mockResolvedValue(planView({ candidates: [activity], revisions: [first, second] }));

    show();

    await screen.findByText("A long walk");
    expect(screen.queryByRole("button", { name: "Restore this version" })).toBeNull();
  });

  test("a successful edit returns the reader to the new latest, not the page they were on", async () => {
    const activity = candidate({ title: "A long walk" });
    const placed = item({ candidateId: activity.id });
    const first = revision([day(0, [placed])]);
    const second = revision([day(0, [{ ...placed, position: 0 }])], [], [], [], {
      revision: 2,
      reason: "Removed something.",
    });
    fetched.mockResolvedValue(planView({ candidates: [activity], revisions: [first] }));
    edited.mockResolvedValue(planView({ candidates: [activity], revisions: [first, second] }));

    const user = userEvent.setup();
    show();

    await user.click(await screen.findByRole("button", { name: "Remove" }));

    // The new latest is on screen, not the revision the reader was looking at
    // when they asked for the edit — the restore case's own rule, extended.
    expect(await screen.findByText("Version 2 of 2 · Removed something.")).toBeDefined();
  });
});

describe("the diff", () => {
  /**
   * `rev3` is shown (the latest, the default — no picker interaction needed),
   * and `diffs` is ordered so that **every** plausible positional scheme
   * lands on the wrong entry, not just a raw `diffs[i]`:
   *
   * - `diffs[revisions.indexOf(shown)]` is `diffs[2]` — out of bounds on this
   *   two-element array, so it renders nothing rather than the real diff.
   * - `diffs[shown.revision - 2]` (diffs start at revision 2) and
   *   `diffs[revisions.indexOf(shown) - 1]` both land on `diffs[1]`, which is
   *   `diffForRev2` — a different revision's diff, wrong on its face.
   *
   * Only a lookup by `revisionId` finds `diffForRev3`, wherever it sits in
   * the array.
   */
  test("resolves by revisionId, not by array index", async () => {
    const first = candidate({ title: "A viewpoint" });
    const second = candidate({ title: "A lighthouse" });
    const rev1 = revision([day(0, [item({ candidateId: first.id })])]);
    const rev2 = revision([day(0, [item({ candidateId: first.id })])], [], [], [], {
      revision: 2,
      reason: "Nothing changed here.",
    });
    const rev3 = revision(
      [day(0, [item({ candidateId: first.id }), item({ candidateId: second.id, position: 1 })])],
      [],
      [],
      [],
      { revision: 3, reason: "Added the lighthouse." },
    );
    // A real and empty diff — rev2 changed nothing from rev1.
    const diffForRev2 = revisionDiff(rev2.id, rev1.id, []);
    const diffForRev3 = revisionDiff(rev3.id, rev2.id, [
      addedEntry(second.id, diffPlacement(0, 1)),
    ]);

    fetched.mockResolvedValue(
      planView({
        candidates: [first, second],
        revisions: [rev1, rev2, rev3],
        // See the block comment above for why this exact order and this exact
        // shown revision defeat every index-based scheme at once.
        diffs: [diffForRev3, diffForRev2],
      }),
    );

    show();

    expect(await screen.findByText("A lighthouse — Day 1")).toBeDefined();
  });

  test("renders added, removed and moved entries as three short lists, never as prose", async () => {
    const first = candidate({ title: "A viewpoint" });
    const second = candidate({ title: "A lighthouse" });
    const third = candidate({ title: "A diner" });
    const rev1 = revision([
      day(0, [item({ candidateId: first.id }), item({ candidateId: second.id, position: 1 })]),
      day(1, []),
    ]);
    const rev2 = revision(
      [day(0, [item({ candidateId: third.id })]), day(1, [item({ candidateId: second.id })])],
      [],
      [],
      [],
      { revision: 2, reason: "Moved the lighthouse, dropped the viewpoint, added a diner." },
    );
    const diff = revisionDiff(rev2.id, rev1.id, [
      addedEntry(third.id, diffPlacement(0, 0)),
      removedEntry(first.id, diffPlacement(0, 0)),
      movedEntry(second.id, diffPlacement(0, 1), diffPlacement(1, 0)),
    ]);

    fetched.mockResolvedValue(
      planView({ candidates: [first, second, third], revisions: [rev1, rev2], diffs: [diff] }),
    );

    show();

    const changed = await screen.findByText("What changed");
    // Scoped to the diff section alone: a placed item's own title is also an
    // `<h4>` (`Item` in `PlanView.tsx`), so an unscoped query for level-4
    // headings counts those too.
    const section = within(changed.closest("section")!);

    // Three headings, in this order, each owning exactly its own list — not
    // one list carrying every entry, and not a heading rendered over nothing.
    // A mutation that routed every entry through one group, or dropped the
    // group headings outright, changes this and only this assertion: the
    // per-item text below is the same whichever group an entry ends up in,
    // since it comes from the entry's own `kind`.
    const headings = section.getAllByRole("heading", { level: 4 }).map((node) => node.textContent);
    expect(headings).toEqual(["Added", "Removed", "Moved"]);

    const added = within(section.getByRole("heading", { name: "Added", level: 4 }).parentElement!);
    const removed = within(
      section.getByRole("heading", { name: "Removed", level: 4 }).parentElement!,
    );
    const moved = within(section.getByRole("heading", { name: "Moved", level: 4 }).parentElement!);

    expect(added.getByText("A diner — Day 1")).toBeDefined();
    expect(added.getAllByRole("listitem")).toHaveLength(1);

    expect(removed.getByText("A viewpoint — Day 1")).toBeDefined();
    expect(removed.getAllByRole("listitem")).toHaveLength(1);

    expect(moved.getByText("A lighthouse — Day 1 → Day 2")).toBeDefined();
    expect(moved.getAllByRole("listitem")).toHaveLength(1);
  });

  test("a re-plan's note is shown, marked as what the user wrote", async () => {
    const first = candidate({ title: "A viewpoint" });
    const rev1 = revision([day(0, [item({ candidateId: first.id })])]);
    const rev2 = revision([day(0, [item({ candidateId: first.id })])], [], [], [], {
      revision: 2,
      reason: "Re-planned day 1.",
      operation: { kind: "replan", days: [0], specialists: [], note: "Keep it cheap." },
    });
    const diff = revisionDiff(rev2.id, rev1.id, []);
    fetched.mockResolvedValue(
      planView({ candidates: [first], revisions: [rev1, rev2], diffs: [diff] }),
    );

    show();

    expect(await screen.findByText(/Keep it cheap\./)).toBeDefined();
    expect(screen.getByText("What was asked")).toBeDefined();
  });

  test("no diff is rendered for the first revision", async () => {
    const first = candidate({ title: "A viewpoint" });
    fetched.mockResolvedValue(
      planView({
        candidates: [first],
        revisions: [revision([day(0, [item({ candidateId: first.id })])])],
      }),
    );

    show();

    await screen.findByText("A viewpoint");
    expect(screen.queryByText("What changed")).toBeNull();
  });
});

describe("moving and removing", () => {
  test("moving an item sends the destination and the latest baseRevisionId", async () => {
    const first = candidate({ title: "A viewpoint" });
    const placed = item({ candidateId: first.id });
    const rev = revision([day(0, [placed]), day(1, [])]);
    fetched.mockResolvedValue(planView({ candidates: [first], revisions: [rev] }));
    edited.mockResolvedValue(planView({ candidates: [first], revisions: [rev] }));

    const user = userEvent.setup();
    show();

    await user.click(await screen.findByRole("button", { name: "Move" }));
    await user.selectOptions(screen.getByLabelText("Day"), "1");
    await user.click(screen.getByRole("button", { name: "Move here" }));

    expect(edited).toHaveBeenCalledWith("plan-1", {
      kind: "move",
      baseRevisionId: rev.id,
      itemId: placed.id,
      toDayIndex: 1,
      toPosition: 0,
    });
  });

  test("removing an item sends the latest baseRevisionId", async () => {
    const first = candidate({ title: "A viewpoint" });
    const placed = item({ candidateId: first.id });
    const rev = revision([day(0, [placed])]);
    fetched.mockResolvedValue(planView({ candidates: [first], revisions: [rev] }));
    edited.mockResolvedValue(planView({ candidates: [first], revisions: [rev] }));

    const user = userEvent.setup();
    show();

    await user.click(await screen.findByRole("button", { name: "Remove" }));

    expect(edited).toHaveBeenCalledWith("plan-1", {
      kind: "remove",
      baseRevisionId: rev.id,
      itemId: placed.id,
    });
  });
});

describe("re-planning", () => {
  test("the submit button is disabled with no day ticked, and stays that way after ticking and unticking one", async () => {
    const first = candidate({ title: "A viewpoint" });
    const rev = revision([day(0, [item({ candidateId: first.id })])]);
    fetched.mockResolvedValue(planView({ candidates: [first], revisions: [rev] }));

    const user = userEvent.setup();
    show();

    const button = await screen.findByRole<HTMLButtonElement>("button", {
      name: "Re-plan these days",
    });
    expect(button.disabled).toBe(true);

    const dayOne = screen.getByRole("checkbox", { name: "Day 1" });
    await user.click(dayOne);
    expect(button.disabled).toBe(false);

    // Unticking it is the other half: a day checkbox is a toggle, not a
    // one-way switch, and the button must go back to disabled with it.
    await user.click(dayOne);
    expect(button.disabled).toBe(true);
  });

  test("submits the chosen days, specialists and note, and hands the run to onReplan", async () => {
    const first = candidate({ title: "A viewpoint" });
    const rev = revision([day(0, [item({ candidateId: first.id })]), day(1, [])]);
    fetched.mockResolvedValue(planView({ candidates: [first], revisions: [rev] }));
    const run: Run = {
      id: "run-9",
      planId: "plan-1",
      kind: "replan",
      status: "queued",
      rosterSize: null,
      specialistsDone: 0,
      error: null,
      startedAt: "2027-01-01T00:00:00.000Z",
      finishedAt: null,
    };
    replanned.mockResolvedValue(run);
    const onReplan = vi.fn();

    const user = userEvent.setup();
    show({ onReplan });

    await user.click(await screen.findByRole("checkbox", { name: "Day 1" }));
    await user.click(screen.getByRole("checkbox", { name: "lodging" }));
    await user.type(
      screen.getByLabelText("Anything the specialists should know?"),
      "Keep it cheap.",
    );
    await user.click(screen.getByRole("button", { name: "Re-plan these days" }));

    expect(replanned).toHaveBeenCalledWith("plan-1", {
      kind: "replan",
      baseRevisionId: rev.id,
      days: [0],
      specialists: ["lodging"],
      note: "Keep it cheap.",
    });
    await waitFor(() => {
      expect(onReplan).toHaveBeenCalledWith(run);
    });
  });

  /**
   * The empty state named in this ticket's brief: leaving every specialist
   * box unchecked is one of the two choices, not a forgotten step, and the
   * submit button must not treat it as incomplete.
   */
  test("submits with no specialists named — the free re-pack, not an error state", async () => {
    const first = candidate({ title: "A viewpoint" });
    const rev = revision([day(0, [item({ candidateId: first.id })])]);
    fetched.mockResolvedValue(planView({ candidates: [first], revisions: [rev] }));
    replanned.mockResolvedValue({
      id: "run-10",
      planId: "plan-1",
      kind: "replan",
      status: "queued",
      rosterSize: null,
      specialistsDone: 0,
      error: null,
      startedAt: "2027-01-01T00:00:00.000Z",
      finishedAt: null,
    });

    const user = userEvent.setup();
    show();

    await user.click(await screen.findByRole("checkbox", { name: "Day 1" }));
    const button = screen.getByRole("button", { name: "Re-plan these days" });
    expect(button).not.toHaveProperty("disabled", true);
    await user.click(button);

    expect(replanned).toHaveBeenCalledWith(
      "plan-1",
      expect.objectContaining({ specialists: [], note: null }),
    );
  });
});

describe("revise errors", () => {
  test("REVISION_STALE offers a reload, which replaces the loaded plan", async () => {
    const activity = candidate({ title: "A long walk" });
    const placed = item({ candidateId: activity.id });
    fetched.mockResolvedValueOnce(
      planView({ candidates: [activity], revisions: [revision([day(0, [placed])])] }),
    );
    edited.mockRejectedValueOnce(
      new AppError(
        "REVISION_STALE",
        "This plan changed since you opened it — reload to see the current version.",
      ),
    );
    fetched.mockResolvedValueOnce(
      planView({
        candidates: [activity],
        revisions: [
          revision([day(0, [placed])], [], [], [], {
            revision: 2,
            reason: "Someone else changed it.",
          }),
        ],
      }),
    );

    const user = userEvent.setup();
    show();

    await user.click(await screen.findByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/reload to see the current version/i);
    });
    await user.click(screen.getByRole("button", { name: "Reload the plan" }));

    expect(await screen.findByText(/Someone else changed it\./)).toBeDefined();
  });

  test("PLAN_BUSY offers Watch it, and does not force a reload", async () => {
    const activity = candidate({ title: "A long walk" });
    const placed = item({ candidateId: activity.id });
    fetched.mockResolvedValue(
      planView({ candidates: [activity], revisions: [revision([day(0, [placed])])] }),
    );
    edited.mockRejectedValue(
      new AppError(
        "PLAN_BUSY",
        "A change to this plan is already underway — wait for it to finish, then try again.",
        { details: { run: "run-42" } },
      ),
    );

    const onWatchRun = vi.fn();
    const user = userEvent.setup();
    show({ onWatchRun });

    await user.click(await screen.findByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/already underway/i);
    });
    expect(screen.queryByRole("button", { name: "Reload the plan" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Watch it" }));
    expect(onWatchRun).toHaveBeenCalledWith("run-42", "plan-1");
  });

  /**
   * `PLAN_INFEASIBLE` and `ITEM_NOT_FOUND` are given **the same message on
   * purpose**, so a passing assertion cannot be the message text coincidence
   * doing the work. What must differ is whether `details.findings` — the
   * composer's own shape (`@planner/itinerary`'s `compose.ts`) — reaches the
   * page: `PLAN_INFEASIBLE` renders it, `ITEM_NOT_FOUND`'s `{ item: <id> }`
   * degrades to the message alone, per Build step 9.
   */
  const SAME_WORDS = "Same words.";

  test("PLAN_INFEASIBLE renders its message and the composer's findings", async () => {
    const activity = candidate({ title: "A long walk" });
    const placed = item({ candidateId: activity.id });
    fetched.mockResolvedValue(
      planView({
        candidates: [activity],
        revisions: [revision([day(0, [placed]), day(1, [])])],
      }),
    );
    edited.mockRejectedValue(
      new AppError("PLAN_INFEASIBLE", SAME_WORDS, {
        details: { findings: [{ kind: "day-overfull", dayIndex: 0, detail: "Over capacity." }] },
      }),
    );

    const user = userEvent.setup();
    show();

    await user.click(await screen.findByRole("button", { name: "Move" }));
    await user.click(screen.getByRole("button", { name: "Move here" }));

    const alert = await waitFor(() => screen.getByRole("alert"));
    expect(alert.textContent).toMatch(/Same words\./);
    expect(within(alert).getByText("Day 1: Over capacity.")).toBeDefined();
  });

  test("ITEM_NOT_FOUND renders its message alone — an id is not a shape worth rendering", async () => {
    const activity = candidate({ title: "A long walk" });
    const placed = item({ candidateId: activity.id });
    fetched.mockResolvedValue(
      planView({ candidates: [activity], revisions: [revision([day(0, [placed])])] }),
    );
    edited.mockRejectedValue(
      new AppError("ITEM_NOT_FOUND", SAME_WORDS, { details: { item: "item-1" } }),
    );

    const user = userEvent.setup();
    show();

    await user.click(await screen.findByRole("button", { name: "Remove" }));

    const alert = await waitFor(() => screen.getByRole("alert"));
    expect(alert.textContent).toMatch(/Same words\./);
    // Distinct from `PLAN_INFEASIBLE` above despite the identical message:
    // no findings list, and the raw id is never shown to a reader.
    expect(within(alert).queryByRole("listitem")).toBeNull();
    expect(within(alert).queryByText(/item-1/)).toBeNull();
  });
});
