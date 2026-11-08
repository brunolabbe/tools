/**
 * Which worksheet part each of a workbook's sheets is read from, judged from the
 * zip before SheetJS opens it (lg-96, gate 1's F2).
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
 * **The resolution is SheetJS's own, copied.** What this refuses has to be what
 * SheetJS would read twice, and it picks the part by its own rules, not the
 * format's: the workbook part is the first `Override` of a workbook content type in
 * `[Content_Types].xml` (else `xl/workbook.xml`); a sheet's relationship is found by
 * its `r:id` in that part's `.rels`; its target is tried as `xl/<target without a
 * leading xl/>`, then as the target itself, then beside the relationships; a name
 * is matched without regard to case. A workbook whose relationships do not give
 * every sheet a target is read by position, `xl/worksheets/sheet<n>.xml`. Where
 * this copy differs from the version of SheetJS the repo pins, a shared part gets
 * through, and the memory bound is the inflate bound and the cells bounds as before.
 */

import type { Buffer } from "node:buffer";
import { inflateRawSync } from "node:zlib";
import { MAX_WORKBOOK_INFLATED_BYTES, compressedOf } from "./workbook-zip.ts";
import type { ZipEntry } from "./workbook-zip.ts";

/** The content types SheetJS reads as the workbook part (its `CT_LIST.workbooks`). */
const WORKBOOK_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
  "application/vnd.ms-excel.sheet.macroEnabled.main+xml",
  "application/vnd.ms-excel.sheet.binary.macroEnabled.main",
  "application/vnd.ms-excel.addin.macroEnabled.main+xml",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml",
]);

/** A zip name as SheetJS compares it: lower case, `/` for `\`. */
function keyOf(name: string): string {
  return name.toLowerCase().replaceAll("\\", "/");
}

/**
 * A tag's attributes as SheetJS's `parsexmltag` keeps them: a name with a prefix is
 * kept without it, one with an underscore is cut there, and each is also kept in
 * lower case. The first is by exact name and the second by lower case.
 */
function attributesOf(tag: string): { exact: Map<string, string>; lower: Map<string, string> } {
  const exact = new Map<string, string>();
  const lower = new Map<string, string>();
  for (const match of tag.matchAll(/\s([^"\s?>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^'">\s]+))/gu)) {
    let name = match[1] ?? "";
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    const colon = name.indexOf(":");
    if (colon < 0) {
      if (name.indexOf("_") > 0) name = name.slice(0, name.indexOf("_"));
    } else {
      name = name.slice(colon + 1);
    }
    exact.set(name, value);
    lower.set(name.toLowerCase(), value);
  }
  return { exact, lower };
}

function unescaped(text: string): string {
  return text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

/**
 * The first worksheet part that two or more of the workbook's sheets are read
 * from, or `undefined` when none is shared, or when the parts cannot be worked out
 * (the reader then refuses or reads the file by its own rules).
 */
export function sharedSheetPart(bytes: Buffer, entries: readonly ZipEntry[]): string | undefined {
  const byKey = new Map<string, ZipEntry>();
  for (const entry of entries)
    if (!byKey.has(keyOf(entry.name))) byKey.set(keyOf(entry.name), entry);
  const exists = (name: string): boolean => byKey.has(keyOf(name));
  const textOf = (name: string): string | undefined => {
    const entry = byKey.get(keyOf(name));
    if (entry === undefined) return undefined;
    try {
      const raw = compressedOf(bytes, entry);
      const inflated =
        entry.method === 0
          ? raw
          : inflateRawSync(raw, { maxOutputLength: MAX_WORKBOOK_INFLATED_BYTES });
      return inflated.length > MAX_WORKBOOK_INFLATED_BYTES ? undefined : inflated.toString("utf8");
    } catch {
      return undefined;
    }
  };
  const unslashed = (name: string): string => (name.startsWith("/") ? name.slice(1) : name);

  let workbookPart = "xl/workbook.xml";
  for (const tag of textOf("[Content_Types].xml")?.match(/<[^<>]*>/gu) ?? []) {
    if (!/^<(?:\w+:)?Override(?=[\s/>])/u.test(tag)) continue;
    const { exact } = attributesOf(tag);
    const type = exact.get("ContentType");
    if (type !== undefined && WORKBOOK_TYPES.has(type)) {
      workbookPart = exact.get("PartName") ?? workbookPart;
      break;
    }
  }
  const workbook = textOf(unslashed(workbookPart));
  if (workbook === undefined) return undefined;

  const ids: (string | undefined)[] = [];
  for (const tag of workbook.match(/<[^<>]*>/gu) ?? []) {
    if (!/^<(?:\w+:)?sheet(?=[\s/>])/u.test(tag)) continue;
    const { exact, lower } = attributesOf(tag);
    ids.push(lower.get("id") ?? exact.get("strRelID"));
  }

  const slash = workbookPart.lastIndexOf("/");
  let relationships =
    `${workbookPart.slice(0, slash + 1)}_rels/${workbookPart.slice(slash + 1)}.rels`.replace(
      /^\//u,
      "",
    );
  if (!exists(relationships)) relationships = "xl/_rels/workbook.xml.rels";
  const targets = new Map<string, string>();
  for (const tag of textOf(relationships)?.match(/<[^<>]*>/gu) ?? []) {
    if (!/^<Relationship(?=[\s])/u.test(tag)) continue;
    const { exact } = attributesOf(tag);
    const id = exact.get("Id");
    if (id !== undefined) targets.set(id, unescaped(exact.get("Target") ?? ""));
  }

  // Every sheet's target found, or the whole workbook is read by position.
  const resolved = ids.every((id) => id !== undefined && targets.has(id));
  const seen = new Set<string>();
  for (const [index, id] of ids.entries()) {
    let part = `xl/worksheets/sheet${String(index + 1)}.xml`;
    if (resolved) {
      const target = targets.get(id ?? "") ?? "";
      part = `xl/${target.replace(/\/?xl\//u, "")}`;
      if (!exists(part)) part = target;
      if (!exists(part)) part = relationships.replace(/_rels\/[\s\S]*$/u, "") + target;
    }
    if (!exists(part)) continue;
    const key = keyOf(part);
    if (seen.has(key)) return key;
    seen.add(key);
  }
  return undefined;
}
