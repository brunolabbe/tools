/**
 * A provider that answers from a script instead of from a model.
 *
 * Two jobs, both real. Tests get fixed replies, so an assertion about the code
 * that called the model is not an assertion about a model's mood. And a
 * developer with no API key — or no wish to spend one — gets a UI that works
 * end to end, which is the same trick the downloader's mocked transport plays.
 *
 * It is not a stub in the sense of "unfinished": it never becomes a model, and
 * it should stay honest about being scripted rather than trying to sound clever.
 *
 * ## It now answers the fan-out, and it answers it by name
 *
 * The whole roster has to run offline with no key, or "the scripted provider is
 * the default" is a claim about a health endpoint rather than about the tool. So
 * a request whose system prompt carries the two machine-readable lines every
 * specialist prompt opens with — `Trip shape:` and `Specialist:` — is answered
 * from `SCRIPTED_FAN_OUT`, keyed by exactly that pair.
 *
 * **A pair with no entry gets an empty candidate list, not a plausible one.**
 * That reaches the plan as a `no-candidates-found` gap, which is the honest
 * outcome and is the repo's _never fake progress_ rule in the one place it would
 * be easiest to break: a scripted provider that invented a hotel to fill a shape
 * would be indistinguishable from a model doing the same thing, which is the
 * failure the whole provenance mechanism exists to make visible.
 *
 * Anything that is not a specialist prompt falls through to `replies`, so the
 * plain script keeps working exactly as it did.
 */

import { AppError } from "@planner/contract";
import { readMarkers } from "../prompt.ts";
import type { ModelProvider, ModelReply, ModelRequest } from "../provider.ts";
import { SCRIPTED_FAN_OUT } from "./scripted-fan-out.ts";

export interface ScriptedProviderOptions {
  /**
   * Replies, handed out in order. The last one repeats once the script runs
   * out — a test that dies because the tester wrote four replies and the code
   * asked for a fifth teaches nothing.
   */
  replies: readonly string[];
  /**
   * Answer specialist prompts from `SCRIPTED_FAN_OUT` rather than from
   * `replies`. On by default, because a fresh clone must be able to plan; a test
   * that wants to script the fan-out's replies by hand — including the malformed
   * ones — turns it off.
   */
  fanOut?: boolean;
}

const DEFAULT_REPLIES: readonly string[] = [
  "This server is running the scripted planner, so I am not a real assistant yet — " +
    "but the wiring works. Configure a model provider to plan an actual trip.",
];

export class ScriptedProvider implements ModelProvider {
  readonly name = "scripted";
  readonly model = "scripted";

  readonly #replies: readonly string[];
  readonly #fanOut: boolean;
  #turn = 0;

  constructor(options: ScriptedProviderOptions = { replies: DEFAULT_REPLIES }) {
    if (options.replies.length === 0) {
      throw new AppError("AGENT_UNCONFIGURED", "The scripted provider was given no replies.");
    }
    this.#replies = options.replies;
    this.#fanOut = options.fanOut ?? true;
  }

  async send(request: ModelRequest): Promise<ModelReply> {
    // Honoured even though nothing here is slow: a caller that cancels expects
    // cancellation, and a provider that ignores it hides the bug in the caller.
    request.signal?.throwIfAborted();

    const markers = this.#fanOut ? readMarkers(request.system) : null;
    if (markers !== null) {
      const candidates = SCRIPTED_FAN_OUT[markers.shape][markers.specialist] ?? [];
      return reply(JSON.stringify({ candidates }));
    }

    const index = Math.min(this.#turn, this.#replies.length - 1);
    this.#turn += 1;
    // Non-null: `index` is clamped into range and the constructor refused an
    // empty script, so this cannot miss.
    return reply(this.#replies[index] as string);
  }
}

/**
 * The fan-out's turn counter is deliberately not advanced.
 *
 * Specialists run concurrently, so "the third reply" would depend on which of
 * them the event loop reached first — a script that is different every run is
 * not a script. The pair of markers is the whole key, and it is stable.
 */
function reply(content: string): ModelReply {
  return { content, stopReason: "end", usage: { inputTokens: null, outputTokens: null } };
}
