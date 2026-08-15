import { afterEach, describe, expect, test } from "vitest";
import type { App } from "../src/server.ts";
import { createApp } from "../src/server.ts";
import {
  deleteAnswers,
  insertIntake,
  selectAnswers,
  selectIntake,
  selectIntakes,
  updateIntake,
  upsertAnswer,
} from "../src/db/intakes.ts";
import { answered, NOW } from "./helpers/intakes.ts";

let app: App | undefined;

afterEach(async () => {
  await app?.shutdown();
  app = undefined;
});

async function startApp(): Promise<App> {
  app = await createApp({
    config: { databasePath: ":memory:", logLevel: "silent" },
    now: () => NOW,
  });
  return app;
}

const AT = NOW.toISOString();

describe("the intake store", () => {
  test("writes an intake and reads it back", async () => {
    const { context } = await startApp();

    const written = insertIntake(context.db, { id: "one", treeVersion: 3, now: AT });

    expect(written).toEqual({
      id: "one",
      title: null,
      treeVersion: 3,
      createdAt: AT,
      updatedAt: AT,
    });
    expect(selectIntake(context.db, "one")).toEqual(written);
    expect(selectIntake(context.db, "missing")).toBeUndefined();
  });

  test("re-answering replaces the row rather than adding one", async () => {
    const { context } = await startApp();
    insertIntake(context.db, { id: "one", treeVersion: 1, now: AT });

    upsertAnswer(context.db, {
      intakeId: "one",
      questionId: "shape",
      answer: answered({ kind: "single-choice", value: "resort" }),
      now: AT,
    });
    upsertAnswer(context.db, {
      intakeId: "one",
      questionId: "shape",
      answer: answered({ kind: "single-choice", value: "road-trip" }),
      now: "2026-08-16T00:00:00.000Z",
    });

    const { answers } = selectAnswers(context.db, "one");
    expect(Object.keys(answers)).toEqual(["shape"]);
    expect(answers["shape"]).toEqual(answered({ kind: "single-choice", value: "road-trip" }));
  });

  test("deleting is by question, and an empty list is not a delete-everything", async () => {
    const { context } = await startApp();
    insertIntake(context.db, { id: "one", treeVersion: 1, now: AT });
    for (const question of ["shape", "origin"]) {
      upsertAnswer(context.db, {
        intakeId: "one",
        questionId: question,
        answer: answered({ kind: "text", value: "x" }),
        now: AT,
      });
    }

    deleteAnswers(context.db, "one", []);
    expect(Object.keys(selectAnswers(context.db, "one").answers).toSorted()).toEqual([
      "origin",
      "shape",
    ]);

    deleteAnswers(context.db, "one", ["origin"]);
    expect(Object.keys(selectAnswers(context.db, "one").answers)).toEqual(["shape"]);
  });

  test("reports a row it cannot read rather than throwing over it", async () => {
    const { context } = await startApp();
    insertIntake(context.db, { id: "one", treeVersion: 1, now: AT });
    upsertAnswer(context.db, {
      intakeId: "one",
      questionId: "shape",
      answer: answered({ kind: "single-choice", value: "resort" }),
      now: AT,
    });
    // What a build whose contract disagreed with this one would have left, and
    // what a truncated write looks like. One corrupt row must not brick an intake.
    context.db
      .prepare("INSERT INTO answers (intake_id, question_id, value, answered_at) VALUES (?,?,?,?)")
      .run("one", "origin", "{not json", AT);
    context.db
      .prepare("INSERT INTO answers (intake_id, question_id, value, answered_at) VALUES (?,?,?,?)")
      .run("one", "dates", '{"state":"shrugged"}', AT);

    const { answers, unreadable } = selectAnswers(context.db, "one");
    expect(Object.keys(answers)).toEqual(["shape"]);
    expect(unreadable.toSorted()).toEqual(["dates", "origin"]);
  });

  test("lists most recently touched first", async () => {
    const { context } = await startApp();
    insertIntake(context.db, { id: "older", treeVersion: 1, now: "2026-08-14T09:00:00.000Z" });
    insertIntake(context.db, { id: "newer", treeVersion: 1, now: "2026-08-15T09:00:00.000Z" });

    expect(selectIntakes(context.db, 10).map((intake) => intake.id)).toEqual(["newer", "older"]);
    expect(selectIntakes(context.db, 1).map((intake) => intake.id)).toEqual(["newer"]);
  });

  test("updates the derived columns, and leaves updated_at alone when asked to", async () => {
    const { context } = await startApp();
    insertIntake(context.db, { id: "one", treeVersion: 1, now: AT });

    updateIntake(context.db, { id: "one", title: "A resort stay", treeVersion: 2 });
    expect(selectIntake(context.db, "one")).toMatchObject({
      title: "A resort stay",
      treeVersion: 2,
      updatedAt: AT,
    });

    updateIntake(context.db, {
      id: "one",
      title: "Lisbon — a resort stay",
      treeVersion: 2,
      updatedAt: "2026-08-16T00:00:00.000Z",
    });
    expect(selectIntake(context.db, "one")?.updatedAt).toBe("2026-08-16T00:00:00.000Z");
  });

  test("answers go with the intake they belong to", async () => {
    const { context } = await startApp();
    insertIntake(context.db, { id: "one", treeVersion: 1, now: AT });
    upsertAnswer(context.db, {
      intakeId: "one",
      questionId: "shape",
      answer: answered({ kind: "single-choice", value: "resort" }),
      now: AT,
    });

    context.db.prepare("DELETE FROM intakes WHERE id = ?").run("one");

    // `ON DELETE CASCADE`, and the `foreign_keys` pragma that makes it mean
    // something — off by default in SQLite, so this is a real assertion.
    expect(Object.keys(selectAnswers(context.db, "one").answers)).toEqual([]);
  });
});
