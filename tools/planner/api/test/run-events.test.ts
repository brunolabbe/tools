/**
 * `GET /api/runs/:id/events` — the stream a browser watches a fan-out through.
 *
 * The three things worth asserting are the three the downloader's implementation
 * gets right and this one copies: the current state goes out immediately so a
 * late client is not staring at `queued`, every frame validates against the
 * shared schema because the union is emitted verbatim, and a terminal frame ends
 * the stream so a client never has to decide when to stop listening.
 *
 * The fourth is this tool's, and it is the reason progress here is a number
 * rather than a spinner: **the roster's size is decided before the first request
 * goes out**, so "4 of 7 specialists done" is knowable rather than invented.
 */

import { describe, expect, test } from "vitest";
import { runEventSchema, runEventsUrl, type RunEvent } from "@planner/contract";
import type { ModelProvider, ModelReply, ModelRequest } from "@planner/agent";
import { ScriptedProvider } from "@planner/agent";
import {
  createRunHarness,
  deferred,
  intakeReadyToDraft,
  runToCompletion,
  startRunOver,
} from "./helpers/runs.ts";

/**
 * The scripted provider, held at the door until the test lets it through.
 *
 * A run against the scripted provider finishes in microseconds, so without this
 * there is no window in which to attach a client — and "a client that connected
 * mid-run sees the rest of it" is the property this route exists for.
 */
class GatedProvider implements ModelProvider {
  readonly name = "gated";
  readonly model = "gated";
  readonly #inner = new ScriptedProvider();
  readonly #entered = deferred();
  readonly #open = deferred();

  /** Resolves once at least one specialist is inside `send`. */
  get entered(): Promise<void> {
    return this.#entered.promise;
  }

  release(): void {
    this.#open.resolve();
  }

  async send(request: ModelRequest): Promise<ModelReply> {
    this.#entered.resolve();
    await this.#open.promise;
    return await this.#inner.send(request);
  }
}

function framesOf(body: string): RunEvent[] {
  return body
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.slice("data: ".length)) as RunEvent);
}

describe("the run event stream", () => {
  test("reports the roster before the fan-out and one frame per specialist after it", async () => {
    const provider = new GatedProvider();
    const harness = await createRunHarness({ model: provider });
    try {
      const intakeId = await intakeReadyToDraft(harness.app);
      const run = await startRunOver(harness.app, intakeId);

      // The roster is decided and recorded before the first provider call, so
      // by the time anyone is inside `send` the size is already knowable.
      await provider.entered;

      const streamed = harness.app.server.inject({
        method: "GET",
        url: runEventsUrl(run.id),
      });
      // Let the subscription land before the run is allowed to finish.
      await new Promise((resolve) => setTimeout(resolve, 10));
      provider.release();

      const response = await streamed;
      expect(response.headers["content-type"]).toContain("text/event-stream");
      // Nginx buffers proxied responses by default, which would hold every frame
      // until the run finished — precisely defeating the point.
      expect(response.headers["x-accel-buffering"]).toBe("no");

      const frames = framesOf(response.body);
      // Emitted verbatim: any deviation is a frame the client would discard.
      for (const frame of frames) {
        expect(runEventSchema.safeParse(frame).success, JSON.stringify(frame)).toBe(true);
      }

      const snapshot = frames[0];
      expect(snapshot?.type).toBe("snapshot");
      const rosterSize = snapshot?.type === "snapshot" ? snapshot.run.rosterSize : null;
      expect(rosterSize).toBeGreaterThan(0);

      // One per specialist, and the last of them accounts for the whole roster.
      const finished = frames.filter(
        (frame) => frame.type === "progress" && frame.progress.type === "specialist-finished",
      );
      expect(finished.length).toBe(rosterSize);
      for (const frame of finished) {
        if (frame.type !== "progress" || frame.progress.type !== "specialist-finished") continue;
        // Never a percentage of one specialist's work: a model call has no
        // progress inside it.
        expect(frame.progress.total).toBe(rosterSize);
        expect(frame.progress.done).toBeLessThanOrEqual(frame.progress.total);
      }

      // A terminal frame ends the stream: there is nothing more to say.
      expect(frames.at(-1)?.type).toBe("done");
    } finally {
      await harness.close();
    }
  });

  test("a run that finished before the client connected still gets its answer", async () => {
    const harness = await createRunHarness();
    try {
      const intakeId = await intakeReadyToDraft(harness.app);
      const run = await startRunOver(harness.app, intakeId);
      await runToCompletion(harness.app, run.id);

      const response = await harness.app.server.inject({
        method: "GET",
        url: runEventsUrl(run.id),
      });
      const frames = framesOf(response.body);

      // Not left staring at `queued` waiting for an event that will never come.
      expect(frames[0]?.type).toBe("snapshot");
      const done = frames.at(-1);
      expect(done?.type).toBe("done");
      if (done?.type === "done") {
        // Read off the plan rather than re-derived from the run id — "the latest
        // one" is `latestRevision`'s to answer.
        expect(done.revisionId).not.toBe("");
        expect(done.planId).toBe(run.planId);
      }
    } finally {
      await harness.close();
    }
  });

  test("a canceled run's stream ends on the cancellation, not on a plan", async () => {
    const provider = new GatedProvider();
    const harness = await createRunHarness({ model: provider });
    try {
      const intakeId = await intakeReadyToDraft(harness.app);
      const run = await startRunOver(harness.app, intakeId);
      await provider.entered;

      harness.app.context.runs.cancel(run.id);
      provider.release();
      await runToCompletion(harness.app, run.id);

      const response = await harness.app.server.inject({
        method: "GET",
        url: runEventsUrl(run.id),
      });
      const frames = framesOf(response.body);
      const last = frames.at(-1);
      expect(last?.type).toBe("canceled");
      if (last?.type === "canceled") {
        expect(last.error.code).toBe("JOB_CANCELED");
      }
    } finally {
      await harness.close();
    }
  });

  test("events for an unknown run are a JSON 404, not an empty stream", async () => {
    const harness = await createRunHarness();
    try {
      const response = await harness.app.server.inject({
        method: "GET",
        url: runEventsUrl("nope"),
      });
      expect(response.statusCode).toBe(404);
      expect(response.headers["content-type"]).toContain("application/json");
      expect(response.json<{ error: { code: string } }>().error.code).toBe("JOB_NOT_FOUND");
    } finally {
      await harness.close();
    }
  });

  test("a disconnected client leaves no subscription behind", async () => {
    const provider = new GatedProvider();
    const harness = await createRunHarness({ model: provider });
    try {
      const intakeId = await intakeReadyToDraft(harness.app);
      const run = await startRunOver(harness.app, intakeId);
      await provider.entered;

      const streamed = harness.app.server.inject({
        method: "GET",
        url: runEventsUrl(run.id),
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      provider.release();
      await streamed;

      // The unsubscribe *and* the heartbeat timer must both go, or a tab closed
      // mid-run leaks a listener for the lifetime of the process.
      expect(harness.app.context.events.subscriberCount(run.id)).toBe(0);
    } finally {
      await harness.close();
    }
  });
});
