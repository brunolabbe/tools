/**
 * Both SDK clients are constructed with an `openTelemetry` option (repo-120).
 *
 * Without one, SDK 1.x reads `ANTHROPIC_OPEN_TELEMETRY`, `_PROPAGATION`,
 * `_TRACES_CONTENT_MODE` and `_TRACES_MAX_CONTENT_BYTES` from the environment,
 * which these modules' headers promise they never do. No tracer provider is
 * registered anywhere in the tool today, so nothing observable comes of that
 * yet; what can be asserted is the option each client was handed, so this spies
 * on the constructor rather than on a wire that stays silent either way.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, test, vi } from "vitest";
import { createLayoutAsk, createModelReader } from "../src/index.ts";

const constructed = vi.hoisted(() => [] as unknown[]);

vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const real = await importOriginal<{ default: typeof Anthropic }>();
  class Spied extends real.default {
    constructor(options: ConstructorParameters<typeof Anthropic>[0]) {
      constructed.push(options);
      super(options);
    }
  }
  return { ...real, default: Spied };
});

const KEY = "sk-ant-test-not-a-key";

describe("the SDK clients", () => {
  test("the receipt reader's is given an openTelemetry option", () => {
    constructed.length = 0;
    createModelReader({ provider: "anthropic", apiKey: KEY });

    expect(constructed).toHaveLength(1);
    expect(constructed[0]).toMatchObject({ openTelemetry: { traces: false, propagation: false } });
  });

  test("the layout describer's is given an openTelemetry option", () => {
    constructed.length = 0;
    createLayoutAsk({ apiKey: KEY });

    expect(constructed).toHaveLength(1);
    expect(constructed[0]).toMatchObject({ openTelemetry: { traces: false, propagation: false } });
  });
});
