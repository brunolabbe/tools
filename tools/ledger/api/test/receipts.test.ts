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
import { afterEach, describe, expect, test } from "vitest";
import { MAX_RECEIPT_PHOTO_BYTES, ROUTES } from "@ledger/contract";
import type {
  ErrorResponse,
  OpenPeriodResponse,
  ReadReceiptResponse,
  Receipt,
  ReceiptFiling,
  ReceiptMatchesResponse,
  ReceiptProposal,
} from "@ledger/contract";
import type { ReceiptReader } from "@ledger/receipts";
import { loadApiConfig } from "../src/config.ts";
import { createLogger } from "../src/logger.ts";
import { createApp } from "../src/server.ts";
import type { App } from "../src/server.ts";
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
  await app?.shutdown();
  app = undefined;
  if (dataDir !== undefined) rmSync(dataDir, { recursive: true, force: true });
  dataDir = undefined;
});

async function start(
  options: { reader?: ReceiptReader | null; files?: boolean; lines?: string[] } = {},
): Promise<App> {
  if (options.files === true) dataDir = mkdtempSync(path.join(tmpdir(), "ledger-receipts-"));
  const lines = options.lines;
  app = await createApp({
    directory: memberDirectory(),
    config: {
      dataDir: dataDir ?? ":memory:",
      access: accessConfig(),
      rateLimitReadsPerMinute: 0,
      rateLimitWritesPerMinute: 0,
      // Never the environment's: a key on the host must not reach a test.
      receiptReader: { apiKey: undefined, model: "claude-haiku-5-5" },
    },
    logger: createLogger({
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

async function file(target: App, id: number, request: unknown, who = ALEX) {
  return await target.server.inject({
    method: "POST",
    url: url(ROUTES.receiptFile, id),
    headers: as(who),
    payload: request as Record<string, unknown>,
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

    // Uploading, asking for matches and filing by hand never call it.
    await matches(target, receipt.id, 2_650, "2026-10-04");
    expect(counted.calls).toBe(0);

    const response = await read(target, receipt.id);

    expect(response.statusCode, response.body).toBe(200);
    expect(counted.calls).toBe(1);
    expect(response.json<ReadReceiptResponse>()).toEqual({
      receiptId: receipt.id,
      model: "fake-haiku",
      proposals: [
        { proposal: READ, flags: [] },
        { proposal: { ...READ, merchant: "Quincaillerie", total: 2_651 }, flags: ["parts-differ"] },
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
    const target = await start({ lines });
    const photo = jpeg();
    photo.write("PHOTO-MARKER", 8);
    const sent = await upload(target, photo);
    await read(target, sent.json<Receipt>().id);
    await upload(target, Buffer.from("PHOTO-MARKER and no image"));

    const log = lines.join("\n");
    expect(lines.length).toBeGreaterThan(0);
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
