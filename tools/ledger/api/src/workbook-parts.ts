/**
 * Which parts of a workbook SheetJS reads for each of its sheets, judged from the zip
 * before SheetJS parses any sheet (lg-96, gate 1's F2 and gate 2's F2; lg-104).
 *
 * **Why.** `workbook.xml` lists the sheets and a relationship gives each its part,
 * and nothing in the format stops two sheets from naming the same part. SheetJS
 * parses a part once for every sheet that names it, and the inflate bound counts a
 * part once, so a file of 10 parts and a few kilobytes costs the parse of its
 * biggest part many times over: 14 entries over a part of 1 400 rows by 100 numeric
 * cells (3.84 MB inflated, under the 4 MiB bound) read +384.7 MB, SheetJS's parse
 * alone +223.8 MB of it, all before `xlsx.ts` could charge a place. A running total
 * over the sheets cannot close that; refusing the shared part can.
 *
 * **It is not only the worksheet part** (lg-104). For each sheet SheetJS also reads the
 * sheet's own `.rels`, and through it the sheet's comments, threaded comments and VML
 * drawing, and for a chartsheet its drawing, the drawing's `.rels`, the chart and the
 * chart's `.rels`. A comments part of 50 000 comments that 14 sheets' `.rels` all name
 * read +327.1 MB through `readSheets` (peak 412.0 MB; gate 3 of lg-96 read +352.5 MB),
 * where 14 parts of the same total read +54.0 MB. So `eachPartReadOnce` counts every
 * part a sheet's relationships name, whatever their type, and refuses a workbook in which
 * one part is counted twice: by two sheets, or twice by one. Counting every type is
 * more than SheetJS reads, which costs nothing here: a part only one sheet names is
 * counted once whatever it is.
 *
 * **No workbook Excel saves does this**: each sheet is a part of its own, with its own
 * comments and drawings, so a shared one is a file that is not a workbook a household
 * saves, which is what `WORKBOOK_NOT_XLSX` says of the other shapes `workbook-zip.ts`
 * refuses. Believed of Excel in general; measured on one real workbook (lg-104's Log).
 *
 * **This is a copy of how SheetJS picks a part, and the check does not rest on it
 * alone.** What is refused has to be what SheetJS reads twice, and it picks the part
 * by rules of its own, not the format's. Round 1 copied the plain spellings and gate 2
 * found seven more that SheetJS reads as two sheets over one part and the copy did not
 * (entities and `_x0031_` in a target, a `>` inside a quoted name, an empty `r:id`
 * beside `strRelID`, a sheet with no id beside a relationship `Id="undefined"`, a tab
 * after a tag name); gate 3 found a local-header name (`workbook-zip.ts` now refuses
 * it), and lg-104's build a `<![CDATA[` section in a target and a `.rels` part saved as
 * UTF-16. Patching the next difference only reopens it. So the check that `xlsx.ts`
 * makes is one SheetJS's own sheet list can contradict: it reads the list with
 * `bookSheets`, which parses no sheet, and refuses unless this copy finds the same
 * number of sheets, each resolved to a part that exists, and no two to the same one.
 * What this file does on top is to be as exact as it can be where a difference would
 * let two reads look distinct to the copy and the same to SheetJS: the tag and
 * attribute reading is `parsexmltag` and `tagregex` ported, the zip is searched as
 * `safegetzipfile` does, by each name a byte to a character as SheetJS's CFB reads it,
 * text is decoded a byte to a character as its `cc2str` does (so two different bytes
 * are never the same character here), and a part that `cc2str` would decode as UTF-16
 * is "cannot tell", a relationship is looked up as `hash[id]` is (an absent id is
 * `"undefined"`), a sheet's relationship target is decoded by `unescapexml` ported and
 * resolved by `resolve_path` ported, and a workbook's relationship target that
 * `unescapexml` would change is not guessed at (`&#49;`, `_x0031_`, `<![CDATA[`): it is
 * "cannot tell", and so refused. A part that exists and cannot be read is refused the
 * same way, never read as empty.
 *
 * The workbook part is the first `Override` of a workbook content type in
 * `[Content_Types].xml` (else `xl/workbook.xml`); a sheet's relationship is found by
 * its id in that part's `.rels`; its target is tried as `xl/<target without a
 * leading xl/>`, then as the target itself, then beside the relationships. A
 * workbook in which any sheet has no relationship is read by position,
 * `xl/worksheets/sheet<n>.xml`, every sheet of it. A SheetJS upgrade should re-read
 * all of this against `parse_zip`, `safe_parse_sheet`, `parse_wb_xml`, `parse_rels`,
 * `resolve_path`, `unescapexml`, `cc2str` and `parsexmltag`.
 */

import type { Buffer } from "node:buffer";
import { inflateRawSync } from "node:zlib";
import { MAX_WORKBOOK_INFLATED_BYTES, compressedOf } from "./workbook-zip.ts";
import type { ZipEntry } from "./workbook-zip.ts";

/** The content types SheetJS reads as the workbook part (its `ct2type`, "workbooks"). */
const WORKBOOK_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
  "application/vnd.ms-excel.sheet.macroEnabled.main+xml",
  "application/vnd.ms-excel.sheet.binary.macroEnabled.main",
  "application/vnd.ms-excel.addin.macroEnabled.main+xml",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml",
]);

/** SheetJS's `RELS.CS`: the one relationship type it reads as a chartsheet (`get_sheet_type`). */
const CHARTSHEET = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chartsheet";

/** SheetJS's `tagregex1`, the one it splits an XML part into tags with. */
const TAG =
  /<[/?]?[a-zA-Z0-9:_-]+(?:\s+[^"\s?<>/]+\s*=\s*(?:"[^"]*"|'[^']*'|[^'"<>\s=]+))*\s*[/?]?>/gm;

/** SheetJS's `attregexg`, the attributes of one tag. */
const ATTRIBUTE = /\s([^"\s?>/]+)\s*=\s*((?:")([^"]*)(?:")|(?:')([^']*)(?:')|([^'">\s]+))/g;

/** `unescapexml`'s two expressions and its table, as SheetJS writes them. */
const ENTITY = /&(?:quot|apos|gt|lt|amp|#x?([\da-fA-F]+));/gi;
const CODE = /_x([\da-fA-F]{4})_/gi;
const ENTITIES = new Map([
  ["&quot;", '"'],
  ["&apos;", "'"],
  ["&gt;", ">"],
  ["&lt;", "<"],
  ["&amp;", "&"],
]);

/**
 * SheetJS's `unescapexml` (its `raw_unescapexml`), ported line for line, the CDATA split
 * and its odd cases included: `&AMP;` matches the expression and not the table, and
 * becomes the character `parseInt(undefined)` gives, as it does there.
 */
function unescaped(text: string): string {
  const at = text.indexOf("<![CDATA[");
  if (at === -1) {
    return text
      .replace(
        ENTITY,
        (whole: string, code: string | undefined) =>
          ENTITIES.get(whole) ||
          String.fromCharCode(Number.parseInt(String(code), whole.includes("x") ? 16 : 10)) ||
          whole,
      )
      .replace(CODE, (_whole: string, code: string) =>
        String.fromCharCode(Number.parseInt(code, 16)),
      );
  }
  const end = text.indexOf("]]>");
  return unescaped(text.slice(0, at)) + text.slice(at + 9, end) + unescaped(text.slice(end + 3));
}

/** SheetJS's `resolve_path`, ported: `target` read from the folder `base` is in. */
function resolved(target: string, base: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const result = base.split("/");
  if (!base.endsWith("/")) result.pop();
  for (const step of target.split("/")) {
    if (step === "..") result.pop();
    else if (step !== ".") result.push(step);
  }
  return result.join("/");
}

/** The `.rels` part `safe_parse_sheet` reads beside a sheet's part, by `parse_zip`'s expression. */
function sheetRelationshipsOf(path: string): string {
  return path.replace(/^(.*)(\/)([^/]*)$/, "$1/_rels/$3.rels");
}

/** The `.rels` part of any other part, by SheetJS's `get_rels_path`. */
function relationshipsOf(file: string): string {
  const slash = file.lastIndexOf("/");
  return `${file.slice(0, slash + 1)}_rels/${file.slice(slash + 1)}.rels`;
}

interface Tag {
  /** SheetJS's `y[0]`: the tag up to its first space, line feed or carriage return. */
  root: string;
  /** The attributes as `parsexmltag` keeps them: each under its name and in lower case. */
  attributes: Map<string, string>;
}

/** `parsexmltag`, ported. */
function parseTag(tag: string): Tag {
  let split = 0;
  for (; split !== tag.length; split += 1) {
    const code = tag.charCodeAt(split);
    if (code === 32 || code === 10 || code === 13) break;
  }
  const attributes = new Map<string, string>();
  const root = tag.slice(0, split);
  if (split === tag.length) return { root, attributes };
  for (const found of tag.match(ATTRIBUTE) ?? []) {
    const text = found.slice(1);
    let at = 0;
    while (at !== text.length && text.charCodeAt(at) !== 61) at += 1;
    let name = text.slice(0, at).trim();
    while (text.charCodeAt(at + 1) === 32) at += 1;
    const next = text.charCodeAt(at + 1);
    const quote = next === 34 || next === 39 ? 1 : 0;
    const value = text.slice(at + 1 + quote, text.length - quote);
    const colon = name.indexOf(":");
    if (colon < 0) {
      if (name.indexOf("_") > 0) name = name.slice(0, name.indexOf("_"));
      attributes.set(name, value);
      attributes.set(name.toLowerCase(), value);
    } else {
      const key = (colon === 5 && name.startsWith("xmlns") ? "xmlns" : "") + name.slice(colon + 1);
      if (attributes.get(key) && name.slice(colon - 3, colon) === "ext") continue;
      attributes.set(key, value);
      attributes.set(key.toLowerCase(), value);
    }
  }
  return { root, attributes };
}

/**
 * The zip as SheetJS's `safegetzipfile` searches it: no regard to case, `/` and `\`
 * alike, a `Root Entry/` prefix on a stored name ignored, the first stored name that
 * matches. Names are compared a byte to a character, as SheetJS's CFB reads them from
 * the local header (`workbook-zip.ts` refuses one the directory does not repeat). The
 * index is the part's identity.
 */
interface Zip {
  /** The index of the part `file` names, or -1. */
  find: (file: string) => number;
  /** The part at `index` as text, or `undefined` when it cannot be read as SheetJS reads it. */
  textAt: (index: number) => string | undefined;
  /** The part `file` names as text; `null` when there is none, `undefined` as `textAt`. */
  textOf: (file: string) => string | null | undefined;
}

function zipOf(bytes: Buffer, entries: readonly ZipEntry[]): Zip {
  // The first index of each name, so a lookup is one step and not a walk of the entries.
  const first = new Map<string, number>();
  for (const [index, entry] of entries.entries()) {
    const name = entry.rawName.replace(/^Root Entry\//u, "").toLowerCase();
    if (!first.has(name)) first.set(name, index);
  }
  const find = (file: string): number => {
    const backslashed = file.toLowerCase().replaceAll("/", "\\");
    const slashed = backslashed.replaceAll("\\", "/");
    const either = [first.get(backslashed), first.get(slashed)].filter((at) => at !== undefined);
    return either.length === 0 ? -1 : Math.min(...either);
  };
  const textAt = (index: number): string | undefined => {
    const entry = entries[index];
    if (entry === undefined) return undefined;
    try {
      const raw = compressedOf(bytes, entry);
      const inflated =
        entry.method === 0
          ? raw
          : inflateRawSync(raw, { maxOutputLength: MAX_WORKBOOK_INFLATED_BYTES });
      if (inflated.length > MAX_WORKBOOK_INFLATED_BYTES) return undefined;
      // `cc2str` reads a part opening with either byte-order mark as UTF-16 (its test for
      // a big-endian one is off by a byte, and differs between a Buffer and an array):
      // text this copy would read otherwise, so it is not read at all (lg-104).
      if (
        (inflated[0] === 0xff && inflated[1] === 0xfe) ||
        (inflated[0] === 0xfe && inflated[1] === 0xff) ||
        (inflated[1] === 0xfe && inflated[2] === 0xff)
      ) {
        return undefined;
      }
      // A byte to a character, as SheetJS reads a part: no two bytes alike.
      return inflated.toString("latin1");
    } catch {
      return undefined;
    }
  };
  const textOf = (file: string): string | null | undefined => {
    const index = find(file);
    return index < 0 ? null : textAt(index);
  };
  return { find, textAt, textOf };
}

/** One sheet as SheetJS reads it. */
interface SheetRead {
  /** The name SheetJS reads the part under, which its `.rels` and targets hang from. */
  path: string;
  /** The part's index in the entries. */
  part: number;
  /** Whether SheetJS reads it as a chartsheet, and so follows its drawing to a chart. */
  chart: boolean;
}

/** `sheetPartsOf`, with the name each part is read under: `undefined` when it cannot say. */
function sheetReadsOf(zip: Zip): SheetRead[] | undefined {
  const { find, textOf } = zip;
  const types = textOf("[Content_Types].xml");
  if (types === undefined) return undefined;
  const workbooks: (string | undefined)[] = [];
  for (const tag of types?.match(TAG) ?? []) {
    const { root, attributes } = parseTag(tag);
    if (root.replace(/<\w*:/u, "<") !== "<Override") continue;
    const type = attributes.get("ContentType");
    if (type !== undefined && WORKBOOK_TYPES.has(type)) workbooks.push(attributes.get("PartName"));
  }
  const workbookPart = workbooks.length === 0 ? "xl/workbook.xml" : workbooks[0];
  // A binary workbook is not an `.xlsx`; the reader says so after, in its own words.
  if (workbookPart === undefined || workbookPart.endsWith("bin")) return undefined;
  const workbook = textOf(workbookPart.startsWith("/") ? workbookPart.slice(1) : workbookPart);
  if (typeof workbook !== "string") return undefined;

  const ids: string[] = [];
  for (const tag of workbook.match(TAG) ?? []) {
    const { root, attributes } = parseTag(tag);
    if (root.replace(/<(\/?)\w+:/u, "<$1") !== "<sheet") continue;
    // `w.id` or, when that is empty, `w.strRelID`, looked up as `hash[id]`.
    const id = attributes.get("id");
    ids.push((id === undefined || id === "" ? attributes.get("strRelID") : id) ?? "undefined");
  }
  // An id that names a property of every object is not looked up the way a map is.
  if (ids.some((id) => id in {})) return undefined;

  const slash = workbookPart.lastIndexOf("/");
  let relationships =
    `${workbookPart.slice(0, slash + 1)}_rels/${workbookPart.slice(slash + 1)}.rels`.replace(
      /^\//u,
      "",
    );
  if (find(relationships) < 0) relationships = "xl/_rels/workbook.xml.rels";
  const relationshipsText = textOf(relationships);
  if (relationshipsText === undefined) return undefined;
  const targets = new Map<string, { target: string; type: string | undefined }>();
  for (const tag of relationshipsText?.match(TAG) ?? []) {
    const { root, attributes } = parseTag(tag);
    if (root !== "<Relationship") continue;
    // No Target is a throw in SheetJS's `parse_rels`, and one `unescapexml` would change
    // is one it would decode.
    const target = attributes.get("Target");
    if (target === undefined || decodes(target)) return undefined;
    const id = attributes.get("Id") ?? "undefined";
    // Assigning `hash["__proto__"]` changes what every other lookup finds.
    if (id === "__proto__") return undefined;
    targets.set(id, { target, type: attributes.get("Type") });
  }

  const sheets: SheetRead[] = [];
  // Every sheet's target found, or SheetJS reads the whole workbook by position.
  if (ids.every((id) => targets.has(id))) {
    const beside = relationships.replace(/_rels\/[\s\S]*$/u, "");
    for (const id of ids) {
      const { target, type } = targets.get(id) ?? { target: "", type: undefined };
      let path = `xl/${target.replace(/\/?xl\//u, "")}`;
      if (find(path) < 0) path = target;
      if (find(path) < 0) path = beside + target;
      const part = find(path);
      if (part < 0) return undefined;
      sheets.push({ path, part, chart: type === CHARTSHEET });
    }
    return sheets;
  }
  // The Numbers hack: a workbook with an `xl/worksheets/sheet.xml` numbers from 0.
  const offset = find("xl/worksheets/sheet.xml") < 0 ? 0 : 1;
  for (const [index] of ids.entries()) {
    const path = `xl/worksheets/sheet${String(index + 1 - offset)}.xml`.replace(
      "sheet0.",
      "sheet.",
    );
    const part = find(path);
    if (part < 0) return undefined;
    sheets.push({ path, part, chart: false });
  }
  return sheets;
}

/** Whether `unescapexml` would read `text` as something else, or cannot read it at all. */
function decodes(text: string): boolean {
  try {
    return unescaped(text) !== text;
  } catch {
    return true;
  }
}

/**
 * The index in `entries` of the part each of the workbook's sheets is read from, in
 * the order `workbook.xml` lists them (the same part twice is the same index), or
 * `undefined` when this cannot say: the workbook part is not text it can read, a
 * sheet resolves to no part, or a target is one SheetJS would decode. The caller
 * refuses `undefined`.
 */
export function sheetPartsOf(bytes: Buffer, entries: readonly ZipEntry[]): number[] | undefined {
  return sheetReadsOf(zipOf(bytes, entries))?.map((sheet) => sheet.part);
}

/** A part's name as `safegetzipfile` matches it: two names alike here may find one part. */
function partKey(name: string): string {
  return name.toLowerCase().replaceAll("\\", "/");
}

/**
 * Whether `[Content_Types].xml` lists each part once (lg-104, the owner's answer of
 * 2026-11-10). SheetJS's `parse_ct` keeps every `Override` of an external-link type, and
 * `parse_zip` parses each listed link's `.rels` in turn, before even a `bookSheets` read
 * returns: one link's `.rels` of 20 000 relationships listed 50 times took 4.8 s of
 * `bookSheets` and 13.6 s of `readSheets` at `a100f429`, and was read. So a `PartName`
 * listed twice, or two whose `.rels` would be one part, is refused, whatever the content
 * type: the package format allows a part one `Override`, and no workbook Excel saves
 * lists one twice. Names are compared as SheetJS finds a part, without regard to case
 * or to `/` against `\`. `false` too when the content types exist and cannot be read.
 */
export function eachPartListedOnce(bytes: Buffer, entries: readonly ZipEntry[]): boolean {
  const types = zipOf(bytes, entries).textOf("[Content_Types].xml");
  if (types === undefined) return false;
  const listed = new Set<string>();
  for (const tag of types?.match(TAG) ?? []) {
    const { root, attributes } = parseTag(tag);
    if (root.replace(/<\w*:/u, "<") !== "<Override") continue;
    const name = attributes.get("PartName");
    // No name throws in SheetJS before anything is read.
    if (name === undefined) continue;
    const part = name.startsWith("/") ? name.slice(1) : name;
    for (const key of [`part ${partKey(part)}`, `rels ${partKey(relationshipsOf(part))}`]) {
      if (listed.has(key)) return false;
      listed.add(key);
    }
  }
  return true;
}

/**
 * Whether every part SheetJS reads for the workbook's sheets is read once (lg-104): for
 * each sheet, its part, its `.rels`, every part a relationship there names, and for a
 * chartsheet each of those parts' `.rels`, every part they name and those parts' `.rels`.
 * `false` when one part is reached twice, by two sheets or by one, and when this cannot
 * say: the sheets cannot be resolved (`sheetPartsOf`), a `.rels` part exists and cannot
 * be read, or a relationship has no target or one `unescapexml` cannot read. A part
 * that does not exist is not read, and costs nothing.
 */
export function eachPartReadOnce(bytes: Buffer, entries: readonly ZipEntry[]): boolean {
  const zip = zipOf(bytes, entries);
  const sheets = sheetReadsOf(zip);
  if (sheets === undefined) return false;
  const seen = new Set<number>();
  /** Counts `file` as read; `false` when it was read already. */
  const read = (file: string): boolean => {
    // `getzipdata` and `getzipstr` read nothing for an empty name.
    const index = file === "" ? -1 : zip.find(file);
    if (index < 0) return true;
    if (seen.has(index)) return false;
    seen.add(index);
    return true;
  };
  /**
   * Counts `rels` as read, and gives every target in it resolved from `from`, as
   * `parse_rels` and then `resolve_path` read them; `undefined` when `rels` was read
   * already or cannot be read.
   */
  const targetsOf = (rels: string, from: string): string[] | undefined => {
    if (!read(rels)) return undefined;
    const text = zip.textOf(rels);
    if (text === undefined) return undefined;
    const found: string[] = [];
    for (const tag of text?.match(TAG) ?? []) {
      const { root, attributes } = parseTag(tag);
      if (root !== "<Relationship") continue;
      const target = attributes.get("Target");
      if (target === undefined) return undefined;
      try {
        found.push(resolved(unescaped(target), from));
      } catch {
        return undefined;
      }
    }
    return found;
  };
  for (const sheet of sheets) {
    if (!read(sheet.path)) return false;
    const targets = targetsOf(sheetRelationshipsOf(sheet.path), sheet.path);
    if (targets === undefined) return false;
    for (const target of targets) {
      if (!read(target)) return false;
      if (!sheet.chart) continue;
      // A chartsheet's drawing names its chart, and SheetJS reads both with their `.rels`.
      const charts = targetsOf(relationshipsOf(target), target);
      if (charts === undefined) return false;
      for (const chart of charts) {
        if (!read(chart) || !read(relationshipsOf(chart))) return false;
      }
    }
  }
  return true;
}
