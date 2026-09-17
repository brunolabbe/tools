/**
 * Synthetic MP4 files for dl-64, built box by box so every size and every
 * fourcc a test depends on is visible in the test rather than in a binary blob.
 *
 * They are not playable — sample tables are empty and `mdat` is zeros — and do
 * not need to be: the reader walks box headers, and those are real.
 */

import type { RangedBytes } from "../../src/size-sample.ts";

const encoder = new TextEncoder();

export function ascii(text: string): Uint8Array {
  return encoder.encode(text);
}

export function u32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value);
  return out;
}

export function u64(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, value);
  return out;
}

export function zeros(length: number): Uint8Array {
  return new Uint8Array(length);
}

export function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

/** A box with an honest 32-bit size. */
export function box(type: string, ...payload: readonly Uint8Array[]): Uint8Array {
  const body = concat(...payload);
  return concat(u32(8 + body.byteLength), ascii(type), body);
}

/** A box whose header declares whatever size the test says, true or not. */
export function boxDeclaring(
  type: string,
  declared: number,
  ...payload: readonly Uint8Array[]
): Uint8Array {
  return concat(u32(declared), ascii(type), ...payload);
}

/** A box using the 64-bit `largesize` form (`size == 1`). */
export function largeBox(
  type: string,
  declared: bigint | undefined,
  payload: Uint8Array,
): Uint8Array {
  return concat(u32(1), ascii(type), u64(declared ?? BigInt(16 + payload.byteLength)), payload);
}

export function ftyp(brands: readonly string[]): Uint8Array {
  return box("ftyp", ascii("isom"), u32(512), ...brands.map((brand) => ascii(brand)));
}

/** One track: `trak/mdia/{hdlr, minf/stbl/stsd/<entry>}`, laid out as muxers write it. */
export function trak(handler: "vide" | "soun" | "subt", entry: string): Uint8Array {
  return box(
    "trak",
    box("tkhd", zeros(84)),
    box(
      "mdia",
      box("mdhd", zeros(24)),
      box("hdlr", u32(0), u32(0), ascii(handler), zeros(12), zeros(1)),
      box(
        "minf",
        box(handler === "soun" ? "smhd" : "vmhd", zeros(8)),
        box("stbl", box("stsd", u32(0), u32(1), box(entry, zeros(28))), box("stts", zeros(8))),
      ),
    ),
  );
}

export interface Mp4Shape {
  brands: readonly string[];
  tracks: readonly Uint8Array[];
  /** Bytes of media. Large enough and the tail `moov` is out of the first read. */
  mdatBytes?: number;
  /** Bytes of `free` inside `moov`, to make one larger than the first read. */
  moovPadding?: number;
}

export function moov(shape: Mp4Shape): Uint8Array {
  return box(
    "moov",
    box("mvhd", zeros(100)),
    ...shape.tracks,
    ...(shape.moovPadding === undefined ? [] : [box("free", zeros(shape.moovPadding))]),
  );
}

/** `ftyp`, `moov`, `mdat` — what `-movflags +faststart` writes. */
export function faststartMp4(shape: Mp4Shape): Uint8Array {
  return concat(ftyp(shape.brands), moov(shape), box("mdat", zeros(shape.mdatBytes ?? 1024)));
}

/** `ftyp`, `free`, `mdat`, `moov` — the layout measured on the reported AV1 files. */
export function tailMoovMp4(shape: Mp4Shape): Uint8Array {
  return concat(
    ftyp(shape.brands),
    box("free"),
    box("mdat", zeros(shape.mdatBytes ?? 1024)),
    moov(shape),
  );
}

/** A range reader over bytes in memory, recording every read it was asked for. */
export function memoryReader(file: Uint8Array): {
  read: (start: number, endInclusive: number) => Promise<RangedBytes | undefined>;
  reads: Array<{ start: number; endInclusive: number }>;
} {
  const reads: Array<{ start: number; endInclusive: number }> = [];
  return {
    reads,
    async read(start, endInclusive) {
      reads.push({ start, endInclusive });
      if (start >= file.byteLength) return await Promise.resolve(undefined);
      return await Promise.resolve({
        bytes: file.slice(start, Math.min(endInclusive + 1, file.byteLength)),
        totalBytes: file.byteLength,
      });
    },
  };
}

/** `bytes=40-99` → `[40, 99]`. */
function parseRange(header: string | null): [number, number] | undefined {
  const match = /^bytes=(\d+)-(\d+)$/u.exec(header ?? "");
  if (match?.[1] === undefined || match[2] === undefined) return undefined;
  return [Number(match[1]), Number(match[2])];
}

export interface ServedCall {
  method: string;
  url: string;
  range: string | undefined;
}

/**
 * A `fetch` serving files by URL, honouring `HEAD` and `Range` the way an
 * ordinary CDN does. A URL in `refuse` answers 403 to everything.
 */
export function servingFiles(
  files: ReadonlyMap<string, Uint8Array>,
  options: { refuse?: ReadonlySet<string>; onCall?: (call: ServedCall) => void } = {},
): { fetch: typeof globalThis.fetch; calls: ServedCall[] } {
  const calls: ServedCall[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const range = new Headers(init?.headers).get("range");
    const call = { method, url, range: range ?? undefined };
    calls.push(call);
    options.onCall?.(call);

    const file = files.get(url);
    if (file === undefined) return await Promise.resolve(new Response(null, { status: 404 }));
    if (options.refuse?.has(url) === true) {
      return await Promise.resolve(new Response(null, { status: 403 }));
    }
    if (method === "HEAD") {
      return await Promise.resolve(
        new Response(null, { headers: { "content-length": String(file.byteLength) } }),
      );
    }
    const wanted = parseRange(range);
    if (wanted === undefined) return await Promise.resolve(new Response(file));
    const [start, end] = wanted;
    if (start >= file.byteLength) return await Promise.resolve(new Response(null, { status: 416 }));
    const last = Math.min(end, file.byteLength - 1);
    return await Promise.resolve(
      new Response(file.slice(start, last + 1), {
        status: 206,
        headers: {
          "content-range": `bytes ${String(start)}-${String(last)}/${String(file.byteLength)}`,
        },
      }),
    );
  };
  return { fetch, calls };
}
