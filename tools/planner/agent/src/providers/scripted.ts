/**
 * A provider that answers from a script instead of from a model.
 *
 * Two jobs, both real. Tests get a conversation loop whose replies are fixed,
 * so an assertion about the loop is not an assertion about a model's mood. And
 * a developer with no API key — or no wish to spend one — gets a UI that works
 * end to end, which is the same trick the downloader's mocked transport plays.
 *
 * It is not a stub in the sense of "unfinished": it never becomes a model, and
 * it should stay honest about being scripted rather than trying to sound clever.
 */

import { AppError } from "@planner/contract";
import type { ChatProvider, ChatReply, ChatRequest } from "../provider.ts";

export interface ScriptedProviderOptions {
  /**
   * Replies, handed out in order. The last one repeats once the script runs
   * out — a conversation that dies mid-test because the tester wrote four
   * replies and the loop asked for a fifth teaches nothing.
   */
  replies: readonly string[];
}

const DEFAULT_REPLIES: readonly string[] = [
  "This server is running the scripted planner, so I am not a real assistant yet — " +
    "but the wiring works. Configure a chat provider to plan an actual trip.",
];

export class ScriptedProvider implements ChatProvider {
  readonly name = "scripted";
  readonly model = "scripted";

  readonly #replies: readonly string[];
  #turn = 0;

  constructor(options: ScriptedProviderOptions = { replies: DEFAULT_REPLIES }) {
    if (options.replies.length === 0) {
      throw new AppError("AGENT_UNCONFIGURED", "The scripted provider was given no replies.");
    }
    this.#replies = options.replies;
  }

  async send(request: ChatRequest): Promise<ChatReply> {
    // Honoured even though nothing here is slow: a caller that cancels expects
    // cancellation, and a provider that ignores it hides the bug in the caller.
    request.signal?.throwIfAborted();

    const index = Math.min(this.#turn, this.#replies.length - 1);
    this.#turn += 1;
    // Non-null: `index` is clamped into range and the constructor refused an
    // empty script, so this cannot miss.
    const content = this.#replies[index] as string;

    return { content, stopReason: "end", usage: { inputTokens: null, outputTokens: null } };
  }
}
