/**
 * The run's state machine and its wire types.
 *
 * These live in the contract because `web` renders the state and `api` enforces
 * it — the same argument that keeps the downloader's job FSM in its contract —
 * so the assertions here are the ones that keep the two from disagreeing: the
 * table is total, the terminal set is derived rather than listed, and every
 * frame the server can build is one the client can parse.
 */

import { describe, expect, test } from "vitest";
import {
  canRunTransition,
  isTerminalRunEvent,
  RUN_STATUSES,
  RUN_TRANSITIONS,
  runEventSchema,
  runProgressSchema,
  runSchema,
  TERMINAL_RUN_STATUSES,
  type RunEvent,
  type RunStatus,
} from "../src/index.ts";

const AT = "2026-08-16T12:00:00.000Z";

describe("the transition table", () => {
  test("has an entry for every status, and names only statuses", () => {
    expect(Object.keys(RUN_TRANSITIONS).toSorted()).toEqual([...RUN_STATUSES].toSorted());
    for (const targets of Object.values(RUN_TRANSITIONS)) {
      for (const target of targets) expect(RUN_STATUSES).toContain(target);
    }
  });

  test("derives the terminal set rather than listing it", () => {
    expect([...TERMINAL_RUN_STATUSES].toSorted()).toEqual(["canceled", "done", "failed"]);
    for (const status of TERMINAL_RUN_STATUSES) {
      expect(RUN_TRANSITIONS[status]).toEqual([]);
    }
  });

  test("walks the happy path and refuses the ways back", () => {
    expect(canRunTransition("queued", "fanning-out")).toBe(true);
    expect(canRunTransition("fanning-out", "composing")).toBe(true);
    expect(canRunTransition("composing", "done")).toBe(true);

    expect(canRunTransition("queued", "composing")).toBe(false);
    expect(canRunTransition("composing", "fanning-out")).toBe(false);
    expect(canRunTransition("done", "fanning-out")).toBe(false);
  });

  test("lets `composing` reach `done` without passing through `reviewing`", () => {
    // Not an oversight. pl-9 built the critic *inside* `compose()`: it packs,
    // critiques and packs again for a bounded number of rounds and returns once,
    // so there is no moment `api` could honestly observe the changeover at.
    // Emitting `reviewing` around that call to make the diagram come true would
    // be the repo's _never fake progress_ rule broken for decoration.
    expect(canRunTransition("composing", "done")).toBe(true);
    expect(canRunTransition("composing", "reviewing")).toBe(true);
    expect(canRunTransition("reviewing", "done")).toBe(true);
  });

  test("lets the fan-out reach grounding, and grounding reach the composer", () => {
    expect(canRunTransition("fanning-out", "grounding")).toBe(true);
    expect(canRunTransition("grounding", "composing")).toBe(true);

    // Grounding measures what the fan-out proposed and hands it to the packer.
    // It cannot finish a run on its own.
    expect(canRunTransition("grounding", "done")).toBe(false);
    expect(canRunTransition("grounding", "reviewing")).toBe(false);
  });

  test("lets `fanning-out` reach `composing` without passing through `grounding`", () => {
    // The same argument as `composing → done` one state earlier. A run with a
    // provider that knows nothing, or with no leg to measure, does no grounding
    // — and emitting a state it spent no time in, to make the diagram come
    // true, is _never fake progress_ broken for decoration.
    expect(canRunTransition("fanning-out", "composing")).toBe(true);
  });

  test("lets a run discover before it fans out, and reach the fan-out from grounding", () => {
    // pl-29: discovery is a corridor query that proposes what a specialist
    // might read, so it has to run *before* the fan-out — the opposite side of
    // the same `grounding` status the measuring pass already uses *after* it.
    // One state, entered twice, is the whole point: two names for "we are
    // looking something up outside the process" would be a distinction the UI
    // has to explain for nothing.
    expect(canRunTransition("queued", "grounding")).toBe(true);
    expect(canRunTransition("grounding", "fanning-out")).toBe(true);

    // And the skip: a brief with nothing to discover along, or a provider that
    // cannot discover anything, must not pass through a state it spent no time
    // in — the same argument `fanning-out → composing` already won.
    expect(canRunTransition("queued", "fanning-out")).toBe(true);
  });

  test("every non-terminal status can fail and can be canceled", () => {
    const live = RUN_STATUSES.filter((status) => !TERMINAL_RUN_STATUSES.has(status));
    for (const status of live) {
      expect(canRunTransition(status, "failed"), `${status} → failed`).toBe(true);
      expect(canRunTransition(status, "canceled"), `${status} → canceled`).toBe(true);
    }
  });

  test("no status can reach itself — a move is a change", () => {
    for (const status of RUN_STATUSES) {
      expect(canRunTransition(status, status as RunStatus)).toBe(false);
    }
  });
});

describe("the progress payload", () => {
  test("accepts the roster frame, whose total is known before any request", () => {
    const parsed = runProgressSchema.safeParse({
      type: "roster",
      running: ["route-and-logistics", "lodging"],
      droppedForBudget: ["budget"],
      total: 2,
    });
    expect(parsed.success).toBe(true);
  });

  test("refuses a specialist nobody has heard of", () => {
    const parsed = runProgressSchema.safeParse({
      type: "specialist-started",
      specialist: "sommelier",
      total: 3,
    });
    expect(parsed.success).toBe(false);
  });

  test("refuses an error code outside the taxonomy", () => {
    const parsed = runProgressSchema.safeParse({
      type: "specialist-failed",
      specialist: "lodging",
      code: "SOMETHING_WENT_WRONG",
      done: 1,
      total: 3,
    });
    expect(parsed.success).toBe(false);
  });
});

describe("the wire", () => {
  const run = {
    id: "run-1",
    planId: "plan-1",
    status: "fanning-out",
    rosterSize: 5,
    specialistsDone: 2,
    error: null,
    startedAt: AT,
    finishedAt: null,
  };

  test("a run parses, and a queued one has no roster yet", () => {
    expect(runSchema.safeParse(run).success).toBe(true);
    // Null rather than zero: "not decided yet" and "nobody is running" are
    // different sentences, and only one of them is a bug.
    expect(runSchema.safeParse({ ...run, status: "queued", rosterSize: null }).success).toBe(true);
  });

  test("every frame the server can build is one the client can parse", () => {
    const frames: RunEvent[] = [
      { type: "snapshot", runId: "run-1", run: run as never, at: AT },
      { type: "status", runId: "run-1", status: "composing", at: AT },
      {
        type: "progress",
        runId: "run-1",
        progress: {
          type: "specialist-finished",
          specialist: "lodging",
          candidates: 3,
          done: 1,
          total: 5,
        },
        at: AT,
      },
      { type: "done", runId: "run-1", planId: "plan-1", revisionId: "rev-1", at: AT },
      {
        type: "failed",
        runId: "run-1",
        error: { code: "AGENT_UNAVAILABLE", message: "no", retryable: true },
        at: AT,
      },
      {
        type: "canceled",
        runId: "run-1",
        error: { code: "JOB_CANCELED", message: "stopped", retryable: false },
        at: AT,
      },
      { type: "heartbeat", at: AT },
    ];

    for (const frame of frames) {
      expect(runEventSchema.safeParse(frame).success, frame.type).toBe(true);
    }
  });

  test("names the three frames after which there is nothing more to say", () => {
    expect(
      isTerminalRunEvent({ type: "done", runId: "r", planId: "p", revisionId: "v", at: AT }),
    ).toBe(true);
    expect(
      isTerminalRunEvent({
        type: "failed",
        runId: "r",
        error: { code: "INTERNAL", message: "x", retryable: false },
        at: AT,
      }),
    ).toBe(true);
    expect(
      isTerminalRunEvent({
        type: "canceled",
        runId: "r",
        error: { code: "JOB_CANCELED", message: "x", retryable: false },
        at: AT,
      }),
    ).toBe(true);

    expect(isTerminalRunEvent({ type: "heartbeat", at: AT })).toBe(false);
    expect(isTerminalRunEvent({ type: "status", runId: "r", status: "queued", at: AT })).toBe(
      false,
    );
  });
});

describe("the grounding progress frame", () => {
  test("carries a count the bar can show", () => {
    expect(runProgressSchema.safeParse({ type: "grounding", done: 2, total: 6 }).success).toBe(
      true,
    );
  });

  test("accepts a null total, because §7's answer to an unknowable one is null", () => {
    // A backend that discovers work as it goes has no honest total. `null` and
    // an indeterminate bar, never a number that moves while you watch it.
    expect(runProgressSchema.safeParse({ type: "grounding", done: 2, total: null }).success).toBe(
      true,
    );
  });

  test("refuses a done count that is not a whole number of lookups", () => {
    expect(runProgressSchema.safeParse({ type: "grounding", done: -1, total: 6 }).success).toBe(
      false,
    );
    expect(runProgressSchema.safeParse({ type: "grounding", done: 1.5, total: 6 }).success).toBe(
      false,
    );
  });
});
