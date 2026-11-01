/**
 * Receipts through the API (lg-8): a photo uploaded, read by a fake reader when
 * the person asks, and filed on confirmation — as a line for whoever uploaded
 * it, or on the joint-account row it documents. No test here reaches a model:
 * every reader is a fake that counts its calls. Every merchant, amount and photo
 * is invented; a "photo" is a JPEG's first bytes and some filler.
 */

import { Buffer } from "node:buffer";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { MAX_RECEIPT_PHOTO_BYTES, MAX_RECEIPTS_PER_PHOTO, ROUTES } from "@ledger/contract";
import type {
  ErrorResponse,
  OpenPeriodResponse,
  ReadReceiptResponse,
  Receipt,
  ReceiptFiling,
  ReceiptMatchesResponse,
  ReceiptProposal,
  StoredRow,
} from "@ledger/contract";
import { createModelReader } from "@ledger/receipts";
import type { ReceiptReader } from "@ledger/receipts";
import { loadApiConfig } from "../src/config.ts";
import { createLogger } from "../src/logger.ts";
import type { AppLogger } from "../src/logger.ts";
import { merchantCategory } from "../src/receipts.ts";
import { chartedAs, receiptsOnRows } from "../src/slices.ts";
import { createApp } from "../src/server.ts";
import { migratedBooks } from "./helpers/template.ts";
import type { App } from "../src/server.ts";
import type { Directory } from "../src/directory.ts";
import {
  ALEX,
  SAM,
  accessConfig,
  homeBooks,
  jwksFetch,
  memberDirectory,
  signToken,
  testKey,
} from "./helpers/access.ts";
import { renderPaste, withBalances } from "./helpers/paste.ts";

const KEY = testKey("key-1");
const NOW = new Date("2026-10-05T12:00:00Z");

/** A JPEG's first bytes, then filler that names nothing. */
function jpeg(size = 64): Buffer {
  const bytes = Buffer.alloc(size, 0x2a);
  bytes.set([0xff, 0xd8, 0xff, 0xe0], 0);
  return bytes;
}

/** 15,00 $ zero-rated and 10,00 $ taxable: it adds up. */
const READ: ReceiptProposal = {
  merchant: "Marché Exemple",
  date: "2026-10-04",
  subtotal: 2_500,
  gst: 50,
  qst: 100,
  total: 2_650,
  items: [],
};

/** A reader that proposes `READ`, and a second receipt a cent off, and counts its calls. */
function countingReader(): { reader: ReceiptReader; calls: number } {
  const counted = {
    calls: 0,
    reader: {
      model: "fake-haiku",
      async read(): Promise<ReceiptProposal[]> {
        counted.calls += 1;
        return [READ, { ...READ, merchant: "Quincaillerie", total: 2_651 }];
      },
    } satisfies ReceiptReader,
  };
  return counted;
}

let app: App | undefined;
let dataDir: string | undefined;

afterEach(async () => {
  // A test that listen()ed and aborted a fetch leaves the server a socket it
  // waits 4 s on before `close` returns (lg-69: 4001 ms against 1 ms here).
  // Harmless for an app that never listened.
  app?.server.server.closeAllConnections();
  await app?.shutdown();
  app = undefined;
  if (dataDir !== undefined) rmSync(dataDir, { recursive: true, force: true });
  dataDir = undefined;
});

async function start(
  options: {
    reader?: ReceiptReader | null;
    files?: boolean;
    lines?: string[];
    logger?: AppLogger;
    apiKey?: string;
    /** The household's members, alex and sam by default. */
    members?: Parameters<typeof memberDirectory>[0];
    /** A directory the test keeps, to change its members after the books open. */
    directory?: Directory;
  } = {},
): Promise<App> {
  if (options.files === true) dataDir = mkdtempSync(path.join(tmpdir(), "ledger-receipts-"));
  const lines = options.lines;
  app = await createApp({
    booksTemplate: migratedBooks(),
    directory: options.directory ?? memberDirectory(options.members),
    config: {
      dataDir: dataDir ?? ":memory:",
      access: accessConfig(),
      rateLimitReadsPerMinute: 0,
      rateLimitWritesPerMinute: 0,
      // Never the environment's: a key on the host must not reach a test.
      receiptReader: { apiKey: options.apiKey, model: "claude-haiku-5-5" },
    },
    logger:
      options.logger ??
      createLogger({
        level: lines === undefined ? "silent" : "debug",
        ...(lines === undefined ? {} : { write: (line: string) => lines.push(line) }),
      }),
    now: () => NOW,
    fetch: jwksFetch(() => [KEY]).fetch,
    receiptReader: options.reader === undefined ? countingReader().reader : options.reader,
  });
  return app;
}

function as(address: string): Record<string, string> {
  return {
    "cf-access-jwt-assertion": signToken({
      key: KEY,
      nowSec: Math.floor(NOW.getTime() / 1000),
      claims: { email: address },
    }),
  };
}

async function upload(
  target: App,
  body: Buffer | string = jpeg(),
  who = ALEX,
  type = "image/jpeg",
) {
  return await target.server.inject({
    method: "POST",
    url: ROUTES.receipts,
    headers: { ...as(who), "content-type": type },
    payload: body,
  });
}

async function uploaded(target: App, who = ALEX): Promise<Receipt> {
  const response = await upload(target, jpeg(), who);
  expect(response.statusCode, response.body).toBe(200);
  return response.json<Receipt>();
}

function url(route: string, id: number): string {
  return route.replace(":id", String(id));
}

async function read(target: App, id: number, who = ALEX) {
  return await target.server.inject({
    method: "POST",
    url: url(ROUTES.receiptRead, id),
    headers: as(who),
  });
}

/** Files the first receipt in the photo unless the request names another `part`. */
async function file(target: App, id: number, request: Record<string, unknown>, who = ALEX) {
  return await target.server.inject({
    method: "POST",
    url: url(ROUTES.receiptFile, id),
    headers: as(who),
    payload: { part: 1, ...request },
  });
}

async function matches(target: App, id: number, amountCents: number, date: string) {
  return await target.server.inject({
    method: "GET",
    url: `${url(ROUTES.receiptMatches, id)}?amountCents=${String(amountCents)}&date=${date}`,
    headers: as(ALEX),
  });
}

function asLine(amountCents: number, extra: Record<string, unknown> = {}) {
  return {
    to: "line",
    date: "2026-10-04",
    amountCents,
    spendingCategoryId: null,
    note: "Marché Exemple",
    chargedTo: null,
    ...extra,
  };
}

/** A deposit, the 26,50 $ charge `READ` matches, and one a cent off it. */
async function pasteRows(target: App): Promise<void> {
  const paste = renderPaste(
    withBalances(
      [
        {
          date: "2026-10-01",
          category: "Virements",
          description: "Virement /Caisse",
          amountCents: 50_000,
        },
        {
          date: "2026-10-03",
          category: "Épicerie",
          description: "Achat /Marché Exemple",
          amountCents: -2_650,
        },
        {
          date: "2026-10-04",
          category: "Épicerie",
          description: "Achat /Autre",
          amountCents: -2_651,
        },
      ],
      100_000,
    ),
  );
  const pasted = await target.server.inject({
    method: "POST",
    url: ROUTES.statements,
    headers: as(ALEX),
    payload: { text: paste },
  });
  expect(pasted.statusCode, pasted.body).toBe(200);
}

/** The stored row the 26,50 $ charge is. */
function chargeRow(target: App): number {
  return (
    homeBooks(target).prepare("SELECT id FROM statement_rows WHERE amount_cents = -2650").get() as {
      id: number;
    }
  ).id;
}

function count(target: App, table: string): number {
  return (homeBooks(target).prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
}

describe("uploading a receipt", () => {
  test("keeps the photo and records who took it, and reads nothing and files nothing", async () => {
    const counted = countingReader();
    const target = await start({ reader: counted.reader });

    const receipt = await uploaded(target);

    expect(receipt).toEqual({
      id: 1,
      mediaType: "image/jpeg",
      bytes: 64,
      uploadedAt: NOW.toISOString(),
      uploadedBy: "alex",
      // What the screen names before the person asks for a read.
      reader: "fake-haiku",
    });
    expect(counted.calls).toBe(0);
    expect(count(target, "period_lines")).toBe(0);
    expect(count(target, "receipt_filings")).toBe(0);
  });

  test.each([
    ["text, sent as a JPEG", Buffer.from("not a photo at all"), "image/jpeg"],
    ["a GIF, which no camera makes", Buffer.from("GIF89a and the rest"), "image/gif"],
    ["a PDF named as an image", Buffer.from("%PDF-1.7 a receipt"), "application/octet-stream"],
    ["an empty body", Buffer.alloc(0), "image/jpeg"],
  ])("refuses %s as RECEIPT_NOT_AN_IMAGE, and keeps nothing", async (_name, body, type) => {
    const target = await start();

    const response = await upload(target, body, ALEX, type);

    expect(response.statusCode).toBe(415);
    expect(response.json<ErrorResponse>().error.code).toBe("RECEIPT_NOT_AN_IMAGE");
    expect(count(target, "receipts")).toBe(0);
  });

  test.each([
    ["a PNG", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "image/png"],
    ["a WebP", [0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50], "image/webp"],
  ] as const)(
    "takes %s by its bytes, whatever the request calls it",
    async (_name, magic, type) => {
      const target = await start();
      const body = Buffer.concat([Buffer.from(magic), Buffer.alloc(32, 0x2a)]);

      const response = await upload(target, body, ALEX, "text/plain");

      expect(response.statusCode, response.body).toBe(200);
      expect(response.json<Receipt>().mediaType).toBe(type);
    },
  );

  test("takes a photo past the 1 MiB every other route is held to", async () => {
    const target = await start();

    const response = await upload(target, jpeg(2 * 1024 * 1024));

    expect(response.statusCode, response.body).toBe(200);
  });

  test("refuses a photo over the cap, before keeping any of it", async () => {
    const target = await start({ files: true });

    const response = await upload(target, jpeg(MAX_RECEIPT_PHOTO_BYTES + 1));

    expect(response.statusCode).toBe(413);
    const { error } = response.json<ErrorResponse>();
    expect(error.code).toBe("SIZE_LIMIT_EXCEEDED");
    expect(error.message).toMatch(/7 MB/u);
    expect(count(target, "receipts")).toBe(0);
    expect(readdirSync(dataDir ?? "")).not.toContain("receipts");
  });

  test("keeps the photo on the data volume under a name it made, in the household's directory", async () => {
    const target = await start({ files: true });

    await target.server.inject({
      method: "POST",
      url: `${ROUTES.receipts}?name=../../escape.jpg`,
      headers: { ...as(ALEX), "content-type": "image/jpeg", "x-file-name": "../escape.jpg" },
      payload: jpeg(),
    });

    const directory = path.join(dataDir ?? "", "receipts", "home");
    const kept = readdirSync(directory);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatch(/^[0-9a-f-]{36}\.jpg$/u);
    expect(readFileSync(path.join(directory, kept[0] ?? ""))).toEqual(jpeg());
    expect(readdirSync(dataDir ?? "").toSorted()).toEqual(["households", "receipts"]);
    expect(existsSync(path.join(dataDir ?? "", "..", "escape.jpg"))).toBe(false);
  });
});

describe("reading a receipt", () => {
  test("reaches the model only when the person asks, and answers each proposal checked", async () => {
    const counted = countingReader();
    const target = await start({ reader: counted.reader });
    const receipt = await uploaded(target);

    // Uploading and asking for matches never call it; filing is the F1 test below.
    await matches(target, receipt.id, 2_650, "2026-10-04");
    expect(counted.calls).toBe(0);

    const response = await read(target, receipt.id);

    expect(response.statusCode, response.body).toBe(200);
    expect(counted.calls).toBe(1);
    expect(response.json<ReadReceiptResponse>()).toEqual({
      receiptId: receipt.id,
      model: "fake-haiku",
      proposals: [
        { proposal: READ, flags: [], merchantCategoryId: null },
        {
          proposal: { ...READ, merchant: "Quincaillerie", total: 2_651 },
          flags: ["parts-differ"],
          merchantCategoryId: null,
        },
      ],
    });
  });

  test("files nothing: a read proposal waits for the person", async () => {
    const target = await start();
    const receipt = await uploaded(target);

    await read(target, receipt.id);

    expect(count(target, "period_lines")).toBe(0);
    expect(count(target, "receipt_filings")).toBe(0);
  });

  test("with no model configured, is refused, and typing the receipt in still files it", async () => {
    const target = await start({ reader: null });
    const receipt = await uploaded(target);

    const refused = await read(target, receipt.id);
    expect(receipt).toMatchObject({ reader: null });
    const typed = await file(target, receipt.id, { proposal: READ, destination: asLine(2_650) });

    expect(refused.statusCode).toBe(503);
    expect(refused.json<ErrorResponse>().error.code).toBe("RECEIPT_READER_UNCONFIGURED");
    expect(typed.statusCode, typed.body).toBe(200);
  });

  test("names no receipt that was never uploaded", async () => {
    const counted = countingReader();
    const target = await start({ reader: counted.reader });

    const response = await read(target, 7);

    expect(response.statusCode).toBe(404);
    expect(response.json<ErrorResponse>().error.code).toBe("RECEIPT_NOT_FOUND");
    expect(counted.calls).toBe(0);
  });
});

describe("filing a receipt", () => {
  test("a read proposal, edited and confirmed, becomes a period line for whoever uploaded it", async () => {
    const target = await start();
    const receipt = await uploaded(target, ALEX);
    const [proposal] = (await read(target, receipt.id)).json<ReadReceiptResponse>().proposals;

    // Sam confirms Alex's receipt, with the tip the card was charged on top.
    const edited = { ...proposal?.proposal, merchant: "Marché Exemple inc." };
    const response = await file(
      target,
      receipt.id,
      { proposal: edited, destination: asLine(3_000, { note: "with the tip" }) },
      SAM,
    );

    expect(response.statusCode, response.body).toBe(200);
    const filing = response.json<ReceiptFiling>();
    expect(filing).toMatchObject({ receiptId: receipt.id, rowId: null, filedBy: "sam" });
    expect(filing.proposal).toEqual(edited);
    const open = await target.server.inject({
      method: "GET",
      url: `${ROUTES.periodOpen}?end=2026-10-31`,
      headers: as(ALEX),
    });
    const lines = open.json<OpenPeriodResponse>().lines;
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      lineId: filing.periodLineId,
      personId: "alex",
      date: "2026-10-04",
      amountCents: 3_000,
      note: "with the tip",
      chargedTo: null,
    });
    expect(
      homeBooks(target)
        .prepare("SELECT source, entered_by FROM period_lines WHERE id = ?")
        .get(filing.periodLineId),
    ).toEqual({ source: "receipt", entered_by: "sam" });
  });

  test("a line can be the other person's, as a charge", async () => {
    const target = await start();
    const receipt = await uploaded(target, ALEX);

    const response = await file(target, receipt.id, {
      proposal: READ,
      destination: asLine(2_650, { chargedTo: "sam" }),
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(
      homeBooks(target).prepare("SELECT person_id, charged_to FROM period_lines").get(),
    ).toEqual({ person_id: "alex", charged_to: "sam" });
  });

  test("a proposal matching a stored joint-account row is offered, and confirming it attaches the receipt and adds no line", async () => {
    const target = await start();
    await pasteRows(target);
    const receipt = await uploaded(target);

    const offered = (
      await matches(target, receipt.id, 2_650, "2026-10-04")
    ).json<ReceiptMatchesResponse>();

    expect(offered.matches).toHaveLength(1);
    const [match] = offered.matches;
    expect(match).toMatchObject({
      date: "2026-10-03",
      description: "Achat /Marché Exemple",
      amountCents: -2_650,
      daysApart: 1,
    });

    const response = await file(target, receipt.id, {
      proposal: READ,
      destination: { to: "row", rowId: match?.rowId },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<ReceiptFiling>()).toMatchObject({
      rowId: match?.rowId,
      periodLineId: null,
    });
    expect(count(target, "period_lines")).toBe(0);
    // A row a receipt documents is not offered to the next one.
    const next = await uploaded(target);
    expect(
      (await matches(target, next.id, 2_650, "2026-10-04")).json<ReceiptMatchesResponse>(),
    ).toEqual({
      matches: [],
    });
  });

  test("files a receipt once", async () => {
    const target = await start();
    const receipt = await uploaded(target);
    await file(target, receipt.id, { proposal: READ, destination: asLine(2_650) });

    const again = await file(target, receipt.id, { proposal: READ, destination: asLine(2_650) });

    expect(again.statusCode).toBe(409);
    expect(again.json<ErrorResponse>().error.code).toBe("RECEIPT_ALREADY_FILED");
    expect(count(target, "period_lines")).toBe(1);
  });

  test("refuses a row that is not stored, and files nothing", async () => {
    const target = await start();
    const receipt = await uploaded(target);

    const response = await file(target, receipt.id, {
      proposal: READ,
      destination: { to: "row", rowId: 99 },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json<ErrorResponse>().error.code).toBe("ROW_NOT_FOUND");
    expect(count(target, "receipt_filings")).toBe(0);
  });

  test("refuses a line that names who paid, since that is whoever uploaded the photo", async () => {
    const target = await start();
    const receipt = await uploaded(target);

    const response = await file(target, receipt.id, {
      proposal: READ,
      destination: asLine(2_650, { personId: "sam" }),
    });

    expect(response.statusCode).toBe(400);
    expect(count(target, "period_lines")).toBe(0);
  });

  test("refuses a line whose spending category is not in the list, and files nothing", async () => {
    const target = await start();
    const receipt = await uploaded(target);

    const response = await file(target, receipt.id, {
      proposal: READ,
      destination: asLine(2_650, { spendingCategoryId: 999 }),
    });

    expect(response.json<ErrorResponse>().error.code).toBe("SPENDING_CATEGORY_NOT_FOUND");
    expect(count(target, "period_lines")).toBe(0);
    expect(count(target, "receipt_filings")).toBe(0);
  });
});

describe("what is logged", () => {
  test("never the photo, and never the key", async () => {
    const lines: string[] = [];
    const logger = createLogger({ level: "debug", write: (line) => lines.push(line) });
    // The real reader, built from a configured key, against an API that refuses
    // the key and quotes it back (gate 1, F7): no test reaches a model.
    const secret = "sk-ant-api-KEY-MARKER";
    const reader = createModelReader({
      provider: "anthropic",
      apiKey: secret,
      maxRetries: 0,
      logger,
      fetch: async () =>
        Response.json(
          { type: "error", error: { type: "authentication_error", message: `bad key ${secret}` } },
          { status: 401 },
        ),
    });
    const target = await start({ reader, logger, apiKey: secret });
    const photo = jpeg();
    photo.write("PHOTO-MARKER", 8);
    const sent = await upload(target, photo);
    const refused = await read(target, sent.json<Receipt>().id);
    await upload(target, Buffer.from("PHOTO-MARKER and no image"));

    const log = lines.join("\n");
    expect(refused.statusCode).toBe(500);
    expect(lines.length).toBeGreaterThan(0);
    expect(log).toContain("the receipt reader refused the request");
    expect(log).not.toContain("KEY-MARKER");
    expect(log).not.toContain("sk-ant");
    expect(log).not.toContain("PHOTO-MARKER");
    expect(log).not.toContain(photo.toString("base64").slice(0, 16));
  });
});

/** A key, and a header variable that would replace it. */
function bootWithCustomHeaders() {
  return loadApiConfig(
    {},
    { ANTHROPIC_API_KEY: "k", ANTHROPIC_CUSTOM_HEADERS: "x-api-key: other" },
  );
}

describe("the receipt reader's configuration", () => {
  test("is Haiku 5.5 with no key by default, and takes RECEIPT_MODEL", () => {
    expect(loadApiConfig({}, {}).receiptReader).toEqual({
      apiKey: undefined,
      model: "claude-haiku-5-5",
    });
    expect(
      loadApiConfig({}, { ANTHROPIC_API_KEY: "k", RECEIPT_MODEL: "claude-sonnet-5-5" })
        .receiptReader,
    ).toEqual({ apiKey: "k", model: "claude-sonnet-5-5" });
  });

  test("refuses to boot with ANTHROPIC_CUSTOM_HEADERS beside a key, and never repeats it", () => {
    expect(bootWithCustomHeaders).toThrow(/ANTHROPIC_CUSTOM_HEADERS/u);
    expect(bootWithCustomHeaders).not.toThrow(/other/u);
    // With no key nothing builds the SDK, so the variable reaches nothing.
    expect(() => loadApiConfig({}, { ANTHROPIC_CUSTOM_HEADERS: "x" })).not.toThrow();
  });
});

// --- Gate 1's findings (lg-8) ---

describe("filing never reaches the model (gate 1, F1)", () => {
  test("filing as a line and onto a row calls no reader", async () => {
    const counted = countingReader();
    const target = await start({ reader: counted.reader });
    await pasteRows(target);
    const first = await uploaded(target);
    const second = await uploaded(target);

    const asALine = await file(target, first.id, { proposal: READ, destination: asLine(2_650) });
    const onARow = await file(target, second.id, {
      proposal: READ,
      destination: { to: "row", rowId: chargeRow(target) },
    });

    expect([asALine.statusCode, onARow.statusCode]).toEqual([200, 200]);
    expect(counted.calls).toBe(0);
  });
});

describe("a photo of two receipts (gate 1, F2)", () => {
  test("files each receipt the photo holds, each once", async () => {
    const target = await start();
    const receipt = await uploaded(target);
    const answer = (await read(target, receipt.id)).json<ReadReceiptResponse>();
    expect(answer.proposals).toHaveLength(2);
    const [marche, quincaillerie] = answer.proposals.map((checked) => checked.proposal);

    const first = await file(target, receipt.id, {
      part: 1,
      proposal: marche,
      destination: asLine(2_650),
    });
    const second = await file(target, receipt.id, {
      part: 2,
      proposal: quincaillerie,
      destination: asLine(2_651, { note: "Quincaillerie" }),
    });
    const again = await file(target, receipt.id, {
      part: 2,
      proposal: quincaillerie,
      destination: asLine(2_651),
    });

    expect([first.statusCode, second.statusCode], second.body).toEqual([200, 200]);
    expect(second.json<ReceiptFiling>()).toMatchObject({ receiptId: receipt.id, part: 2 });
    expect(again.statusCode).toBe(409);
    expect(again.json<ErrorResponse>().error.code).toBe("RECEIPT_ALREADY_FILED");
    expect(count(target, "period_lines")).toBe(2);
  });

  test("refuses a part past the receipts a photo can hold", async () => {
    const target = await start();
    const receipt = await uploaded(target);

    const response = await file(target, receipt.id, {
      part: 11,
      proposal: READ,
      destination: asLine(2_650),
    });

    expect(response.statusCode).toBe(400);
    expect(count(target, "receipt_filings")).toBe(0);
  });
});

describe("a row documented once (gate 1, F3)", () => {
  test("refuses a second receipt the row a receipt already documents, and files nothing", async () => {
    const target = await start();
    await pasteRows(target);
    const first = await uploaded(target);
    const second = await uploaded(target, SAM);
    const row = { proposal: READ, destination: { to: "row", rowId: chargeRow(target) } };

    const attached = await file(target, first.id, row);
    const refused = await file(target, second.id, row, SAM);

    expect(attached.statusCode).toBe(200);
    expect(refused.statusCode).toBe(409);
    expect(refused.json<ErrorResponse>().error.code).toBe("ROW_ALREADY_DOCUMENTED");
    expect(count(target, "receipt_filings")).toBe(1);
  });
});

describe("the paid route (gate 1, F4)", () => {
  test("takes a bucket of its own, five reads a minute a person by default", async () => {
    const counted = countingReader();
    const target = await start({ reader: counted.reader });
    const receipt = await uploaded(target);

    const statuses = [];
    for (let attempt = 0; attempt < 6; attempt++) {
      statuses.push((await read(target, receipt.id)).statusCode);
    }

    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    expect(counted.calls).toBe(5);
    // The writes' bucket is not the one spent.
    expect((await upload(target)).statusCode).toBe(200);
  });

  test("refuses to read a receipt already filed, and calls no reader for it", async () => {
    const counted = countingReader();
    const target = await start({ reader: counted.reader });
    const receipt = await uploaded(target);
    await file(target, receipt.id, { proposal: READ, destination: asLine(2_650) });

    const response = await read(target, receipt.id);

    expect(response.statusCode).toBe(409);
    expect(response.json<ErrorResponse>().error.code).toBe("RECEIPT_ALREADY_FILED");
    expect(counted.calls).toBe(0);
  });

  test("hands the reader the request's signal, which a caller hanging up aborts", async () => {
    const seen: { signal?: AbortSignal | undefined; aborted: boolean } = { aborted: false };
    const started: { resolve?: () => void } = {};
    const reading = new Promise<void>((resolve) => {
      started.resolve = resolve;
    });
    const reader: ReceiptReader = {
      model: "fake-haiku",
      async read(_photo, signal) {
        seen.signal = signal;
        started.resolve?.();
        if (signal === undefined) return [];
        return await new Promise<ReceiptProposal[]>((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            seen.aborted = true;
            reject(new Error("aborted"));
          });
        });
      },
    };
    const target = await start({ reader });
    const receipt = await uploaded(target);
    await target.server.listen({ host: "127.0.0.1", port: 0 });
    const address = target.server.addresses()[0];
    const caller = new AbortController();

    const request = fetch(
      `http://127.0.0.1:${String(address?.port)}${url(ROUTES.receiptRead, receipt.id)}`,
      { method: "POST", headers: as(ALEX), signal: caller.signal },
    ).catch(() => undefined);
    await reading;
    caller.abort();
    await request;

    expect(seen.signal).toBeInstanceOf(AbortSignal);
    await vi.waitFor(() => expect(seen.aborted).toBe(true), { timeout: 2_000 });
  });
});

// --- Gate 2's findings (lg-8) ---

describe("a read of more receipts than can be filed (gate 2, N2)", () => {
  test("answers no more proposals than a photo can file", async () => {
    const many: ReceiptReader = {
      model: "fake-haiku",
      async read() {
        return Array.from({ length: MAX_RECEIPTS_PER_PHOTO + 1 }, (_, index) => ({
          ...READ,
          merchant: `Marchand ${String(index + 1)}`,
        }));
      },
    };
    const target = await start({ reader: many });
    const receipt = await uploaded(target);

    const answer = (await read(target, receipt.id)).json<ReadReceiptResponse>();

    expect(answer.proposals).toHaveLength(MAX_RECEIPTS_PER_PHOTO);
    expect(answer.proposals.at(-1)?.proposal.merchant).toBe(
      `Marchand ${String(MAX_RECEIPTS_PER_PHOTO)}`,
    );
  });
});

// --- lg-10: items, what comes off the shared amount, and categories ---

/** Migration 6's seeded list, by the ids it gave. */
const GROCERIES = 1;
const ALCOHOL = 2;
const HOUSEHOLD = 3;

/**
 * Bread, zero-rated; a six-pack, taxable, with its 0,60 $ deposit; soap,
 * taxable. Taxable 17,98 $: GST 0,90 $, QST 1,79 $; the total 24,76 $. The
 * six-pack alone, with its deposit and taxes, is 15,5352525 $ → 15,54 $.
 */
const BASKET: ReceiptProposal = {
  merchant: "Marché Exemple",
  date: "2026-10-04",
  subtotal: 2_207,
  gst: 90,
  qst: 179,
  total: 2_476,
  items: [
    {
      text: "PAIN",
      price: 349,
      taxable: false,
      deposit: null,
      discount: null,
      spendingCategoryId: GROCERIES,
      share: "shared",
      chargedTo: null,
    },
    {
      text: "BIERE 6X355",
      price: 1_299,
      taxable: true,
      deposit: 60,
      discount: null,
      spendingCategoryId: ALCOHOL,
      share: "shared",
      chargedTo: null,
    },
    {
      text: "SAVON",
      price: 499,
      taxable: true,
      deposit: null,
      discount: null,
      spendingCategoryId: HOUSEHOLD,
      share: "shared",
      chargedTo: null,
    },
  ],
};

/** `BASKET` with each item's share as given, in order. */
function marked(...shares: ReceiptProposal["items"][number]["share"][]): ReceiptProposal {
  return {
    ...BASKET,
    items: BASKET.items.map((item, index) => ({ ...item, share: shares[index] ?? "shared" })),
  };
}

/** A reader that answers `proposals` and keeps the categories it was offered. */
function itemReader(...proposals: ReceiptProposal[]): {
  reader: ReceiptReader;
  offered: { id: number; name: string }[][];
} {
  const offered: { id: number; name: string }[][] = [];
  return {
    offered,
    reader: {
      model: "fake-haiku",
      async read(_photo, _signal, categories = []) {
        offered.push([...categories]);
        return proposals;
      },
    },
  };
}

function storedLines(target: App): { amount_cents: number; charged_to: string | null }[] {
  return homeBooks(target)
    .prepare("SELECT amount_cents, charged_to FROM period_lines ORDER BY id")
    .all() as { amount_cents: number; charged_to: string | null }[];
}

describe("a receipt's items (lg-10)", () => {
  test("a receipt whose items do not add up to its total cannot be filed, and files once corrected", async () => {
    const target = await start();
    const receipt = await uploaded(target);
    // The bread misread a cent short: 24,75 $ of items and taxes against 24,76 $.
    const short = {
      ...BASKET,
      items: BASKET.items.map((item, index) => (index === 0 ? { ...item, price: 348 } : item)),
    };

    const refused = await file(target, receipt.id, {
      proposal: short,
      destination: asLine(2_476),
    });

    expect(refused.statusCode, refused.body).toBe(422);
    expect(refused.json<ErrorResponse>().error.code).toBe("RECEIPT_DOES_NOT_ADD_UP");
    expect([count(target, "period_lines"), count(target, "receipt_filings")]).toEqual([0, 0]);
    expect(count(target, "receipt_items")).toBe(0);

    const corrected = await file(target, receipt.id, {
      proposal: BASKET,
      destination: asLine(2_476),
    });
    expect(corrected.statusCode, corrected.body).toBe(200);
  });

  test("refuses items with no total to make, and files nothing", async () => {
    const target = await start();
    const receipt = await uploaded(target);

    const refused = await file(target, receipt.id, {
      proposal: { ...BASKET, total: null },
      destination: asLine(2_476),
    });

    expect(refused.statusCode, refused.body).toBe(422);
    expect(count(target, "receipt_filings")).toBe(0);
  });

  test("an item not shared, with its deposit and taxes, comes off the line, to the cent", async () => {
    const target = await start();
    const receipt = await uploaded(target);

    const response = await file(target, receipt.id, {
      proposal: marked("shared", "not-shared"),
      destination: asLine(2_476, { spendingCategoryId: GROCERIES }),
    });

    expect(response.statusCode, response.body).toBe(200);
    const filing = response.json<ReceiptFiling>();
    // 24,76 $ less 15,54 $: excluded + shared = total.
    expect(storedLines(target)).toEqual([{ amount_cents: 922, charged_to: null }]);
    expect(filing.chargeLineId).toBeNull();
    expect(filing.proposal).toEqual(marked("shared", "not-shared"));
    expect(
      homeBooks(target)
        .prepare(
          "SELECT position, text, price_cents, taxable, deposit_cents, spending_category_id, share FROM receipt_items ORDER BY position",
        )
        .all(),
    ).toEqual([
      {
        position: 1,
        text: "PAIN",
        price_cents: 349,
        taxable: 0,
        deposit_cents: null,
        spending_category_id: GROCERIES,
        share: "shared",
      },
      {
        position: 2,
        text: "BIERE 6X355",
        price_cents: 1_299,
        taxable: 1,
        deposit_cents: 60,
        spending_category_id: ALCOHOL,
        share: "not-shared",
      },
      {
        position: 3,
        text: "SAVON",
        price_cents: 499,
        taxable: 1,
        deposit_cents: null,
        spending_category_id: HOUSEHOLD,
        share: "shared",
      },
    ]);
  });

  test("an item marked as the other's becomes a charge equal to its excluded amount, and the receipt still reconciles", async () => {
    const target = await start();
    const receipt = await uploaded(target, ALEX);

    const response = await file(target, receipt.id, {
      proposal: marked("shared", "theirs", "not-shared"),
      destination: asLine(2_476, { spendingCategoryId: GROCERIES }),
    });

    expect(response.statusCode, response.body).toBe(200);
    const filing = response.json<ReceiptFiling>();
    const stored = homeBooks(target)
      .prepare(
        "SELECT id, person_id, amount_cents, charged_to, spending_category_id, source FROM period_lines ORDER BY id",
      )
      .all() as { id: number; amount_cents: number }[];
    // The six-pack: exactly what it would come off as not shared, 15,54 $.
    expect(stored).toEqual([
      {
        id: filing.periodLineId,
        person_id: "alex",
        amount_cents: 348,
        charged_to: null,
        spending_category_id: GROCERIES,
        source: "receipt",
      },
      {
        id: filing.chargeLineId,
        person_id: "alex",
        amount_cents: 1_554,
        charged_to: "sam",
        spending_category_id: ALCOHOL,
        source: "receipt",
      },
    ]);
    // Shared + not shared (the soap, 5,74 $) + charged = total.
    const [shared, charged] = stored.map((line) => line.amount_cents);
    expect((shared ?? 0) + 574 + (charged ?? 0)).toBe(BASKET.total);
    const open = await target.server.inject({
      method: "GET",
      url: `${ROUTES.periodOpen}?end=2026-10-31`,
      headers: as(ALEX),
    });
    expect(
      open
        .json<OpenPeriodResponse>()
        .lines.map((line) => [line.lineId, line.amountCents, line.chargedTo]),
    ).toEqual([
      [filing.periodLineId, 348, null],
      [filing.chargeLineId, 1_554, "sam"],
    ]);
  });

  test("a receipt of only the other's items files the charge as its line", async () => {
    const target = await start();
    const receipt = await uploaded(target, ALEX);

    const response = await file(target, receipt.id, {
      proposal: marked("theirs", "theirs", "theirs"),
      destination: asLine(2_476),
    });

    expect(response.statusCode, response.body).toBe(200);
    const filing = response.json<ReceiptFiling>();
    expect(filing.chargeLineId).toBeNull();
    // 22,07 $ + 17,98 $ × 14,975 % = 24,762505 $ → 24,76 $: the whole receipt.
    expect(storedLines(target)).toEqual([{ amount_cents: 2_476, charged_to: "sam" }]);
  });

  test("a tip stays shared", async () => {
    const target = await start();
    const receipt = await uploaded(target);

    const response = await file(target, receipt.id, {
      proposal: marked("shared", "not-shared"),
      destination: asLine(2_476 + 300),
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(storedLines(target)).toEqual([{ amount_cents: 922 + 300, charged_to: null }]);
  });

  test("refuses a receipt of which nothing is shared or the other's, and files nothing", async () => {
    const target = await start();
    const receipt = await uploaded(target);

    const refused = await file(target, receipt.id, {
      proposal: marked("not-shared", "not-shared", "not-shared"),
      destination: asLine(2_476),
    });

    expect(refused.statusCode, refused.body).toBe(400);
    expect([count(target, "period_lines"), count(target, "receipt_filings")]).toEqual([0, 0]);
  });

  test("a receipt on a joint-account row keeps its items' categories, and refuses an item left out", async () => {
    const target = await start();
    await pasteRows(target);
    const first = await uploaded(target);
    const second = await uploaded(target);
    const rowOf = (amount: number): number =>
      (
        homeBooks(target)
          .prepare("SELECT id FROM statement_rows WHERE amount_cents = ?")
          .get(amount) as { id: number }
      ).id;

    const refused = await file(target, first.id, {
      proposal: marked("shared", "not-shared"),
      destination: { to: "row", rowId: rowOf(-2_650) },
    });
    expect(refused.statusCode, refused.body).toBe(400);
    expect(count(target, "receipt_filings")).toBe(0);

    const kept = await file(target, second.id, {
      proposal: BASKET,
      destination: { to: "row", rowId: rowOf(-2_650) },
    });
    expect(kept.statusCode, kept.body).toBe(200);
    expect(kept.json<ReceiptFiling>().proposal.items).toEqual(BASKET.items);
    expect(count(target, "period_lines")).toBe(0);
  });

  test("refuses an item whose category is not in the list, and files nothing", async () => {
    const target = await start();
    const receipt = await uploaded(target);
    const proposal = {
      ...BASKET,
      items: BASKET.items.map((item, index) =>
        index === 0 ? { ...item, spendingCategoryId: 99 } : item,
      ),
    };

    const refused = await file(target, receipt.id, { proposal, destination: asLine(2_476) });

    expect(refused.statusCode, refused.body).toBe(404);
    expect(refused.json<ErrorResponse>().error.code).toBe("SPENDING_CATEGORY_NOT_FOUND");
    expect(count(target, "period_lines")).toBe(0);
  });

  test("the model is offered the list as it stands, and a category not in it arrives as none", async () => {
    const offList = {
      ...BASKET,
      items: BASKET.items.map((item, index) =>
        index === 2 ? { ...item, spendingCategoryId: 99 } : item,
      ),
    };
    const fake = itemReader(offList);
    const target = await start({ reader: fake.reader });
    const retired = await target.server.inject({
      method: "POST",
      url: ROUTES.spendingCategoryRetire.replace(":id", String(HOUSEHOLD)),
      headers: as(ALEX),
    });
    expect(retired.statusCode, retired.body).toBe(200);
    const receipt = await uploaded(target);

    const answer = (await read(target, receipt.id)).json<ReadReceiptResponse>();

    // Household was retired, so it is not offered.
    expect(fake.offered[0]?.map((category) => category.name)).toEqual([
      "Groceries",
      "Alcohol",
      "Pharmacy",
      "Restaurant",
      "Other",
      "Property taxes",
      "Electricity",
      "Internet & phone",
      "Subscriptions",
      "Insurance",
      "Home maintenance",
      "Travel",
      "Transport",
      "Bank fees",
      "Cash",
    ]);
    expect(answer.proposals[0]?.proposal.items.map((item) => item.spendingCategoryId)).toEqual([
      GROCERIES,
      ALCOHOL,
      null,
    ]);
    expect(answer.proposals[0]?.flags).toEqual([]);
  });

  test("a merchant's previous category is proposed first on its next receipt", async () => {
    const fake = itemReader(
      { ...BASKET, merchant: "MARCHE  exemple" },
      { ...BASKET, merchant: "Quincaillerie" },
    );
    const target = await start({ reader: fake.reader });
    const before = await uploaded(target);
    const never = (await read(target, before.id)).json<ReadReceiptResponse>();
    expect(never.proposals.map((proposal) => proposal.merchantCategoryId)).toEqual([null, null]);

    const filed = await file(target, before.id, {
      proposal: BASKET,
      destination: asLine(2_476, { spendingCategoryId: GROCERIES }),
    });
    expect(filed.statusCode, filed.body).toBe(200);
    const next = await uploaded(target);

    const answer = (await read(target, next.id)).json<ReadReceiptResponse>();

    // The same merchant, written differently, gets Groceries; another gets none.
    expect(answer.proposals.map((proposal) => proposal.merchantCategoryId)).toEqual([
      GROCERIES,
      null,
    ]);
  });

  test("a merchant last filed on a row is proposed the category most of its items were given", async () => {
    const fake = itemReader(BASKET);
    const target = await start({ reader: fake.reader });
    await pasteRows(target);
    const first = await uploaded(target);
    // Groceries first, then Alcohol twice: the most, not the first.
    const proposal = {
      ...BASKET,
      items: BASKET.items.map((item, index) => ({
        ...item,
        spendingCategoryId: index === 0 ? GROCERIES : ALCOHOL,
      })),
    };
    const filed = await file(target, first.id, {
      proposal,
      destination: { to: "row", rowId: chargeRow(target) },
    });
    expect(filed.statusCode, filed.body).toBe(200);
    const next = await uploaded(target);

    const answer = (await read(target, next.id)).json<ReadReceiptResponse>();

    expect(answer.proposals[0]?.merchantCategoryId).toBe(ALCOHOL);
  });
});

// --- lg-10 gate 1's findings ---

describe("a merchant's last category, corrected (lg-10 gate 1, F3)", () => {
  test("is the category of the line as it now stands, not as it was filed", async () => {
    const PHARMACY = 4;
    const fake = itemReader({ ...BASKET, merchant: "Pharmaprix", items: [] });
    const target = await start({ reader: fake.reader });
    const before = await uploaded(target);
    const filed = await file(target, before.id, {
      proposal: { ...READ, merchant: "Pharmaprix" },
      destination: asLine(2_650, { spendingCategoryId: GROCERIES }),
    });
    expect(filed.statusCode, filed.body).toBe(200);
    // The person corrects the line: it was the pharmacy, not groceries.
    const corrected = await target.server.inject({
      method: "POST",
      url: ROUTES.periodLine.replace(":id", String(filed.json<ReceiptFiling>().periodLineId)),
      headers: as(ALEX),
      payload: {
        personId: "alex",
        date: "2026-10-04",
        amountCents: 2_650,
        category: null,
        spendingCategoryId: PHARMACY,
        note: "Pharmaprix",
        chargedTo: null,
      },
    });
    expect(corrected.statusCode, corrected.body).toBe(200);
    const next = await uploaded(target);

    const answer = (await read(target, next.id)).json<ReadReceiptResponse>();

    expect(answer.proposals[0]?.merchantCategoryId).toBe(PHARMACY);
  });
});

describe("a joint-account row's items (lg-10 gate 1, F1)", () => {
  // lg-91 supersedes "shared whole": a person's item on a row is a charge to the
  // pot, and must name whose it is, since a row has no payer to be "the other" of.
  test("refuses an item marked as someone's on a row that names nobody, and files nothing", async () => {
    const target = await start();
    await pasteRows(target);
    const receipt = await uploaded(target);

    const refused = await file(target, receipt.id, {
      proposal: {
        ...BASKET,
        total: 2_476,
        items: [BASKET.items[0], { ...BASKET.items[1], share: "theirs" }, BASKET.items[2]],
      },
      destination: { to: "row", rowId: chargeRow(target) },
    });

    expect(refused.statusCode, refused.body).toBe(400);
    const message = refused.json<ErrorResponse>().error.message;
    expect(message).toBe(
      "On a joint-account row, name whose each item left out of the shared amount is.",
    );
    // A line is paid by whoever uploaded the photo, which a row's purchase was not.
    expect(message).not.toContain("line");
    expect([count(target, "receipt_filings"), count(target, "receipt_items")]).toEqual([0, 0]);
    expect(count(target, "period_lines")).toBe(0);
  });
});

// --- lg-10 gate 2's findings, fixed at landing ---

describe("a merchant's last category, removed (lg-10 gate 2, N1)", () => {
  test("a line since removed still sets its merchant's category", async () => {
    const fake = itemReader({ ...BASKET, merchant: "Pharmaprix", items: [] });
    const target = await start({ reader: fake.reader });
    const before = await uploaded(target);
    const filed = await file(target, before.id, {
      proposal: { ...READ, merchant: "Pharmaprix" },
      destination: asLine(2_650, { spendingCategoryId: GROCERIES }),
    });
    expect(filed.statusCode, filed.body).toBe(200);
    const removed = await target.server.inject({
      method: "POST",
      url: ROUTES.periodLineRetire.replace(":id", String(filed.json<ReceiptFiling>().periodLineId)),
      headers: as(ALEX),
    });
    expect(removed.statusCode, removed.body).toBe(200);
    expect(count(target, "period_lines")).toBe(2);
    const next = await uploaded(target);

    const answer = (await read(target, next.id)).json<ReadReceiptResponse>();

    // The owner's answer of 2026-10-17: a removal undoes an entry, not its category.
    expect(answer.proposals[0]?.merchantCategoryId).toBe(GROCERIES);
  });
});

describe("a cycle in a line's corrections (lg-10 gate 2, N2)", () => {
  test("still answers when a hand-edited file makes a line supersede itself", async () => {
    const target = await start();
    const receipt = await uploaded(target);
    const filed = await file(target, receipt.id, {
      proposal: { ...READ, merchant: "Pharmaprix" },
      destination: asLine(2_650, { spendingCategoryId: GROCERIES }),
    });
    expect(filed.statusCode, filed.body).toBe(200);
    const db = homeBooks(target);
    // Nothing in the tool writes this; only a file edited by hand, or corrupt, holds it.
    db.prepare("UPDATE period_lines SET supersedes = id WHERE id = ?").run(
      filed.json<ReceiptFiling>().periodLineId,
    );

    expect(merchantCategory(db, "Pharmaprix", new Set([GROCERIES]))).toBe(GROCERIES);
  });
});

// lg-23 gate 1, F2: in a household of three, "the other's" named nobody, and
// lg-23 refused it. lg-30 names whose on each item, and lifts the refusal.
describe("an item marked as the other's, among more than two", () => {
  const three = [
    [ALEX, "alex"],
    ["casey@example.test", "casey"],
    [SAM, "sam"],
  ] as const;

  test("files a charge to each person the items name (lg-30)", async () => {
    const target = await start({ members: three });
    const receipt = await uploaded(target, ALEX);
    const proposal = named(BASKET, "shared", ["theirs", "casey"], ["theirs", "sam"]);

    const response = await file(target, receipt.id, {
      proposal,
      destination: asLine(2_476, { spendingCategoryId: GROCERIES }),
    });

    expect(response.statusCode, response.body).toBe(200);
    const filing = response.json<ReceiptFiling>();
    const stored = homeBooks(target)
      .prepare("SELECT id, person_id, amount_cents, charged_to FROM period_lines ORDER BY id")
      .all() as { id: number; amount_cents: number }[];
    // Apart 15,54 $ and 5,74 $: the shared line takes the cent, 3,48 $.
    expect(stored).toEqual([
      { id: filing.periodLineId, person_id: "alex", amount_cents: 348, charged_to: null },
      { id: expect.any(Number), person_id: "alex", amount_cents: 1_554, charged_to: "casey" },
      { id: expect.any(Number), person_id: "alex", amount_cents: 574, charged_to: "sam" },
    ]);
    expect(stored.reduce((sum, line) => sum + line.amount_cents, 0)).toBe(2_476);
    expect(filing.charges).toEqual([
      { chargedTo: "casey", lineId: stored[1]?.id, owedToPot: false },
      { chargedTo: "sam", lineId: stored[2]?.id, owedToPot: false },
    ]);
    expect(filing.chargeLineId).toBe(stored[1]?.id);
    expect(storedItems(target)).toEqual([
      { share: "shared", charged_to: null, charge_line_id: null },
      { share: "theirs", charged_to: "casey", charge_line_id: stored[1]?.id },
      { share: "theirs", charged_to: "sam", charge_line_id: stored[2]?.id },
    ]);
    expect(filing.proposal.items.map((item) => item.chargedTo)).toEqual([null, "casey", "sam"]);
  });

  test("a receipt with nothing marked as the other's still files", async () => {
    const target = await start({ members: three });
    const receipt = await uploaded(target, ALEX);

    const response = await file(target, receipt.id, {
      proposal: marked("shared", "not-shared", "shared"),
      destination: asLine(2_476, { spendingCategoryId: GROCERIES }),
    });

    expect(response.statusCode, response.body).toBe(200);
  });
});

function couponItem(
  text: string,
  price: number,
  taxable: boolean,
  share: "not-shared" | "theirs",
): ReceiptProposal["items"][number] {
  return {
    text,
    price,
    taxable,
    deposit: null,
    discount: null,
    spendingCategoryId: null,
    share,
    chargedTo: null,
  };
}

// --- lg-30: whose a receipt item's charge is, among more than two people ---

/** `BASKET`'s items marked in order, each a share or a share and whose it is. */
function named(
  receipt: ReceiptProposal,
  ...marks: (ItemMark | [ItemMark, string])[]
): ReceiptProposal {
  return {
    ...receipt,
    items: receipt.items.map((item, index) => {
      const mark = marks[index] ?? "shared";
      return typeof mark === "string"
        ? { ...item, share: mark, chargedTo: null }
        : { ...item, share: mark[0], chargedTo: mark[1] };
    }),
  };
}

type ItemMark = ReceiptProposal["items"][number]["share"];

function storedItems(
  target: App,
): { share: string; charged_to: string | null; charge_line_id: number | null }[] {
  return homeBooks(target)
    .prepare("SELECT share, charged_to, charge_line_id FROM receipt_items ORDER BY id")
    .all() as { share: string; charged_to: string | null; charge_line_id: number | null }[];
}

const THREE = [
  [ALEX, "alex"],
  ["casey@example.test", "casey"],
  [SAM, "sam"],
] as const;

const MORE_COMES_OFF =
  "More comes off this receipt than the card was charged. Check the amount charged and the items.";

describe("a theirs item that names nobody, among three (lg-30)", () => {
  test("is refused, asking whose, and files nothing", async () => {
    const target = await start({ members: THREE });
    const receipt = await uploaded(target, ALEX);

    const refused = await file(target, receipt.id, {
      proposal: named(BASKET, "shared", "theirs", ["theirs", "sam"]),
      destination: asLine(2_476),
    });

    expect(refused.statusCode, refused.body).toBe(400);
    expect(refused.json<ErrorResponse>().error).toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("name whose"),
    });
    expect([count(target, "period_lines"), count(target, "receipt_filings")]).toEqual([0, 0]);
  });
});

describe("two people keep their requests and results (lg-30)", () => {
  test("lg-10's charge names sam in charges and on its stored item", async () => {
    const target = await start();
    const receipt = await uploaded(target, ALEX);

    const response = await file(target, receipt.id, {
      proposal: marked("shared", "theirs", "not-shared"),
      destination: asLine(2_476, { spendingCategoryId: GROCERIES }),
    });

    expect(response.statusCode, response.body).toBe(200);
    const filing = response.json<ReceiptFiling>();
    expect(filing.chargeLineId).not.toBeNull();
    expect(filing.charges).toEqual([
      { chargedTo: "sam", lineId: filing.chargeLineId, owedToPot: false },
    ]);
    expect(storedItems(target)).toEqual([
      { share: "shared", charged_to: null, charge_line_id: null },
      { share: "theirs", charged_to: "sam", charge_line_id: filing.chargeLineId },
      { share: "not-shared", charged_to: null, charge_line_id: null },
    ]);
    expect(storedLines(target)).toEqual([
      { amount_cents: 348, charged_to: null },
      { amount_cents: 1_554, charged_to: "sam" },
    ]);
  });
});

describe("the names a theirs item may not carry (lg-30)", () => {
  test.each([
    [
      "the payer",
      named(BASKET, "shared", ["theirs", "alex"]),
      "A charge is owed by the other person, not by whoever paid.",
    ],
    [
      "a name the books do not hold",
      named(BASKET, "shared", ["theirs", "robin"]),
      "That person is not one of the household.",
    ],
    [
      "a name on a shared item",
      named(BASKET, ["shared", "sam"], "theirs"),
      "The filing is not valid: check proposal.",
    ],
    [
      "a name on a not-shared item",
      named(BASKET, ["not-shared", "sam"], "theirs"),
      "The filing is not valid: check proposal.",
    ],
  ])("refuses %s, and files nothing", async (_case, proposal, message) => {
    const target = await start({ members: THREE });
    const receipt = await uploaded(target, ALEX);

    const refused = await file(target, receipt.id, { proposal, destination: asLine(2_476) });

    expect(refused.statusCode, refused.body).toBe(400);
    expect(refused.json<ErrorResponse>().error).toMatchObject({ code: "BAD_REQUEST", message });
    expect([count(target, "period_lines"), count(target, "receipt_filings")]).toEqual([0, 0]);
  });

  // lg-91 supersedes the refusal this test held: a named item on a row is a
  // charge to the pot. The rest is proved at the end of this file.
  test("a theirs item naming a member on a joint-account row is filed as a charge to the pot", async () => {
    const target = await start({ members: THREE });
    await pasteRows(target);
    const receipt = await uploaded(target, ALEX);

    const filed = await file(target, receipt.id, {
      proposal: named(BASKET, "shared", ["theirs", "sam"]),
      destination: { to: "row", rowId: chargeRow(target) },
    });

    expect(filed.statusCode, filed.body).toBe(200);
    expect(filed.json<ReceiptFiling>().charges).toEqual([
      { chargedTo: "sam", lineId: 1, owedToPot: true },
    ]);
  });
});

describe("a member who has left (lg-30)", () => {
  async function departed(): Promise<App> {
    const directory = memberDirectory(THREE);
    const target = await start({ directory });
    // The books enrolled casey when they opened; the directory no longer holds them.
    directory.removeMember({
      address: "casey@example.test",
      by: "operator",
      at: new Date("2026-10-02T00:00:00Z"),
    });
    expect(directory.people("home")).toEqual(["alex", "sam"]);
    return target;
  }

  test("a theirs item that names nobody is the one other current member's", async () => {
    const target = await departed();
    const receipt = await uploaded(target, ALEX);

    const response = await file(target, receipt.id, {
      proposal: named(BASKET, "shared", "theirs"),
      destination: asLine(2_476),
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(storedLines(target)).toEqual([
      { amount_cents: 922, charged_to: null },
      { amount_cents: 1_554, charged_to: "sam" },
    ]);
  });

  test("and one that names them is charged to them", async () => {
    const target = await departed();
    const receipt = await uploaded(target, ALEX);

    const response = await file(target, receipt.id, {
      proposal: named(BASKET, "shared", ["theirs", "casey"]),
      destination: asLine(2_476),
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(storedLines(target)).toEqual([
      { amount_cents: 922, charged_to: null },
      { amount_cents: 1_554, charged_to: "casey" },
    ]);
  });
});

describe("nothing shared, two people charged (lg-30)", () => {
  test("files two charges, the cent of rounding off the largest", async () => {
    const target = await start({ members: THREE });
    const receipt = await uploaded(target, ALEX);

    const response = await file(target, receipt.id, {
      proposal: named(BASKET, ["theirs", "casey"], ["theirs", "sam"], ["theirs", "casey"]),
      destination: asLine(2_476),
    });

    expect(response.statusCode, response.body).toBe(200);
    const filing = response.json<ReceiptFiling>();
    const stored = homeBooks(target)
      .prepare("SELECT id, amount_cents, charged_to FROM period_lines ORDER BY id")
      .all() as { id: number }[];
    expect(stored).toEqual([
      { id: filing.periodLineId, amount_cents: 923, charged_to: "casey" },
      { id: expect.any(Number), amount_cents: 1_553, charged_to: "sam" },
    ]);
    expect(filing.chargeLineId).toBeNull();
    expect(filing.charges).toEqual([
      { chargedTo: "casey", lineId: stored[0]?.id, owedToPot: false },
      { chargedTo: "sam", lineId: stored[1]?.id, owedToPot: false },
    ]);
  });

  test.each([
    ["several", named(BASKET, ["theirs", "casey"], ["theirs", "sam"], ["theirs", "casey"])],
    ["one", named(BASKET, ["theirs", "sam"], ["theirs", "sam"], ["theirs", "sam"])],
  ])(
    "a payment under the printed total, with %s charged, is refused as more coming off",
    async (_case, proposal) => {
      const target = await start({ members: THREE });
      const receipt = await uploaded(target, ALEX);

      const refused = await file(target, receipt.id, { proposal, destination: asLine(2_470) });

      expect(refused.statusCode, refused.body).toBe(400);
      expect(refused.json<ErrorResponse>().error).toMatchObject({
        code: "BAD_REQUEST",
        message: MORE_COMES_OFF,
      });
      expect([count(target, "period_lines"), count(target, "receipt_filings")]).toEqual([0, 0]);
    },
  );
});

describe("a theirs item that costs nothing (lg-30)", () => {
  test("files no charge line, and keeps whose it was on the item", async () => {
    const target = await start({ members: THREE });
    const receipt = await uploaded(target, ALEX);
    const proposal: ReceiptProposal = {
      ...BASKET,
      items: [...BASKET.items, { ...couponItem("SAC", 0, false, "theirs"), chargedTo: "casey" }],
    };

    const response = await file(target, receipt.id, { proposal, destination: asLine(2_476) });

    expect(response.statusCode, response.body).toBe(200);
    const filing = response.json<ReceiptFiling>();
    expect(storedLines(target)).toEqual([{ amount_cents: 2_476, charged_to: null }]);
    expect(filing.charges).toEqual([]);
    expect(filing.chargeLineId).toBeNull();
    expect(storedItems(target).at(-1)).toEqual({
      share: "theirs",
      charged_to: "casey",
      charge_line_id: null,
    });
  });
});

describe("the people the screen is not given (lg-30)", () => {
  // lg-33 added `names`, a contract change the owner asked for (2026-10-17), and
  // lg-35 `retired`, the books' people retired at a close, which is no list of
  // the current members either; what lg-30 held still holds: none rides here.
  test("GET /api/people still answers people, and only retired and names beside it", async () => {
    const target = await start({ members: THREE });

    const response = await target.server.inject({
      method: "GET",
      url: ROUTES.people,
      headers: as(ALEX),
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(Object.keys(response.json<Record<string, unknown>>())).toEqual([
      "people",
      "retired",
      "names",
    ]);
  });
});

// lg-30, gate 1 F1, fixed at landing (owner, 2026-10-18): main files this receipt.
describe("a free shared item beside a cent of rounding (lg-30, gate 1 F1)", () => {
  test("files the charge alone, as the same receipt without the free item does", async () => {
    const target = await start();
    const receipt = await uploaded(target, ALEX);
    const items = [
      couponItem("VIN", 2_074, true, "not-shared"),
      { ...couponItem("SAC 0,00", 0, false, "theirs"), share: "shared" as const },
      couponItem("FROMAGE", 309, true, "theirs"),
      couponItem("PAIN", 1_892, true, "theirs"),
    ];

    const response = await file(target, receipt.id, {
      proposal: {
        ...BASKET,
        subtotal: 4_275,
        gst: 214,
        qst: 426,
        total: 4_915,
        items,
      },
      destination: asLine(4_915),
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(storedLines(target)).toEqual([{ amount_cents: 2_531, charged_to: "sam" }]);
  });
});

// lg-30, gate 1 F2, fixed at landing (owner, 2026-10-18): a free theirs item files
// no line, so `addLine` never meets its name and only `chargedToOf` does.
describe("a free theirs item names a person the household does not hold (lg-30, gate 1 F2)", () => {
  test.each([
    ["a member of another household", "zoe", "That person is not one of the household."],
    ["a name nobody holds", "nobody", "That person is not one of the household."],
    ["the payer", "alex", "A charge is owed by the other person, not by whoever paid."],
  ])("refuses %s, and files nothing", async (_case, name, message) => {
    const directory = memberDirectory(THREE);
    const change = { by: "operator", at: new Date("2026-10-01T00:00:00Z") };
    directory.addHousehold({ id: "away", name: "Another", ...change });
    directory.addMember({
      household: "away",
      address: "zoe@example.test",
      person: "zoe",
      ...change,
    });
    const target = await start({ directory });
    const receipt = await uploaded(target, ALEX);
    const free = { ...couponItem("SAC 0,00", 0, false, "theirs"), chargedTo: name };
    const basket = named(BASKET, "shared", "shared", "shared");

    const refused = await file(target, receipt.id, {
      proposal: { ...basket, items: [...basket.items, free] },
      destination: asLine(2_476),
    });

    expect(refused.statusCode, refused.body).toBe(400);
    expect(refused.json<ErrorResponse>().error).toMatchObject({ code: "BAD_REQUEST", message });
    expect([
      count(target, "period_lines"),
      count(target, "receipt_filings"),
      count(target, "receipt_items"),
    ]).toEqual([0, 0, 0]);
  });
});

// --- lg-89: a rebate folded into the item it reduces ---

/**
 * `BASKET` with 2,00 $ off the six-pack, folded into it: taxable nets 15,98 $,
 * GST 0,80 $, QST 1,59 $, total 22,46 $. The six-pack alone, at its net, with
 * its deposit and taxes, is 13,2357525 $ → 13,24 $.
 */
const REBATED: ReceiptProposal = {
  ...BASKET,
  subtotal: 2_007,
  gst: 80,
  qst: 159,
  total: 2_246,
  items: BASKET.items.map((item, index) => (index === 1 ? { ...item, discount: -200 } : item)),
};

describe("a rebate folded into an item (lg-89)", () => {
  test("stores the rebate with its item, reads it back, and takes it off with the item", async () => {
    const target = await start();
    const receipt = await uploaded(target);
    const proposal = {
      ...REBATED,
      items: REBATED.items.map((item, index) =>
        index === 1 ? { ...item, share: "not-shared" as const } : item,
      ),
    };

    const response = await file(target, receipt.id, { proposal, destination: asLine(2_246) });

    expect(response.statusCode, response.body).toBe(200);
    // 22,46 $ less 13,24 $.
    expect(storedLines(target)).toEqual([{ amount_cents: 922, charged_to: null }]);
    expect(response.json<ReceiptFiling>().proposal).toEqual(proposal);
    expect(
      homeBooks(target)
        .prepare("SELECT position, discount_cents FROM receipt_items ORDER BY position")
        .all(),
    ).toEqual([
      { position: 1, discount_cents: null },
      { position: 2, discount_cents: -200 },
      { position: 3, discount_cents: null },
    ]);
  });

  test("reads an item a request sends with no rebate, as every client before lg-89 does, as none", async () => {
    const target = await start();
    const receipt = await uploaded(target);
    const unaware = {
      ...BASKET,
      items: BASKET.items.map(({ discount: _discount, ...item }) => item),
    };

    const response = await file(target, receipt.id, {
      proposal: unaware,
      destination: asLine(2_476),
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<ReceiptFiling>().proposal.items.map((item) => item.discount)).toEqual([
      null,
      null,
      null,
    ]);
  });

  test("passes a rebate on a row's item to the chart's split", async () => {
    const target = await start();
    await pasteRows(target);
    const receipt = await uploaded(target);

    const response = await file(target, receipt.id, {
      proposal: REBATED,
      destination: { to: "row", rowId: chargeRow(target) },
    });

    expect(response.statusCode, response.body).toBe(200);
    const onRow = receiptsOnRows(homeBooks(target)).get(chargeRow(target));
    expect(onRow?.items.map((item) => item.discount)).toEqual([null, -200, null]);
  });
});

// lg-89 gate 1, the third low: a stored rebate to a chart amount in one piece.
describe("a stored rebate reaches the chart (lg-89, gate 1)", () => {
  test("a rebate on the soap lowers the household slice by its net and taxes, and the remainder stays with the beer", async () => {
    const target = await start();
    await pasteRows(target);
    const receipt = await uploaded(target);
    // 1,00 $ off the soap: the taxable items net 16,98 $, GST 0,85 $, QST 1,69 $,
    // and the 0,60 $ deposit makes 23,61 $.
    const proposal: ReceiptProposal = {
      ...BASKET,
      subtotal: 2_047,
      gst: 85,
      qst: 169,
      total: 2_361,
      items: BASKET.items.map((item, index) => (index === 2 ? { ...item, discount: -100 } : item)),
    };
    const rowId = chargeRow(target);

    const response = await file(target, receipt.id, {
      proposal,
      destination: { to: "row", rowId },
    });

    expect(response.statusCode, response.body).toBe(200);
    const row: StoredRow = {
      id: rowId,
      date: "2026-10-03",
      category: "Épicerie",
      description: "Achat /Marché Exemple",
      amountCents: -2_650,
      balanceCents: 0,
      classification: null,
      spendingCategory: null,
    };
    const charted = chartedAs(row, receiptsOnRows(homeBooks(target)));
    // Soap: 3,99 $ × 1,14975 = 4,59 $ → 459, not 574 without the rebate. Beer, the
    // largest, takes the rest of the 26,50 $: 1 554 + (2 650 − 2 362).
    expect(charted).toEqual({
      split: true,
      slices: [
        { categoryId: GROCERIES, cents: 349 },
        { categoryId: ALCOHOL, cents: 1_842 },
        { categoryId: HOUSEHOLD, cents: 459 },
      ],
    });
  });
});

// --- lg-91: an item left out of a joint-account row's receipt, owed to the pot ---

/** The six-pack, sam's: 15,54 $ with its deposit and taxes (`BASKET`'s comment). */
const SAMS_BEER = named(BASKET, "shared", ["theirs", "sam"]);
const BEER_CENTS = 1_554;

async function send(target: App, method: "GET" | "POST", route: string, payload?: object) {
  return await target.server.inject({
    method,
    url: route,
    headers: as(ALEX),
    ...(payload === undefined ? {} : { payload }),
  });
}

/** Confirms a ratio from 2026-01-01 out of the salaries given, by person. */
async function confirmRatio(target: App, salaries: Record<string, number>): Promise<void> {
  const entered = await send(target, "POST", ROUTES.salaries, {
    year: 2026,
    salaries: Object.entries(salaries).map(([personId, amountCents]) => ({
      personId,
      amountCents,
    })),
  });
  expect(entered.statusCode, entered.body).toBe(200);
  const confirmed = await send(target, "POST", ROUTES.ratios, {
    effectiveFrom: "2026-01-01",
    salaryIds: entered.json<{ salaries: { id: number }[] }>().salaries.map((salary) => salary.id),
  });
  expect(confirmed.statusCode, confirmed.body).toBe(200);
}

async function openPeriod(target: App): Promise<OpenPeriodResponse> {
  const open = await send(target, "GET", ROUTES.periodOpen);
  expect(open.statusCode, open.body).toBe(200);
  return open.json<OpenPeriodResponse>();
}

function statementRow(target: App, rowId: number): unknown {
  return homeBooks(target).prepare("SELECT * FROM statement_rows WHERE id = ?").get(rowId);
}

function potLines(target: App): unknown[] {
  return homeBooks(target)
    .prepare(
      "SELECT person_id, date, amount_cents, charged_to, owed_to_pot, spending_category_id, note, source FROM period_lines ORDER BY id",
    )
    .all();
}

describe("an item on a joint-account row charged to a person (lg-91)", () => {
  test("files one charge to the pot in the row's period at the item's cost, leaves the row as it was, and moves the settlement by (1 − r) × c", async () => {
    const target = await start();
    await pasteRows(target);
    // alex 0.6, sam 0.4.
    await confirmRatio(target, { alex: 6_000_000, sam: 4_000_000 });
    const rowId = chargeRow(target);
    const row = statementRow(target, rowId);
    const classifications = count(target, "classifications");
    const before = await openPeriod(target);
    const receipt = await uploaded(target);

    const filed = await file(target, receipt.id, {
      proposal: SAMS_BEER,
      destination: { to: "row", rowId },
    });

    expect(filed.statusCode, filed.body).toBe(200);
    const filing = filed.json<ReceiptFiling>();
    expect(filing).toMatchObject({ rowId, periodLineId: null, chargeLineId: null });
    // One line: sam owes the pot the six-pack, dated the row's date, under its category.
    expect(potLines(target)).toEqual([
      {
        person_id: "sam",
        date: "2026-10-03",
        amount_cents: BEER_CENTS,
        charged_to: null,
        owed_to_pot: 1,
        spending_category_id: ALCOHOL,
        note: "Marché Exemple",
        source: "receipt",
      },
    ]);
    const [charge] = filing.charges;
    expect(filing.charges).toEqual([{ chargedTo: "sam", lineId: charge?.lineId, owedToPot: true }]);
    expect(storedItems(target)).toEqual([
      { share: "shared", charged_to: null, charge_line_id: null },
      { share: "theirs", charged_to: "sam", charge_line_id: charge?.lineId },
      { share: "shared", charged_to: null, charge_line_id: null },
    ]);
    // The row is as it was, and so is how it is filed.
    expect(statementRow(target, rowId)).toEqual(row);
    expect(count(target, "classifications")).toBe(classifications);

    const after = await openPeriod(target);
    // The open period holds it, read as a charge to sam owed to the pot.
    expect(after.lines).toEqual([
      expect.objectContaining({
        date: "2026-10-03",
        personId: "sam",
        chargedTo: "sam",
        owedToPot: true,
        amountCents: BEER_CENTS,
        lineId: charge?.lineId,
      }),
    ]);
    // Nothing was owed before; now sam owes alex (1 − 0.4) × 15,54 $ = 9,324 $.
    expect(before.settlement).toMatchObject({ deposits: [], transfers: [] });
    expect(after.settlement).toMatchObject({
      transfers: [{ fromId: "sam", toId: "alex", cents: 932 }],
      // Into a buffer alex owns 0.6 of: 9,324 / 0.6 = 15,54 $, the six-pack's cost.
      deposits: [{ personId: "sam", depositCents: BEER_CENTS }],
    });
  });

  test("among three, the charge is shared out at each member's ratio", async () => {
    const target = await start({ members: THREE });
    await pasteRows(target);
    // alex 0.5, casey 0.3, sam 0.2.
    await confirmRatio(target, { alex: 5_000_000, casey: 3_000_000, sam: 2_000_000 });
    const receipt = await uploaded(target);

    const filed = await file(target, receipt.id, {
      proposal: SAMS_BEER,
      destination: { to: "row", rowId: chargeRow(target) },
    });

    expect(filed.statusCode, filed.body).toBe(200);
    // sam owes alex 0.5 × 15,54 $ = 7,77 $ and casey 0.3 × 15,54 $ = 4,662 $.
    expect((await openPeriod(target)).settlement?.transfers).toEqual([
      { fromId: "sam", toId: "alex", cents: 777 },
      { fromId: "sam", toId: "casey", cents: 466 },
    ]);
  });

  test.each([
    [
      "a not-shared item",
      named(BASKET, "shared", "not-shared"),
      "A joint-account purchase has no payer to keep an item: mark it shared, or name whose it is.",
    ],
    [
      "a theirs item naming nobody",
      named(BASKET, "shared", "theirs"),
      "On a joint-account row, name whose each item left out of the shared amount is.",
    ],
    [
      "a theirs item naming someone the books do not hold",
      named(BASKET, "shared", ["theirs", "robin"]),
      "That person is not one of the household.",
    ],
  ])("refuses %s, and files nothing", async (_case, proposal, message) => {
    const target = await start({ members: THREE });
    await pasteRows(target);
    const rowId = chargeRow(target);
    const row = statementRow(target, rowId);
    const receipt = await uploaded(target);

    const refused = await file(target, receipt.id, {
      proposal,
      destination: { to: "row", rowId },
    });

    expect(refused.statusCode, refused.body).toBe(400);
    expect(refused.json<ErrorResponse>().error).toMatchObject({ code: "BAD_REQUEST", message });
    expect([
      count(target, "period_lines"),
      count(target, "receipt_filings"),
      count(target, "receipt_items"),
    ]).toEqual([0, 0, 0]);
    expect(statementRow(target, rowId)).toEqual(row);
  });

  test("the row's chart leaves out the charged item's category, which its charge charts instead", async () => {
    const target = await start();
    await pasteRows(target);
    const rowId = chargeRow(target);
    const receipt = await uploaded(target);
    const filed = await file(target, receipt.id, {
      proposal: SAMS_BEER,
      destination: { to: "row", rowId },
    });
    expect(filed.statusCode, filed.body).toBe(200);
    const row: StoredRow = {
      id: rowId,
      date: "2026-10-03",
      category: "Épicerie",
      description: "Achat /Marché Exemple",
      amountCents: -2_650,
      balanceCents: 0,
      classification: null,
      spendingCategory: null,
    };

    const charted = chartedAs(row, receiptsOnRows(homeBooks(target)));

    // Bread 3,49 $ and soap 4,99 $ × 1,14975 = 5,74 $; the 26,50 $ less the
    // six-pack's 15,54 $ is 10,96 $, and the soap, the larger, takes the
    // remaining 1,73 $. No alcohol: the six-pack's charge charts it, as a card line.
    expect(charted).toEqual({
      split: true,
      slices: [
        { categoryId: GROCERIES, cents: 349 },
        { categoryId: HOUSEHOLD, cents: 747 },
      ],
    });
    expect(charted.slices.reduce((sum, slice) => sum + slice.cents, 0) + BEER_CENTS).toBe(2_650);
    expect(potLines(target)).toEqual([
      expect.objectContaining({ amount_cents: BEER_CENTS, spending_category_id: ALCOHOL }),
    ]);
  });

  test("a charge to the pot corrected stays one, and the row's chart follows what stands; removed, the row is whole again", async () => {
    const target = await start();
    await pasteRows(target);
    const rowId = chargeRow(target);
    const receipt = await uploaded(target);
    const filed = await file(target, receipt.id, {
      proposal: SAMS_BEER,
      destination: { to: "row", rowId },
    });
    expect(filed.statusCode, filed.body).toBe(200);
    const lineId = filed.json<ReceiptFiling>().charges[0]?.lineId ?? 0;
    const row = { id: rowId, amountCents: -2_650, spendingCategory: null } as StoredRow;
    const copied = {
      personId: "sam",
      date: "2026-10-03",
      amountCents: 1_000,
      category: null,
      spendingCategoryId: ALCOHOL,
      note: "Marché Exemple",
      chargedTo: "sam",
    };

    // The stats screen corrects a line by sending it back as it reads it.
    const corrected = await send(
      target,
      "POST",
      ROUTES.periodLine.replace(":id", String(lineId)),
      copied,
    );
    expect(corrected.statusCode, corrected.body).toBe(200);
    expect(corrected.json()).toMatchObject({
      chargedTo: "sam",
      owedToPot: true,
      amountCents: 1_000,
    });
    const chargedNow = receiptsOnRows(homeBooks(target)).get(rowId)?.chargedCents;
    expect(chargedNow).toBe(1_000);
    // Made a card line, it is refused: nobody paid it on a card.
    const toCard = await send(
      target,
      "POST",
      ROUTES.periodLine.replace(":id", String(corrected.json<{ id: number }>().id)),
      { ...copied, chargedTo: null },
    );
    expect(toCard.statusCode, toCard.body).toBe(400);

    const retired = await send(
      target,
      "POST",
      ROUTES.periodLineRetire.replace(":id", String(corrected.json<{ id: number }>().id)),
    );
    expect(retired.statusCode, retired.body).toBe(200);
    expect((await openPeriod(target)).lines).toEqual([]);
    expect(chartedAs(row, receiptsOnRows(homeBooks(target))).slices).toEqual([
      { categoryId: GROCERIES, cents: 349 },
      { categoryId: ALCOHOL, cents: 1_727 },
      { categoryId: HOUSEHOLD, cents: 574 },
    ]);
  });

  test("a line charged to whoever paid it is still refused when a person enters it", async () => {
    const target = await start();

    const refused = await send(target, "POST", ROUTES.periodLines, {
      personId: "sam",
      date: "2026-10-03",
      amountCents: 1_000,
      category: null,
      spendingCategoryId: null,
      note: null,
      chargedTo: "sam",
    });

    expect(refused.statusCode, refused.body).toBe(400);
    expect(count(target, "period_lines")).toBe(0);
  });
});
