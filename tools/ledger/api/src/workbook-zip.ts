/**
 * Whether an upload is an `.xlsx`, and what it inflates to, judged before
 * `exceljs` opens it (lg-66, Build 3.1 and 3.3).
 *
 * **From the bytes, never the name.** An `.xlsx` is a zip: it opens with `PK`,
 * ends with a readable end-of-central-directory record pointing at a readable
 * central directory, and holds the workbook's own entries,
 * `[Content_Types].xml` and `xl/workbook.xml`. Opening with `PK` alone is not
 * enough: a CSV whose first header is `PK ID` passes it, and a zip that is not
 * a workbook reads in `exceljs` as no sheet with no error. Every way of failing
 * this gets the one plain `WORKBOOK_NOT_XLSX`, never a parser's reason.
 *
 * **The inflated size is bounded twice.** `exceljs` inflates every entry whole,
 * with no hook into its inflate, so a file of 200 KB that inflates to 200 MiB
 * (gate 4's `upload.mts` on lg-66's filing) is bounded only by checking before
 * it is handed over:
 *
 * 1. the central directory declares each entry's uncompressed size, and a
 *    total over the bound is refused before anything is inflated;
 * 2. a zip can declare less than it holds, so every entry is then inflated
 *    once here, by `node:zlib`, counting the bytes as they come out and
 *    keeping none, and the count passing the bound stops the inflate at once.
 *    A stored entry, which has nothing to inflate, is counted a chunk at a
 *    time all the same, so a stop overshoots the bound by at most one chunk,
 *    `INFLATE_CHUNK_BYTES`, whichever kind of entry it falls in.
 *
 * The second pass inflates every accepted file once more than `exceljs` does,
 * which at the bound is a fraction of a second; it holds one chunk at a time.
 * The parse is by hand rather than through `jszip`, which `exceljs` carries
 * but this package does not declare.
 */

import type { Buffer } from "node:buffer";
import { createInflateRaw } from "node:zlib";
import { AppError } from "@ledger/contract";

/**
 * What a workbook may inflate to, summed over its entries: 16 MiB. The largest
 * of the six measured workbook fixtures, `lg37`, inflates to 90 542 bytes as
 * `exceljs` writes it, under a hundredth of the bound, and `exceljs` held about twice the inflated
 * size in memory in gate 4's measurement (+79 MB for 40 MiB).
 */
export const MAX_WORKBOOK_INFLATED_BYTES = 16 * 1024 * 1024;

/** The inflate's output chunk, and so the most a stop at the bound overshoots it by. */
export const INFLATE_CHUNK_BYTES = 16 * 1024;

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_DIRECTORY = 0x06054b50;
const END_OF_DIRECTORY_SIZE = 22;
/** The longest comment an end-of-directory record can carry. */
const MAX_COMMENT = 0xffff;

/** One entry, as the central directory declares it. */
export interface ZipEntry {
  name: string;
  /** 0, stored, or 8, deflated: the two `exceljs` reads. */
  method: 0 | 8;
  compressedSize: number;
  /** As declared, which a zip can understate. */
  declaredSize: number;
  localHeaderOffset: number;
}

/** The entries an `.xlsx` holds whatever else it does. */
const WORKBOOK_ENTRIES = ["[Content_Types].xml", "xl/workbook.xml"] as const;

function notXlsx(): AppError {
  return new AppError("WORKBOOK_NOT_XLSX");
}

function tooLarge(): AppError {
  return new AppError("WORKBOOK_TOO_LARGE", undefined, { details: { bound: "inflated" } });
}

/** Where the end-of-central-directory record starts, or -1. */
function endOfDirectory(bytes: Buffer): number {
  const lowest = Math.max(0, bytes.length - END_OF_DIRECTORY_SIZE - MAX_COMMENT);
  for (let at = bytes.length - END_OF_DIRECTORY_SIZE; at >= lowest; at--) {
    if (bytes.readUInt32LE(at) === END_OF_DIRECTORY) return at;
  }
  return -1;
}

/**
 * The upload's entries, or `WORKBOOK_NOT_XLSX`. Reads only the directory;
 * inflates nothing. A zip64 archive, a split one, an encrypted entry or a
 * compression `exceljs` cannot read are refused the same way: none is a
 * workbook a household saves.
 */
export function workbookEntries(bytes: Buffer): ZipEntry[] {
  if (bytes.length < END_OF_DIRECTORY_SIZE || bytes.readUInt32LE(0) !== LOCAL_HEADER) {
    throw notXlsx();
  }
  const end = endOfDirectory(bytes);
  if (end < 0) throw notXlsx();
  const disk = bytes.readUInt16LE(end + 4);
  const directoryDisk = bytes.readUInt16LE(end + 6);
  const onDisk = bytes.readUInt16LE(end + 8);
  const count = bytes.readUInt16LE(end + 10);
  const size = bytes.readUInt32LE(end + 12);
  const offset = bytes.readUInt32LE(end + 16);
  if (disk !== 0 || directoryDisk !== 0 || onDisk !== count || count === 0xffff) throw notXlsx();
  if (offset === 0xffffffff || size === 0xffffffff || offset + size > end) throw notXlsx();

  const entries: ZipEntry[] = [];
  let at = offset;
  for (let index = 0; index < count; index++) {
    if (at + 46 > offset + size || bytes.readUInt32LE(at) !== CENTRAL_HEADER) throw notXlsx();
    const flags = bytes.readUInt16LE(at + 8);
    const method = bytes.readUInt16LE(at + 10);
    const compressedSize = bytes.readUInt32LE(at + 20);
    const declaredSize = bytes.readUInt32LE(at + 24);
    const nameLength = bytes.readUInt16LE(at + 28);
    const extraLength = bytes.readUInt16LE(at + 30);
    const commentLength = bytes.readUInt16LE(at + 32);
    const localHeaderOffset = bytes.readUInt32LE(at + 42);
    const next = at + 46 + nameLength + extraLength + commentLength;
    if (next > offset + size) throw notXlsx();
    // Bit 0: encrypted. Sizes of 0xffffffff: zip64, carried in an extra field.
    if ((flags & 1) !== 0 || (method !== 0 && method !== 8)) throw notXlsx();
    if (
      compressedSize === 0xffffffff ||
      declaredSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff
    ) {
      throw notXlsx();
    }
    entries.push({
      name: bytes.toString("utf8", at + 46, at + 46 + nameLength),
      method,
      compressedSize,
      declaredSize,
      localHeaderOffset,
    });
    at = next;
  }
  const names = new Set(entries.map((entry) => entry.name));
  if (!WORKBOOK_ENTRIES.every((name) => names.has(name))) throw notXlsx();
  return entries;
}

/** What the directory says the entries inflate to, together. */
export function declaredInflatedSize(entries: readonly ZipEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.declaredSize, 0);
}

/** An entry's compressed bytes, found through its local header. */
function compressedOf(bytes: Buffer, entry: ZipEntry): Buffer {
  const at = entry.localHeaderOffset;
  if (at + 30 > bytes.length || bytes.readUInt32LE(at) !== LOCAL_HEADER) throw notXlsx();
  const start = at + 30 + bytes.readUInt16LE(at + 26) + bytes.readUInt16LE(at + 28);
  const stop = start + entry.compressedSize;
  if (stop > bytes.length) throw notXlsx();
  return bytes.subarray(start, stop);
}

/** Told each chunk's size as it is inflated: what a test reads to see the stop. */
export type InflateSpy = (bytes: number) => void;

/**
 * Inflates every entry, keeping nothing, and refuses the moment the bytes
 * produced, summed over the entries, pass `bound`: `WORKBOOK_TOO_LARGE`,
 * whatever the directory declared. A deflate stream that will not inflate is
 * `WORKBOOK_NOT_XLSX`. Resolves to the total inflated.
 */
export async function countInflated(
  bytes: Buffer,
  entries: readonly ZipEntry[],
  bound: number,
  spy?: InflateSpy,
): Promise<number> {
  let total = 0;
  const produced = (size: number): void => spy?.(size);
  for (const entry of entries) {
    const compressed = compressedOf(bytes, entry);
    if (entry.method === 0) {
      // Nothing to inflate, but counted a chunk at a time as an inflate is, so
      // a stop overshoots by one chunk here too, not by the whole entry.
      for (let at = 0; at < compressed.length; at += INFLATE_CHUNK_BYTES) {
        const size = Math.min(INFLATE_CHUNK_BYTES, compressed.length - at);
        total += size;
        produced(size);
        if (total > bound) throw tooLarge();
      }
      continue;
    }
    // One entry at a time, so the bound is checked between chunks of each.
    // oxlint-disable-next-line no-await-in-loop -- the count carries from one entry to the next
    total = await inflateCounted(compressed, total, bound, produced);
  }
  return total;
}

function inflateCounted(
  compressed: Buffer,
  before: number,
  bound: number,
  produced: (size: number) => void,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const inflater = createInflateRaw({ chunkSize: INFLATE_CHUNK_BYTES });
    let total = before;
    let stopped = false;
    inflater.on("data", (chunk: Buffer) => {
      if (stopped) return;
      total += chunk.length;
      produced(chunk.length);
      if (total > bound) {
        stopped = true;
        inflater.destroy();
        reject(tooLarge());
      }
    });
    inflater.on("error", () => {
      if (stopped) return;
      stopped = true;
      reject(notXlsx());
    });
    inflater.on("end", () => {
      if (!stopped) resolve(total);
    });
    inflater.end(compressed);
  });
}
