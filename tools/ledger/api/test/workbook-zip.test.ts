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
import { rawZip, reEnded } from "./helpers/xlsx-file.ts";
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
    ["compressed by a method the reader does not read (12, bzip2)", { method: 12 }],
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
  test("forty directory entries over one stored entry are stopped at the bound", async () => {
    // Nothing inflates a stored entry, but a reader that follows the directory
    // reads each name's bytes: forty names over one block of 300 000 are 12 MB.
    // Not a divisor of the bound, so a stop on a whole entry would overshoot.
    // Each declared 0 until lg-87, which refuses a directory size the local
    // header does not repeat; the count is what this test is about.
    const block = Buffer.alloc(300_000, 0x20);
    const sheets: RawEntry[] = Array.from({ length: 40 }, (_, index) => ({
      name: `xl/worksheets/sheet${String(index + 1)}.xml`,
      data: block,
      method: 0,
      ...(index === 0 ? {} : { sameAs: 2 }),
    }));
    const zip = rawZip(workbook(...sheets));
    const entries = workbookEntries(zip);
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

describe("the directory's own entries, and the bytes they point at (round 1's sweep)", () => {
  // Three guards gate 1 did not list, which no test reached until round 1.
  const SHEET = { name: "xl/worksheets/sheet1.xml", data: Buffer.from("<x/>") };

  test("a directory entry whose signature is not a central header's is not an .xlsx", () => {
    const zip = rawZip(workbook(SHEET));
    const offset = zip.readUInt32LE(zip.length - 22 + 16);
    // The third entry's header: after the first two, each 46 bytes and its name.
    const third = offset + 46 + "[Content_Types].xml".length + 46 + "xl/workbook.xml".length;
    expect(zip.readUInt32LE(third)).toBe(0x02014b50);
    zip.writeUInt32LE(0, third);
    expect(codeOf(() => workbookEntries(zip))).toBe("WORKBOOK_NOT_XLSX");
  });

  test("a directory entry whose name runs past the directory is not an .xlsx", () => {
    const honest = rawZip(workbook(SHEET));
    const size = honest.readUInt32LE(honest.length - 22 + 12);
    // Three bytes short: the last header fits, its name does not.
    const zip = rawZip(workbook(SHEET), { size: size - 3 });
    expect(codeOf(() => workbookEntries(zip))).toBe("WORKBOOK_NOT_XLSX");
  });

  test("an entry whose compressed bytes run past the end of the file is not an .xlsx", async () => {
    const zip = rawZip(workbook({ ...SHEET, method: 0, compressedSize: 1_000_000 }));
    const entries = workbookEntries(zip);
    expect(await codeOfAsync(() => countInflated(zip, entries, BIG))).toBe("WORKBOOK_NOT_XLSX");
  });
});

describe("what the walk may read, and when the entries bound is read (lg-66 gate 2, F1)", () => {
  const SHEET = { name: "xl/worksheets/sheet1.xml", data: Buffer.from("<x/>") };
  /** A central header's signature alone, four bytes before the end record. */
  const SIGNATURE = Buffer.from([0x50, 0x4b, 0x01, 0x02]);

  test("a counted header that starts in the directory's last four bytes is not an .xlsx", () => {
    // Its 46 bytes would run 24 past the file: refused, never a RangeError.
    const zip = reEnded(rawZip(workbook(SHEET)), { count: 1, extra: 4, insert: SIGNATURE });
    expect(codeOf(() => workbookEntries(zip))).toBe("WORKBOOK_NOT_XLSX");
  });

  test("a directory that runs past the end record, ending in a header's signature, is not an .xlsx", () => {
    const zip = reEnded(rawZip(workbook(SHEET)), { count: 1, extra: 1_004, insert: SIGNATURE });
    expect(codeOf(() => workbookEntries(zip))).toBe("WORKBOOK_NOT_XLSX");
  });

  test("the entries bound is read off the end record before a single header is walked", () => {
    // Three headers and a record that counts the bound and one more: walked,
    // the fourth would be the end record itself and refused as not a zip.
    const zip = reEnded(rawZip(workbook(SHEET)), { count: MAX_WORKBOOK_ENTRIES - 2 });
    expect(zip.readUInt16LE(zip.length - 22 + 10)).toBe(MAX_WORKBOOK_ENTRIES + 1);
    expect(codeOf(() => workbookEntries(zip))).toBe("WORKBOOK_TOO_LARGE");
  });
});

// lg-87: SheetJS takes an entry's method and sizes from its local header or a
// zip64 record, and finds the end record from four bytes before the file's end.
// Each disagreement with what this parse counted is refused, one field at a time.
describe("what SheetJS reads that the directory does not say (lg-87)", () => {
  const SHEET = "xl/worksheets/sheet1.xml";
  /** The control's zip, with the sheet stored, and its local header's offset. */
  function stored(): { zip: Buffer; at: number } {
    const zip = rawZip(workbook({ name: SHEET, data: Buffer.from("<x/>"), method: 0 }));
    const at = workbookEntries(zip).find((entry) => entry.name === SHEET)?.localHeaderOffset;
    if (at === undefined) throw new Error("no sheet in the control");
    return { zip, at };
  }

  async function counted(zip: Buffer): Promise<string> {
    return codeOfAsync(() => countInflated(zip, workbookEntries(zip), BIG));
  }

  test("the stored control is read", async () => {
    expect(await counted(stored().zip)).toBe("nothing thrown");
  });

  test("a local header that says deflated where the directory says stored is refused", async () => {
    const { zip, at } = stored();
    zip.writeUInt16LE(8, at + 8);
    expect(await counted(zip)).toBe("WORKBOOK_NOT_XLSX");
  });

  test.each([
    ["compressed", 18],
    ["inflated", 22],
  ])("a local %s size other than the directory's is refused", async (_what, field) => {
    const { zip, at } = stored();
    zip.writeUInt32LE(0, at + field);
    expect(await counted(zip)).toBe("WORKBOOK_NOT_XLSX");
  });

  test("local sizes of 0 under bit 3, a data descriptor's, are read", async () => {
    const { zip, at } = stored();
    zip.writeUInt16LE(8, at + 6);
    zip.writeUInt32LE(0, at + 18);
    zip.writeUInt32LE(0, at + 22);
    expect(await counted(zip)).toBe("nothing thrown");
  });

  test("a local header that says encrypted is refused", async () => {
    const { zip, at } = stored();
    zip.writeUInt16LE(1, at + 6);
    expect(await counted(zip)).toBe("WORKBOOK_NOT_XLSX");
  });

  /** A zip64 record, header id 1, with a 4-byte body. */
  const ZIP64 = Buffer.from([1, 0, 4, 0, 0, 0, 0, 0]);
  const OTHER = Buffer.from([0x55, 0x54, 4, 0, 0, 0, 0, 0]);

  /** The control's zip with `extra` as the last local header's extra field. */
  function localExtra(extra: Buffer): Buffer {
    const { zip, at } = stored();
    const name = zip.readUInt16LE(at + 26);
    const end = zip.length - 22;
    const patched = Buffer.concat([
      zip.subarray(0, at + 30 + name),
      extra,
      zip.subarray(at + 30 + name),
    ]);
    patched.writeUInt16LE(extra.length, at + 28);
    patched.writeUInt32LE(zip.readUInt32LE(end + 16) + extra.length, end + extra.length + 16);
    return patched;
  }

  /** The control's zip with `extra` as the last central entry's extra field. */
  function centralExtra(extra: Buffer): Buffer {
    const { zip } = stored();
    const end = zip.length - 22;
    const last = zip.lastIndexOf(Buffer.from(SHEET), end) - 46;
    const name = zip.readUInt16LE(last + 28);
    const patched = Buffer.concat([
      zip.subarray(0, last + 46 + name),
      extra,
      zip.subarray(last + 46 + name),
    ]);
    patched.writeUInt16LE(extra.length, last + 30);
    patched.writeUInt32LE(zip.readUInt32LE(end + 12) + extra.length, end + extra.length + 12);
    return patched;
  }

  test("another extra field is read, in either header", async () => {
    expect(await counted(localExtra(OTHER))).toBe("nothing thrown");
    expect(await counted(centralExtra(OTHER))).toBe("nothing thrown");
  });

  test("a zip64 record is refused in the local header and in the directory", async () => {
    expect(await counted(localExtra(ZIP64))).toBe("WORKBOOK_NOT_XLSX");
    expect(codeOf(() => workbookEntries(centralExtra(ZIP64)))).toBe("WORKBOOK_NOT_XLSX");
  });

  test("an end-record signature in the last 21 bytes is refused; other trailing bytes are not", () => {
    const { zip } = stored();
    const signature = Buffer.from([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0]);
    expect(codeOf(() => workbookEntries(Buffer.concat([zip, signature])))).toBe(
      "WORKBOOK_NOT_XLSX",
    );
    expect(codeOf(() => workbookEntries(Buffer.concat([zip, Buffer.alloc(8)])))).toBe(
      "nothing thrown",
    );
  });
});
