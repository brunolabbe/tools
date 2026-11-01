/**
 * The SDK client is constructed with an `openTelemetry` option (repo-120).
 *
 * Without one, SDK 1.x reads `ANTHROPIC_OPEN_TELEMETRY`, `_PROPAGATION`,
 * `_TRACES_CONTENT_MODE` and `_TRACES_MAX_CONTENT_BYTES` from the environment,
 * which this provider's header promises it never does. No tracer provider is
 * registered anywhere in the tool today, so nothing observable comes of that
 * yet; what can be asserted is the option the client was handed, so this spies
 * on the constructor rather than on a wire that stays silent either way.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, test, vi } from "vitest";
import { AnthropicProvider } from "../src/index.ts";

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

describe("the provider's SDK client", () => {
  test("is given an openTelemetry option, so the SDK reads no OpenTelemetry variable", () => {
    constructed.length = 0;
    const provider = new AnthropicProvider({
      apiKey: "sk-ant-test-not-a-key",
      model: "claude-opus-5",
      effort: "low",
      timeoutMs: 5_000,
    });

    expect(provider.name).toBe("anthropic");
    expect(constructed).toHaveLength(1);
    expect(constructed[0]).toMatchObject({ openTelemetry: { traces: false, propagation: false } });
  });
});
