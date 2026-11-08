/**
 * Which worksheet part each of a workbook's sheets is read from, judged from the
 * zip before SheetJS parses any sheet (lg-96, gate 1's F2 and gate 2's F2).
 *
 * **Why.** `workbook.xml` lists the sheets and a relationship gives each its part,
 * and nothing in the format stops two sheets from naming the same part. SheetJS
 * parses a part once for every sheet that names it, and the inflate bound counts a
 * part once, so a file of 10 parts and a few kilobytes costs the parse of its
 * biggest part many times over: 14 entries over a part of 1 400 rows by 100 numeric
 * cells (3.84 MB inflated, under the 4 MiB bound) read +384.7 MB, SheetJS's parse
 * alone +223.8 MB of it, all before `xlsx.ts` could charge a place. A running total
 * over the sheets cannot close that; refusing the shared part can. Distinct parts
 * cannot multiply the parse: `MAX_WORKBOOK_INFLATED_BYTES` is a total over every
 * entry of the file, declared and then counted, so the parts together never inflate
 * to more than the bound.
 *
 * **No workbook Excel saves does this**: each sheet is a part of its own, so a
 * shared one is a file that is not a workbook a household saves, which is what
 * `WORKBOOK_NOT_XLSX` says of the other shapes `workbook-zip.ts` refuses.
 *
 * **This is a copy of how SheetJS picks a part, and the check does not rest on it
 * alone.** What is refused has to be what SheetJS reads twice, and it picks the part
 * by rules of its own, not the format's. Round 1 copied the plain spellings and gate 2
 * found seven more that SheetJS reads as two sheets over one part and the copy did not
 * (entities and `_x0031_` in a target, a `>` inside a quoted name, an empty `r:id`
 * beside `strRelID`, a sheet with no id beside a relationship `Id="undefined"`, a tab
 * after a tag name); patching the next difference only reopens it. So the check that
 * `xlsx.ts` makes is one SheetJS's own sheet list can contradict: it reads the list
 * with `bookSheets`, which parses no sheet, and refuses unless this copy finds the same
 * number of sheets, each resolved to a part that exists, and no two to the same one.
 * What this file does on top is to be as exact as it can be where a difference would
 * let two sheets look distinct to the copy and the same to SheetJS: the tag and
 * attribute reading is `parsexmltag` and `tagregex` ported, the zip is searched as
 * `safegetzipfile` does, text is decoded a byte to a character as its `cc2str` does
 * (so two different bytes are never the same character here), a relationship is
 * looked up as `hash[id]` is (an absent id is `"undefined"`), and a target that
 * `unescapexml` would change is not guessed at (`&`, `_x0031_`): it is "cannot tell",
 * and so refused.
 *
 * The workbook part is the first `Override` of a workbook content type in
 * `[Content_Types].xml` (else `xl/workbook.xml`); a sheet's relationship is found by
 * its id in that part's `.rels`; its target is tried as `xl/<target without a
 * leading xl/>`, then as the target itself, then beside the relationships. A
 * workbook in which any sheet has no relationship is read by position,
 * `xl/worksheets/sheet<n>.xml`, every sheet of it. A SheetJS upgrade should re-read
 * all of this against `parse_zip`, `parse_wb_xml`, `parse_rels` and `parsexmltag`.
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

/** SheetJS's `tagregex1`, the one it splits an XML part into tags with. */
const TAG =
  /<[/?]?[a-zA-Z0-9:_-]+(?:\s+[^"\s?<>/]+\s*=\s*(?:"[^"]*"|'[^']*'|[^'"<>\s=]+))*\s*[/?]?>/gm;

/** SheetJS's `attregexg`, the attributes of one tag. */
const ATTRIBUTE = /\s([^"\s?>/]+)\s*=\s*((?:")([^"]*)(?:")|(?:')([^']*)(?:')|([^'">\s]+))/g;

/** What `unescapexml` would change in a value: an entity, or a `_x0031_` code. */
const ESCAPED = /&|_x[\da-fA-F]{4}_/u;

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
 * The part of the zip that `file` names as SheetJS's `safegetzipfile` finds it: no
 * regard to case, `/` and `\` alike, a `Root Entry/` prefix on a stored name ignored,
 * the first stored name that matches. The index is the part's identity.
 */
function finderOf(entries: readonly ZipEntry[]): (file: string) => number {
  const stored = entries.map((entry) => entry.name.replace(/^Root Entry\//u, "").toLowerCase());
  return (file) => {
    const backslashed = file.toLowerCase().replaceAll("/", "\\");
    const slashed = backslashed.replaceAll("\\", "/");
    return stored.findIndex((name) => name === backslashed || name === slashed);
  };
}

/**
 * The index in `entries` of the part each of the workbook's sheets is read from, in
 * the order `workbook.xml` lists them (the same part twice is the same index), or
 * `undefined` when this cannot say: the workbook part is not text it can read, a
 * sheet resolves to no part, or a target is one SheetJS would decode. The caller
 * refuses `undefined`.
 */
export function sheetPartsOf(bytes: Buffer, entries: readonly ZipEntry[]): number[] | undefined {
  const find = finderOf(entries);
  const textAt = (index: number): string | undefined => {
    const entry = entries[index];
    if (entry === undefined) return undefined;
    try {
      const raw = compressedOf(bytes, entry);
      const inflated =
        entry.method === 0
          ? raw
          : inflateRawSync(raw, { maxOutputLength: MAX_WORKBOOK_INFLATED_BYTES });
      // A byte to a character, as SheetJS reads a part: no two bytes alike.
      return inflated.length > MAX_WORKBOOK_INFLATED_BYTES
        ? undefined
        : inflated.toString("latin1");
    } catch {
      return undefined;
    }
  };
  const textOf = (file: string): string | undefined => {
    const index = find(file);
    return index < 0 ? undefined : textAt(index);
  };

  const workbooks: (string | undefined)[] = [];
  for (const tag of textOf("[Content_Types].xml")?.match(TAG) ?? []) {
    const { root, attributes } = parseTag(tag);
    if (root.replace(/<\w*:/u, "<") !== "<Override") continue;
    const type = attributes.get("ContentType");
    if (type !== undefined && WORKBOOK_TYPES.has(type)) workbooks.push(attributes.get("PartName"));
  }
  const workbookPart = workbooks.length === 0 ? "xl/workbook.xml" : workbooks[0];
  // A binary workbook is not an `.xlsx`; the reader says so after, in its own words.
  if (workbookPart === undefined || workbookPart.endsWith("bin")) return undefined;
  const workbook = textOf(workbookPart.startsWith("/") ? workbookPart.slice(1) : workbookPart);
  if (workbook === undefined) return undefined;

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
  const targets = new Map<string, string>();
  for (const tag of textOf(relationships)?.match(TAG) ?? []) {
    const { root, attributes } = parseTag(tag);
    if (root !== "<Relationship") continue;
    // No Target is a throw in SheetJS's `parse_rels`, and an entity is one it would decode.
    const target = attributes.get("Target");
    if (target === undefined || ESCAPED.test(target)) return undefined;
    const id = attributes.get("Id") ?? "undefined";
    // Assigning `hash["__proto__"]` changes what every other lookup finds.
    if (id === "__proto__") return undefined;
    targets.set(id, target);
  }

  const parts: number[] = [];
  // Every sheet's target found, or SheetJS reads the whole workbook by position.
  if (ids.every((id) => targets.has(id))) {
    const beside = relationships.replace(/_rels\/[\s\S]*$/u, "");
    for (const id of ids) {
      const target = targets.get(id) ?? "";
      let part = find(`xl/${target.replace(/\/?xl\//u, "")}`);
      if (part < 0) part = find(target);
      if (part < 0) part = find(beside + target);
      if (part < 0) return undefined;
      parts.push(part);
    }
    return parts;
  }
  // The Numbers hack: a workbook with an `xl/worksheets/sheet.xml` numbers from 0.
  const offset = find("xl/worksheets/sheet.xml") < 0 ? 0 : 1;
  for (const [index] of ids.entries()) {
    const part = find(
      `xl/worksheets/sheet${String(index + 1 - offset)}.xml`.replace("sheet0.", "sheet."),
    );
    if (part < 0) return undefined;
    parts.push(part);
  }
  return parts;
}
