/**
 * The seam every model backend plugs into.
 *
 * Which model answers is a deployment decision, not an architectural one, and
 * it is the decision most likely to change: a local model over Ollama costs
 * nothing to run, a hosted API costs per token, and the sensible answer differs
 * between a laptop, CI and production. So nothing above this file names a
 * vendor — the API picks an implementation at boot and passes it down.
 *
 * The interface is deliberately the smallest thing that can carry one model
 * call. `messages` is the provider API's shape and not a transcript: the intake
 * asks authored questions with no model in it, and the callers this seam is
 * waiting for are the specialists in the fan-out, each of which reads a
 * `TripBrief` and asks once.
 *
 * Streaming and tool use both matter for a planner and both will land here, but
 * their shapes depend on the caller above them, and an interface guessed at now
 * would be one more thing to unpick. Add them when the caller exists.
 *
 * **A reply schema is the first of those to land, because its caller did**
 * (pl-39). `askSpecialist` already validated every reply against
 * `specialistReplySchema`; `replySchema` sends the same schema ahead of the
 * reply as well, to a backend that can constrain its output to it. It is the
 * zod original rather than a JSON Schema object, because `agent` already speaks
 * zod and a vendor's helper needs the original to derive its own wire format.
 * A backend that cannot enforce a schema ignores the field — the scripted one
 * does — and nothing about the caller's own validation changes either way.
 */

import type { z } from "zod";

export interface ModelMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ModelRequest {
  /** The agent's instructions. */
  system: string;
  /** Oldest first. */
  messages: readonly ModelMessage[];
  /**
   * Ceiling on the reply. A planner answers in prose, not in essays, and an
   * unbounded reply is an unbounded bill on a metered provider.
   */
  maxOutputTokens: number;
  /**
   * The shape the reply must take, for a backend that can hold it to one.
   *
   * **A promise about the shape, never the check of it.** A vendor's structured
   * output cannot carry every constraint a zod schema can — a `.refine` does not
   * survive JSON Schema at all — so the caller validates the reply against this
   * same schema afterwards, and that validation is the one that counts.
   */
  replySchema?: z.ZodType | undefined;
  signal?: AbortSignal | undefined;
}

/**
 * What one call billed, token kind by token kind (pl-49).
 *
 * **The three input kinds are kept apart because they are priced apart.** A
 * cache read bills at about a tenth of the input rate and a cache write at
 * about a quarter more, so one input total priced at one rate is wrong in
 * whichever direction the cache went. Before pl-49 `inputTokens` was all three
 * summed; it is now the uncached input alone, which is also what the Messages
 * API's own `input_tokens` means.
 *
 * Every field is `null` where the provider does not report that kind — a local
 * model usually reports none, and the scripted provider reports none on
 * purpose. `null` is "nobody said", never zero.
 *
 * **`thinkingTokens` is a subset of `outputTokens`, not a fifth kind billed
 * apart (pl-50).** Thinking is billed as ordinary output — `outputTokens`
 * already includes it — so this field exists only to say how much of that
 * total was spent thinking, for a report that wants the split. A backend
 * that does not report the breakdown leaves it `null` the same way it would
 * any other unreported kind.
 */
export interface ModelUsage {
  /** Uncached input only. */
  inputTokens: number | null;
  /** Input served from the prompt cache. */
  cacheReadTokens: number | null;
  /** Input written to the prompt cache. */
  cacheWriteTokens: number | null;
  /** Output, thinking included where the model thinks. */
  outputTokens: number | null;
  /** How much of `outputTokens` was internal reasoning, where the provider says. */
  thinkingTokens: number | null;
}

export interface ModelReply {
  content: string;
  /**
   * Why the model stopped. `length` means the reply was cut off at
   * `maxOutputTokens`, which a caller assembling an itinerary needs to know
   * rather than silently keep half of.
   */
  stopReason: "end" | "length" | "refusal";
  usage: ModelUsage;
  /**
   * The model that actually produced this reply, where the backend says.
   *
   * Not always `ModelProvider.model`: a backend with server-side refusal
   * fallbacks can answer one request on another model, and "which model
   * answered" is the first question about a bad candidate. `model` is what was
   * configured; this is what served. Absent where the backend does not report
   * it — the scripted provider has nothing to report.
   */
  servedModel?: string | undefined;
}

export interface ModelProvider {
  /** Reported by `/api/health` and stamped on log lines. Never includes a key. */
  readonly name: string;
  /**
   * The model actually in use, where the provider knows it. Health reports it
   * because "which model answered" is the first question about a bad reply.
   */
  readonly model: string;
  send(request: ModelRequest): Promise<ModelReply>;
}
