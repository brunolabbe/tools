---
id: lg-104
tool: ledger
title: A worksheet part SheetJS still parses once per sheet past lg-96's check
kind: fix
status: needs-decision
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
or parse about 350 to 380 MB, against the 512 MB the ledger's production container
gets (`compose.ledger.prod.yaml`, `memory: 512m`). Gate 3 measured +310.3 to +367.5 MB;
the re-run for this ticket measured +313.3 to +379.0 MB (table below).

The owner chose on 2026-11-08 to land lg-96 and file these two as this ticket. lg-96's
own text names lg-104 at its landing head `1aabcb4a`, not at the gated `3b8e95d4`.

The landing head's `workbook-parts.ts` header (line 13 at `1aabcb4a`) says "Distinct
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

## Decision — open

**Who decides:** the owner. Two questions. Question 1 is open. Question 2 is answered.
Gate 3 (Opus 5.5) recommended option 1 of question 1; that recommendation is gate 3's,
recorded here as gate 3's. This ticket does not add one.

**Question 2 — how the ticket carries the probes of its Reproduction.** answered 2026-11-08
by the owner: **(a), paste.** The options were (a) paste the generators into the ticket,
which the filer recommended, (b) commit them as test fixtures, and (c) leave them in
scratch. The pasted files are under "Probe files" in the Reproduction. The full question,
options and choice are in the Log.

**Question 1 — open. What do the two shapes do under the shared-part check?**

1. **Refuse both shapes before the parse (gate 3's recommendation).** Refuse a zip
   whose local-header name differs from the central name of an entry the copy reads
   (in `compressedOf` or `workbookEntries`), and refuse a workbook in which two sheets'
   `.rels` (comments, VML, drawing, chart) name one part. Costs: a second copy of
   SheetJS's rules (`parse_rels` and `resolve_path`), and the observation above says a
   copy has been followed by a new difference each time. The refusal is `WORKBOOK_NOT_XLSX`,
   as lg-96's answer 11 has it for the shared part. Per `workbook-parts.ts`'s own header,
   no workbook Excel saves has either shape.
2. **Parse one sheet per `XLSX.read` (`sheets: i`).** Each shared part is parsed and
   released per sheet, so one part's parse is held at a time. Costs: unmeasured. Time
   grows with the sheet count, about N full inflates for N sheets (up to the sheet
   bound). Built grids still accumulate across sheets, so memory for the built result is
   not closed by this.
3. **Accept and document.** Keep the code. Reword the texts that promise the bound
   (`workbook-parts.ts`'s header, `xlsx.ts`'s `refuseUnlessEachSheetIsItsOwn` comment,
   `workbook-bounds.ts`'s +129 MB figure) to the measured figure and the two shapes
   named. Costs: lg-96's answer 10 rests on "+129 MB the worst built"; restated, a
   crafted upload under 4 MiB takes about 350 to 380 MB of the 512 MB container, and
   the cap is not the bound on it.

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
3. **If 3:** reword the three texts named under option 3 to the measured figure and to
   the two shapes, and record in lg-96's answer 10 that its premise is corrected.
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
   tests.
2. **If 2:** the Log holds the before and after table for both shapes, at 14 sheets and
   at the largest sheet count, with time and peak under `--max-old-space-size=900`. Each
   shape's peak at that count is named, and the built-grid growth is measured, not
   estimated.
3. **If 3:** `git grep -n "Distinct parts cannot multiply"` on the branch matches nothing,
   and the reworded texts name the two shapes and the re-run figure
   (`localname-decoy-14` +379.0 MB; `comments-comments-14` +327.1 MB, or their re-measured
   values at the time).
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
  landing; no change is made here.
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
