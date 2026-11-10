---
id: lg-104
tool: ledger
title: A worksheet part SheetJS still parses once per sheet past lg-96's check
kind: fix
status: ready
milestone: null
depends_on: [lg-96]
difficulty: hard
---

# lg-104 — A worksheet part SheetJS still parses once per sheet past lg-96's check

## Why

[lg-96](./lg-96-a-far-stored-cell-costs-memory-by-its-address.md) bounds `readSheets`
(`tools/ledger/api/src/xlsx.ts`). Its shared-part check refuses a workbook in which
two `<sheet>` entries name one worksheet part, before SheetJS parses it. Gate 3 of
lg-96 (Opus 5.5, 2026-11-08, at `3b8e95d4`, FAIL, F2) found two ways SheetJS still
parses one worksheet-level part once per sheet, past that check. Both files are under
the 4 MiB inflated bound, and both pass every bound lg-96 sets.

The cost is memory. A crafted upload of under 4 MiB inflated makes `readSheets` build
or parse about 327 to 385 MB, against the 512 MB the ledger's production container
gets (`compose.ledger.prod.yaml`, `memory: 512m`). Gate 3 measured +310.3 to +367.5 MB;
the re-run for this ticket measured +313.3 to +379.0 MB (table below).

The owner chose on 2026-11-08 to land lg-96 and file these two as this ticket. lg-96's
own text names lg-104 at `1aabcb4a`, the head where `--land` ran, not at the gated
`3b8e95d4`. PR #758 is open at `a4a2feb2` now, one docs commit after `1aabcb4a` that
rewords the header below.

The `workbook-parts.ts` header (line 13 at `1aabcb4a`) says "Distinct
parts cannot multiply the parse: `MAX_WORKBOOK_INFLATED_BYTES` is a total over every
entry of the file … so the parts together never inflate to more than the bound."
`git grep -n "cannot multiply"` on `1aabcb4a` finds it. Both shapes below contradict
it. The owner chose on 2026-11-08 that lg-96's PR #758 rewords it before merge, and a
fixer is doing that now. If it still reads that way when lg-104 is built, lg-104 rewords
it (Build step 4).

## Reproduction

Both shapes were run at `3b8e95d4` on a detached worktree, which is `<tree>` in the
commands (the filer's was `/workspaces/tools/.claude/worktrees/builder-lg-104-1`, removed
after the runs). It was farmed (`worktree-farm.sh`, exit 0) and built (`npm run build`,
exit 0). Each probe ran once, one process at a
time; every measured process ran under `node --max-old-space-size=900`. The generators
(`localname.mts`, `comments.mts`) are small and ran uncapped.

The probes are pasted in full under "Probe files" below, so the Reproduction runs from
this ticket alone (the owner's answer on how the ticket carries them, Decision, question
2). The gate ran them from its scratch directories, `…/lg-96/gate-3/` and
`…/lg-96/gate-2/`. The pasted copies were run from `…/lg-104/build/paste/`, and that
directory is `<probes>` in the commands below. The probes are not committed to the repo,
and nothing here adds them to it.

Every reading is in MB of RSS growth over the process baseline, and "peak" is the
process peak. The "gate 3" column is gate 3's own figure for the same file.

### Probe files

Pasted whole so that the Reproduction runs from this ticket alone. The owner chose to paste them
on 2026-11-08 (Decision, question 2). Copy each block to a file of the same name in one directory,
and that directory is `<probes>` in the commands above. The gate ran them from its own scratch
directories, `…/lg-96/gate-3/` and `…/lg-96/gate-2/`. The copies below are those files, with one
change: the `G2` line in each `.sh` names the directory holding `multiplier.mts`, where the gate
named its scratch directory. Nothing else is changed. The `.sh` scripts export a `TMPDIR` under
`/tmp/claude-1000/lg96g3`, as the gate ran them, and must be invoked by absolute path, since they
`cd` into the tree before reading `$S`.

The six files, copied from the paste directory `…/lg-104/build/paste/`, ran from there against a
detached `3b8e95d4` with exit 0 for every probe (Log, 2026-11-08, verification run).

#### `localname.sh`: the local-name driver; `G2` names the paste directory

```bash
#!/bin/bash
# usage: localname.sh <tree> <outdir> <n...>  -- builds, inspects, measures readSheets and the route, one at a time
T="$1"; O="$2"; shift 2
S=$(dirname "$0")
G2="$S"  # multiplier.mts sits beside this script (gate 2 ran it from its own scratch directory)
cd "$T" || exit 9
export TMPDIR=/tmp/claude-1000/lg96g3 TEMP=/tmp/claude-1000/lg96g3 TMP=/tmp/claude-1000/lg96g3
mkdir -p "$O/files"
for N in "$@"; do
  for K in decoy control; do
    if [ "$K" = control ]; then node --import tsx "$S/localname.mts" "$T" "$N" "$O/files" control; else node --import tsx "$S/localname.mts" "$T" "$N" "$O/files"; fi
    timeout 120 node --max-old-space-size=900 --import tsx "$S/inspect.mts" "$T" "$O/files/localname-$K-$N.xlsx"
    timeout 120 node --max-old-space-size=900 --expose-gc --import tsx "$G2/multiplier.mts" "$T" run "$O/files/localname-$K-$N.xlsx" "$O" reader
    echo "exit $?"
  done
  timeout 120 node --max-old-space-size=900 --expose-gc --import tsx "$G2/multiplier.mts" "$T" run "$O/files/localname-decoy-$N.xlsx" "$O" route
  echo "exit $?"
done
```

#### `localname.mts`: the local-name generator: writes the decoy and the control

```text
// usage: node --import tsx localname.mts <tree> <n> <outdir> [control]
// The copy (`workbook-parts.ts`) matches a target against the zip's CENTRAL directory
// names (`workbookEntries`); SheetJS's CFB names each file by its LOCAL header. This
// builds a zip whose decoy entries have a central name the copy resolves a sheet's
// first lookup to, and a local name SheetJS never asks for, so SheetJS falls through
// to the target itself, which names the one big part. <n> sheets, <n> distinct indices
// in the copy, one part in SheetJS. The big part is gate 1's densex14 part
// (1 400 rows by 100 numbers). "control": every decoy's local name equals its central
// name (an honest zip): SheetJS then reads each decoy, and nothing is shared.
import { writeFileSync } from "node:fs";
import { crc32, deflateRawSync } from "node:zlib";
import path from "node:path";

const [tree, nArg, outdir, control] = process.argv.slice(2);
const n = Number(nArg);
const honest = control === "control";
void tree;

const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const WS = `${R}/worksheet`;
const PKG = "http://schemas.openxmlformats.org/package/2006/relationships";

function colName(i: number): string {
  let s = "";
  let x = i + 1;
  while (x > 0) {
    s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

interface In {
  central: string;
  local: string;
  data: Buffer;
}
function zip(entries: readonly In[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const cname = Buffer.from(e.central, "utf8");
    const lname = Buffer.from(e.local, "utf8");
    const bytes = deflateRawSync(e.data);
    const crc = crc32(e.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(bytes.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(lname.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc >>> 0, 16);
    central.writeUInt32LE(bytes.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(cname.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, lname, bytes);
    centrals.push(central, cname);
    offset += 30 + lname.length + bytes.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

// The big part's name: m segments "xl/" then "b.xml", m = n - 1.
const m = n - 1;
const seg = Array.from({ length: m }, () => "xl");
const big = `${seg.join("/")}/b.xml`;
// Target j (0 <= j < m): segment j lower case, the rest "XL"; target m: all "XL".
const targets: string[] = [];
for (let j = 0; j <= m; j += 1) targets.push(`${seg.map((_, i) => (i === j ? "xl" : "XL")).join("/")}/b.xml`);
// SheetJS's first lookup of each target, as `parse_zip` builds it.
const first = targets.map((t) => `xl/${t.replace(/[/]?xl\//u, "")}`);

const rows: string[] = [];
for (let r = 1; r <= 1400; r += 1) {
  let row = `<row r="${String(r)}">`;
  for (let k = 0; k < 100; k += 1) row += `<c r="${colName(k)}${String(r)}"><v>${String(r)}</v></c>`;
  rows.push(row + "</row>");
}
const part = Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="${MAIN}"><sheetData>${rows.join("")}</sheetData></worksheet>`);
const tiny = Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="${MAIN}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>decoy</t></is></c></row></sheetData></worksheet>`);

const entries: In[] = [];
const add = (name: string, data: Buffer, local = name): void => {
  entries.push({ central: name, local, data });
};
add("[Content_Types].xml", Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`));
add("_rels/.rels", Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`));
add("xl/workbook.xml", Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="${MAIN}" xmlns:r="${R}"><sheets>${targets.map((_, i) => `<sheet name="S${String(i + 1)}" sheetId="${String(i + 1)}" r:id="rId${String(i + 1)}"/>`).join("")}</sheets></workbook>`));
add("xl/_rels/workbook.xml.rels", Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${PKG}">${targets.map((t, i) => `<Relationship Id="rId${String(i + 1)}" Type="${WS}" Target="${t}"/>`).join("")}</Relationships>`));
add(big, part);
const bigKey = big.toLowerCase();
for (const [i, name] of first.entries()) {
  if (name.toLowerCase() === bigKey) continue;
  add(name, tiny, honest ? name : `xl/junk${String(i)}.xml`);
}
const out = zip(entries);
const inflated = entries.reduce((s, e) => s + e.data.length, 0);
const file = path.join(outdir, `localname-${honest ? "control" : "decoy"}-${String(n)}.xlsx`);
writeFileSync(file, out);
console.log(`${path.basename(file)}: ${String(out.length)} B, ${String(inflated)} B inflated (bound 4194304), ${String(entries.length)} entries`);
console.log(`targets: ${targets.join(" | ")}`);
console.log(`first lookups: ${first.join(" | ")}`);
```

#### `inspect.mts`: reads the file's `bookSheets`, `sheetPartsOf` and full SheetJS read

```text
// usage: node --import tsx inspect.mts <tree> <file>
// What SheetJS reads (sheets, and how many hold more than 1000 rows), what
// `sheetPartsOf` says, and what `bookSheets` lists. No readSheets call.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const [tree, file] = process.argv.slice(2);
const api = path.join(tree, "tools/ledger/api");
const XLSX = createRequire(path.join(api, "package.json"))("xlsx");
const { sheetPartsOf } = await import(path.join(api, "src/workbook-parts.ts"));
const { workbookEntries } = await import(path.join(api, "src/workbook-zip.ts"));
const bytes = readFileSync(file);
const listed = XLSX.read(bytes, { type: "buffer", bookSheets: true }).SheetNames as string[];
let parts = "";
try {
  parts = JSON.stringify(sheetPartsOf(bytes, workbookEntries(bytes)));
} catch (e) {
  parts = `threw ${(e as { code?: string }).code ?? String(e)}`;
}
const wb = XLSX.read(bytes, { type: "buffer", dense: true, sheetStubs: true });
const big = wb.SheetNames.filter((n: string) => (wb.Sheets[n]?.["!data"]?.length ?? 0) > 1000).length;
console.log(`${path.basename(file)}: bookSheets ${String(listed.length)}; sheetPartsOf ${parts}; full read ${String(wb.SheetNames.length)} sheets, ${String(big)} of them the big part`);
```

#### `comments.sh`: the comments driver; `G2` names the paste directory

```bash
#!/bin/bash
# usage: comments.sh <tree> <outdir> <k> <n...>  -- builds then measures one process at a time, heap 900 MB
T="$1"; O="$2"; K="$3"; shift 3
S=$(dirname "$0")
G2="$S"  # multiplier.mts sits beside this script (gate 2 ran it from its own scratch directory)
cd "$T" || exit 9
export TMPDIR=/tmp/claude-1000/lg96g3 TEMP=/tmp/claude-1000/lg96g3 TMP=/tmp/claude-1000/lg96g3
mkdir -p "$O/files"
for N in "$@"; do
  for SH in comments distinct; do
    [ "$SH" = distinct ] && [ "$N" = 1 ] && continue
    node --import tsx "$S/comments.mts" "$T" "$SH" "$N" "$K" "$O/files"
    timeout 120 node --max-old-space-size=900 --expose-gc --import tsx "$G2/multiplier.mts" "$T" run "$O/files/comments-$SH-$N-$K.xlsx" "$O" reader
    echo "exit $?"
  done
done
```

#### `comments.mts`: the comments generator: writes the shared and the distinct files

```text
// usage: node --import tsx comments.mts <tree> <shape> <n> <k> <outdir>
// Builds an .xlsx of <n> sheets, each its own small worksheet part, each with its own
// .rels pointing at ONE shared part of <k> comments (shape "comments"), or at ONE
// shared VML+comments pair (shape "vml"), or at <n> distinct comments parts of k/n
// comments each (shape "distinct", the control: same inflated bytes, no sharing).
// Measure the result with gate-2's multiplier.mts run mode.
import { writeFileSync } from "node:fs";
import path from "node:path";

const [tree, shape, nArg, kArg, outdir] = process.argv.slice(2);
const n = Number(nArg);
const k = Number(kArg);
const api = path.join(tree, "tools/ledger/api");
const h = await import(path.join(api, "test/helpers/xlsx-file.ts"));

const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const WS = `${R}/worksheet`;
const CM = `${R}/comments`;
const PKG = "http://schemas.openxmlformats.org/package/2006/relationships";

function colName(i: number): string {
  let s = "";
  let x = i + 1;
  while (x > 0) {
    s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

function commentsXml(count: number): string {
  const list: string[] = [];
  for (let i = 0; i < count; i += 1) {
    // 100 columns wide, so rows stay under the row bound; text short.
    list.push(`<comment ref="${colName(i % 100)}${String(Math.floor(i / 100) + 1)}" authorId="0"><text><t>c</t></text></comment>`);
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<comments xmlns="${MAIN}"><authors><author>a</author></authors><commentList>${list.join("")}</commentList></comments>`;
}

const ids = Array.from({ length: n }, (_, i) => i + 1);
const entries: { name: string; data: Buffer }[] = [];
const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`;
entries.push({ name: "[Content_Types].xml", data: Buffer.from(ct) });
entries.push({
  name: "_rels/.rels",
  data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
});
entries.push({
  name: "xl/workbook.xml",
  data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="${MAIN}" xmlns:r="${R}"><sheets>${ids.map((i) => `<sheet name="S${String(i)}" sheetId="${String(i)}" r:id="rId${String(i)}"/>`).join("")}</sheets></workbook>`),
});
entries.push({
  name: "xl/_rels/workbook.xml.rels",
  data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${PKG}">${ids.map((i) => `<Relationship Id="rId${String(i)}" Type="${WS}" Target="worksheets/sheet${String(i)}.xml"/>`).join("")}</Relationships>`),
});
for (const i of ids) {
  entries.push({
    name: `xl/worksheets/sheet${String(i)}.xml`,
    data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="${MAIN}" xmlns:r="${R}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>P1</t></is></c></row></sheetData></worksheet>`),
  });
  const target = shape === "distinct" ? `../comments${String(i)}.xml` : "../comments1.xml";
  entries.push({
    name: `xl/worksheets/_rels/sheet${String(i)}.xml.rels`,
    data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${PKG}"><Relationship Id="c1" Type="${CM}" Target="${target}"/></Relationships>`),
  });
}
if (shape === "distinct") {
  for (const i of ids) entries.push({ name: `xl/comments${String(i)}.xml`, data: Buffer.from(commentsXml(Math.floor(k / n))) });
} else {
  entries.push({ name: "xl/comments1.xml", data: Buffer.from(commentsXml(k)) });
}
const inflated = entries.reduce((s, e) => s + e.data.length, 0);
const out: Buffer = h.zipOf(entries);
const file = path.join(outdir, `comments-${shape}-${String(n)}-${String(k)}.xlsx`);
writeFileSync(file, out);
console.log(`${path.basename(file)}: ${String(out.length)} B, ${String(inflated)} B inflated (bound 4194304), ${String(entries.length)} entries`);
```

#### `multiplier.mts`: gate 2's measurement script, pasted whole; these probes use its `run` mode

```text
// usage: node --import tsx multiplier.mts <tree> build <shape> <n> <outdir>
//        node --expose-gc --max-old-space-size=900 --import tsx multiplier.mts <tree> run <file> <outdir>
// shape: x_code (targets after the first spelled sheet_x0031_), plain (all the same spelling, the control)
// The part is gate 1's densex14 part: 1 400 rows by 100 numeric cells.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const [tree, mode, a, b, c] = process.argv.slice(2);
const api = path.join(tree, "tools/ledger/api");
const WS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet";
const NS =
  'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

function colName(i: number): string {
  let s = "";
  let n = i + 1;
  while (n > 0) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

if (mode === "build") {
  const shape = a;
  const n = Number(b);
  const outdir = c;
  const h = await import(path.join(api, "test/helpers/xlsx-file.ts"));
  const rows: string[] = [];
  for (let r = 1; r <= 1400; r += 1) {
    let row = `<row r="${r}">`;
    for (let k = 0; k < 100; k += 1) row += `<c r="${colName(k)}${r}"><v>${r}</v></c>`;
    rows.push(row + "</row>");
  }
  const part = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet ${NS}><sheetData>${rows.join("")}</sheetData></worksheet>`;
  const each = Array.from({ length: n }, (_, i) => String(i + 1));
  const sheets = each.map((k) => `<sheet name="S${k}" sheetId="${k}" r:id="dup${k}"/>`).join("");
  const target = (k: string): string =>
    shape === "x_code" && k !== "1" ? "worksheets/sheet_x0031_.xml" : "worksheets/sheet1.xml";
  const rels = each
    .map((k) => `<Relationship Id="dup${k}" Type="${WS}" Target="${target(k)}"/>`)
    .join("");
  const sheet = new h.SheetWriter("S");
  sheet.set("A1", "Alex");
  let inflated = 0;
  const entries = h.entriesOf(h.workbookOf([sheet])).map((entry: { name: string; data?: Buffer }) => {
    if (entry.data === undefined) return entry;
    const xml = entry.data.toString("utf8");
    let data = entry.data;
    if (entry.name === "xl/workbook.xml") data = Buffer.from(xml.replace(/<sheets>.*<\/sheets>/su, `<sheets>${sheets}</sheets>`));
    else if (entry.name === "xl/_rels/workbook.xml.rels") data = Buffer.from(xml.replace(/<Relationship [^>]*worksheet[^>]*\/>/u, rels));
    else if (entry.name === "xl/worksheets/sheet1.xml") data = Buffer.from(part);
    inflated += data.length;
    return { name: entry.name, data };
  });
  const out: Buffer = h.zipOf(entries);
  const file = path.join(outdir, `dense-${shape}-${n}.xlsx`);
  writeFileSync(file, out);
  console.log(`${path.basename(file)}: ${out.length} B, ${inflated} B inflated (bound 4194304), ${n} entries`);
} else {
  const file = a;
  const outdir = b;
  const data = readFileSync(file);
  const which = c ?? "reader";
  const { readSheets } = await import(path.join(api, "src/xlsx.ts"));
  const describe = which === "route" ? (await import(path.join(api, "src/workbook-describe.ts"))).describeWorkbook : undefined;
  (globalThis as { gc?: () => void }).gc?.();
  const before = process.resourceUsage().maxRSS;
  const t0 = performance.now();
  let outcome = "read";
  try {
    if (describe === undefined) {
      const sheets = await readSheets(data);
      let cells = 0;
      for (const s of sheets) for (const row of s.rows) for (const x of row) if (x !== null) cells += 1;
      outcome = `read ${sheets.length} sheets, ${cells} cells`;
    } else {
      await describe({ db: undefined, personId: "p" }, { file: data.toString("base64"), consent: true }, { ask: async () => ({ text: null, stopReason: "refusal" }), readSheets });
    }
  } catch (e: unknown) {
    const err = e as { code?: string; details?: unknown };
    outcome = `${err.code ?? String(e)} ${JSON.stringify(err.details ?? null)}`;
  }
  const ms = performance.now() - t0;
  const after = process.resourceUsage().maxRSS;
  const line = `${path.basename(file)} [${which}]: ${outcome}; +${((after - before) / 1024).toFixed(1)} MB (baseline ${(before / 1024).toFixed(1)}, peak ${(after / 1024).toFixed(1)}); ${ms.toFixed(0)} ms`;
  console.log(line);
  appendFileSync(path.join(outdir, "multiplier.results"), line + "\n");
}
```

### Shape 1: a zip entry whose local-header name differs from its central name

SheetJS's CFB names each zip entry from its **local** header. The ledger's copy
(`workbookEntries` and `compressedOf` in `tools/ledger/api/src/workbook-zip.ts`) names
it from the **central directory** and never compares the two. The decoy file has 14
sheet targets whose first lookup, in the copy, is a distinct entry. Each of those
entries has a local name SheetJS never asks for, so SheetJS falls through to the
target itself, and all 14 targets name one 1,400 × 100 numeric part (3.84 MB inflated).
The control is the same file with every local name equal to its central name.

Commands, from the worktree root, outputs under `build/probe-localname/`:

```
bash <probes>/localname.sh <tree> <out> 2 14
node --max-old-space-size=900 --import tsx <probes>/inspect.mts <tree> <out>/files/localname-decoy-14.xlsx
node --max-old-space-size=900 --import tsx <probes>/inspect.mts <tree> <out>/files/localname-control-14.xlsx
```

`localname.sh` exit 0; both `inspect.mts` runs exit 0. The 14-sheet decoy is 294,618 B,
3,836,319 B inflated, 18 entries. Its `sheetPartsOf` is `[4,5,…,17]`, 14 distinct
indices; SheetJS's full read gives 14 sheets, all 14 the big part. The control's
`sheetPartsOf` is the same, and its full read gives 1 of 14 the big part.

| File                                                | Reading (this re-run)                                                                | Gate 3's figure        |
| --------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------- |
| `localname-decoy-2`, reader                         | 2 sheets, 280,000 cells; +87.3 MB (peak 182.1)                                       | +81.0 MB               |
| `localname-control-2`, reader                       | 2 sheets, 140,001 cells; +59.7 MB (peak 147.7)                                       | not run                |
| **`localname-decoy-14`, reader**                    | 14 sheets, 1,960,000 cells; **+379.0 MB (peak 462.0)**, 11.6 s                       | +367.5 MB (peak 448.9) |
| **`localname-control-14`, reader** (honest control) | 14 sheets, 140,013 cells; +60.0 MB (peak 145.1), 1.2 s                               | +63.1 MB (peak 146.7)  |
| **`localname-decoy-14`, route**                     | `WORKBOOK_TOO_LARGE {"bound":"cells"}`, only after the build; +350.1 MB (peak 464.8) | +349.1 MB              |

The route refuses the decoy as `cells` only after the build, so its figure is the
build's cost. The command path calls only `readSheets`, so the reader row is the one
the command pays. Forty such sheets would cost about forty parses (about 1 GB by
extrapolation); that was not run.

### Shape 2: one comments part named by 14 sheets' `.rels`

Each of 14 sheets has a worksheet part of its own. Each sheet's `.rels` names one
comments part of 50,000 comments (3.2 MB inflated). SheetJS's `safe_parse_sheet` reads
each sheet's comments relationship and parses the part once per sheet. The copy looks
at none of this, and every bound passes. The control is 14 comments parts of 3,571
comments each, the same total inflated size, so nothing is shared.

Commands, outputs under `build/probe-comments/`:

```
bash <probes>/comments.sh <tree> <out> 50000 1 14
node --max-old-space-size=900 --expose-gc --import tsx <probes>/multiplier.mts <tree> run <out>/files/comments-comments-14-50000.xlsx <out> route
```

`comments.sh` exit 0; the route run exit 0. The 14-sheet comments file is 120,025 B,
3,238,478 B inflated, 33 entries.

| File                                                          | Reading (this re-run)                                                                                          | Gate 3's figure                             |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `comments-comments-1`, reader (one sheet names it)            | 1 sheet, 1 cell; +44.5 MB (peak 127.0)                                                                         | +41.7 MB (peak 140.5)                       |
| **`comments-comments-14`, reader**                            | 14 sheets, 14 cells; **+327.1 MB (peak 412.0)**, 4.5 s                                                         | +352.5 MB (peak 435.4)                      |
| **`comments-distinct-14`, reader** (honest control: 14 parts) | 14 sheets, 14 cells; +54.0 MB (peak 136.2)                                                                     | +54.6 MB (peak 138.8)                       |
| **`comments-comments-14`, route**                             | `LAYOUT_UNREADABLE`, every bound passed (the route's model step refuses the fake file); +313.3 MB (peak 442.7) | `LAYOUT_UNREADABLE`; +310.3 MB (peak 440.6) |

The VML, threaded-comment, drawing and chart parts are read the same way by SheetJS
(`parse_vml`, `parse_drawing`, `parse_chart`). Gate 3 did not build them and nor did
this re-run; they are unmeasured.

### Observation, not a recommendation

Each of lg-96's three gates found a point where the copy and SheetJS disagree about
the parts, or where SheetJS parses what the copy charges once. They differ in kind:

- **Gate 1** (`e2e6a6cb`), F2: the cap's stated worst case does not hold. SheetJS's
  parse of a shared part runs before `placesOf` charges anything. This is a cost
  finding, not a disagreement about which part a sheet names.
- **Gate 2** (`c2e36eb7`), F2 and N1: seven spellings (an entity and `_x0031_` in a
  target, a `>` inside a quoted name, an empty `r:id` beside `strRelID`, a sheet with
  no id beside `Id="undefined"`, a tab after a tag name) that SheetJS reads as two sheets
  over one part and `sharedSheetPart` answers `undefined` for; and, in the other
  direction, a tab after `<Relationship`.
- **Gate 3** (`3b8e95d4`), F2: the local-header name against the central name (shape 1).
  Shape 2 is not a disagreement about identity: SheetJS parses a shared comments part
  per sheet, and the copy does not inspect comments.

Each further rule added to the copy has so far been followed by a new difference.

## Decision — answered 2026-11-08 by the owner

**Who decides:** the owner. Two questions, both answered.
Gate 3 (Opus 5.5) recommended option 1 of question 1; that recommendation is gate 3's,
recorded here as gate 3's. This ticket does not add one.

**Question 2 — how the ticket carries the probes of its Reproduction.** answered 2026-11-08
by the owner: **(a), paste.** The options were (a) paste the generators into the ticket,
which the filer recommended, (b) commit them as test fixtures, and (c) leave them in
scratch. The pasted files are under "Probe files" in the Reproduction. The full question,
options and choice are in the Log.

**Question 1 — what do the two shapes do under the shared-part check?** answered 2026-11-08
by the owner: **option 1, refuse both shapes before the parse.** The options are below as
they were put; the measurements taken for the question and the choice are under "Chosen".

1. **Refuse both shapes before the parse (gate 3's recommendation).** Refuse a zip
   whose local-header name differs from the central name of an entry the copy reads
   (in `compressedOf` or `workbookEntries`), and refuse a workbook in which two sheets'
   `.rels` (comments, VML, drawing, chart) name one part. Costs: a second copy of
   SheetJS's rules (`parse_rels` and `resolve_path`), and the observation above says a
   copy has been followed by a new difference each time. The refusal is `WORKBOOK_NOT_XLSX`,
   as lg-96's answer 11 has it for the shared part. Believed, unmeasured: that no workbook
   Excel saves has either shape. `workbook-parts.ts`'s header says it only of a worksheet
   part shared by two sheets ("each sheet is a part of its own"), and nothing in the repo
   says it of a local-header name that differs from the central one, or of a comments, VML,
   drawing or chart part named by several sheets. The cost not priced is a false refusal of
   a real workbook; the repo's one real workbook (described in `workbook-bounds.ts`) has not
   been run against the proposed refusal, and the real-workbook row of Done when 1 is the
   measurement.
2. **Parse one sheet per `XLSX.read` (`sheets: i`).** Each shared part is parsed and
   released per sheet, so one part's parse is held at a time. Costs: unmeasured. Time
   grows with the sheet count, about N full inflates for N sheets (up to the sheet
   bound). Built grids still accumulate across sheets, so memory for the built result is
   not closed by this.
3. **Accept and document.** No code. Correct whichever text still reads otherwise at
   build time, as Build 4 does for the header. At `a4a2feb2` (PR #758's open head: `1aabcb4a`,
   where `--land` ran, plus one docs commit that rewords the header)
   `workbook-bounds.ts`, `xlsx.ts`'s comment and lg-96's answer 10 already name the two
   shapes and gate 3's figures; `workbook-parts.ts`'s header is the one Build 4 covers.
   Costs: a crafted upload under 4 MiB takes about 327 to 385 MB of the 512 MB
   container in `readSheets` (the envelope of every `readSheets` reading on record), and
   +310 to +354 MB through the describe route, which is what an upload reaches; the cap is
   not the bound on either.

**Chosen: option 1, refuse both shapes** (gate 3's recommendation, and the orchestrator's).
Put to the owner on 2026-11-08 with four options: 1; 2; 1 and 2 together; 3. Measured for
the question, on `origin/main` 4a34361d, one process at a time under
`--max-old-space-size=900` (Log, 2026-11-08, the owner's answer to question 1):

- The one real workbook at hand, `workbook.xlsx`, untracked at the shared checkout's root
  (`/workspaces/tools/workbook.xlsx`, not in the repository), was saved by `Microsoft Excel
  Online` (`docProps/app.xml`, AppVersion 16.0300). It has 14 sheets, 32 entries, 1 drawing
  part and 1 chart part, no comments, VML or threaded-comment part. No entry's local name
  differs from its central name, and no part is named by two sheets' `.rels`. So it has
  neither shape, and it holds a drawing and a chart, which gives Done when 1's
  real-workbook row something to decide.
- Option 2, measured on raw SheetJS (`XLSX.read` alone, not `readSheets`): peak RSS for
  the decoy-14 file 321 MB whole, 186 MB one sheet per read, 273 MB keeping each sheet's
  cells; for comments-14, 425, 221 and 239 MB. Time on the real workbook 130 to 213 ms.
  Not chosen.
- A `worker_thread` with `resourceLimits.maxOldGenerationSizeMb` does not bound it: at a cap
  of 96 MB the decoy-14 file was still read whole, 1,960,000 cells, peak 495 MB. The memory
  is outside V8's old generation. Not an option.

## Build

Written for the answer the owner gives. The owner's answer goes under the heading
above first (who, the date, the options it was chosen from), and `status` moves to
`ready` in that commit, as `docs/01-TICKETS.md` says.

1. **If 1:** in `tools/ledger/api/src/workbook-zip.ts`, `workbookEntries` and
   `compressedOf` compare each entry's local-header name with its central name, at the
   local header's offset, and refuse the zip on a mismatch with `WORKBOOK_NOT_XLSX`. In
   `tools/ledger/api/src/workbook-parts.ts`, refuse a workbook whose sheets' `.rels`
   (comments, VML, drawing, chart) resolve to one part, before any sheet is parsed. Both
   run before `readSheets` calls SheetJS. Tests: each shape, through `readSheets`, the
   describe route and the import command.
2. **If 2:** measure first, before the change, on both shapes at 14 sheets and at the
   largest sheet count the workbook bound admits, one process at a time under
   `--max-old-space-size=900`: time, peak, and the size of the built grid. Record the
   table in the Log. Then change `readSheets` to `XLSX.read` once per sheet with
   `sheets: i`, keeping only that sheet's built grid, and measure again on the same
   shapes.
3. **If 3:** no code. Read `workbook-parts.ts`'s header, `xlsx.ts`'s
   `refuseUnlessEachSheetIsItsOwn` comment, `workbook-bounds.ts`'s +129 MB figure and
   lg-96's answer 10 at the build head, and correct whichever still promises the bound or
   omits the two shapes. A text that already names both shapes and a measured figure is
   left as it is.
4. **Under any answer, whichever merges first:** lg-96's PR #758 rewords the header
   sentence in `tools/ledger/api/src/workbook-parts.ts` that begins "Distinct parts cannot
   multiply the parse" before it merges, as the owner chose on 2026-11-08. If the header
   still reads that way when lg-104 is built, lg-104 rewords it in its own change, to
   what the chosen answer covers (under option 3, naming the two shapes and the measured
   figure). If it already reads otherwise, this step is met and nothing is changed.

## Done when

The population is the two shapes: (a) a zip entry whose local-header name differs from
its central name, and (b) a workbook in which two sheets' `.rels` name one part. Each is
the file named in the Reproduction. Each line is checked by someone other than the
builder.

1. **If 1:** `xlsx.test.ts` or `workbook-import.test.ts` has one test per shape, each
   asserting `WORKBOOK_NOT_XLSX` before SheetJS parses (the decoy-14 file and the
   comments-14 file), through `readSheets`, the describe route and the import command.
   Re-running `localname.sh 2 14` and `comments.sh … 50000 1 14` on the head refuses both
   14-sheet files, and reads the honest controls unchanged (`localname-control-14`
   140,013 cells; `comments-distinct-14` 14 cells). Removing the new check fails the
   tests. A real workbook saved by Excel, which the repo does not hold (the one
   `workbook-bounds.ts` describes is outside it), is read at the head with both refusals in
   place and still reads, with its sheet and cell counts the same as at `origin/main`. The
   owner or the builder supplies it, and the Log says which file, which application saved
   it (`docProps/app.xml` names it) and how many comments, VML, drawing and chart parts it
   holds. A workbook with none of those parts gives the second refusal nothing to decide,
   so a count of 0 for all four leaves that clause `unproven`; if no file is available the
   line is `unproven` and the false-refusal cost stays unpriced.
2. **If 2:** the Log holds the before and after table for both shapes, at 14 sheets and
   at the largest sheet count, with time and peak under `--max-old-space-size=900`. Each
   shape's peak at that count is named, and the built-grid growth is measured, not
   estimated.
3. **If 3:** `git grep -n "cannot multiply" -- tools/ledger/api/src` matches nothing
   (the fragment, not the whole phrase: the comment wraps between "parts" and "cannot"),
   and each of the four texts in Build 3 names the two shapes and a measured figure
   (gate 3's, the re-run's, or a re-measured one), as read at the head. A text already so
   at the build head is met, not re-edited.
4. **Under any answer, whichever merges first:** on lg-104's head,
   `git grep -n "cannot multiply" -- tools/ledger/api/src/workbook-parts.ts` matches
   nothing. If lg-96's PR #758 merges first with its rewording, this line is met by it;
   otherwise by lg-104's own change under Build step 4.
5. **Under any answer:** the Reproduction's probes re-run at the head, with their output in
   the Log, and the honest controls read the same as above.
6. **Under any answer:** `npm run check` and `npm test -- --project ledger` pass.

## Log

### 2026-11-08, filing

- Filed by a builder on a maintenance dispatch (no ship authority), from lg-96's gate 3
  (Opus 5.5, FAIL at `3b8e95d4`, F2). The owner chose on 2026-11-08 to land lg-96 and
  file these two shapes as this ticket.
- Re-ran gate 3's probes, once each, on a detached `3b8e95d4` (farm exit 0, build exit 0).
  Readings are in the Reproduction beside gate 3's. The local-name and comments figures
  agree with gate 3's to within about 10 MB on each row, except `comments-comments-14`
  reader (+327.1 against +352.5), which is recorded as measured.
- `lg-96` at `3b8e95d4` does not name lg-104. At its landing head `1aabcb4a` it does, in
  its Log, in `workbook-bounds.ts` and in `xlsx.ts`. The reference is in place for the
  landing; no change is made here. Clarified at landing (gate 2, N1): `1aabcb4a` is where
  `--land` ran, and "its landing head" did not mean `a4a2feb2`, PR #758's head with the
  header reworded.
- The dispatch's observation said each of lg-96's three gates found a new disagreement
  between the copy and SheetJS. Gate 1's F2, read from the lg-96 Log, is the parse that
  runs before the charge (a cost finding). Gates 2 and 3 each found an identity
  disagreement. The Observation section says it this way.
- Coordinator's addition: the header of `tools/ledger/api/src/workbook-parts.ts` at
  `1aabcb4a` line 13 says "Distinct parts cannot multiply the parse … the parts together
  never inflate to more than the bound". Verified by `git show 1aabcb4a:… | grep -n
  "cannot multiply"`. Build step 4 and Done when 4 cover it.
- `difficulty: hard`. The recommended option (1) is another copy of SheetJS's rules, and
  lg-96's three gates are the record of how such a copy goes. The rating follows the
  recommended option, as `docs/01-TICKETS.md` says for a question.
- `depends_on: [lg-96]` resolves on `main`, where lg-96's ticket file already exists.
- Not measured: the VML, threaded-comment, drawing and chart variants of shape 2, and the
  built-grid growth under option 2.

### 2026-11-08, the owner's answers

- **Question 2: how the ticket carries the probes of its Reproduction.** Asked by the
  builder; answered 2026-11-08 by the owner, through the coordinator. Options: (a) paste
  the generators into the ticket, as lg-103 did, the filer's recommendation; (b) commit
  them as test fixtures; (c) leave them in the gate's scratch directories. **Chosen: (a),
  paste.**
  - Pasted whole under "Probe files": `localname.sh`, `localname.mts`, `inspect.mts`,
    `comments.sh`, `comments.mts`, and gate 2's `multiplier.mts`, whole, because the probes
    call its `run` mode. The only change is the `G2` line in the two `.sh` scripts, which
    names the directory holding `multiplier.mts`. The commands now take `<probes>` and
    `<tree>`. The pull request stays docs-only.
  - Verified from the ticket's own files. The six copies were placed in
    `…/scratchpad/lg-104/build/paste/` and run from there, by absolute path, against a
    detached `3b8e95d4` (farm exit 0, build exit 0). Output in
    `…/scratchpad/lg-104/build/verify/`. `localname.sh 2 14` exit 0; `comments.sh 50000 1 14`
    exit 0. Readings: local-name decoy-14 +380.9 MB (peak 467.4), control-14 +57.9 MB
    (140,013 cells), decoy-14 route `WORKBOOK_TOO_LARGE` `cells` +353.5 MB; comments-14
    +333.6 MB (peak 416.2), distinct-14 +52.5 MB. The same shapes as the first run, within
    the spread between runs; the tables keep the first run's readings.
  - The pasted blocks are byte-identical to the six files (checked by comparing each block
    with its file). The fences are `text`, not `ts`, because the formatter reflows
    TypeScript inside a `ts` fence, and an earlier paste had been reflowed that way before
    the check caught it.
- **Build step 4 and Done when 4 reworded.** Owner, 2026-11-08: lg-96's PR #758 rewords the
  header sentence "Distinct parts cannot multiply the parse" before it merges, and a fixer
  is doing that now. Both lines now hold whichever merges first: if the header still reads
  so when lg-104 is built, lg-104 rewords it; if not, the line is met by
  `git grep -n "cannot multiply" -- tools/ledger/api/src/workbook-parts.ts` matching
  nothing. The earlier wording, "under any answer, reword it in this change", is superseded.
- **Decision heading.** It stays `Decision — open`, and `status` stays `needs-decision`,
  because question 1 (the shape options) is still open. Question 2 is marked answered on its
  own line, as `docs/01-TICKETS.md` says for a ticket with several questions.

### 2026-11-08, gate 1 CONCERNS

- Gate 1 (Sonnet, narrow, at `cb3107c1`) returned CONCERNS. A fixer applied four findings
  and stopped, with no ship authority:
  - F1: Done when 3's grep could not go red, because the header wraps between "parts" and
    "cannot". Reproduced: `git grep -n "Distinct parts cannot multiply" 1aabcb4a -- tools/ledger`
    exits 1; `git grep -n "cannot multiply" 1aabcb4a -- tools/ledger/api/src/workbook-parts.ts`
    finds line 13. Done when 3 now uses `cannot multiply`, scoped to `tools/ledger/api/src`
    because this ticket itself contains the fragment.
  - F2: option 3, Build 3 and Done when 3 described rewording that `a4a2feb2` already holds.
    Reproduced by `git grep -n -i "worst measured\|lg-104" a4a2feb2 -- tools/ledger/api/src`.
    Option 3 is now "no code; correct whichever text still reads otherwise at build time",
    and Build 3 and Done when 3 match.
  - F3: option 1 sourced "no workbook Excel saves has either shape" to a header that says
    it only of a shared worksheet part. It now reads "believed, unmeasured", and Done when 1
    has a row for a real workbook saved by Excel. The workbook is not in the repo, so that
    row was not run.
  - F4: "about 350 to 380 MB" left out the ticket's own rows (+327.1, +313.3, +350.1) and
    the gate's (+332.6, +331.9). The range is now about 327 to 385 MB, in the Why and in
    option 3.
- Not changed, as dispatched: Done when 2 and 5. Gate 1's F5, the unpinned count, stays as
  the gate wrote it; its fix needs a choice.

### 2026-11-08, gate 2 PASS, the owner's answer and the landing

- Gate 2 (Sonnet, narrow, at `46d9d330`) returned PASS with four lows. Its full report and
  gate 1's are on the pull request thread, #759; status unchanged. No `--land`: this pull
  request only files the ticket, and the sections do not go into it.
- **Question: which of gate 2's four lows to fix at the landing.** Asked by the
  orchestrator; answered 2026-11-08 by the owner. Options: fix all four with no re-gate (the
  orchestrator's recommendation), fix N1 and N2 only, record all four and change nothing.
  **Chosen: fix all four at landing, no re-gate.** The question was not recorded in the ticket
  before this entry.
- 2026-11-08 — Fixed at landing by owner choice: gate 2, N1 — "Two shas are called lg-96's
  landing head". Option 3, the Why and the filing Log now say that `1aabcb4a` is where
  `--land` ran and `a4a2feb2` is PR #758's head with the header reworded. The filing Log's
  claim is clarified in place, not deleted. Proof, on one line:
  `git diff 46d9d330 HEAD -- <ticket> | grep -c '^-.*landing head)'` → 1.
- 2026-11-08 — Fixed at landing by owner choice: gate 2, N2 — "a description, not a name".
  Option 1 and Done when 1 now say "described in" and "describes", since
  `workbook-bounds.ts` gives counts and no filename. Proof, on one line:
  `git diff 46d9d330 HEAD -- <ticket> | grep -c '^-.*one real workbook (named in'` → 1.
- 2026-11-08 — Fixed at landing by owner choice: gate 2, F4 residual — "option 3 drops the
  scope". Option 3's range is now scoped to `readSheets`, with the route's +310 to +354 MB
  beside it, from gate 2's account. Proof, on one line:
  `git diff 46d9d330 HEAD -- <ticket> | grep -c '^-.*the cap is not the bound on it'` → 1.
- 2026-11-08 — Fixed at landing by owner choice: gate 2, F3 residual — "the row is met and
  the false-refusal cost is still unpriced". Done when 1's real-workbook row now requires
  the Log to name the file's application and its count of comments, VML, drawing and chart
  parts, and a count of 0 for all four leaves the second refusal `unproven`. Proof, on one line:
  `git diff 46d9d330 HEAD -- <ticket> | grep -c '^-.*the Log says which file; if none'` → 1.

### 2026-11-08, the owner's answer to question 1 (Claude Opus 5.5)

- **Question 1.** Asked by the orchestrator through `AskUserQuestion`; answered 2026-11-08 by
  the owner. Options: 1, refuse both shapes (recommended); 2, one sheet per `XLSX.read`; 1
  and 2 together; 3, accept and document. **Chosen: 1.** The Decision heading reads
  answered, and `status` moves to `ready`. `difficulty` stays `hard`, as the filing rated it
  for option 1.
- The measurements put with the question, on a detached `origin/main` 4a34361d (farm exit
  0, `npm run build` exit 0). The probe files were generated by the ticket's own pasted
  `localname.mts` (`14`, decoy and control) and `comments.mts` (`comments` and `distinct`,
  `14`, `50000`), and match the Reproduction's sizes (294,618 B, 120,025 B). Scripts in
  scratch, not committed.
  - The real workbook's structure, read with Python's `zipfile` from part names, `.rels`
    targets and `docProps/app.xml` only (no cell was read): figures above, under Chosen.
  - `readSheets` inside a `Worker` with `maxOldGenerationSizeMb` 0 (none), 128 and 96, peak
    RSS of the process: decoy-14 494, 477, 495 MB, every run reading all 1,960,000 cells;
    control-14 169, 170, 167; comments-14 437, 441, 441; distinct-14 165, 165, 168; the real
    workbook 129, 134, 127 MB, 14 sheets, 3,513 cells.
  - `XLSX.read` whole, then once per sheet with `sheets: i` (cells dropped, then kept),
    peak RSS and time: decoy-14 321 / 186 / 273 MB, 4.9 / 4.8 / 5.4 s; control-14 137 /
    174 / 179 MB; comments-14 425 / 221 / 239 MB; distinct-14 141 / 146 / 157 MB; the real
    workbook 116 / 117 / 117 MB, 130 / 213 / 238 ms.
- For the builder: the real workbook for Done when 1 is `/workspaces/tools/workbook.xlsx`,
  the owner's, untracked and outside every worktree. Read it in place, never copy it into a
  worktree or a fixture (real bank data never enters the repository), and record only its
  application, its part counts and its sheet and cell counts. If it is gone at build time,
  ask the owner for it.

### 2026-11-10, build (Claude Opus 5.5)

Built option 1 on `lg-104-refuse-shared-parts` from `origin/main` `a100f429`, farmed and
built (both exit 0). The code is commit `08c22e7a`.

- **Build 1, shape (a).** `workbookEntries` compares each entry's local-header name with
  its directory name, byte for byte, at the local header's offset, and refuses a mismatch
  or a header that does not fit as `WORKBOOK_NOT_XLSX`. `compressedOf` compares them again.
  `ZipEntry` gains `rawName`, the name with one character per byte, which is how SheetJS's
  CFB reads it.
- **Build 1, shape (b).** `eachPartReadOnce` in `workbook-parts.ts` is called by
  `refuseUnlessEachSheetIsItsOwn` after the shared-sheet check, before any sheet is
  parsed. For each sheet it counts the sheet's part, its `.rels`, and every part a
  relationship there names. For a chartsheet it also counts each named part's `.rels`,
  what those name, and their `.rels`. It refuses when one part is counted twice, whether
  by two sheets or twice by one. It counts every relationship type, not only comments,
  VML, drawing and chart, so it reads more than SheetJS does. The extra counting can only
  add refusals, and only in a file where two sheets name one part. The refusal message is
  its own: "names one of its parts from more than one place in its sheets".
- **What the brief had wrong, or did not say.** "Two sheets' `.rels` name one part" is not
  the whole shape. SheetJS keys a sheet's relationships by their raw target, so one
  sheet's `.rels` naming one comments part twice in two cases (`../comments1.xml`,
  `../COMMENTS1.xml`) parses it twice. The check counts within a sheet too. A test covers
  it (SheetJS hangs 2 comments on `A1`).
- **The copy was made exact where the new count depends on it, and that found two more
  ways past lg-96's check.** Both are folded in because the new count needs the same
  fixes to be sound:
  - **Part names.** The finder compared targets, which SheetJS decodes one character per
    byte, with directory names decoded as UTF-8. A part whose name is not ASCII was never
    found. For a sheet that meant a refusal, but in the new count it would have been a
    miss. Names are now compared one character per byte, and a `Map` gives each lookup in
    one step.
  - **UTF-16 parts.** SheetJS's `cc2str` reads a part that opens with a UTF-16
    byte-order mark as UTF-16. The copy read it one byte per character, found no tags,
    and treated a UTF-16 workbook `.rels` as empty, so it read the sheets by position.
    Probe `bom.mts` on the base (`a100f429`): SheetJS read `["BIG","BIG"]`,
    `sheetPartsOf` gave `[4,5]`, and `readSheets` read both sheets from the one part. Such
    a part is now "cannot tell". `[Content_Types].xml` and a workbook `.rels` that exist
    and cannot be read are refused, no longer read as empty.
  - **CDATA in a target.** `unescapexml` turns `sheet<![CDATA[1]]>.xml` into `sheet1.xml`,
    and lg-96's `ESCAPED` test did not see it. Probe `cdata.mts` on the base: SheetJS read
    `["P1","P1"]`, `sheetPartsOf` gave `[3,10]`, and `readSheets` read both sheets.
    `unescapexml` and `resolve_path` are now ported. A workbook target is refused when
    the port would change it, which replaces `ESCAPED`. A sheet relationship's target is
    decoded and resolved as SheetJS does, so a hyperlink with `&amp;` is not refused.
- **Tests.** There are 23 new tests in four files, plus two existing tests changed.
  - `xlsx.test.ts`, the describe block "a part SheetJS would read more than once for the
    sheets…": the decoy at 14 sheets and its honest control; comments named by 14 sheets
    and their control; one sheet naming comments twice; five two-sheet variants (an
    entity, a non-ASCII name, VML through `legacyDrawing`, threaded comments, a drawing);
    two chartsheets sharing a chart, with the control; CDATA; UTF-16 `.rels`; a non-ASCII
    sheet part that is read.
  - `workbook-zip.test.ts`, "the name an entry's local header carries": the control, three
    mismatches, and `compressedOf`.
  - `workbook-describe.test.ts`, "a part SheetJS would read for many sheets, through the
    route": both shapes, through Describe and Confirm.
  - `workbook-import.test.ts`, "… through the command": both shapes.
  - Changed: the two existing "forty directory entries over one stored block" tests
    (`workbook-zip.test.ts`, `workbook-describe.test.ts`). Their forty directory names
    over one local header are now refused as shape (a), so all forty now carry the
    header's name. The test still checks the count.
  - The tests use the two shapes at 14 sheets with a small part. The 3.84 MB part and the
    50,000 comments are the probes' to measure (below).
- **Red runs.**
  - The head's four spec files and helper, copied over the base source in a second tree
    at `a100f429`: 20 of 198 failed, every one of them a new test. The three controls
    passed.
  - On the head, with `localNameIs` answering `true`: 7 of 198 failed (the four zip
    tests and the decoy through `readSheets`, the route and the command).
  - With the `eachPartReadOnce` call disabled: 10 of 198 failed (every shape (b) test).
    Each mutation was restored from `08c22e7a`, and `git status` was clean after.
- **Done when 1 and 5, the probes at the head.** The six pasted files were extracted from
  this ticket. `localname.sh <head> <out> 2 14` exit 0. `comments.sh <head> <out> 50000 1 14`
  exit 0. Both `inspect.mts` runs and the comments route run exit 0. All ran under
  `--max-old-space-size=900`, one at a time.

  | File                           | At the head                                          |
  | ------------------------------ | ---------------------------------------------------- |
  | `localname-decoy-2`, reader    | `WORKBOOK_NOT_XLSX`; +0.4 MB; 1 ms                   |
  | `localname-control-2`, reader  | 2 sheets, 140,001 cells; +60.2 MB                    |
  | `localname-decoy-14`, reader   | `WORKBOOK_NOT_XLSX`; +0.0 MB (peak 86.9); 1 ms       |
  | `localname-control-14`, reader | 14 sheets, 140,013 cells; +58.7 MB (peak 143.5)      |
  | `localname-decoy-14`, route    | `WORKBOOK_NOT_XLSX`; +0.0 MB; 5 ms                   |
  | `comments-comments-1`, reader  | 1 sheet, 1 cell; +48.6 MB (one sheet names it: read) |
  | `comments-comments-14`, reader | `WORKBOOK_NOT_XLSX`; +4.7 MB (peak 90.8); 35 ms      |
  | `comments-distinct-14`, reader | 14 sheets, 14 cells; +53.3 MB (peak 134.1)           |
  | `comments-comments-14`, route  | `WORKBOOK_NOT_XLSX`; +6.6 MB (peak 132.4); 74 ms     |

  On the decoy, `inspect.mts` gives `sheetPartsOf threw WORKBOOK_NOT_XLSX`, and SheetJS's
  own full read still makes 14 of 14 sheets the big part. The controls read as the
  Reproduction has them: 140,013 cells and 14 cells.

- **Done when 1, the real workbook.** `/workspaces/tools/workbook.xlsx` was read in place
  and never copied. Only counts were taken; no cell was read into this record. My own
  measurements: `docProps/app.xml` names `Microsoft Excel Online`, AppVersion `16.0300`.
  It has 32 entries, and no local name differs from its directory name (0 of 32). It has
  14 worksheet parts and 0 chartsheets. Parts: 0 comments, 0 threaded comments, 0 VML,
  1 drawing, 1 chart. One sheet has a `.rels`, which names one part, the drawing. The
  drawing's `.rels` names the chart.
  - With both refusals in place, `readSheets` on the head reads 14 sheets and 3,513
    cells. On the base tree at `a100f429` it also reads 14 sheets and 3,513 cells.
  - The second refusal had one part to decide, the drawing, and it passed. The chart is
    reached only through a worksheet's drawing, which the check follows only for a
    chartsheet. So the chartsheet branch is unproven on a real file. Comments and VML are
    unproven on a real file too, since this one has none.
- **Done when 4.** PR #758 merged as `050ce1a4`, an ancestor of the base. On the head,
  `git grep -n "cannot multiply" -- tools/ledger/api/src` exits 1. Build 4 is met by
  #758, and the header is rewritten here to name what lg-104 refuses.
- **Done when 6.** `npm run check` exit 0. `npm test -- --project ledger` exit 0: 2,323 of
  2,323 tests, 99 files, 48 s.
- **Fold-in.** The two copy defects above are folded in. Nothing else was folded. A
  workbook-level multiplier was found and left out: see the next entry.
- **Found, not fixed: one external-link part listed many times.** SheetJS's `parse_ct`
  keeps every `Override` of an external-link type, without removing repeats. `parse_zip`
  then parses each listed link's `.rels`, before even a `bookSheets` read returns. This
  costs time, not memory, since nothing is kept between the parses. Probe `links.mts` on
  the head ran while the ledger suite ran beside it, so the times are high: one link
  `.rels` of 20,000 relationships listed once took 148 ms for `bookSheets` and 229 ms for
  `readSheets`, +40.9 MB. Listed 50 times, it took 10,408 ms and 22,046 ms, +64.7 MB, and
  `readSheets` read the file. It is not a sheet's part, so it falls outside this ticket's
  population. Whether to fix it here or file it is an open decision, handed to the
  orchestrator.

### 2026-11-10, the owner's answer on the external-link listing

- **Question.** SheetJS parses an external-link part's `.rels` once for each time
  `[Content_Types].xml` lists the part. It costs time, not memory, and it is already on
  `main`. Asked by the orchestrator, answered 2026-11-10 by the owner. The options:
  (1) file a ledger ticket, which was the builder's recommendation; (2) fold it into
  lg-104: refuse a repeated `Override` `PartName` before the `bookSheets` read, with a
  test; (3) accept it and record it. **Chosen: (2), fold it in now.** That overrides the
  builder's recommendation.
- **The base measurement put with the question,** taken by the orchestrator. It ran the
  builder's `links.mts` with the head's `xlsx-file.ts` helper over `a100f429`'s
  `readSheets`. Listed once with 20,000 relationships: `bookSheets` 148 ms, `readSheets`
  220 ms, +38.1 MB. Listed 50 times: `bookSheets` 4,829 ms, `readSheets` 13,565 ms,
  +68.6 MB.

### 2026-11-10, the external-link listing, built (Claude Opus 5.5)

- **The refusal, commit `07a1471f`.** `eachPartListedOnce` in `workbook-parts.ts` reads
  `[Content_Types].xml` with the ported tag reader. It refuses a workbook in which two
  `Override` tags name one part. Names are compared as `safegetzipfile` finds a part:
  case does not count, `/` and `\` count as one, and a leading `/` is stripped as
  `strip_front_slash` does. It also refuses two names whose `.rels` would be one part.
  - It applies to every content type, not only external links. The package format gives
    a part one `Override`, and no workbook Excel saves lists one twice.
  - A content-types part that exists and cannot be read is refused.
  - `refuseUnlessEachSheetIsItsOwn` calls it right after `workbookEntries`, before the
    `bookSheets` read. The error is `WORKBOOK_NOT_XLSX`, with the message "lists one of
    its parts more than once". That code fits as it does for the other refusals: the
    file is not a workbook a household saves.
- **Tests,** built by the new helper `listedLinkWorkbook`. Six new tests, all passing at
  `07a1471f`: 204 of 204 across the four spec files.
  - `xlsx.test.ts`, the describe block "a part the content types list more than once is
    refused before SheetJS reads the workbook": a link listed once is read; a link listed
    50 times, in another case, with backslashes, or without the leading `/` is refused.
  - `workbook-describe.test.ts`, "… through the route": refused by Describe and by
    Confirm, nothing asked or written.
  - My first backslash case was wrong, not the code. It turned every `/` into `\`, leading
    one included, and SheetJS strips only a leading `/`, so it would not find that part
    either. The case now drops the leading slash first.
- **Mutation.** With the `eachPartListedOnce` refusal disabled in `xlsx.ts`, 5 of 204
  tests fail: the four refusal cases and the route test. Restored from `07a1471f`, and
  `git status` was clean.
- **`links.mts` on the head (`07a1471f`).** One process at a time, under
  `--max-old-space-size=900`, with nothing else running.
  - Listed once, 20,000 relationships: `bookSheets` 131 ms; `readSheets` read 1 sheet in
    196 ms; +42.6 MB; exit 0.
  - Listed 50 times: `readSheets` refused `WORKBOOK_NOT_XLSX` in 2 ms; exit 0. The probe
    calls `XLSX.read` with `bookSheets` itself before `readSheets`, and that direct call
    still took 4,054 ms. The line's +63.3 MB is that call's too. `readSheets` reaches no
    SheetJS read on this file.
- **The real workbook at `07a1471f`.** Read in place, counts only: 14 sheets and 3,513
  cells, as at the base.

### 2026-11-10, the owner's answer on the corrupt-stream spin

- **Question.** Gate 1 (Sonnet 5.5, FAIL at `2c48efa3`) dropped one item as outside its
  range: `readSheets` spins at 100% CPU, killed at 30 s, on a workbook whose
  `xl/_rels/workbook.xml.rels` is a corrupt deflate stream. It does the same at
  `a100f429` (exit 124), so this branch does not introduce it. The import command reaches
  it, since it does not call `countInflated`; the route does not. The reproduction is the
  gate's `fold-F-wb-rels-corrupt.xlsx` through its `one.mts`. Asked by the orchestrator,
  answered 2026-11-10 by the owner. The options: fold it into lg-104's review round (the
  orchestrator's recommendation); file a ledger ticket; leave it. **Chosen: fold it into
  lg-104's round.** The answer asks for a typed refusal, or a failure bounded to a few
  seconds, through `readSheets` and the import command, with a test that fails or times
  out at `2c48efa3`. It also asks where the spin is, and says to stop if the only fix is
  inside `node_modules/xlsx`.

### 2026-11-10, review round 1 (Claude Opus 5.5)

The round's code is commit `76429ea5`. "Before" means a second tree at `2c48efa3` with
the round's test files and helper copied in, farmed and built (both exit 0), and
removed after.

- **Gate 1's F1 reproduced on `2c48efa3` before any change.** The gate's
  `slash-doubleslash-14` and `slash-leadingslash-14` read 14 sheets in 3,959 ms and
  3,857 ms. `ct-listed-50-shadowed` read in 2,389 ms, against 105 ms listed once.
- **The premise, from SheetJS's source and a reading.** `init_cfb` puts `Root Entry/`
  first and `seed_cfb` a four-byte `\u0001Sh33tJ5` second. `cfb_add` keeps any name not
  starting with `Root Entry/` as `("Root Entry/" + name).replace("//", "/")`.
  `paths.mts` printed SheetJS's `FullPaths` for `/xl/a.xml`, `xl//b.xml`,
  `Root Entry//xl/c.xml`, `//xl//d.xml`, `\u0001Sh33tJ5` and `xl/a.xml`:
  `["Root Entry/","Root Entry/\u0001Sh33tJ5","Root Entry/xl/a.xml","Root Entry/xl/b.xml","Root Entry//xl/c.xml","Root Entry//xl//d.xml","Root Entry/\u0001Sh33tJ5","Root Entry/xl/a.xml"]`.
- **The fix.** `zipOf` in `workbook-parts.ts` keys each entry by `cfbPathOf`, the path
  `cfb_add` keeps. It also seeds the two keys `init_cfb` puts first, the empty name and
  the seed, as "no part", since SheetJS finds those before any zip entry of that name.
  This is gate 1's candidate remedy plus the seed, which the candidate left out.
- **The two texts F1 names, corrected.** The header of `workbook-parts.ts` now says
  the zip is searched under the path `cfb_add` keeps, after the seeded entries. It also
  says the count of reads is as exact as the lookup and no more, since a part the copy
  cannot find is counted as not read, and it records gate 1's +329.5 MB. In
  `workbook-bounds.ts`, "they no longer get here" is replaced: the refusal rests on the
  copy finding each part as SheetJS does, gate 1 read the comments shape past it, and
  the copy, not the cap, keeps them from the cap.
- **The sheet-part variant, built and measured.** It is the new helper
  `storedSlashWorkbook`. One part is stored first as `xl//worksheets/b.xml`. Its
  targets are `worksheets/b.xml`, `/xl/worksheets/b.xml` and `xl/worksheets/b.xml`,
  each with a decoy under the name the old copy's next lookup tried. With `more`, it
  adds one target for each place in `worksheets/b.xml` (not after a `/`) where `xl/`
  can be put and still be taken out by SheetJS's first lookup, which makes 18 sheets.
  The part is 1,400 by 100 numbers. These are `multiplier.mts` reader runs under
  `--max-old-space-size=900`, one at a time:

  | File              | At `2c48efa3`                                                                   | At `76429ea5`                       |
  | ----------------- | ------------------------------------------------------------------------------- | ----------------------------------- |
  | `slashsheet-3`    | read 3 sheets, 420,000 cells; +114.2 MB (peak 211.3); 1,296 ms                  | `WORKBOOK_NOT_XLSX`; +8.6 MB; 75 ms |
  | `slashsheet-more` | `WORKBOOK_TOO_LARGE` `slots`, after the parse; +414.5 MB (peak 499.1); 7,755 ms | `WORKBOOK_NOT_XLSX`; +8.3 MB; 86 ms |

  The gate estimated three to four times by reading. The spellings reach 18, and the
  18-sheet file's parse peaked at 499.1 MB against the 512 MB container before the slots
  cap refused it.

- **The gate's own files, the same runs.**

  | File                          | At `2c48efa3`                          | At `76429ea5`                        |
  | ----------------------------- | -------------------------------------- | ------------------------------------ |
  | `slash-plain-14-50000`        | `WORKBOOK_NOT_XLSX`; +4.9 MB           | `WORKBOOK_NOT_XLSX`; +11.0 MB; 75 ms |
  | `slash-doubleslash-14-50000`  | read 14 sheets; +346.2 MB (peak 430.5) | `WORKBOOK_NOT_XLSX`; +7.8 MB; 75 ms  |
  | `slash-leadingslash-14-50000` | read 14 sheets; +330.9 MB (peak 416.9) | `WORKBOOK_NOT_XLSX`; +9.8 MB; 73 ms  |
  | `slash-triple-14-50000`       | read 14 sheets; +9.8 MB                | read 14 sheets; +12.3 MB             |
  | `ct-listed-50-shadowed`       | read, 1,931 ms                         | `WORKBOOK_NOT_XLSX`, 18 ms           |
  | `ct-listed-once`              | read, 111 ms                           | read, 102 ms                         |

  `triple` is the gate's negative control: SheetJS keeps it under a name no relationship
  asks for. It reads at both heads.

- **The spin, located.** Gate 1's `fold-F-wb-rels-corrupt.xlsx` on `2c48efa3`:
  `XLSX.CFB.read` alone exits 124 at 30 s, and so does `XLSX.read` with `bookSheets`.
  Node's `inflateRawSync` refuses `xl/_rels/workbook.xml.rels` with `Z_DATA_ERROR` in
  3 ms. So the spin is SheetJS's own JavaScript inflate inside its zip read, before any
  code of ours runs.
  - It is fixed in our code, not in `node_modules`. `readSheets` now runs
    `countInflated` over every entry, with no bound, before any SheetJS read. That
    inflates each stream through zlib once, keeps nothing, and refuses one that does not
    inflate as `WORKBOOK_NOT_XLSX`.
  - It costs one more inflate of the file: about 35 ms at the bound by
    `workbook-zip.ts`'s own figure. The route already ran this count against its bound;
    the command now gets the stream check and no bound. The comments-14 refusal went
    from 35 ms (+4.7 MB) to 86 ms (+10.8 MB) through the reader.
  - At `76429ea5`, `fold-F-wb-rels-corrupt.xlsx` through the gate's `one.mts` is refused
    `WORKBOOK_NOT_XLSX` in 7 ms.
- **Regression tests,** all passing on `76429ea5`:
  - `xlsx.test.ts`, describe "a part stored under a name SheetJS's CFB normalises is
    found as SheetJS finds it (lg-104, gate 1)", four tests: comments stored as
    `xl//comments1.xml` and as `/xl/comments1.xml`, each asserting that SheetJS hangs a
    comment on all 14 sheets; `/[Content_Types].xml` before a plain one; the sheet-part
    variant, asserting that SheetJS reads `BIG` for 3 sheets.
  - `xlsx.test.ts`, describe "a deflate stream that does not inflate is refused before
    SheetJS reads it (lg-104)": refused, in under 5 s.
  - `workbook-import.test.ts`, describe "a deflate stream that does not inflate, through
    the command (lg-104)": exit 2, "Only an .xlsx workbook", no books directory.
- **The same tests at `2c48efa3`:** `npx vitest run … -t "CFB normalises"` gave 4 of 4
  failed. The two corrupt-stream tests each hit `timeout -k 5 90` (exit 124). No vitest
  process survived (`ps … | grep -c "[v]itest"` → 0).
- **Re-run at `76429ea5`:**
  - Gate 1's `legit.mts`: the same six lines as gate 1's, the case-only `Override`
    pair still refused.
  - The real workbook, read in place, counts only: 14 sheets, 3,513 cells.
  - `localname.sh 2 14` and `comments.sh … 50000 1 14`, all exit 0: both 14-sheet files
    refused; the controls read 140,013 cells and 14 cells.
  - The four spec files: 210 of 210.
