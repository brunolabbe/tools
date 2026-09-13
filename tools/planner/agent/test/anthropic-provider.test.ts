/**
 * The Anthropic provider, against hand-written Messages API responses.
 *
 * **No live call anywhere in this file.** The SDK takes a custom `fetch`, and
 * every request is answered from `fixtures/anthropic-messages.json` — whose
 * header says, and this repeats, that those responses were **written by hand
 * from the documented shape and not captured**, because no key existed where
 * pl-39 was built. pl-28's rule is that fixtures come from real payloads; pl-40
 * is where captured ones replace or confirm these. What this file can prove is
 * that the adapter does the right thing *with the documented shape*. Whether
 * the API really answers in that shape is pl-40's to measure.
 *
 * `maxRetries: 0` everywhere except the one test about retries, so a `429` or
 * a `529` is one request and no backoff sleep.
 */

import { readFileSync } from "node:fs";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AppError, MODEL_ASSERTED, RETRYABLE_CODES } from "@planner/contract";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { loadFixture } from "../../contract/test/fixtures.ts";
import {
  ANTHROPIC_FALLBACK_BETA,
  AnthropicProvider,
  askSpecialist,
  DEFAULT_RUN_BUDGET,
  specialistReplySchema,
} from "../src/index.ts";
import type {
  AnthropicProviderLogger,
  AnthropicProviderOptions,
  ModelRequest,
} from "../src/index.ts";
import { capacityOf } from "./helpers.ts";

interface FixtureResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

const FIXTURES = JSON.parse(
  readFileSync(new URL("./fixtures/anthropic-messages.json", import.meta.url), "utf8"),
) as { header: string; responses: Record<string, FixtureResponse> };

function fixture(name: string): FixtureResponse {
  const found = FIXTURES.responses[name];
  if (found === undefined) throw new Error(`no fixture named ${name}`);
  return found;
}

/** A structured reply whose only text block is `text`, on the ordinary envelope. */
function replyWithText(text: string): FixtureResponse {
  const ordinary = fixture("ordinary");
  const body = structuredClone(ordinary.body) as { content: { type: string; text: string }[] };
  body.content = [{ type: "text", text }];
  return { ...ordinary, body };
}

const KEY = "sk-ant-api03-FIXTURE-KEY-MUST-NEVER-BE-LOGGED";

interface Sent {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

/** A `fetch` that answers from a queue of responses and records what it was sent. */
function answering(...responses: FixtureResponse[]) {
  const sent: Sent[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    sent.push({
      url,
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    const next = responses[Math.min(sent.length - 1, responses.length - 1)];
    if (next === undefined) throw new Error("no response scripted");
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { "content-type": "application/json", ...next.headers },
    });
  };
  return { fetch, sent };
}

function provider(
  fetch: AnthropicProviderOptions["fetch"],
  overrides: Partial<AnthropicProviderOptions> = {},
): AnthropicProvider {
  return new AnthropicProvider({
    apiKey: KEY,
    model: "claude-opus-5",
    effort: "low",
    timeoutMs: 5_000,
    maxRetries: 0,
    fetch,
    ...overrides,
  });
}

const REQUEST: ModelRequest = {
  system: "You are a test.",
  messages: [{ role: "user", content: "Plan nothing." }],
  maxOutputTokens: 8_000,
  replySchema: specialistReplySchema,
};

/** The code a request fails with, and the error itself for the fields. */
async function failure(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }
  throw new Error("expected the request to fail");
}

describe("the fixture file", () => {
  test("says in its header that it was written by hand and not captured", () => {
    expect(FIXTURES.header).toMatch(/^HAND-WRITTEN, NOT CAPTURED/u);
    expect(FIXTURES.header).toContain("pl-40");
  });
});

describe("what the provider sends", () => {
  test("the reply schema as output_config.format, adaptive thinking, the effort, and the fallback with its beta", async () => {
    const { fetch, sent } = answering(fixture("ordinary"));
    await provider(fetch, { effort: "medium" }).send(REQUEST);

    expect(sent).toHaveLength(1);
    const [request] = sent;
    expect(request?.url).toBe("https://api.anthropic.com/v1/messages?beta=true");

    const body = request?.body ?? {};
    expect(body["model"]).toBe("claude-opus-5");
    expect(body["max_tokens"]).toBe(8_000);
    expect(body["system"]).toBe("You are a test.");
    expect(body["messages"]).toEqual([{ role: "user", content: "Plan nothing." }]);
    expect(body["thinking"]).toEqual({ type: "adaptive" });
    expect(body["fallbacks"]).toBe("default");
    // Not a stream, no tools, no stop sequences: the three things that would
    // make a `pause_turn`, `tool_use` or `stop_sequence` stop legitimate.
    expect(body).not.toHaveProperty("stream", true);
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("stop_sequences");

    const config = body["output_config"] as {
      effort: string;
      format: { type: string; schema: unknown };
    };
    expect(config.effort).toBe("medium");
    expect(config.format.type).toBe("json_schema");
    // The same schema `askSpecialist` validates against, sent ahead of the reply.
    expect(config.format.schema).toEqual(schemaFor(specialistReplySchema));

    expect(request?.headers.get("anthropic-beta")).toBe(ANTHROPIC_FALLBACK_BETA);
    expect(ANTHROPIC_FALLBACK_BETA).toBe("server-side-fallback-2026-07-01");
  });

  test("the key it was given, and no bearer token from anywhere else", async () => {
    const { fetch, sent } = answering(fixture("ordinary"));
    await provider(fetch).send(REQUEST);

    expect(sent[0]?.headers.get("x-api-key")).toBe(KEY);
    // `authToken: null` is explicit so a stray ANTHROPIC_AUTH_TOKEN on a host
    // is never sent beside the key.
    expect(sent[0]?.headers.get("authorization")).toBeNull();
  });

  test("no format at all when the caller sent no schema", async () => {
    const { fetch, sent } = answering(fixture("ordinary"));
    await provider(fetch).send({ ...REQUEST, replySchema: undefined });

    expect(sent[0]?.body["output_config"]).toEqual({ effort: "low" });
  });

  test("refuses to construct without a key rather than going looking for one", () => {
    expect(() => provider(undefined, { apiKey: "  " })).toThrow(AppError);
  });
});

describe("the JSON Schema sent for a specialist reply", () => {
  test("is snapshotted, so a zod or SDK upgrade that changes it shows up as a diff", async () => {
    expect(await sentSchema()).toMatchSnapshot();
  });

  test("keeps both discriminated unions as anyOf — and demotes their discriminant to a description", async () => {
    const root = (await sentSchema()) as JsonSchema;
    const resolve = (node: JsonSchema | undefined): JsonSchema | undefined => {
      const ref = node?.$ref;
      if (ref === undefined) return node;
      const name = ref.replace("#/$defs/", "");
      return resolve(root.$defs?.[name]);
    };

    const reply = resolve(root);
    const candidate = resolve(reply?.properties?.["candidates"]?.items);

    // The union survives as `anyOf`, one branch per kind, rather than
    // collapsing into one permissive object.
    const location = resolve(candidate?.properties?.["location"]);
    expect(location?.anyOf).toHaveLength(2);

    // **But the discriminant does not survive as a `const`.** The helper
    // rewrites `kind: z.literal("at")` to a plain string with the literal moved
    // into its description, because the API's schema subset has no `const` —
    // so structured output alone would accept `kind: "between"` carrying only a
    // `place`. Pinned here so the day an SDK keeps the `const` is visible, and
    // it is one more reason `askSpecialist`'s zod validation is the check that
    // counts (pl-39).
    const kinds = location?.anyOf?.map((branch) => resolve(branch)?.properties?.["kind"]);
    expect(kinds).toEqual([
      { type: "string", description: '{const: "at"}' },
      { type: "string", description: '{const: "between"}' },
    ]);

    // `provenance` is omitted from a proposal (pl-36) but survives on the cost
    // band, where it is the other discriminated union the brief named.
    const cost = resolve(candidate?.properties?.["cost"]);
    const band = cost?.anyOf?.map(resolve).find((branch) => branch?.type === "object");
    const provenance = resolve(band?.properties?.["provenance"]);
    expect(provenance?.anyOf?.length).toBeGreaterThanOrEqual(2);
  });
});

describe("what the provider reads back", () => {
  test("an ordinary reply is its text, stopped at the end, with its usage", async () => {
    const { fetch } = answering(fixture("ordinary"));
    const reply = await provider(fetch).send(REQUEST);

    expect(reply.stopReason).toBe("end");
    expect(JSON.parse(reply.content)).toHaveProperty("candidates");
    expect(reply.usage).toEqual({ inputTokens: 780, outputTokens: 210 });
    expect(reply.servedModel).toBe("claude-opus-5");
  });

  test("thinking blocks are dropped, text blocks are concatenated, and cached input counts as input", async () => {
    const { fetch } = answering(fixture("withThinking"));
    const reply = await provider(fetch).send(REQUEST);

    expect(reply.content).toBe('{"candidates":[]}');
    expect(reply.content).not.toContain("THINKING");
    // 700 uncached + 60 read + 40 written. Output already includes thinking.
    expect(reply.usage).toEqual({ inputTokens: 800, outputTokens: 1_400 });
  });

  test("max_tokens is a length stop", async () => {
    const { fetch } = answering(fixture("maxTokens"));
    expect((await provider(fetch).send(REQUEST)).stopReason).toBe("length");
  });

  test("refusal is a refusal", async () => {
    const { fetch } = answering(fixture("refusal"));
    expect((await provider(fetch).send(REQUEST)).stopReason).toBe("refusal");
  });

  test.each(["pauseTurn", "toolUse", "stopSequence"])(
    "%s is malformed, not a silent end — this request sends nothing that could cause it",
    async (name) => {
      const { fetch } = answering(fixture(name));
      const error = await failure(provider(fetch).send(REQUEST));
      expect(error.code).toBe("AGENT_MALFORMED_REPLY");
    },
  );

  test("model_context_window_exceeded is CONTEXT_LIMIT, because the API typed it so", async () => {
    const { fetch } = answering(fixture("contextWindowExceeded"));
    const error = await failure(provider(fetch).send(REQUEST));
    expect(error.code).toBe("CONTEXT_LIMIT");
  });

  test("a fallback-served reply names the model that served it, logs it, and bills both attempts", async () => {
    const warnings: { message: string; fields: Record<string, unknown> | undefined }[] = [];
    const logger: AnthropicProviderLogger = {
      warn: (message, fields) => warnings.push({ message, fields }),
      error: () => undefined,
    };
    const { fetch } = answering(fixture("fallbackServed"));
    const reply = await provider(fetch, { logger }).send(REQUEST);

    expect(reply.servedModel).toBe("claude-opus-4-8");
    expect(reply.stopReason).toBe("end");
    // Top-level usage says 850 out: the serving attempt only. The declined
    // attempt's 120 partial tokens are billed too, and only `iterations`
    // reports them.
    expect(reply.usage).toEqual({ inputTokens: 1_560, outputTokens: 970 });
    expect(warnings).toEqual([
      {
        message: "model reply served by another model",
        fields: expect.objectContaining({ configured: "claude-opus-5", served: "claude-opus-4-8" }),
      },
    ]);
  });
});

describe("how a failure is named", () => {
  test.each([
    ["rateLimited", "RATE_LIMITED"],
    ["unauthorized", "AGENT_UNCONFIGURED"],
    ["forbidden", "AGENT_UNCONFIGURED"],
    ["internalError", "AGENT_UNAVAILABLE"],
    ["overloaded", "AGENT_UNAVAILABLE"],
    ["modelNotFound", "INTERNAL"],
  ] as const)("%s is %s, with the catalog's retryability", async (name, code) => {
    const { fetch } = answering(fixture(name));
    const error = await failure(provider(fetch).send(REQUEST));

    expect(error.code).toBe(code);
    expect(error.retryable).toBe(RETRYABLE_CODES.has(code));
    // Status, the API's type and the request id — never the SDK error itself.
    expect(error.details).toEqual({
      status: fixture(name).status,
      type: (fixture(name).body as { error: { type: string } }).error.type,
      requestId: fixture(name).headers["request-id"],
    });
    expect(error.cause).toBeUndefined();
  });

  test("a 400 that names the context window is INTERNAL — nothing typed says it is CONTEXT_LIMIT", async () => {
    const { fetch } = answering(fixture("promptTooLong"));
    const error = await failure(provider(fetch).send(REQUEST));

    expect(error.code).toBe("INTERNAL");
    expect(error.details).toMatchObject({ status: 400, type: "invalid_request_error" });
  });

  test("a connection that never answers in time is TIMEOUT", async () => {
    const error = await failure(provider(hangUntilAborted, { timeoutMs: 20 }).send(REQUEST));
    expect(error.code).toBe("TIMEOUT");
    expect(error.retryable).toBe(RETRYABLE_CODES.has("TIMEOUT"));
  });

  test("a connection that fails outright is AGENT_UNAVAILABLE", async () => {
    const error = await failure(provider(refuseConnection).send(REQUEST));
    expect(error.code).toBe("AGENT_UNAVAILABLE");
  });

  test("a caller that aborts mid-request gets CANCELED, not a failure", async () => {
    const controller = new AbortController();
    const hang = async (_input: string | URL | Request, init?: RequestInit): Promise<Response> =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
        controller.abort();
      });

    const error = await failure(provider(hang).send({ ...REQUEST, signal: controller.signal }));
    expect(error.code).toBe("CANCELED");
  });

  test("an already-aborted signal sends nothing", async () => {
    const { fetch, sent } = answering(fixture("ordinary"));
    const controller = new AbortController();
    controller.abort();

    const error = await failure(provider(fetch).send({ ...REQUEST, signal: controller.signal }));
    expect(error.code).toBe("CANCELED");
    expect(sent).toHaveLength(0);
  });

  test("the SDK's own retries are what retry a 429, and they are bounded by maxRetries", async () => {
    const { fetch, sent } = answering(fixture("rateLimited"), fixture("ordinary"));
    const reply = await provider(fetch, { maxRetries: 1 }).send(REQUEST);

    expect(sent).toHaveLength(2);
    expect(reply.stopReason).toBe("end");
  });
});

describe("askSpecialist over the real adapter", () => {
  const brief = loadFixture("road-trip").brief;

  /** A proposal that satisfies every constraint JSON Schema can say, and fails the refine. */
  const INVERTED_BAND = {
    title: "A motel with showers",
    summary: "Simple rooms and a kitchenette.",
    location: {
      kind: "at",
      place: { name: "Rimouski", locality: "Québec, Canada", coordinates: null },
    },
    durationMinutes: null,
    cost: { currency: "CAD", low: 200, high: 100, basis: "per-party", provenance: MODEL_ASSERTED },
    season: null,
    bookingLeadTimeDays: 30,
  };

  test("a reply that passes the JSON Schema sent and fails costEstimateSchema's refine is refused, and re-asked as before", async () => {
    const inverted = JSON.stringify({ candidates: [INVERTED_BAND] });
    const fixed = JSON.stringify({
      candidates: [{ ...INVERTED_BAND, cost: { ...INVERTED_BAND.cost, low: 100, high: 200 } }],
    });
    const { fetch, sent } = answering(replyWithText(inverted), replyWithText(fixed));

    const result = await askSpecialist({
      provider: provider(fetch),
      specialist: "lodging",
      shape: "road-trip",
      brief,
      capacity: capacityOf(brief),
      budget: DEFAULT_RUN_BUDGET,
    });

    // The first reply is valid against the schema that was actually sent —
    // proven by validating it against that schema, not by assuming it.
    const sentSchemaFirst = outputConfigOf(sent[0]).format?.schema;
    // `askSpecialist` itself put the schema on the request — not merely the
    // provider when handed one.
    expect(sentSchemaFirst).toEqual(schemaFor(specialistReplySchema));
    expect(
      z
        .fromJSONSchema(sentSchemaFirst as Parameters<typeof z.fromJSONSchema>[0])
        .safeParse(JSON.parse(inverted)).success,
    ).toBe(true);
    // …and invalid against the zod schema `askSpecialist` validates with.
    expect(specialistReplySchema.safeParse(JSON.parse(inverted)).success).toBe(false);

    // Refused once and re-asked exactly as before: the re-ask carries the
    // first reply and the complaint naming the refine, and the same schema.
    expect(sent).toHaveLength(2);
    const reasked = sent[1]?.body["messages"] as { role: string; content: string }[];
    expect(reasked).toHaveLength(3);
    expect(reasked[1]).toEqual({ role: "assistant", content: inverted });
    expect(reasked[2]?.content).toContain("high end is below its low end");
    expect(outputConfigOf(sent[1]).format).toEqual(outputConfigOf(sent[0]).format);

    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]?.cost).toMatchObject({ low: 100, high: 200 });
  });
});

interface JsonSchema {
  type?: string;
  const?: unknown;
  description?: string;
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
  anyOf?: JsonSchema[];
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
}

interface SentOutputConfig {
  effort?: string;
  format?: { type: string; schema: unknown };
}

/**
 * A request's `output_config`, or an empty one. Empty rather than `undefined`,
 * so an assertion about a missing format fails on the value it reads instead
 * of throwing on the way to it.
 */
function outputConfigOf(request: Sent | undefined): SentOutputConfig {
  return (request?.body["output_config"] ?? {}) as SentOutputConfig;
}

/** A `fetch` that never answers, and gives up only when its signal is aborted. */
async function hangUntilAborted(
  _input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => {
      reject(new DOMException("The operation was aborted.", "AbortError"));
    });
  });
}

/** A `fetch` whose connection fails before any response, the way `undici` reports it. */
async function refuseConnection(): Promise<Response> {
  throw new TypeError("fetch failed");
}

/** The JSON Schema the provider actually put on the wire for `specialistReplySchema`. */
async function sentSchema(): Promise<unknown> {
  const { fetch, sent } = answering(fixture("ordinary"));
  await provider(fetch).send(REQUEST);
  return outputConfigOf(sent[0]).format?.schema;
}

/**
 * What the SDK's beta helper derives from a zod schema — the whole object, so
 * "the provider sent this schema" is an equality and not a resemblance.
 */
function schemaFor(schema: z.ZodType): unknown {
  return betaZodOutputFormat(schema).schema;
}
