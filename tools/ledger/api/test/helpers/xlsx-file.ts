/**
 * Files for lg-66's upload tests: a cell grid written as a real `.xlsx`, and
 * zips built entry by entry, so a test can make one that lies about its sizes
 * or is no workbook at all. Every name and figure in them is the test's own.
 */

import { Buffer } from "node:buffer";
import { crc32, createDeflateRaw, deflateRawSync, inflateRawSync } from "node:zlib";
import ExcelJS from "exceljs";
import type { Sheet } from "@ledger/books";
import { workbookEntries } from "../../src/workbook-zip.ts";

/** `sheets` as an `.xlsx`, each cell as `readSheets` reads it back. */
export async function xlsxOf(sheets: readonly Sheet[]): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    const out = book.addWorksheet(sheet.name);
    for (const [index, row] of sheet.rows.entries()) {
      for (const [column, cell] of row.entries()) {
        if (cell === null || cell === undefined) continue;
        const target = out.getCell(index + 1, column + 1);
        const value = cell.value;
        const plain: ExcelJS.CellValue =
          value === null
            ? null
            : value.kind === "text"
              ? value.text
              : value.kind === "number"
                ? value.number
                : new Date(`${value.date}T00:00:00.000Z`);
        target.value =
          cell.formula === null
            ? plain
            : { formula: cell.formula, result: typeof plain === "number" ? plain : 0 };
        if (value?.kind === "date") target.numFmt = "yyyy-mm-dd";
      }
    }
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}

/** An entry of a zip as `zipOf` writes it. */
export interface ZipInput {
  name: string;
  /** What it inflates to; ignored when `deflated` is given. */
  data?: Buffer;
  /** Already deflated, with the CRC and size of what it inflates to. */
  deflated?: { bytes: Buffer; crc: number; size: number };
  /** What the directory says it inflates to, when that is to be a lie. */
  declaredSize?: number;
}

/** A zip of `entries`, deflated, with a central directory and its end record. */
export function zipOf(entries: readonly ZipInput[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = entry.data ?? Buffer.alloc(0);
    const deflated = entry.deflated ?? {
      bytes: deflateRawSync(data),
      crc: crc32(data),
      size: data.length,
    };
    const declared = entry.declaredSize ?? deflated.size;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(deflated.crc >>> 0, 14);
    local.writeUInt32LE(deflated.bytes.length, 18);
    local.writeUInt32LE(declared, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(deflated.crc >>> 0, 16);
    central.writeUInt32LE(deflated.bytes.length, 20);
    central.writeUInt32LE(declared, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, deflated.bytes);
    centrals.push(central, name);
    offset += local.length + name.length + deflated.bytes.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/**
 * The entries of a zip `zipOf` can read back: every entry of a real `.xlsx`,
 * inflated. Only for the small workbooks the tests write.
 */
export function entriesOf(xlsx: Buffer): ZipInput[] {
  return workbookEntries(xlsx).map((entry) => {
    const at = entry.localHeaderOffset;
    const start = at + 30 + xlsx.readUInt16LE(at + 26) + xlsx.readUInt16LE(at + 28);
    const raw = xlsx.subarray(start, start + entry.compressedSize);
    return { name: entry.name, data: entry.method === 0 ? raw : inflateRawSync(raw) };
  });
}

/** One mebibyte of spaces, written again and again rather than held whole. */
const SPACES = Buffer.alloc(1024 * 1024, 0x20);

/**
 * `xml` with `padding` bytes of spaces before its last closing tag, deflated
 * as it is written, so the whole of it is never in memory: the CRC is carried
 * chunk by chunk and only the compressed bytes are kept.
 */
export async function paddedDeflate(
  xml: Buffer,
  padding: number,
): Promise<{ bytes: Buffer; crc: number; size: number }> {
  const close = xml.lastIndexOf("</");
  const head = xml.subarray(0, close);
  const tail = xml.subarray(close);
  const deflater = createDeflateRaw();
  const out: Buffer[] = [];
  deflater.on("data", (chunk: Buffer) => out.push(chunk));
  const ended = new Promise<void>((resolve, reject) => {
    deflater.on("end", resolve);
    deflater.on("error", reject);
  });
  const write = async (chunk: Buffer): Promise<void> => {
    if (!deflater.write(chunk)) await new Promise((resolve) => deflater.once("drain", resolve));
  };
  let crc = crc32(head);
  await write(head);
  for (let left = padding; left > 0; left -= SPACES.length) {
    const chunk = left >= SPACES.length ? SPACES : SPACES.subarray(0, left);
    crc = crc32(chunk, crc);
    // oxlint-disable-next-line no-await-in-loop -- one chunk in flight, so the padding is never held whole
    await write(chunk);
  }
  crc = crc32(tail, crc);
  deflater.end(tail);
  await ended;
  return { bytes: Buffer.concat(out), crc, size: head.length + padding + tail.length };
}
