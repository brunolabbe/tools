/**
 * What every suite here needs: a provider it controls, and the day's ceilings.
 *
 * The ceilings come from `@planner/itinerary` rather than from numbers written
 * out again — `dayCapacity` and `tripSpan` are where a day's length is decided,
 * and a test that restated them would pass while the two disagreed, which is
 * exactly the failure pl-9 found in the fixtures. That is also the only reason
 * `@planner/agent` has `@planner/itinerary` in its **dev**Dependencies: no
 * production file here imports it, and the fan-out takes its ceilings as an
 * argument precisely so it does not have to.
 */

import { isAnswered } from "@planner/contract";
import type { Specialist, TripBrief } from "@planner/contract";
import { dayCapacity, tripSpan } from "@planner/itinerary";
import type { ModelProvider, ModelReply, ModelRequest } from "../src/index.ts";
import { readMarkers, type TripCapacity } from "../src/index.ts";

/** The capacity argument `runFanOut` requires, assembled the way `api` will. */
export function capacityOf(brief: TripBrief): TripCapacity {
  if (!isAnswered(brief.dates)) throw new Error("this fixture has no dates");
  return { dayCount: tripSpan(brief.dates.value).dayCount, ...dayCapacity(brief) };
}

/** What one specialist's turn should answer, and how. */
export type Turn =
  | { kind: "content"; content: string }
  | { kind: "reply"; reply: ModelReply }
  | { kind: "throw"; error: unknown };

export function content(value: string): Turn {
  return { kind: "content", content: value };
}

export function candidates(...values: unknown[]): Turn {
  return content(JSON.stringify({ candidates: values }));
}

/**
 * A provider whose answer depends only on which specialist asked — the same key
 * the scripted one uses, so a test can replace one specialist's answers and
 * leave the rest of the fan-out alone.
 *
 * Turns for one specialist are consumed in order and the last repeats, so a
 * re-ask can be scripted as two entries without the test having to know how many
 * attempts the budget allows.
 */
export class FakeProvider implements ModelProvider {
  readonly name = "fake";
  readonly model = "fake";

  readonly #turns: Partial<Record<Specialist, Turn[]>>;
  readonly #fallback: Turn;
  readonly asked: Specialist[] = [];

  constructor(turns: Partial<Record<Specialist, Turn[]>>, fallback: Turn = candidates()) {
    this.#turns = turns;
    this.#fallback = fallback;
  }

  async send(request: ModelRequest): Promise<ModelReply> {
    request.signal?.throwIfAborted();

    const markers = readMarkers(request.system);
    if (markers === null) throw new Error("this provider only answers specialist prompts");
    this.asked.push(markers.specialist);

    const scripted = this.#turns[markers.specialist];
    const used = this.asked.filter((entry) => entry === markers.specialist).length;
    const turn =
      scripted === undefined || scripted.length === 0
        ? this.#fallback
        : (scripted[Math.min(used - 1, scripted.length - 1)] as Turn);

    switch (turn.kind) {
      case "throw":
        throw turn.error;
      case "reply":
        return turn.reply;
      case "content":
        return {
          content: turn.content,
          stopReason: "end",
          usage: { inputTokens: 100, outputTokens: 200 },
        };
    }
  }
}
