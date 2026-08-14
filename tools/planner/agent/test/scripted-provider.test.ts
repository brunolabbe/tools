import { describe, expect, test } from "vitest";
import { AppError } from "@planner/contract";
import { ScriptedProvider } from "../src/index.ts";
import type { ChatRequest } from "../src/index.ts";

function request(overrides: Partial<ChatRequest> = {}): ChatRequest {
  return {
    system: "You plan trips.",
    messages: [{ role: "user", content: "Two weeks in Portugal, in October." }],
    maxOutputTokens: 256,
    ...overrides,
  };
}

describe("the scripted provider", () => {
  test("hands out its replies in order", async () => {
    const provider = new ScriptedProvider({ replies: ["first", "second"] });
    expect((await provider.send(request())).content).toBe("first");
    expect((await provider.send(request())).content).toBe("second");
  });

  test("repeats the last reply rather than running dry", async () => {
    const provider = new ScriptedProvider({ replies: ["only"] });
    await provider.send(request());
    // A conversation that dies mid-test because the script was one turn short
    // would fail the test for a reason that has nothing to do with the loop.
    expect((await provider.send(request())).content).toBe("only");
  });

  test("refuses an empty script instead of answering nothing", () => {
    expect(() => new ScriptedProvider({ replies: [] })).toThrow(AppError);
  });

  test("honours an aborted signal", async () => {
    const provider = new ScriptedProvider({ replies: ["never seen"] });
    const controller = new AbortController();
    controller.abort();
    await expect(provider.send(request({ signal: controller.signal }))).rejects.toThrow();
  });

  test("reports no usage rather than inventing token counts", async () => {
    const reply = await new ScriptedProvider({ replies: ["hello"] }).send(request());
    expect(reply.usage).toEqual({ inputTokens: null, outputTokens: null });
    expect(reply.stopReason).toBe("end");
  });
});
