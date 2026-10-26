/**
 * `workbook-zip.ts`'s own guards, one test each (lg-66, gate 1's F1). The
 * route tests in `workbook-describe.test.ts` reach the bounds; these reach the
 * structure checks a crafted zip meets first, each of which a test there would
 * pass without. Every zip here is built byte by byte, so one field at a time
 * can be wrong, and the control proves the same zip is read when nothing is.
 */

import { Buffer } from "node:buffer";
import { describe, expect, test } from "vitest";
import { AppError } from "@ledger/contract";
import {
  INFLATE_CHUNK_BYTES,
  MAX_WORKBOOK_ENTRIES,
  countInflated,
  workbookEntries,
} from "../src/workbook-zip.ts";
import type { ZipEntry } from "../src/workbook-zip.ts";
import { rawZip } from "./helpers/xlsx-file.ts";
import type { RawEntry } from "./helpers/xlsx-file.ts";

const TYPES = Buffer.from(
  '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>',
);
const WORKBOOK = Buffer.from(
  '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets/></workbook>',
);

/** The two entries every `.xlsx` holds, then `more`. */
function workbook(...more: RawEntry[]): RawEntry[] {
  return [
    { name: "[Content_Types].xml", data: TYPES },
    { name: "xl/workbook.xml", data: WORKBOOK },
    ...more,
  ];
}

/** The code `run` threw, or what it did instead, so a red run says which. */
function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error: unknown) {
    return error instanceof AppError ? error.code : `not an AppError: ${String(error)}`;
  }
  return "nothing thrown";
}

async function codeOfAsync(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error: unknown) {
    return error instanceof AppError ? error.code : `not an AppError: ${String(error)}`;
  }
  return "nothing thrown";
}

const BIG = Number.MAX_SAFE_INTEGER;

describe("the control", () => {
  test("the zip every case below breaks one field of is read, and counted", async () => {
    const zip = rawZip(workbook({ name: "xl/worksheets/sheet1.xml", data: Buffer.from("<x/>") }));
    const entries = workbookEntries(zip);
    expect(entries.map((entry) => entry.name)).toEqual([
      "[Content_Types].xml",
      "xl/workbook.xml",
      "xl/worksheets/sheet1.xml",
    ]);
    expect(await countInflated(zip, entries, BIG)).toBe(TYPES.length + WORKBOOK.length + 4);
  });
});

describe("the directory, read before anything is inflated", () => {
  test.each([
    ["encrypted (flag bit 0)", { flags: 1 }],
    ["compressed by a method exceljs does not read (12, bzip2)", { method: 12 }],
  ])("an entry %s is not an .xlsx", (_what, field) => {
    const zip = rawZip(
      workbook({ name: "xl/worksheets/sheet1.xml", data: Buffer.from("<x/>"), ...field }),
    );
    expect(codeOf(() => workbookEntries(zip))).toBe("WORKBOOK_NOT_XLSX");
  });

  test.each([
    ["compressed size", { compressedSize: 0xffffffff }],
    ["uncompressed size", { declaredSize: 0xffffffff }],
    ["local header's offset", { localHeaderOffset: 0xffffffff }],
  ])("a zip64 sentinel in an entry's %s is not an .xlsx", (_what, field) => {
    const zip = rawZip(
      workbook({ name: "xl/worksheets/sheet1.xml", data: Buffer.from("<x/>"), ...field }),
    );
    expect(codeOf(() => workbookEntries(zip))).toBe("WORKBOOK_NOT_XLSX");
  });

  test.each([
    ["this disk's number is not 0", { disk: 1 }],
    ["the directory's disk is not 0", { directoryDisk: 1 }],
    ["the entries on this disk are not all of them", { onDisk: 2 }],
    ["the count is zip64's 0xffff", { count: 0xffff }],
  ])("an end record where %s is not an .xlsx", (_what, end) => {
    const zip = rawZip(
      workbook({ name: "xl/worksheets/sheet1.xml", data: Buffer.from("<x/>") }),
      end,
    );
    expect(codeOf(() => workbookEntries(zip))).toBe("WORKBOOK_NOT_XLSX");
  });

  test.each([
    ["the directory's offset is zip64's 0xffffffff", (_size: number) => ({ offset: 0xffffffff })],
    ["the directory's size is zip64's 0xffffffff", (_size: number) => ({ size: 0xffffffff })],
    ["the directory runs into the end record", (size: number) => ({ size: size + 10 })],
  ])("an end record where %s is not an .xlsx", (_what, end) => {
    const entries = workbook({ name: "xl/worksheets/sheet1.xml", data: Buffer.from("<x/>") });
    const honest = rawZip(entries);
    const size = honest.readUInt32LE(honest.length - 22 + 12);
    const zip = rawZip(entries, end(size));
    expect(codeOf(() => workbookEntries(zip))).toBe("WORKBOOK_NOT_XLSX");
  });
});

describe("the entries' bytes, found through their local headers", () => {
  test("an entry whose local header has no signature is not an .xlsx", async () => {
    const zip = rawZip(
      workbook({ name: "xl/worksheets/sheet1.xml", data: Buffer.from("<x/>"), localSignature: 0 }),
    );
    const entries = workbookEntries(zip);
    expect(await codeOfAsync(() => countInflated(zip, entries, BIG))).toBe("WORKBOOK_NOT_XLSX");
  });

  test("an entry whose local header would start past the file's last 30 bytes is not an .xlsx", async () => {
    const zip = rawZip(workbook({ name: "xl/worksheets/sheet1.xml", data: Buffer.from("<x/>") }));
    const entries: ZipEntry[] = workbookEntries(zip).map((entry) =>
      entry.name === "xl/worksheets/sheet1.xml"
        ? { ...entry, localHeaderOffset: zip.length - 10 }
        : entry,
    );
    expect(await codeOfAsync(() => countInflated(zip, entries, BIG))).toBe("WORKBOOK_NOT_XLSX");
  });

  test("a deflated entry that will not inflate is not an .xlsx", async () => {
    // 0xff opens a block of the reserved type 3: zlib refuses it at once.
    const zip = rawZip(
      workbook({
        name: "xl/worksheets/sheet1.xml",
        data: Buffer.from("<x/>"),
        compressed: Buffer.from([0xff, 0xff, 0xff, 0xff]),
      }),
    );
    const entries = workbookEntries(zip);
    expect(await codeOfAsync(() => countInflated(zip, entries, BIG))).toBe("WORKBOOK_NOT_XLSX");
  });
});

describe("stored entries are counted too", () => {
  test("forty directory entries over one stored entry, each declaring 0, are stopped at the bound", async () => {
    // Nothing inflates a stored entry, but a reader that follows the directory
    // reads each name's bytes: forty names over one block of 300 000 are 12 MB.
    // Not a divisor of the bound, so a stop on a whole entry would overshoot.
    const block = Buffer.alloc(300_000, 0x20);
    const sheets: RawEntry[] = Array.from({ length: 40 }, (_, index) => ({
      name: `xl/worksheets/sheet${String(index + 1)}.xml`,
      data: block,
      method: 0,
      declaredSize: 0,
      ...(index === 0 ? {} : { sameAs: 2 }),
    }));
    const zip = rawZip(workbook(...sheets));
    const entries = workbookEntries(zip);
    expect(entries.reduce((sum, entry) => sum + entry.declaredSize, 0)).toBe(
      TYPES.length + WORKBOOK.length,
    );
    const bound = 1024 * 1024;
    const counted: number[] = [];

    const code = await codeOfAsync(() =>
      countInflated(zip, entries, bound, (bytes) => counted.push(bytes)),
    );

    expect(code).toBe("WORKBOOK_TOO_LARGE");
    // Counted a chunk at a time, as an inflate is (gate 1's F3): the stop
    // overshoots by one chunk at most, not by a whole stored entry.
    const total = counted.reduce((sum, bytes) => sum + bytes, 0);
    expect(total).toBeGreaterThan(bound);
    expect(total).toBeLessThanOrEqual(bound + INFLATE_CHUNK_BYTES);
  });
});

describe("the number of entries (lg-66 gate 1, F2)", () => {
  /** A workbook's two entries and enough empty ones to make `count`. */
  function entries(count: number): RawEntry[] {
    return workbook(
      ...Array.from({ length: count - 2 }, (_, index) => ({
        name: `xl/media/part${String(index)}.bin`,
        data: Buffer.alloc(0),
        method: 0,
      })),
    );
  }

  test("a directory of exactly the bound is read", () => {
    expect(workbookEntries(rawZip(entries(MAX_WORKBOOK_ENTRIES)))).toHaveLength(
      MAX_WORKBOOK_ENTRIES,
    );
  });

  test("one entry more is refused as too large, naming the bound, before the directory is walked", () => {
    const zip = rawZip(entries(MAX_WORKBOOK_ENTRIES + 1));
    let thrown: unknown;
    try {
      workbookEntries(zip);
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect(thrown).toMatchObject({ code: "WORKBOOK_TOO_LARGE", details: { bound: "entries" } });
  });
});
