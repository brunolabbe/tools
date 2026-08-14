/**
 * The seam every chat backend plugs into.
 *
 * Which model answers is a deployment decision, not an architectural one, and
 * it is the decision most likely to change: a local model over Ollama costs
 * nothing to run, a hosted API costs per token, and the sensible answer differs
 * between a laptop, CI and production. So nothing above this file names a
 * vendor — the API picks an implementation at boot and passes it down.
 *
 * The interface is deliberately the smallest thing that can hold a
 * conversation. Streaming and tool use both matter for a planner and both will
 * land here, but their shapes depend on the loop above them, and an interface
 * guessed at now would be one more thing to unpick. Add them when the caller
 * exists.
 */

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  /** The agent's instructions. Not part of the stored transcript — see `Message`. */
  system: string;
  /** Oldest first. */
  messages: readonly ChatMessage[];
  /**
   * Ceiling on the reply. A planner answers in prose, not in essays, and an
   * unbounded reply is an unbounded bill on a metered provider.
   */
  maxOutputTokens: number;
  signal?: AbortSignal | undefined;
}

export interface ChatUsage {
  /** Null where the provider does not report it — a local model usually will not. */
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface ChatReply {
  content: string;
  /**
   * Why the model stopped. `length` means the reply was cut off at
   * `maxOutputTokens`, which a caller assembling an itinerary needs to know
   * rather than silently keep half of.
   */
  stopReason: "end" | "length" | "refusal";
  usage: ChatUsage;
}

export interface ChatProvider {
  /** Reported by `/api/health` and stamped on log lines. Never includes a key. */
  readonly name: string;
  /**
   * The model actually in use, where the provider knows it. Health reports it
   * because "which model answered" is the first question about a bad reply.
   */
  readonly model: string;
  send(request: ChatRequest): Promise<ChatReply>;
}
