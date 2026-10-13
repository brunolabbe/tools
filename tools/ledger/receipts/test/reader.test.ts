/**
 * The model reader (lg-8), answered from fixtures through its `fetch`: no test
 * here reaches a model. What is checked is the request it builds — the model,
 * the photo as sent, the schema — and what it makes of each kind of answer.
 * Every merchant and amount is invented.
 */

import { Buffer } from "node:buffer";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AppError } from "@ledger/contract";
import { DEFAULT_RECEIPT_MODEL, RECEIPT_PROMPT, createModelReader } from "../src/index.ts";
import type { ReceiptPhoto } from "../src/index.ts";

const KEY = "sk-ant-test-not-a-key";

/** A few bytes that stand for a photo; the reader never looks inside one. */
const PHOTO: ReceiptPhoto = {
  bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]),
  mediaType: "image/jpeg",
};

/** A Messages API reply carrying `text`, as the API shapes one. */
function message(text: string, stopReason = "end_turn"): Response {
  return Response.json({
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: DEFAULT_RECEIPT_MODEL,
    content: [{ type: "text", text }],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 2_800, output_tokens: 140 },
  });
}

interface Sent {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

function answering(...replies: (() => Response)[]): {
  fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  sent: Sent[];
} {
  const sent: Sent[] = [];
  let next = 0;
  return {
    sent,
    async fetch(input, init) {
      const url = input instanceof Request ? input.url : String(input);
      sent.push({
        url,
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });
      const reply = replies[Math.min(next, replies.length - 1)];
      next += 1;
      if (reply === undefined) throw new Error("no reply");
      return reply();
    },
  };
}

function reader(fetch: ReturnType<typeof answering>["fetch"], model?: string) {
  return createModelReader({
    provider: "anthropic",
    apiKey: KEY,
    ...(model === undefined ? {} : { model }),
    maxRetries: 0,
    fetch,
  });
}

const TWO_RECEIPTS = JSON.stringify({
  receipts: [
    {
      merchant: "Marché Exemple",
      date: "2026-10-04",
      subtotal: 2_500,
      gst: 50,
      qst: 100,
      total: 2_650,
    },
    { merchant: "  ", date: "2026-02-30", subtotal: 1_899, gst: null, qst: null, total: 1_899 },
  ],
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the model reader", () => {
  test("sends the photo as it was uploaded to Haiku 5.5, with the schema and the prompt", async () => {
    const api = answering(() => message(TWO_RECEIPTS));

    await reader(api.fetch).read(PHOTO);

    expect(api.sent).toHaveLength(1);
    const [request] = api.sent;
    expect(request?.url).toBe("https://api.anthropic.com/v1/messages");
    expect(request?.headers.get("x-api-key")).toBe(KEY);
    expect(request?.body["model"]).toBe("claude-haiku-5-5");
    const [content] = (request?.body["messages"] ?? []) as { content: Record<string, unknown>[] }[];
    expect(content?.content[0]).toEqual({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/jpeg",
        data: Buffer.from(PHOTO.bytes).toString("base64"),
      },
    });
    expect(content?.content[1]).toEqual({ type: "text", text: RECEIPT_PROMPT });
    const config = request?.body["output_config"] as { format: { type: string } };
    expect(config.format.type).toBe("json_schema");
  });

  test("takes the model id it is given", async () => {
    const api = answering(() => message(TWO_RECEIPTS));

    const sonnet = reader(api.fetch, "claude-sonnet-5-5");
    await sonnet.read(PHOTO);

    expect(sonnet.model).toBe("claude-sonnet-5-5");
    expect(api.sent[0]?.body["model"]).toBe("claude-sonnet-5-5");
  });

  test("returns a proposal per receipt in the photo, a field it could not use as null", async () => {
    const api = answering(() => message(TWO_RECEIPTS));

    const proposals = await reader(api.fetch).read(PHOTO);

    expect(proposals).toEqual([
      {
        merchant: "Marché Exemple",
        date: "2026-10-04",
        subtotal: 2_500,
        gst: 50,
        qst: 100,
        total: 2_650,
      },
      // A blank merchant and a day that does not exist are not read.
      { merchant: null, date: null, subtotal: 1_899, gst: null, qst: null, total: 1_899 },
    ]);
  });

  test("returns no proposal for a photo that holds no receipt", async () => {
    const api = answering(() => message(JSON.stringify({ receipts: [] })));

    expect(await reader(api.fetch).read(PHOTO)).toEqual([]);
  });

  test.each([
    ["a refusal", () => message("", "refusal")],
    ["a reading cut short", () => message('{"receipts":[{"merchant":', "max_tokens")],
    ["text that is not JSON", () => message("I see a receipt.")],
    ["JSON that is not a reading", () => message(JSON.stringify({ receipts: [{ total: "12" }] }))],
  ])("refuses %s as RECEIPT_UNREADABLE", async (_name, reply) => {
    const api = answering(reply);

    await expect(reader(api.fetch).read(PHOTO)).rejects.toMatchObject({
      code: "RECEIPT_UNREADABLE",
    });
  });

  test.each([
    [429, "UNREACHABLE", true],
    [529, "UNREACHABLE", true],
    [500, "UNREACHABLE", true],
    [401, "INTERNAL", false],
    [400, "INTERNAL", false],
  ] as const)("answers a %i as %s", async (status, code, retryable) => {
    const api = answering(() =>
      Response.json({ type: "error", error: { type: "some_error", message: "no" } }, { status }),
    );

    const refused = await reader(api.fetch)
      .read(PHOTO)
      .catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(AppError);
    expect(refused).toMatchObject({ code, retryable });
  });

  test("reads no credential or address from the environment", async () => {
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "a-token-from-the-host");
    vi.stubEnv("ANTHROPIC_BASE_URL", "https://elsewhere.example.test");
    const api = answering(() => message(TWO_RECEIPTS));

    await reader(api.fetch).read(PHOTO);

    expect(api.sent[0]?.url).toBe("https://api.anthropic.com/v1/messages");
    expect(api.sent[0]?.headers.get("authorization")).toBeNull();
  });

  test("refuses to be built without a key", () => {
    expect(() =>
      createModelReader({ provider: "anthropic", apiKey: " ", fetch: answering().fetch }),
    ).toThrow(expect.objectContaining({ code: "RECEIPT_READER_UNCONFIGURED" }));
  });
});
