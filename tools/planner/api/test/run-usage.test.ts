/**
 * What a run spent, recorded on its row however it ended (pl-49).
 *
 * Every run here is driven over HTTP against the scripted provider, wrapped so
 * each reply reports token counts — the scripted provider on its own reports
 * none, on purpose, and a test of recording against all-null counts would
 * pass whether anything was added up or not.
 */

import { describe, expect, test } from "vitest";
import { AppError, runCancelUrl } from "@planner/contract";
import type { ModelProvider, ModelReply, ModelRequest } from "@planner/agent";
import { readMarkers, ScriptedProvider } from "@planner/agent";
import type { AppLogger } from "../src/index.ts";
import {
  createRunHarness,
  deferred,
  intakeReadyToDraft,
  readRunRow,
  runToCompletion,
  startRunOver,
  type RunHarness,
} from "./helpers/runs.ts";

/** What one reply bills in these tests. Four different numbers, so a swapped column shows. */
const PER_REPLY = {
  inputTokens: 100,
  cacheReadTokens: 30,
  cacheWriteTokens: 7,
  outputTokens: 50,
  thinkingTokens: null,
};

interface UsageRow {
  model: string | null;
  model_calls: number | null;
  input_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  output_tokens: number | null;
  thinking_tokens: number | null;
  fallback_calls: number | null;
}

function usageRow(harness: RunHarness, runId: string): UsageRow {
  return harness.app.context.db
    .prepare(
      `SELECT model, model_calls, input_tokens, cache_read_tokens, cache_write_tokens,
              output_tokens, thinking_tokens, fallback_calls
         FROM plan_runs WHERE id = ?`,
    )
    .get(runId) as UsageRow;
}

/**
 * The row `replies` replies of `PER_REPLY` add up to. `thinking` is what each
 * reply reported of its output as reasoning, `null` for a provider that gave no
 * breakdown (the default, as the scripted provider gives none).
 */
function expectedRow(replies: number, fallbacks = 0, thinking: number | null = null): UsageRow {
  return {
    model: "metered",
    model_calls: replies,
    input_tokens: replies * PER_REPLY.inputTokens,
    cache_read_tokens: replies * PER_REPLY.cacheReadTokens,
    cache_write_tokens: replies * PER_REPLY.cacheWriteTokens,
    output_tokens: replies * PER_REPLY.outputTokens,
    thinking_tokens: thinking === null ? null : replies * thinking,
    fallback_calls: fallbacks,
  };
}

/**
 * The scripted answers, billed at `PER_REPLY` each, and optionally one
 * specialist that is served by another model or never answers until aborted.
 */
class MeteredProvider implements ModelProvider {
  readonly name = "metered";
  readonly model = "metered";
  readonly #inner = new ScriptedProvider();
  readonly #options: { servedElsewhere?: string; blocks?: string; thinking?: number };
  readonly #blocked = deferred();
  answered = 0;

  constructor(options: { servedElsewhere?: string; blocks?: string; thinking?: number } = {}) {
    this.#options = options;
  }

  /** Resolves once the blocking specialist is inside `send`. */
  get blocked(): Promise<void> {
    return this.#blocked.promise;
  }

  async send(request: ModelRequest): Promise<ModelReply> {
    const specialist = readMarkers(request.system)?.specialist;

    if (specialist !== undefined && specialist === this.#options.blocks) {
      this.#blocked.resolve();
      return await new Promise<ModelReply>((_resolve, reject) => {
        const stop = (): void => reject(new AppError("JOB_CANCELED"));
        if (request.signal?.aborted === true) stop();
        else request.signal?.addEventListener("abort", stop);
      });
    }

    const reply = await this.#inner.send(request);
    this.answered += 1;
    return {
      ...reply,
      usage: { ...PER_REPLY, thinkingTokens: this.#options.thinking ?? PER_REPLY.thinkingTokens },
      servedModel:
        specialist !== undefined && specialist === this.#options.servedElsewhere
          ? "another-model"
          : this.model,
    };
  }
}

/** A logger that keeps what it was told, for the one test that asserts a line. */
function capturingLogger(): {
  logger: AppLogger;
  warnings: { message: string; fields: unknown }[];
} {
  const warnings: { message: string; fields: unknown }[] = [];
  const logger: AppLogger = {
    debug: () => undefined,
    info: () => undefined,
    warn: (message, fields) => {
      warnings.push({ message, fields });
    },
    error: () => undefined,
    child: () => logger,
  };
  return { logger, warnings };
}

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("condition not met within 10s");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("a run records what it spent", () => {
  test("a done run records every reply, each token kind in its own column", async () => {
    const provider = new MeteredProvider({ servedElsewhere: "lodging" });
    const harness = await createRunHarness({ model: provider });
    try {
      const intakeId = await intakeReadyToDraft(harness.app);
      const run = await startRunOver(harness.app, intakeId);
      const finished = await runToCompletion(harness.app, run.id);

      expect(finished.status).toBe("done");
      expect(provider.answered).toBeGreaterThan(1);
      // One reply was served by another model, and it is counted apart as
      // well as in the totals.
      expect(usageRow(harness, run.id)).toEqual(expectedRow(provider.answered, 1));
    } finally {
      await harness.close();
    }
  });

  test("a reply's thinking tokens are summed into the run's own column, a subset of output and not an addition", async () => {
    // 20 of each reply's 50 output tokens were reasoning. The run's output
    // column is still every reply's 50 — thinking is inside it, not on top.
    const provider = new MeteredProvider({ thinking: 20 });
    const harness = await createRunHarness({ model: provider });
    try {
      const intakeId = await intakeReadyToDraft(harness.app);
      const run = await startRunOver(harness.app, intakeId);
      const finished = await runToCompletion(harness.app, run.id);

      expect(finished.status).toBe("done");
      expect(provider.answered).toBeGreaterThan(1);
      expect(usageRow(harness, run.id)).toEqual(expectedRow(provider.answered, 0, 20));
      expect(usageRow(harness, run.id).output_tokens).toBe(provider.answered * 50);
    } finally {
      await harness.close();
    }
  });

  test("a reply that reported zero thinking records zero, not null", async () => {
    // The deployed default reported zero on every reply it was measured on, so
    // this is the common production value, and `|| null` would erase it.
    const provider = new MeteredProvider({ thinking: 0 });
    const harness = await createRunHarness({ model: provider });
    try {
      const intakeId = await intakeReadyToDraft(harness.app);
      const run = await startRunOver(harness.app, intakeId);
      await runToCompletion(harness.app, run.id);

      expect(provider.answered).toBeGreaterThan(1);
      expect(usageRow(harness, run.id)).toEqual(expectedRow(provider.answered, 0, 0));
      expect(usageRow(harness, run.id).thinking_tokens).toBe(0);
    } finally {
      await harness.close();
    }
  });

  test("a run no reply gave a thinking breakdown for records null, not zero", async () => {
    const provider = new MeteredProvider();
    const harness = await createRunHarness({ model: provider });
    try {
      const intakeId = await intakeReadyToDraft(harness.app);
      const run = await startRunOver(harness.app, intakeId);
      await runToCompletion(harness.app, run.id);

      const row = usageRow(harness, run.id);
      expect(row.output_tokens).toBe(provider.answered * 50);
      expect(row.thinking_tokens).toBeNull();
    } finally {
      await harness.close();
    }
  });

  test("a failed run records the replies it was billed for before it failed", async () => {
    const provider = new MeteredProvider();
    const harness = await createRunHarness({ model: provider });
    try {
      // Every specialist answers, and then writing the revision fails — so the
      // run fails *after* the model was paid, which is the case worth proving.
      harness.app.context.db.exec(`
        CREATE TRIGGER refuse_revisions BEFORE INSERT ON plan_revisions
        BEGIN SELECT RAISE(ABORT, 'the disk is full'); END;
      `);
      const intakeId = await intakeReadyToDraft(harness.app);
      const run = await startRunOver(harness.app, intakeId);
      const finished = await runToCompletion(harness.app, run.id);

      expect(finished.status).toBe("failed");
      expect(provider.answered).toBeGreaterThan(0);
      expect(usageRow(harness, run.id)).toEqual(expectedRow(provider.answered));
    } finally {
      await harness.close();
    }
  });

  test("a canceled run records the replies that finished before the cancellation", async () => {
    // Lodging never answers; everyone else does. The cancel lands once every
    // other specialist's reply is in, so the count is exactly those — and a
    // run that only recorded on `done` would leave every column NULL.
    const provider = new MeteredProvider({ blocks: "lodging" });
    const harness = await createRunHarness({ model: provider });
    try {
      const intakeId = await intakeReadyToDraft(harness.app);
      const run = await startRunOver(harness.app, intakeId);

      await provider.blocked;
      await waitFor(() => {
        const row = readRunRow(harness.app, run.id);
        return row.rosterSize !== null && row.specialistsDone === row.rosterSize - 1;
      });
      const answered = provider.answered;
      expect(answered).toBeGreaterThan(0);

      const response = await harness.app.server.inject({
        method: "POST",
        url: runCancelUrl(run.id),
      });
      expect(response.statusCode).toBe(200);
      const finished = await runToCompletion(harness.app, run.id);

      expect(finished.status).toBe("canceled");
      expect(usageRow(harness, run.id)).toEqual(expectedRow(answered));
    } finally {
      await harness.close();
    }
  });

  test("a usage write that fails leaves the run's outcome as it was, and says so", async () => {
    const { logger, warnings } = capturingLogger();
    const provider = new MeteredProvider();
    const harness = await createRunHarness({ model: provider, logger });
    try {
      harness.app.context.db.exec(`
        CREATE TRIGGER refuse_usage BEFORE UPDATE OF input_tokens ON plan_runs
        BEGIN SELECT RAISE(ABORT, 'usage write refused'); END;
      `);
      const intakeId = await intakeReadyToDraft(harness.app);
      const run = await startRunOver(harness.app, intakeId);
      const finished = await runToCompletion(harness.app, run.id);

      // The plan is the product; the count is bookkeeping about it.
      expect(finished.status).toBe("done");
      expect(finished.error).toBeNull();
      expect(usageRow(harness, run.id).model_calls).toBeNull();
      expect(warnings).toEqual([
        {
          message: "run usage was not recorded",
          fields: expect.objectContaining({ run: run.id, cause: "usage write refused" }),
        },
      ]);
    } finally {
      await harness.close();
    }
  });

  test("a run still in flight has recorded nothing, which reads as null rather than zero", async () => {
    const provider = new MeteredProvider({ blocks: "lodging" });
    const harness = await createRunHarness({ model: provider });
    try {
      const intakeId = await intakeReadyToDraft(harness.app);
      const run = await startRunOver(harness.app, intakeId);
      await provider.blocked;

      expect(usageRow(harness, run.id)).toEqual({
        model: null,
        model_calls: null,
        input_tokens: null,
        cache_read_tokens: null,
        cache_write_tokens: null,
        output_tokens: null,
        thinking_tokens: null,
        fallback_calls: null,
      });
    } finally {
      await harness.close();
    }
  });
});
