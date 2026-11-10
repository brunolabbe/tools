/**
 * lg-105: a reading the arithmetic check flags is read again, once, by a
 * stronger model, and the second reading is kept only when it is strictly
 * better. No test here reaches a model: every reader is a fake that counts its
 * calls, and the one test that builds readers from configuration hands in a
 * factory that answers fakes. Every merchant, amount and photo is invented.
 */

import { Buffer } from "node:buffer";
import { afterEach, describe, expect, test } from "vitest";
import { checkReceipt } from "@ledger/books";
import { ROUTES } from "@ledger/contract";
import type { ReadReceiptResponse, Receipt, ReceiptItem, ReceiptProposal } from "@ledger/contract";
import type { ModelReaderOptions, ReceiptPhoto, ReceiptReader } from "@ledger/receipts";
import { loadApiConfig } from "../src/config.ts";
import type { ReceiptReaderConfig } from "../src/config.ts";
import { createLogger } from "../src/logger.ts";
import { isBetter } from "../src/receipts.ts";
import type { App, CreateAppOptions } from "../src/server.ts";
import { createApp } from "../src/server.ts";
import { ALEX, accessConfig, memberDirectory } from "./helpers/access.ts";
import { migratedBooks } from "./helpers/template.ts";

function item(text: string, price: number, taxable: boolean): ReceiptItem {
  return {
    text,
    price,
    taxable,
    deposit: null,
    discount: null,
    spendingCategoryId: null,
    share: "shared",
    chargedTo: null,
  };
}

/** 15,00 $ zero-rated and 10,00 $ taxable, each an item: it adds up. */
const ADDS_UP: ReceiptProposal = {
  merchant: "Marché Exemple",
  date: "2026-10-04",
  subtotal: 2_500,
  gst: 50,
  qst: 100,
  total: 2_650,
  items: [item("PAIN", 1_500, false), item("SAVON", 1_000, true)],
};

/** The same receipt with one price read three cents off: `items-differ`. */
const CENTS_OFF: ReceiptProposal = {
  ...ADDS_UP,
  items: [item("PAIN", 1_497, false), item("SAVON", 1_000, true)],
};

/** The same receipt with the total misread too: `items-differ` and `parts-differ`. */
const WORSE: ReceiptProposal = { ...CENTS_OFF, total: 2_660 };

const SECRET = "sk-ant-api-ESCALATION-KEY-MARKER";

interface FakeReader {
  reader: ReceiptReader;
  calls: number;
  signals: (AbortSignal | undefined)[];
}

function fakeReader(
  model: string,
  answer: (photo: ReceiptPhoto, signal?: AbortSignal) => Promise<ReceiptProposal[]>,
): FakeReader {
  const fake: FakeReader = {
    calls: 0,
    signals: [],
    reader: {
      model,
      async read(photo, signal) {
        fake.calls += 1;
        fake.signals.push(signal);
        return await answer(photo, signal);
      },
    },
  };
  return fake;
}

function answering(model: string, ...proposals: ReceiptProposal[]): FakeReader {
  return fakeReader(model, async () => proposals);
}

let app: App | undefined;

afterEach(async () => {
  await app?.shutdown();
  app = undefined;
});

async function start(
  readers: Pick<
    CreateAppOptions,
    "receiptReader" | "escalationReader" | "modelReader" | "receiptReadDeadlineMs"
  >,
  options: { lines?: string[]; receiptReader?: ReceiptReaderConfig } = {},
): Promise<App> {
  const lines = options.lines;
  app = await createApp({
    booksTemplate: migratedBooks(),
    directory: memberDirectory(),
    config: {
      dataDir: ":memory:",
      access: accessConfig({ devIdentity: ALEX }),
      rateLimitReadsPerMinute: 0,
      rateLimitWritesPerMinute: 0,
      rateLimitReceiptReadsPerMinute: 0,
      // Never the environment's: a key on the host must not reach a test.
      receiptReader: options.receiptReader ?? {
        apiKey: undefined,
        model: "claude-haiku-5-5",
        escalationModel: null,
      },
    },
    logger: createLogger({
      level: lines === undefined ? "silent" : "debug",
      ...(lines === undefined ? {} : { write: (line: string) => lines.push(line) }),
    }),
    ...readers,
  });
  return app;
}

/** A JPEG's first bytes, then filler that names nothing. */
function jpeg(): Buffer {
  const bytes = Buffer.alloc(64, 0x2a);
  bytes.set([0xff, 0xd8, 0xff, 0xe0], 0);
  return bytes;
}

/** Uploads a photo and asks for it to be read, as the screen does. */
async function uploadAndRead(target: App): Promise<ReadReceiptResponse> {
  const up = await target.server.inject({
    method: "POST",
    url: ROUTES.receipts,
    headers: { "content-type": "image/jpeg" },
    payload: jpeg(),
  });
  expect(up.statusCode, up.body).toBe(200);
  const { id } = up.json<Receipt>();
  const read = await target.server.inject({
    method: "POST",
    url: ROUTES.receiptRead.replace(":id", String(id)),
  });
  expect(read.statusCode, read.body).toBe(200);
  return read.json<ReadReceiptResponse>();
}

describe("the fixtures say what the tests take them to", () => {
  test("ADDS_UP has no flag, CENTS_OFF only items-differ, WORSE items-differ and more", () => {
    expect(checkReceipt(ADDS_UP)).toEqual([]);
    expect(checkReceipt(CENTS_OFF)).toEqual(["items-differ"]);
    expect(checkReceipt(WORSE)).toContain("items-differ");
    expect(checkReceipt(WORSE).length).toBeGreaterThan(1);
  });
});

describe("a flagged reading is read again (lg-105)", () => {
  test("an escalated reading that adds up is answered, with no flags, named by the escalation model", async () => {
    const first = answering("fake-haiku", CENTS_OFF);
    const second = answering("fake-sonnet", ADDS_UP);
    const target = await start({ receiptReader: first.reader, escalationReader: second.reader });

    const answer = await uploadAndRead(target);

    expect([first.calls, second.calls]).toEqual([1, 1]);
    expect(answer.model).toBe("fake-sonnet");
    expect(answer.proposals.map((read) => read.flags)).toEqual([[]]);
    expect(answer.proposals[0]?.proposal).toEqual(ADDS_UP);
  });

  test("an escalated reading that is no better is not kept: same flags, or more", async () => {
    for (const worse of [CENTS_OFF, WORSE]) {
      const first = answering("fake-haiku", CENTS_OFF);
      const second = answering("fake-sonnet", worse);
      const target = await start({ receiptReader: first.reader, escalationReader: second.reader });

      const answer = await uploadAndRead(target);

      expect(second.calls).toBe(1);
      expect(answer.model).toBe("fake-haiku");
      expect(answer.proposals.map((read) => read.proposal)).toEqual([CENTS_OFF]);
      expect(answer.proposals.map((read) => read.flags)).toEqual([["items-differ"]]);
      await app?.shutdown();
      app = undefined;
    }
  });

  test("a first reading that adds up never reaches the escalation reader", async () => {
    const first = answering("fake-haiku", ADDS_UP);
    const second = answering("fake-sonnet", ADDS_UP);
    const target = await start({ receiptReader: first.reader, escalationReader: second.reader });

    const answer = await uploadAndRead(target);

    expect([first.calls, second.calls]).toEqual([1, 0]);
    expect(answer.model).toBe("fake-haiku");
  });

  test("an escalation reader that throws leaves the first reading answered, and the failure logged with no credential", async () => {
    const lines: string[] = [];
    const first = answering("fake-haiku", CENTS_OFF);
    // What a failed SDK call can carry: the key in its message, in a signed
    // URL's query and in the request's headers.
    const second = fakeReader("fake-sonnet", async () => {
      throw Object.assign(new Error(`refused ${SECRET}`), {
        url: `https://api.anthropic.com/v1/messages?key=${SECRET}`,
        headers: { "x-api-key": SECRET, authorization: `Bearer ${SECRET}` },
      });
    });
    const target = await start(
      { receiptReader: first.reader, escalationReader: second.reader },
      { lines },
    );

    const answer = await uploadAndRead(target);

    expect(second.calls).toBe(1);
    expect(answer.model).toBe("fake-haiku");
    expect(answer.proposals.map((read) => read.proposal)).toEqual([CENTS_OFF]);
    const logged = lines.filter((line) => line.includes("was not read again"));
    expect(logged).toHaveLength(1);
    expect(JSON.parse(logged[0] ?? "{}")).toMatchObject({
      level: "warn",
      model: "fake-sonnet",
      code: "INTERNAL",
      outOfTime: false,
    });
    const log = lines.join("\n");
    expect(log).not.toContain("KEY-MARKER");
    expect(log).not.toContain("sk-ant");
  });

  test("a second reading still going at the deadline is given up, and the first answered", async () => {
    const lines: string[] = [];
    const first = answering("fake-haiku", CENTS_OFF);
    // Answers only when it is told to stop, as the SDK does on an abort.
    const second = fakeReader(
      "fake-sonnet",
      async (_photo, signal) =>
        await new Promise<ReceiptProposal[]>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    );
    const target = await start(
      {
        receiptReader: first.reader,
        escalationReader: second.reader,
        receiptReadDeadlineMs: 50,
      },
      { lines },
    );

    const answer = await uploadAndRead(target);

    expect(answer.model).toBe("fake-haiku");
    expect(answer.proposals.map((read) => read.proposal)).toEqual([CENTS_OFF]);
    expect(second.signals[0]?.aborted).toBe(true);
    const logged = lines.find((line) => line.includes("was not read again"));
    expect(JSON.parse(logged ?? "{}")).toMatchObject({ outOfTime: true });
  });

  test("both reads are handed a signal, so a person who hangs up stops either", async () => {
    const first = answering("fake-haiku", CENTS_OFF);
    const second = answering("fake-sonnet", ADDS_UP);
    const target = await start({ receiptReader: first.reader, escalationReader: second.reader });

    await uploadAndRead(target);

    expect(first.signals[0]).toBeInstanceOf(AbortSignal);
    expect(second.signals[0]).toBeInstanceOf(AbortSignal);
  });
});

describe("the escalation reader's configuration (lg-105)", () => {
  test("RECEIPT_ESCALATION_MODEL is Sonnet 5.5 unset, another model set, and none set empty", () => {
    expect(loadApiConfig({}, {}).receiptReader.escalationModel).toBe("claude-sonnet-5-5");
    expect(
      loadApiConfig({}, { RECEIPT_ESCALATION_MODEL: " claude-opus-5-5 " }).receiptReader
        .escalationModel,
    ).toBe("claude-opus-5-5");
    expect(
      loadApiConfig({}, { RECEIPT_ESCALATION_MODEL: "" }).receiptReader.escalationModel,
    ).toBeNull();
    expect(
      loadApiConfig({}, { RECEIPT_ESCALATION_MODEL: "  " }).receiptReader.escalationModel,
    ).toBeNull();
  });

  /** A factory standing in for `createModelReader`: it records what it was asked to build. */
  function building(answers: Record<string, ReceiptProposal[]>): {
    built: ModelReaderOptions[];
    modelReader: (options: ModelReaderOptions) => ReceiptReader;
    reads: string[];
  } {
    const built: ModelReaderOptions[] = [];
    const reads: string[] = [];
    return {
      built,
      reads,
      modelReader: (options) => {
        built.push(options);
        const model = options.model ?? "unnamed";
        return {
          model,
          async read() {
            reads.push(model);
            return answers[model] ?? [];
          },
        };
      },
    };
  }

  test("with RECEIPT_ESCALATION_MODEL set empty, no second reader is built and a flagged reading is returned as read", async () => {
    const factory = building({ "claude-haiku-5-5": [CENTS_OFF] });
    const configured = loadApiConfig(
      {},
      { ANTHROPIC_API_KEY: SECRET, RECEIPT_ESCALATION_MODEL: "" },
    ).receiptReader;
    const target = await start({ modelReader: factory.modelReader }, { receiptReader: configured });

    const answer = await uploadAndRead(target);

    expect(factory.built.map((options) => options.model)).toEqual(["claude-haiku-5-5"]);
    expect(factory.reads).toEqual(["claude-haiku-5-5"]);
    expect(answer.model).toBe("claude-haiku-5-5");
    expect(answer.proposals.map((read) => read.flags)).toEqual([["items-differ"]]);
  });

  test("unset, the second reader is built with the same key and options, and only its model differs", async () => {
    const factory = building({
      "claude-haiku-5-5": [CENTS_OFF],
      "claude-sonnet-5-5": [ADDS_UP],
    });
    const configured = loadApiConfig({}, { ANTHROPIC_API_KEY: SECRET }).receiptReader;
    const target = await start({ modelReader: factory.modelReader }, { receiptReader: configured });

    const answer = await uploadAndRead(target);

    expect(factory.built.map((options) => options.model)).toEqual([
      "claude-haiku-5-5",
      "claude-sonnet-5-5",
    ]);
    const [first, second] = factory.built;
    expect({ ...second, model: undefined }).toEqual({ ...first, model: undefined });
    expect(second?.apiKey).toBe(SECRET);
    expect(answer.model).toBe("claude-sonnet-5-5");
  });

  test("beside a handed-in reader, nothing is built from configuration", async () => {
    const factory = building({});
    const first = answering("fake-haiku", CENTS_OFF);
    const configured = loadApiConfig({}, { ANTHROPIC_API_KEY: SECRET }).receiptReader;
    const target = await start(
      { receiptReader: first.reader, modelReader: factory.modelReader },
      { receiptReader: configured },
    );

    const answer = await uploadAndRead(target);

    expect(factory.built).toEqual([]);
    expect(answer.model).toBe("fake-haiku");
  });
});

describe("which reading is better (lg-105)", () => {
  const checked = (...proposals: ReceiptProposal[]) =>
    proposals.map((proposal) => ({
      proposal,
      flags: checkReceipt(proposal),
      merchantCategoryId: null,
    }));

  test("fewer proposals that do not add up wins; then fewer flags; a tie keeps the first", () => {
    expect(isBetter(checked(ADDS_UP), checked(CENTS_OFF))).toBe(true);
    expect(isBetter(checked(CENTS_OFF), checked(WORSE))).toBe(true);
    expect(isBetter(checked(CENTS_OFF), checked(CENTS_OFF))).toBe(false);
    expect(isBetter(checked(WORSE), checked(CENTS_OFF))).toBe(false);
  });

  test("a reading with fewer receipts than the first is never better, an empty one included", () => {
    expect(isBetter(checked(), checked(CENTS_OFF))).toBe(false);
    expect(isBetter(checked(ADDS_UP), checked(ADDS_UP, CENTS_OFF))).toBe(false);
    expect(isBetter(checked(ADDS_UP, ADDS_UP), checked(ADDS_UP, CENTS_OFF))).toBe(true);
  });
});
