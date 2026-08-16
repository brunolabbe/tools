import { afterEach, describe, expect, test } from "vitest";
import {
  intakeUrl,
  missingRequiredSlots,
  ROUTES,
  type DiscardPreview,
  type ErrorResponse,
  type IntakeListResponse,
  type IntakeState,
} from "@planner/contract";
import { QUESTION_TREE } from "@planner/intake";
import type { App } from "../src/server.ts";
import { createApp } from "../src/server.ts";
import {
  answered,
  answerFor,
  answerThroughCore,
  NOW,
  postAnswer,
  readIntake,
  startIntake,
} from "./helpers/intakes.ts";

let app: App | undefined;

afterEach(async () => {
  await app?.shutdown();
  app = undefined;
});

/** In-memory database, silent logs, a fixed clock: nothing to clean up, nothing to drift. */
async function startApp(): Promise<App> {
  app = await createApp({
    config: { databasePath: ":memory:", logLevel: "silent" },
    now: () => NOW,
  });
  return app;
}

function answerRows(started: App, id: string): number {
  const row = started.context.db
    .prepare("SELECT COUNT(*) AS count FROM answers WHERE intake_id = ?")
    .get(id) as { count: number };
  return row.count;
}

describe("starting and resuming an intake", () => {
  test("starts empty and asks the first question", async () => {
    const { server } = await startApp();

    const response = await server.inject({ method: "POST", url: ROUTES.intakes });
    expect(response.statusCode).toBe(201);

    const state = response.json<IntakeState>();
    expect(state.answers).toEqual({});
    expect(state.intake.title).toBeNull();
    expect(state.intake.treeVersion).toBe(QUESTION_TREE.version);
    expect(state.progress.question?.id).toBe("shape");
    // The essentials are plainly not done, and the brief says the same thing.
    expect(state.progress.coreComplete).toBe(false);
    expect(missingRequiredSlots(state.brief).length).toBeGreaterThan(0);
  });

  test("an answer survives a reload, and re-answering does not add a second row", async () => {
    const started = await startApp();
    const { server } = started;
    const { intake } = await startIntake(server);

    await postAnswer(
      server,
      intake.id,
      "shape",
      answered({ kind: "single-choice", value: "resort" }),
    );
    await postAnswer(
      server,
      intake.id,
      "shape",
      answered({ kind: "single-choice", value: "resort" }),
    );

    const reloaded = await readIntake(server, intake.id);
    expect(reloaded.answers["shape"]).toEqual({
      state: "answered",
      value: { kind: "single-choice", value: "resort" },
    });
    // Idempotent by primary key rather than by care.
    expect(answerRows(started, intake.id)).toBe(1);
  });

  test("stops at the core questions with refining still open", async () => {
    const { server } = await startApp();
    const { intake } = await startIntake(server);

    const state = await answerThroughCore(server, intake.id);

    // `coreComplete` true *with* a question still to ask is the checkpoint.
    expect(state.progress.coreComplete).toBe(true);
    expect(state.progress.question).not.toBeNull();
    expect(state.progress.question?.stage).toBe("refine");
    // The two ways of saying "draftable" must not be able to disagree.
    expect(missingRequiredSlots(state.brief)).toEqual([]);
  });

  test("titles a checkpoint-complete intake without a destination, and lists it", async () => {
    const { server } = await startApp();
    const { intake } = await startIntake(server);

    const state = await answerThroughCore(server, intake.id, {
      shape: answered({ kind: "single-choice", value: "backcountry" }),
      dates: answered({
        kind: "dates",
        value: { kind: "exact", departure: "2027-02-10", return: "2027-02-14" },
      }),
      destination: { state: "declined" },
    });

    // `destination` is asked third since pl-18 and may be declined, which is
    // the whole point of it moving up: someone who has not picked a place says
    // so and carries on. The intake still reaches the checkpoint, and still
    // needs a name.
    expect(state.answers["destination"]).toEqual({ state: "declined" });
    expect(state.progress.coreComplete).toBe(true);
    expect(state.intake.title).toBe("A backcountry trip in February");

    const listed = await server.inject({ method: "GET", url: ROUTES.intakes });
    expect(listed.json<IntakeListResponse>().intakes).toEqual([
      expect.objectContaining({ id: intake.id, title: "A backcountry trip in February" }),
    ]);
  });

  test("puts the destination in front of it once there is one", async () => {
    const { server } = await startApp();
    const { intake } = await startIntake(server);

    await answerThroughCore(server, intake.id, {
      shape: answered({ kind: "single-choice", value: "city-and-culture" }),
      dates: answered({ kind: "dates", value: { kind: "open", nights: 4 } }),
    });
    const { body } = await postAnswer(
      server,
      intake.id,
      "destination",
      answered({ kind: "text", value: "Lisbon" }),
    );

    expect((body as IntakeState).intake.title).toBe("Lisbon — a city trip for 4 nights");
  });
});

/** A road trip answered to the checkpoint, which is where a shape change costs something. */
async function roadTripAtCheckpoint(server: App["server"]): Promise<IntakeState> {
  const { intake } = await startIntake(server);
  return await answerThroughCore(server, intake.id, {
    shape: answered({ kind: "single-choice", value: "road-trip" }),
  });
}

describe("changing an earlier answer", () => {
  test("names every answer it discards, by prompt, and removes them", async () => {
    const started = await startApp();
    const { server } = started;
    const before = await roadTripAtCheckpoint(server);
    const id = before.intake.id;

    const { body } = await postAnswer(
      server,
      id,
      "shape",
      answered({ kind: "single-choice", value: "backcountry" }),
    );
    const after = body as IntakeState;

    // The road trip's own questions are answers to questions nobody would now
    // ask, and the user is told so by prompt rather than by id.
    expect(after.discarded.map((entry) => entry.question).toSorted()).toEqual([
      "road-trip.drive-appetite",
      "road-trip.vehicle-kind",
    ]);
    for (const entry of after.discarded) expect(entry.prompt).toBeTruthy();

    // Gone from the store as well as from the response — same transaction.
    expect(after.answers["road-trip.vehicle-kind"]).toBeUndefined();
    expect(answerRows(started, id)).toBe(Object.keys(after.answers).length);

    // What did not depend on the shape is untouched — every fixed-core node
    // carries `when: null`, so `prune` cannot reach one whatever the shape says.
    expect(after.answers["origin"]).toEqual(before.answers["origin"]);
    expect(after.answers["travellers"]).toEqual(before.answers["travellers"]);
  });

  test("the dry run and the write agree, and the dry run writes nothing", async () => {
    const started = await startApp();
    const { server } = started;
    const before = await roadTripAtCheckpoint(server);
    const id = before.intake.id;
    const change = answered({ kind: "single-choice" as const, value: "backcountry" });

    const preview = await postAnswer(server, id, "shape", change, { preview: true });
    expect(preview.statusCode).toBe(200);
    const previewed = (preview.body as DiscardPreview).discarded;
    expect(previewed.length).toBeGreaterThan(0);

    // Nothing moved: a warning that costs the user their answers is not a warning.
    const untouched = await readIntake(server, id);
    expect(untouched.answers).toEqual(before.answers);
    expect(untouched.intake.updatedAt).toBe(before.intake.updatedAt);

    const { body } = await postAnswer(server, id, "shape", change);
    expect((body as IntakeState).discarded).toEqual(previewed);
  });

  test("refuses a question this intake never opened", async () => {
    const { server } = await startApp();
    const state = await roadTripAtCheckpoint(server);

    // A real question in the tree — on a branch these answers did not open.
    const { statusCode, body } = await postAnswer(
      server,
      state.intake.id,
      "backcountry.shelter",
      answered({ kind: "single-choice", value: "hut" }),
    );

    expect(statusCode).toBe(400);
    const { error } = body as ErrorResponse;
    expect(error.code).toBe("INVALID_ANSWER");
    expect(error.details).toEqual({ question: "backcountry.shelter" });
  });
});

describe("refusals", () => {
  test("an unknown intake is a typed 404, not a 500", async () => {
    const { server } = await startApp();

    const read = await server.inject({ method: "GET", url: intakeUrl("no-such-intake") });
    expect(read.statusCode).toBe(404);
    expect(read.json<ErrorResponse>().error.code).toBe("INTAKE_NOT_FOUND");

    const written = await postAnswer(
      server,
      "no-such-intake",
      "shape",
      answered({ kind: "single-choice", value: "resort" }),
    );
    expect(written.statusCode).toBe(404);
    expect((written.body as ErrorResponse).error.code).toBe("INTAKE_NOT_FOUND");
  });

  test("a core question cannot be declined past the checkpoint", async () => {
    const { server } = await startApp();
    const { intake } = await startIntake(server);

    const { statusCode, body } = await postAnswer(server, intake.id, "shape", {
      state: "declined",
    });

    // The engine's own refusal, let out rather than caught and re-worded.
    expect(statusCode).toBe(400);
    expect((body as ErrorResponse).error.code).toBe("INVALID_ANSWER");
  });

  test("a body that is not an answer is refused before anything is written", async () => {
    const started = await startApp();
    const { server } = started;
    const { intake } = await startIntake(server);

    const response = await server.inject({
      method: "POST",
      url: `${ROUTES.intakes}/${intake.id}/answers/shape`,
      payload: { state: "answered", value: { kind: "single-choice" } },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorResponse>().error.code).toBe("INVALID_ANSWER");
    expect(answerRows(started, intake.id)).toBe(0);
  });
});

/**
 * An intake saved under an older tree, holding one answer to a question this
 * tree has never heard of and one that no longer fits the question it answers.
 *
 * Written straight to the store on purpose: neither row can be produced through
 * the routes, which is the point — they are what a *release* produces.
 */
function saveStaleIntake(started: App): string {
  const { db } = started.context;
  const id = "stale-intake";
  db.prepare(
    "INSERT INTO intakes (id, title, tree_version, created_at, updated_at) VALUES (?, NULL, ?, ?, ?)",
  ).run(id, QUESTION_TREE.version - 1, NOW.toISOString(), NOW.toISOString());

  const write = (question: string, value: unknown): void => {
    db.prepare(
      "INSERT INTO answers (intake_id, question_id, value, answered_at) VALUES (?, ?, ?, ?)",
    ).run(id, question, JSON.stringify(value), NOW.toISOString());
  };

  write("shape", { state: "answered", value: { kind: "single-choice", value: "resort" } });
  // Inside the party-size bound the question had when it was answered, outside
  // the one it has now — a bound tightened in a release.
  write("travellers", { state: "answered", value: { kind: "number", value: 999 } });
  write("retired.question", { state: "answered", value: { kind: "text", value: "gone" } });
  return id;
}

/**
 * A road trip saved against tree version 1 — the tree as it stood before the
 * content review of 2026-08-16.
 *
 * Written straight to the store for the same reason as `saveStaleIntake`: two of
 * these ids no longer exist, so no route could produce them. This is what a
 * *release* leaves behind, and version 2 is the first bump with real answers
 * under it.
 */
function saveVersionOneRoadTrip(started: App): string {
  const { db } = started.context;
  const id = "v1-road-trip";
  db.prepare(
    "INSERT INTO intakes (id, title, tree_version, created_at, updated_at) VALUES (?, NULL, ?, ?, ?)",
  ).run(id, 1, NOW.toISOString(), NOW.toISOString());

  const write = (question: string, value: unknown): void => {
    db.prepare(
      "INSERT INTO answers (intake_id, question_id, value, answered_at) VALUES (?, ?, ?, ?)",
    ).run(id, question, JSON.stringify(value), NOW.toISOString());
  };

  write("shape", { state: "answered", value: { kind: "single-choice", value: "road-trip" } });
  write("origin", { state: "answered", value: { kind: "text", value: "Montréal" } });
  write("travellers", { state: "answered", value: { kind: "number", value: 2 } });
  // Budget changed stage, not id, so this one must survive the bump.
  write("budget", {
    state: "answered",
    value: { kind: "budget", value: { kind: "band", band: "moderate" } },
  });
  // The two retired ids: a decimal number of hours, and one enum that conflated
  // what you drive with whose it is.
  write("road-trip.drive-hours", { state: "answered", value: { kind: "number", value: 4.5 } });
  write("road-trip.vehicle", {
    state: "answered",
    value: { kind: "single-choice", value: "camper-van" },
  });
  return id;
}

describe("the version 1 tree meeting version 2", () => {
  test("drops exactly the two retired road-trip answers and keeps the budget", async () => {
    const started = await startApp();
    const id = saveVersionOneRoadTrip(started);

    const state = await readIntake(started.server, id);

    expect(state.discarded.map((entry) => entry.question).toSorted()).toEqual([
      "road-trip.drive-hours",
      "road-trip.vehicle",
    ]);
    // Neither can be named: the tree no longer has the question, so the UI says
    // "some earlier answers no longer apply" rather than printing an id.
    for (const entry of state.discarded) expect(entry.prompt).toBeNull();

    // Budget moved from `core` to `refine` and kept its id. If this is gone, the
    // node was re-created rather than moved.
    expect(state.answers["budget"]).toEqual({
      state: "answered",
      value: { kind: "budget", value: { kind: "band", band: "moderate" } },
    });
    expect(state.brief.budget).toEqual({
      state: "answered",
      value: { kind: "band", band: "moderate" },
    });

    expect(state.intake.treeVersion).toBe(QUESTION_TREE.version);
    expect(answerRows(started, id)).toBe(4);
  });

  test("leaves it answerable rather than 500ing, and asks the new questions", async () => {
    const started = await startApp();
    const id = saveVersionOneRoadTrip(started);
    await readIntake(started.server, id);

    // The two retired answers are gone, so the checkpoint has re-opened on their
    // replacements — which is the honest state, not an error.
    const state = await answerThroughCore(started.server, id, {});

    expect(state.progress.coreComplete).toBe(true);
    expect(missingRequiredSlots(state.brief)).toEqual([]);
    expect(state.answers["road-trip.drive-appetite"]).toBeDefined();
    expect(state.answers["road-trip.vehicle-kind"]).toBeDefined();
  });
});

function saveVersionTwoRoadTrip(started: App): string {
  const { db } = started.context;
  const id = "v2-road-trip";
  db.prepare(
    "INSERT INTO intakes (id, title, tree_version, created_at, updated_at) VALUES (?, NULL, ?, ?, ?)",
  ).run(id, 2, NOW.toISOString(), NOW.toISOString());

  const write = (question: string, value: unknown): void => {
    db.prepare(
      "INSERT INTO answers (intake_id, question_id, value, answered_at) VALUES (?, ?, ?, ?)",
    ).run(id, question, JSON.stringify(value), NOW.toISOString());
  };

  write("shape", { state: "answered", value: { kind: "single-choice", value: "road-trip" } });
  write("origin", { state: "answered", value: { kind: "text", value: "Montréal" } });
  // Answered when the question sat eighteenth, behind the checkpoint. pl-18
  // moved it to third without touching its id, so it must come through intact.
  write("destination", { state: "answered", value: { kind: "text", value: "Gaspésie" } });
  write("travellers", { state: "answered", value: { kind: "number", value: 2 } });
  return id;
}

describe("the version 2 tree meeting version 3", () => {
  test("moves the destination question without discarding its answer", async () => {
    const started = await startApp();
    const id = saveVersionTwoRoadTrip(started);

    const state = await readIntake(started.server, id);

    // pl-18 moved a node and changed no id, so unlike the v1 bump this one costs
    // nothing. A discard here means the node was re-created rather than moved.
    expect(state.discarded).toEqual([]);
    expect(state.answers["destination"]).toEqual({
      state: "answered",
      value: { kind: "text", value: "Gaspésie" },
    });
    expect(state.brief.destination).toEqual({ state: "answered", value: "Gaspésie" });

    expect(state.intake.treeVersion).toBe(QUESTION_TREE.version);
    expect(answerRows(started, id)).toBe(4);
  });

  test("does not ask it again, and stops at the checkpoint without it", async () => {
    const started = await startApp();
    const id = saveVersionTwoRoadTrip(started);
    await readIntake(started.server, id);

    const state = await answerThroughCore(started.server, id, {});

    // Already answered, so the wizard walks past it — a moved question that gets
    // re-asked is the most visible way this bump could look broken.
    expect(state.answers["destination"]).toEqual({
      state: "answered",
      value: { kind: "text", value: "Gaspésie" },
    });
    expect(state.progress.coreComplete).toBe(true);
    expect(missingRequiredSlots(state.brief)).toEqual([]);
  });
});

describe("a tree that moved under a saved intake", () => {
  test("prunes what no longer fits, says so, and does not throw", async () => {
    const started = await startApp();
    const id = saveStaleIntake(started);

    const state = await readIntake(started.server, id);

    const discarded = new Map(state.discarded.map((entry) => [entry.question, entry.prompt]));
    expect([...discarded.keys()].toSorted()).toEqual(["retired.question", "travellers"]);
    // A question the tree still has can be named; one it has dropped cannot, and
    // the UI must say "some earlier answers no longer apply" rather than print an id.
    expect(discarded.get("travellers")).toBe("How many people are going?");
    expect(discarded.get("retired.question")).toBeNull();

    // What still fits survived, and the intake now sits on the current tree.
    expect(state.answers["shape"]).toBeDefined();
    expect(state.answers["travellers"]).toBeUndefined();
    expect(state.intake.treeVersion).toBe(QUESTION_TREE.version);
    expect(answerRows(started, id)).toBe(1);
  });

  test("reports the loss once, and does not move the intake up the list for it", async () => {
    const started = await startApp();
    const id = saveStaleIntake(started);
    const first = await readIntake(started.server, id);

    const second = await readIntake(started.server, id);

    expect(second.discarded).toEqual([]);
    expect(second.answers).toEqual(first.answers);
    // The tree moved; nobody touched the intake. Sending it to the top of the
    // list would be a lie about when it was last worked on.
    expect(second.intake.updatedAt).toBe(NOW.toISOString());
  });

  test("a write against a stale intake reconciles first, in the same transaction", async () => {
    const started = await startApp();
    const id = saveStaleIntake(started);

    const { statusCode, body } = await postAnswer(
      started.server,
      id,
      "origin",
      answerFor(
        QUESTION_TREE.nodes.find((node) => node.id === "origin") ?? QUESTION_TREE.nodes[0]!,
      ),
    );
    const state = body as IntakeState;

    expect(statusCode).toBe(200);
    expect(state.discarded.map((entry) => entry.question).toSorted()).toEqual([
      "retired.question",
      "travellers",
    ]);
    expect(state.answers["origin"]).toBeDefined();
    // The reconciliation and the write are one transaction: the store holds
    // exactly what the response says it does.
    expect(answerRows(started, id)).toBe(Object.keys(state.answers).length);
  });
});
