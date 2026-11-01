/**
 * The layout describer (lg-66): the text a workbook's samples make in, a
 * model's answer out, as lg-38 and lg-56 measured it. **The model proposes a
 * layout, never rows**; `api` validates the answer against the contract's
 * `workbookLayoutSchema` and reads the file through it.
 *
 * What is sent was measured as one thing, so each part of it is a constant
 * here and nowhere else: the model (Haiku 5.5), the effort (`medium`), the room
 * for the answer (16 000 tokens) and the answer's schema as the structured
 * output's format. The request's text is `api`'s `layoutRequest`, which takes
 * the books' cell grids; this package takes it as a string and never sees a
 * sheet. The measurement harness (`api/test/live/layout-run.ts`) calls the same
 * function with the model and effort it is measuring.
 *
 * **It reads no environment**, for the reasons `reader.ts` gives: every option
 * the SDK would read from the environment when it is not given one is given
 * here, and `api` refuses `ANTHROPIC_CUSTOM_HEADERS` beside a key.
 *
 * **It interprets nothing.** The answer's text, its stop reason and the
 * tokens it cost come back as they are; whether they make a layout is `api`'s
 * to decide, so the harness can score an answer the product would refuse.
 */

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { AppError, workbookLayoutSchema } from "@ledger/contract";
import { failure } from "./failure.ts";
import type { FailureWords, ReaderLogger } from "./failure.ts";
import { ANTHROPIC_BASE_URL } from "./reader.ts";

/** The measured model. Not `RECEIPT_MODEL`: what was measured is this one. */
export const LAYOUT_MODEL = "claude-haiku-5-5";

/** The measured effort. */
export const LAYOUT_EFFORT = "medium";

/** Room for thinking on top of a description of a few hundred tokens, as the measurement gave it. */
export const LAYOUT_MAX_OUTPUT_TOKENS = 16_000;

/** Per attempt, as the measurement's client had it. */
export const LAYOUT_TIMEOUT_MS = 180_000;

/**
 * The answer's schema as the structured output's format: what the model is
 * sent beside the request, `.describe()` texts and all. Pinned by sha256 in
 * `api/test/layout-pins.test.ts`, so an edit to a `.describe()` in the
 * contract is a deliberate edit of the pin.
 */
export function layoutOutputFormat(): ReturnType<
  typeof zodOutputFormat<typeof workbookLayoutSchema>
> {
  return zodOutputFormat(workbookLayoutSchema);
}

/** What a model answered, uninterpreted. */
export interface LayoutAnswer {
  /** The answer's text blocks, joined; `null` when it held none. */
  text: string | null;
  stopReason: string | null;
  inputTokens: number;
  outputTokens: number;
}

/** The seam: one request, one answer. Tests hand in a fake; no test calls a model. */
export type LayoutAsk = (request: string, signal?: AbortSignal) => Promise<LayoutAnswer>;

export interface LayoutAskOptions {
  /** Required, and never read from the environment here. */
  apiKey: string;
  /** The measured model when absent; the harness names the one it measures. */
  model?: string | undefined;
  effort?: "low" | "medium" | "high" | undefined;
  timeoutMs?: number | undefined;
  maxRetries?: number | undefined;
  baseURL?: string | undefined;
  /** How requests leave the process. */
  fetch?: ((input: string | URL | Request, init?: RequestInit) => Promise<Response>) | undefined;
  logger?: ReaderLogger | undefined;
}

const LAYOUT_FAILURES: FailureWords = {
  timeout: "The workbook took too long to describe. Try again.",
  unreachable: "The model that describes a workbook could not be reached. Try again.",
  busy: "The model that describes a workbook is busy. Try again in a moment.",
  refused: "the layout describer's request was refused",
};

export function createLayoutAsk(options: LayoutAskOptions): LayoutAsk {
  if (options.apiKey.trim() === "") {
    // `api` builds none without a key; this is the library saying the same to
    // any other caller, rather than letting the SDK look in the environment.
    throw new AppError("LAYOUT_READER_UNCONFIGURED");
  }
  const model = options.model ?? LAYOUT_MODEL;
  const effort = options.effort ?? LAYOUT_EFFORT;
  const logger = options.logger;
  const client = new Anthropic({
    apiKey: options.apiKey,
    authToken: null,
    webhookKey: null,
    // Given, so the SDK reads no `ANTHROPIC_OPEN_TELEMETRY*` variable. Both
    // off: `openTelemetry: false` alone leaves propagation on.
    openTelemetry: { traces: false, propagation: false },
    baseURL: options.baseURL ?? ANTHROPIC_BASE_URL,
    timeout: options.timeoutMs ?? LAYOUT_TIMEOUT_MS,
    maxRetries: options.maxRetries ?? 2,
    // Its default logger is `console`, which this repo does not write to.
    logLevel: "off",
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  const format = layoutOutputFormat();
  return async (request, signal) => {
    try {
      const message = await client.messages.create(
        {
          model,
          max_tokens: LAYOUT_MAX_OUTPUT_TOKENS,
          output_config: { effort, format },
          messages: [{ role: "user", content: request }],
        },
        signal === undefined ? {} : { signal },
      );
      const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : []));
      return {
        text: text.length === 0 ? null : text.join(""),
        stopReason: message.stop_reason,
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
      };
    } catch (error: unknown) {
      throw failure(error, logger, LAYOUT_FAILURES);
    }
  };
}
