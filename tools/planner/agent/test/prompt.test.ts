/**
 * What a specialist is shown, and what it is not.
 *
 * Two rules are asserted here rather than trusted to a paragraph: a specialist
 * sees the brief and only the brief, and an unanswered slot is shown as
 * unanswered. The second is the one that quietly breaks — a renderer that falls
 * back to a plausible default hands a model a value the user never gave, and
 * every downstream honesty mechanism is then describing something invented.
 */

import { describe, expect, test } from "vitest";
import { slot } from "@planner/contract";
import type { TripBrief } from "@planner/contract";
import { loadFixture } from "../../contract/test/fixtures.ts";
import { readMarkers, renderBrief, systemPrompt, userPrompt } from "../src/index.ts";
import { capacityOf } from "./helpers.ts";

const roadTrip = loadFixture("road-trip").brief;

describe("rendering the brief", () => {
  test("carries the answers the party actually gave", () => {
    const text = renderBrief(roadTrip);

    expect(text).toContain("Montréal, Québec");
    expect(text).toContain("2027-07-03 to 2027-07-11");
    expect(text).toContain("half-day");
    expect(text).toContain("No more than one night in any campground without showers");
  });

  test("says a declined slot is unanswered rather than inventing one", () => {
    // `accessNeeds` is declined on this fixture. A declined slot and an unasked
    // one are deliberately indistinguishable downstream, and this is where that
    // stops being a doc comment.
    expect(renderBrief(roadTrip)).toContain("Access needs: not answered");
  });

  test("an unknown refine slot renders the same way a declined one does", () => {
    const details = roadTrip.details;
    if (details?.shape !== "road-trip") throw new Error("the fixture lost its shape");

    const unasked: TripBrief = {
      ...roadTrip,
      details: { ...details, routeStyle: slot.unknown() },
    };
    const declined: TripBrief = {
      ...roadTrip,
      details: { ...details, routeStyle: slot.declined() },
    };

    expect(renderBrief(unasked)).toContain("Route style: not answered");
    expect(renderBrief(unasked)).toBe(renderBrief(declined));
  });

  test("a flexible window is rendered as a window, never as a date", () => {
    expect(renderBrief(loadFixture("resort").brief)).toContain("7 nights, no dates chosen");
    expect(renderBrief(loadFixture("backcountry").brief)).toContain(
      "3 nights somewhere between 2027-08-15 and 2027-09-15",
    );
  });
});

describe("the specialist prompt", () => {
  const capacity = capacityOf(roadTrip);

  test("states the day's ceiling as a number the specialist must respect", () => {
    // `half-day` is 300 minutes in `limits.ts`. This is pl-9's finding turned
    // into a sentence: a leg longer than the day allows has to be split.
    const prompt = systemPrompt({
      specialist: "route-and-logistics",
      brief: roadTrip,
      shape: "road-trip",
      capacity,
    });

    expect(prompt).toContain("300 minutes");
    expect(prompt).toMatch(/split/);
  });

  test("charges a drive to the activity budget where the shape has no drive appetite", () => {
    const backcountry = loadFixture("backcountry").brief;
    const prompt = systemPrompt({
      specialist: "route-and-logistics",
      brief: backcountry,
      shape: "backcountry",
      capacity: capacityOf(backcountry),
    });

    // `demanding` is 480 activity minutes and there is no drive appetite on this
    // shape, so a leg is bounded by the day's effort instead.
    expect(prompt).toContain("480 minutes");
  });

  test("gives lodging no minute ceiling, because a bed consumes no part of a day", () => {
    const prompt = systemPrompt({
      specialist: "lodging",
      brief: roadTrip,
      shape: "road-trip",
      capacity,
    });
    expect(prompt).not.toMatch(/may be longer than/);
  });

  test("asks the route specialist for both ends and everyone else for one place", () => {
    const route = systemPrompt({
      specialist: "route-and-logistics",
      brief: roadTrip,
      shape: "road-trip",
      capacity,
    });
    const lodging = systemPrompt({
      specialist: "lodging",
      brief: roadTrip,
      shape: "road-trip",
      capacity,
    });

    expect(route).toContain('"kind":"between"');
    expect(lodging).toContain('"kind":"at"');
  });

  test("the two machine-readable lines round-trip", () => {
    const prompt = systemPrompt({
      specialist: "food",
      brief: roadTrip,
      shape: "road-trip",
      capacity,
    });
    expect(readMarkers(prompt)).toEqual({ shape: "road-trip", specialist: "food" });
  });

  test("anything that is not a specialist prompt has no markers to read", () => {
    expect(readMarkers("You plan trips.")).toBeNull();
    expect(readMarkers("Trip shape: a lovely one\nSpecialist: lodging")).toBeNull();
    expect(readMarkers("Trip shape: resort\nSpecialist: sommelier")).toBeNull();
  });

  test("the user message is the brief and nothing else", () => {
    // No transcript, no answers, no other specialist's output — the whole
    // reason `TripBrief` is the indirection it is.
    expect(userPrompt(roadTrip)).toContain(renderBrief(roadTrip));
  });
});
