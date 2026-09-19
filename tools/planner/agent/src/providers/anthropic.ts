/**
 * The first real model behind the seam: Anthropic's Messages API.
 *
 * Decided by the repo owner on 2026-09-13, from options with measurements
 * attached, and argued in pl-39: Anthropic, `claude-opus-5` by default,
 * structured outputs through the seam rather than prompt-JSON and re-ask, and
 * adaptive thinking at a low effort. Nothing above this file names the vendor —
 * `createModelProvider` in `api/src/server.ts` is still the only place in the
 * tool that picks a backend by name, and it lives beside `scripted.ts` because
 * `agent` is everything that talks to a model.
 *
 * ## It reads no environment
 *
 * The SDK reads `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`,
 * `ANTHROPIC_BASE_URL` and `ANTHROPIC_LOG` from `process.env` for any option it
 * is not given, and `api/src/config.ts` is the only file in this tool allowed to
 * read the environment. So every one of those is passed explicitly, including
 * the ones that are "nothing": a stray `ANTHROPIC_AUTH_TOKEN` on a host would
 * otherwise be sent beside the key, and the API rejects a request carrying both.
 * The one it reads unconditionally is `ANTHROPIC_CUSTOM_HEADERS`, which no
 * option switches off — and it can replace the key rather than add to it: an
 * `x-api-key` line in that variable overwrites the one passed here. This file
 * cannot refuse it, because it reads no environment: `loadApiConfig` in `api`
 * refuses to boot `anthropic` while the variable is set (the owner's decision
 * on pl-39).
 *
 * ## Structured output is a promise, not the check
 *
 * `replySchema` goes out as `output_config.format`, derived by the SDK's own
 * zod helper. The API accepts only part of JSON Schema — no numeric or length
 * bounds, and a `.refine` has no JSON Schema form at all — so the helper strips
 * what it cannot send. `askSpecialist` validates the reply against the full zod
 * schema afterwards, and that is the validation that counts.
 *
 * ## A refusal can be answered by another model
 *
 * `fallbacks: "default"` re-runs a declined request on a model Anthropic picks
 * by refusal category, inside the same call. So the reply's `model` is not
 * always the configured one, which is why `ModelReply.servedModel` exists and
 * why it is logged when it differs. It also means one attempt can bill twice:
 * the declined model's partial output and the fallback model's whole reply.
 * Top-level `usage` covers only the attempt that produced the message, so the
 * count here is summed over `usage.iterations`, which reports every attempt.
 *
 * ## Errors are mapped by class, never by message
 *
 * A guessed match on an error's text is how a real `400` hides behind a
 * plausible code. See `failure` for the table and why `CONTEXT_LIMIT` never
 * comes out of a `400` here.
 */

import Anthropic, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  InternalServerError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type {
  BetaMessage,
  BetaUsage,
  MessageCreateParamsNonStreaming as BetaMessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { AppError } from "@planner/contract";
import type { ErrorCode } from "@planner/contract";
import type { ModelProvider, ModelReply, ModelRequest, ModelUsage } from "../provider.ts";

/** Every effort level the API accepts, lowest first. `MODEL_EFFORT` is one of these. */
export const ANTHROPIC_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type AnthropicEffort = (typeof ANTHROPIC_EFFORTS)[number];

/**
 * The beta that gates `fallbacks: "default"`.
 *
 * Exactly this date, and not the `-2026-06-01` one: that header gates the
 * *array* form, and pairing either header with the other form is a `400`.
 */
export const ANTHROPIC_FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** Where the API lives. Explicit, so the SDK never reads `ANTHROPIC_BASE_URL`. */
export const ANTHROPIC_BASE_URL = "https://api.anthropic.com";

/**
 * The SDK's own retry count, made explicit rather than inherited.
 *
 * It already retries `408`, `409`, `429`, `5xx` and a dropped connection with
 * backoff. Nothing above this seam retries on `AppError.retryable` today, and a
 * second layer that did would multiply wall-clock rather than success.
 */
export const ANTHROPIC_MAX_RETRIES = 2;

/** The part of `api`'s logger this needs. `agent` owns no logger of its own. */
export interface AnthropicProviderLogger {
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export interface AnthropicProviderOptions {
  /** Required, and never read from the environment here. */
  apiKey: string;
  model: string;
  effort: AnthropicEffort;
  /** Per attempt. The SDK retries a timeout, so wall-clock can reach `(maxRetries + 1) ×` this. */
  timeoutMs: number;
  maxRetries?: number | undefined;
  baseURL?: string | undefined;
  /** How requests leave the process. Tests answer from fixtures through this; nothing else sets it. */
  fetch?: ((input: string | URL | Request, init?: RequestInit) => Promise<Response>) | undefined;
  logger?: AnthropicProviderLogger | undefined;
}

export class AnthropicProvider implements ModelProvider {
  readonly name = "anthropic";
  readonly model: string;

  readonly #client: Anthropic;
  readonly #effort: AnthropicEffort;
  readonly #logger: AnthropicProviderLogger | undefined;

  constructor(options: AnthropicProviderOptions) {
    // `api` refuses to boot without a key before it gets here. This is the
    // library saying the same thing to any other caller, rather than letting
    // the SDK go looking for a key in the environment.
    if (options.apiKey.trim() === "") {
      throw new AppError("AGENT_UNCONFIGURED", "The Anthropic provider was given no API key.");
    }

    this.model = options.model;
    this.#effort = options.effort;
    this.#logger = options.logger;
    this.#client = new Anthropic({
      apiKey: options.apiKey,
      authToken: null,
      webhookKey: null,
      baseURL: options.baseURL ?? ANTHROPIC_BASE_URL,
      timeout: options.timeoutMs,
      maxRetries: options.maxRetries ?? ANTHROPIC_MAX_RETRIES,
      // The SDK's default logger is `console`, which this repo does not write
      // to. Failures are reported through `logger` below, by hand, so that what
      // reaches a log line is chosen field by field.
      logLevel: "off",
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
  }

  async send(request: ModelRequest): Promise<ModelReply> {
    if (request.signal?.aborted === true) throw new AppError("CANCELED");

    let message: BetaMessage;
    try {
      message = await this.#client.beta.messages.create(this.#params(request), {
        signal: request.signal,
      });
    } catch (error: unknown) {
      throw this.#failure(error, request.signal);
    }

    return this.#reply(message);
  }

  #params(request: ModelRequest): BetaMessageCreateParamsNonStreaming {
    return {
      model: this.model,
      max_tokens: request.maxOutputTokens,
      system: request.system,
      messages: request.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      // Not `disabled`, and not a config combination: on Opus 5 that is
      // accepted only at effort `high` or below, and with thinking off the model
      // can leak tags into its text — which `askSpecialist` would then refuse
      // as malformed. Effort is the lever; thinking stays adaptive.
      thinking: { type: "adaptive" },
      output_config:
        request.replySchema === undefined
          ? { effort: this.#effort }
          : { effort: this.#effort, format: betaZodOutputFormat(request.replySchema) },
      fallbacks: "default",
      betas: [ANTHROPIC_FALLBACK_BETA],
    };
  }

  #reply(message: BetaMessage): ModelReply {
    const stopReason = stopReasonOf(message);

    // Text blocks only. Thinking blocks are the model's working, a `fallback`
    // block marks where one model handed over to another, and neither is the
    // answer.
    const content = message.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("");

    if (message.model !== this.model) {
      this.#logger?.warn("model reply served by another model", {
        provider: this.name,
        configured: this.model,
        served: message.model,
        requestId: message.id,
      });
    }

    return { content, stopReason, usage: usageOf(message.usage), servedModel: message.model };
  }

  /**
   * An SDK failure as this tool's taxonomy, most specific class first.
   *
   * | SDK                                              | Code                 |
   * | ------------------------------------------------ | -------------------- |
   * | aborted by `signal`                              | `CANCELED`           |
   * | `APIConnectionTimeoutError`                      | `TIMEOUT`            |
   * | `RateLimitError`                                 | `RATE_LIMITED`       |
   * | `AuthenticationError`, `PermissionDeniedError`   | `AGENT_UNCONFIGURED` |
   * | `NotFoundError` (an unknown `MODEL`)             | `AGENT_UNCONFIGURED` |
   * | `InternalServerError`, 529, `APIConnectionError` | `AGENT_UNAVAILABLE`  |
   * | anything else, every `400` included              | `INTERNAL`           |
   *
   * **No `400` becomes `CONTEXT_LIMIT`.** The rule was "only when the error
   * type says so", and in the API's `ErrorType` union no type does: a prompt
   * too long for the window is an `invalid_request_error`, like every other
   * malformed request, and only its message tells them apart. The typed signal
   * for an exhausted window is the `model_context_window_exceeded` stop reason,
   * which `stopReasonOf` maps.
   *
   * **The error object is never logged and never attached as a cause.** It
   * carries the request that produced it, and the request carries `x-api-key`.
   * What is kept is the status, the API's error type and the request id —
   * chosen field by field, so a key cannot ride along inside something nobody
   * meant to log.
   *
   * Retryability is the catalog's, not decided here: `TIMEOUT`, `RATE_LIMITED`
   * and `AGENT_UNAVAILABLE` are in `RETRYABLE_CODES`; `AGENT_UNCONFIGURED` and
   * `INTERNAL` are not, because a bad key answers the same way every time.
   */
  #failure(error: unknown, signal: AbortSignal | undefined): AppError {
    if (error instanceof AppError) return error;
    // The signal first: a caller that stopped the run is a canceled run, not a
    // failed one, whatever shape the abort arrived in.
    if (signal?.aborted === true || error instanceof APIUserAbortError) {
      return new AppError("CANCELED");
    }

    const code = codeFor(error);
    const fields = {
      provider: this.name,
      model: this.model,
      code,
      ...(error instanceof APIError
        ? {
            status: error.status ?? null,
            type: error.type ?? null,
            requestId: error.requestID ?? null,
          }
        : {}),
    };

    if (code === "INTERNAL") this.#logger?.error("model request failed", fields);
    else this.#logger?.warn("model request failed", fields);

    const { provider: _provider, model: _model, code: _code, ...details } = fields;
    return new AppError(code, undefined, { details });
  }
}

function codeFor(error: unknown): ErrorCode {
  // `APIConnectionTimeoutError` extends `APIConnectionError`, so it has to be
  // asked about first or every timeout reads as the vendor being down.
  if (error instanceof APIConnectionTimeoutError) return "TIMEOUT";
  if (error instanceof RateLimitError) return "RATE_LIMITED";
  // A bad or unauthorised key, or a `MODEL` the API has never heard of, is
  // this server's configuration, and `AGENT_UNCONFIGURED`'s copy says so to the
  // user. The `404` joined by the owner's decision on pl-39: a model typo
  // answers the same way on every request, like a bad key.
  if (
    error instanceof AuthenticationError ||
    error instanceof PermissionDeniedError ||
    error instanceof NotFoundError
  ) {
    return "AGENT_UNCONFIGURED";
  }
  // The SDK raises `InternalServerError` for every status from 500 up, 529
  // (overloaded) included.
  if (error instanceof InternalServerError || error instanceof APIConnectionError) {
    return "AGENT_UNAVAILABLE";
  }
  return "INTERNAL";
}

/**
 * Why the model stopped, in the seam's words — or why this reply is not one.
 *
 * `pause_turn`, `tool_use`, `stop_sequence` and `compaction` can only come from
 * a request carrying tools, stop sequences or context management, and this one
 * sends none. A reply that stopped for one of them is something this request
 * should not have been able to produce, so it is malformed rather than a silent
 * `end` whose content is half of something else.
 */
function stopReasonOf(message: BetaMessage): ModelReply["stopReason"] {
  switch (message.stop_reason) {
    case "end_turn":
      return "end";
    case "max_tokens":
      return "length";
    case "refusal":
      return "refusal";
    case "model_context_window_exceeded":
      throw new AppError("CONTEXT_LIMIT", undefined, {
        details: { stopReason: message.stop_reason, requestId: message.id },
      });
    default:
      throw new AppError("AGENT_MALFORMED_REPLY", undefined, {
        details: { stopReason: message.stop_reason, requestId: message.id },
      });
  }
}

/**
 * What this call billed, summed over every attempt the API reports.
 *
 * **Each input kind is reported apart** (pl-49): uncached, cache-read and
 * cache-written tokens are all input this call sent, at three different
 * prices, and until pl-49 they were summed into one number no rate could price.
 * Output already includes thinking. Where `iterations` is present it is the
 * per-attempt source of truth, and the top-level count covers only the attempt
 * that produced the message: after a fallback that is the fallback model alone,
 * and the declined model's partial output would silently fall out of the bill.
 *
 * A cache kind no attempt reported stays `null` rather than becoming zero —
 * the SDK types both as nullable, and "the API did not say" is not "none".
 *
 * **`thinkingTokens` cannot follow that same per-attempt sum, because the API
 * does not offer it per attempt (pl-50).** `output_tokens_details` is declared
 * on `BetaUsage` — the top-level `usage` this function receives — and is
 * absent from every member of `BetaIterationsUsage`
 * (`BetaMessageIterationUsage`, `BetaCompactionIterationUsage`,
 * `BetaAdvisorMessageIterationUsage`, `BetaFallbackMessageIterationUsage`),
 * confirmed by reading all four in `@anthropic-ai/sdk@0.125.0`'s own types,
 * not assumed from pl-50's own prose (whose Build step 2 asked for the same
 * per-iteration sum the other kinds get, which the SDK cannot supply). So
 * this is read once, from `usage` itself, never from `attempts`: it carries
 * the same "top-level covers only the serving attempt" caveat the other kinds
 * only have when a fallback occurred, except here there is no richer source
 * to fall back to — a declined attempt's thinking, if any, is simply not
 * reported anywhere the SDK's types can reach.
 */
function usageOf(usage: BetaUsage): ModelUsage {
  const attempts =
    usage.iterations !== null && usage.iterations.length > 0 ? usage.iterations : [usage];

  let inputTokens = 0;
  let cacheReadTokens: number | null = null;
  let cacheWriteTokens: number | null = null;
  let outputTokens = 0;
  for (const attempt of attempts) {
    inputTokens += attempt.input_tokens;
    if (attempt.cache_read_input_tokens !== null) {
      cacheReadTokens = (cacheReadTokens ?? 0) + attempt.cache_read_input_tokens;
    }
    if (attempt.cache_creation_input_tokens !== null) {
      cacheWriteTokens = (cacheWriteTokens ?? 0) + attempt.cache_creation_input_tokens;
    }
    outputTokens += attempt.output_tokens;
  }
  const thinkingTokens = usage.output_tokens_details?.thinking_tokens ?? null;
  return { inputTokens, cacheReadTokens, cacheWriteTokens, outputTokens, thinkingTokens };
}
