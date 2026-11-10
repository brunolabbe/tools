/**
 * An `.xlsx` file as the plain cell grids `@ledger/books` reads (lg-7): every
 * kind of cell the reader hands back, written by the test. Nothing here is real.
 */

import * as XLSX from "xlsx";
import { describe, expect, test } from "vitest";
import { AppError } from "@ledger/contract";
import { MAX_WORKBOOK_ROWS } from "../src/workbook-bounds.ts";
import { workbookEntries } from "../src/workbook-zip.ts";
import { placesOf, readSheets, rowsOf } from "../src/xlsx.ts";
import {
  SheetWriter,
  commentsPart,
  entriesOf,
  localNameWorkbook,
  packaged,
  relatedWorkbook,
  relationshipType,
  relationshipsPart,
  rewiredWorkbook,
  sharedPartWorkbook,
  textPart,
  workbookOf,
  worksheetRelationship,
  zipOf,
} from "./helpers/xlsx-file.ts";

function file(build: (sheet: SheetWriter) => void): Buffer {
  const sheet = new SheetWriter("2022");
  build(sheet);
  return workbookOf([sheet]);
}

/**
 * `xlsx` with one entry's XML, the first sheet's unless named, rewritten by
 * `edit`: SheetJS writes neither rich text nor a shared formula, and Excel
 * writes both.
 */
function edited(
  xlsx: Buffer,
  edit: (xml: string) => string,
  name = "xl/worksheets/sheet1.xml",
): Buffer {
  return zipOf(
    entriesOf(xlsx).map((entry) =>
      entry.name === name && entry.data !== undefined
        ? { name: entry.name, data: Buffer.from(edit(entry.data.toString("utf8")), "utf8") }
        : entry,
    ),
  );
}

/** The XML of the cell at `address`, replaced whole. */
function cellXml(xml: string, address: string, replacement: string): string {
  const pattern = new RegExp(`<c r="${address}"[^>]*?(/>|>.*?</c>)`, "su");
  if (!pattern.test(xml)) throw new Error(`no cell ${address} in the sheet`);
  return xml.replace(pattern, replacement);
}

describe("reading an .xlsx file", () => {
  test("each kind of cell becomes text, a number or a day, with a formula's text beside its saved value", async () => {
    const written = file((sheet) => {
      sheet.set("A1", "Versement");
      sheet.set("B1", 12.5);
      sheet.set("C1", new Date("2022-03-01T00:00:00.000Z"));
      sheet.set("D1", true);
      sheet.set("E1", "rich text goes here");
      sheet.set("F1", { formula: "B1*2", result: 25 });
      sheet.set("G1", "an error goes here");
      sheet.set("H1", "un lien");
      sheet.set("A2", { formula: "B1*2", result: 25 });
      sheet.set("A3", 0);
      sheet.set("B2", "   ");
    });
    const data = edited(written, (xml) =>
      [
        (x: string) =>
          cellXml(
            x,
            "E1",
            '<c r="E1" t="inlineStr"><is><r><t xml:space="preserve">Dép. </t></r><r><t>Courantes</t></r></is></c>',
          ),
        (x: string) => cellXml(x, "G1", '<c r="G1" t="e"><v>#REF!</v></c>'),
        (x: string) =>
          cellXml(x, "A2", '<c r="A2"><f t="shared" ref="A2:A3" si="0">B1*2</f><v>25</v></c>'),
        (x: string) => cellXml(x, "A3", '<c r="A3"><f t="shared" si="0"/><v>26</v></c>'),
      ].reduce((acc, step) => step(acc), xml),
    );

    const [sheet] = await readSheets(data);

    expect(sheet?.name).toBe("2022");
    expect(sheet?.rows[0]).toEqual([
      { value: { kind: "text", text: "Versement" }, formula: null },
      { value: { kind: "number", number: 12.5 }, formula: null },
      { value: { kind: "date", date: "2022-03-01" }, formula: null },
      { value: { kind: "text", text: "TRUE" }, formula: null },
      { value: { kind: "text", text: "Dép. Courantes" }, formula: null },
      { value: { kind: "number", number: 25 }, formula: "B1*2" },
      { value: { kind: "text", text: "#REF!" }, formula: null },
      { value: { kind: "text", text: "un lien" }, formula: null },
    ]);
    // A blank string is an empty cell; a shared formula keeps its own text.
    expect(sheet?.rows[1]).toEqual([
      { value: { kind: "number", number: 25 }, formula: "B1*2" },
      null,
    ]);
    expect(sheet?.rows[2]?.[0]?.value).toEqual({ kind: "number", number: 26 });
    expect(sheet?.rows[2]?.[0]?.formula).toMatch(/\*2$/u);
  });

  test("a merged cell is read once, at its first part", async () => {
    const data = file((sheet) => {
      sheet.set("A1", "Alex");
      sheet.merge("A1:B1");
    });

    const [sheet] = await readSheets(data);

    // The merge's other part has no place at all (lg-88): the row ends at its
    // one cell, and a reader's `rows[0]?.[1] ?? null` reads the same `null`.
    expect(sheet?.rows[0]).toEqual([{ value: { kind: "text", text: "Alex" }, formula: null }]);
    expect(sheet?.rows[0]?.[1] ?? null).toBeNull();
  });

  test("a file that is not a workbook is refused as the zip check refuses it (lg-96)", async () => {
    // `readSheets` answers for whatever `workbookEntries` refuses, the import command's
    // refusal and the route's the same: it was SheetJS's own reason, as a CSV, before.
    await expect(readSheets(Buffer.from("not a zip"))).rejects.toMatchObject({
      code: "WORKBOOK_NOT_XLSX",
    });
  });

  test("a formula saved as 0 or FALSE keeps its value", async () => {
    const data = file((sheet) => {
      sheet.set("A1", { formula: "0*1", result: 0 });
      sheet.set("B1", { formula: "1=2", result: false });
    });

    const [sheet] = await readSheets(data);

    expect(sheet?.rows[0]).toEqual([
      { value: { kind: "number", number: 0 }, formula: "0*1" },
      { value: { kind: "text", text: "FALSE" }, formula: "1=2" },
    ]);
  });
});

// lg-87: what lg-84's gate found the SheetJS reader got wrong or left unasserted.
describe("reading an .xlsx file, the cases lg-84's gate named (lg-87)", () => {
  /** A one-sheet workbook holding `1` at A1, with `xml` added to its sheet data. */
  function withRows(xml: string): Buffer {
    return edited(
      file((sheet) => {
        sheet.set("A1", 1);
      }),
      (sheet) => sheet.replace("</sheetData>", `${xml}</sheetData>`),
    );
  }

  test.each([
    ["no value at all", '<c r="B1"><f>A1*2</f></c>'],
    ["an empty value", '<c r="B1"><f>A1*2</f><v></v></c>'],
    ["a numeric type and no value", '<c r="B1" t="n"><f>A1*2</f></c>'],
  ])("F1: a formula saved with %s keeps its formula, with no value", async (_what, xml) => {
    const data = edited(
      file((sheet) => {
        sheet.set("A1", 1);
        sheet.set("B1", 0);
      }),
      (sheet) => cellXml(sheet, "B1", xml),
    );

    const [sheet] = await readSheets(data);

    expect(sheet?.rows[0]?.[1]).toEqual({ value: null, formula: "A1*2" });
  });

  test("F3: a date serial names a day from 1, Excel's 29 February 1900 and below 1 naming none", async () => {
    const days = [0, 0.5, 1, 59, 60, 61, 44621, 44621.75, 44621.9999999999];
    const data = file((sheet) => {
      days.forEach((serial, c) => {
        sheet.set(XLSX.utils.encode_cell({ r: 0, c }), serial, "yyyy-mm-dd");
      });
    });

    const [sheet] = await readSheets(data);

    expect(sheet?.rows[0]?.map((cell) => cell?.value ?? null)).toEqual([
      null,
      null,
      { kind: "date", date: "1900-01-01" },
      { kind: "date", date: "1900-02-28" },
      null,
      { kind: "date", date: "1900-03-01" },
      { kind: "date", date: "2022-03-01" },
      { kind: "date", date: "2022-03-01" },
      { kind: "date", date: "2022-03-02" },
    ]);
  });

  test("a workbook on the 1904 system reads its serials from 1904-01-01", async () => {
    const data = edited(
      file((sheet) => {
        sheet.set("A1", 44621 - 1462, "yyyy-mm-dd");
      }),
      (xml) =>
        xml.includes("<workbookPr")
          ? xml.replace(/<workbookPr([^>]*?)\/?>/u, '<workbookPr$1 date1904="1"/>')
          : xml.replace("<sheets>", '<workbookPr date1904="1"/><sheets>'),
      "xl/workbook.xml",
    );

    const [sheet] = await readSheets(data);

    expect(sheet?.rows[0]?.[0]?.value).toEqual({ kind: "date", date: "2022-03-01" });
  });

  test("a zip in another spreadsheet format is refused (lg-96: by the zip check, not by naming the format)", async () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[1]]), "s");
    const ods = XLSX.write(book, { type: "buffer", bookType: "ods" }) as Buffer;

    await expect(readSheets(ods)).rejects.toMatchObject({ code: "WORKBOOK_NOT_XLSX" });
  });

  test("a merge past the last stored row does not extend the sheet (lg-88)", async () => {
    const data = file((sheet) => {
      sheet.set("A1", "Alex");
      sheet.merge("A3:B5");
    });

    const [sheet] = await readSheets(data);

    expect(sheet?.rows).toEqual([[{ value: { kind: "text", text: "Alex" }, formula: null }]]);
  });

  test("F5: a merge over 150 000 rows is read, not a RangeError, and costs no rows (lg-88)", async () => {
    const data = file((sheet) => {
      sheet.set("A1", "Alex");
      sheet.merge("A1:B150000");
    });

    const [sheet] = await readSheets(data);

    expect(sheet?.rows).toHaveLength(1);
    expect(sheet?.rows[0]).toHaveLength(1);
    expect(sheet?.rows[0]?.[0]?.value).toEqual({ kind: "text", text: "Alex" });
  });

  test.each([
    ["a styled empty cell", '<row r="10"><c r="A10" s="0"/></row>'],
    ["an empty inline string", '<row r="2"><c r="A2" t="inlineStr"><is><t></t></is></c></row>'],
    ["an error with no code", '<row r="2"><c r="A2" t="e"/></row>'],
  ])("F8: a trailing row holding only %s is not a row of the sheet", async (_what, xml) => {
    const [sheet] = await readSheets(withRows(xml));

    expect(sheet?.rows).toEqual([[{ value: { kind: "number", number: 1 }, formula: null }]]);
  });
});

// lg-87 gate 1: what its first round left without a test, or open.
describe("a date serial's day, at the ends and in any time zone (lg-87 gate 1)", () => {
  test("a serial past 9999-12-31, or not a number, names no day", async () => {
    // The last two are written as 1 and their saved text replaced: SheetJS's
    // writer turns a NaN or an infinity into an error cell.
    const serials = [2_958_465, 2_958_466, 20_220_301, 1e9, 1, 1];
    const written = file((sheet) => {
      serials.forEach((serial, c) => {
        sheet.set(XLSX.utils.encode_cell({ r: 0, c }), serial, "yyyy-mm-dd");
      });
    });
    const data = edited(written, (xml) =>
      ["E1", "F1"].reduce(
        (acc, address, index) =>
          acc.replace(
            new RegExp(`(<c r="${address}"[^>]*>)<v>1</v>`, "u"),
            `$1<v>${index === 0 ? "NaN" : "1e400"}</v>`,
          ),
        xml,
      ),
    );

    const [sheet] = await readSheets(data);

    expect(sheet?.rows[0]?.map((cell) => cell?.value ?? null)).toEqual([
      { kind: "date", date: "9999-12-31" },
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  test.each([
    ["Pacific/Kiritimati", 34_699, "1994-12-31"],
    ["Pacific/Apia", 40_907, "2011-12-30"],
    ["UTC", 34_699, "1994-12-31"],
  ])("F6: in %s, serial %i is %s", async (zone, serial, day) => {
    // SheetJS's `parse_date_code`, which the reader used before lg-87, went
    // through local time and read both Pacific days one later.
    const was = process.env["TZ"];
    process.env["TZ"] = zone;
    try {
      const data = file((sheet) => {
        sheet.set("A1", serial, "yyyy-mm-dd");
      });

      const [sheet] = await readSheets(data);

      expect(sheet?.rows[0]?.[0]?.value).toEqual({ kind: "date", date: day });
    } finally {
      if (was === undefined) delete process.env["TZ"];
      else process.env["TZ"] = was;
    }
  });
});

// lg-88: what a merged range costs.
describe("a merged range costs no memory of its own (lg-88)", () => {
  test("a merge of A1:XFD1000 holds no places, whatever its area (lg-88)", async () => {
    const data = file((sheet) => {
      sheet.set("A1", "Alex");
      sheet.merge("A1:XFD1000");
    });

    const [sheet] = await readSheets(data);

    // 16 384 columns by 1 000 rows was +484 MB of memory from a 16 KB file; the
    // measurement is in lg-88's Log, since a test of memory measures the machine.
    expect(sheet?.rows.flat()).toHaveLength(1);
  });

  test("a value stored inside a merge is read as an ordinary cell (lg-88)", async () => {
    // LibreOffice's "keep the contents of the hidden cells" writes one; the
    // brief's decision was to read it, not to drop it.
    const data = file((sheet) => {
      sheet.set("B2", "Alex");
      sheet.set("B3", "Dépôt");
      sheet.merge("B2:B4");
    });

    const [sheet] = await readSheets(data);

    expect(sheet?.rows[1]?.[1]?.value).toEqual({ kind: "text", text: "Alex" });
    expect(sheet?.rows[2]?.[1]?.value).toEqual({ kind: "text", text: "Dépôt" });
  });
});

// lg-96: what a stored address costs.
describe("a sheet's extent is bounded before its grid is built (lg-96)", () => {
  /** The refusal `readSheets` raises, or `undefined` for a file it reads. */
  async function refusal(data: Buffer): Promise<AppError | undefined> {
    try {
      await readSheets(data);
    } catch (error: unknown) {
      if (error instanceof AppError) return error;
      throw error;
    }
    return undefined;
  }

  /** `rows` rows of a sheet, the first holding `A1`, each holding a cell in `letters`. */
  function column(name: string, letters: string, rows: number): SheetWriter {
    const sheet = new SheetWriter(name);
    sheet.set("A1", "Alex");
    for (let r = 1; r <= rows; r += 1) sheet.set(`${letters}${String(r)}`, "far");
    return sheet;
  }

  test("case 1: a cell below the last row the import reads is refused as rows, whatever the file's size", async () => {
    // The Reproduction's A1048576 was +62 MB from a 15 909-byte file; the first row
    // over the bound is the same refusal, and a cheaper file to write here.
    const over = file((sheet) => {
      sheet.set("A1", "Alex");
      sheet.set(`A${String(MAX_WORKBOOK_ROWS + 1)}`, "far");
    });

    const error = await refusal(over);

    expect(error?.code).toBe("WORKBOOK_TOO_LARGE");
    expect(error?.details).toEqual({ bound: "rows" });
  });

  test("the last row the bound admits is read", async () => {
    const [sheet] = await readSheets(
      file((each) => {
        each.set("A1", "Alex");
        each.set(`A${String(MAX_WORKBOOK_ROWS)}`, "far");
      }),
    );

    expect(sheet?.rows).toHaveLength(MAX_WORKBOOK_ROWS);
    expect(sheet?.rows[MAX_WORKBOOK_ROWS - 1]?.[0]?.value).toEqual({ kind: "text", text: "far" });
  });

  test("a stub below the last row that holds a value is no row", async () => {
    const address = `A${String(MAX_WORKBOOK_ROWS + 1)}`;
    const data = file((sheet) => {
      sheet.set("A1", "Alex");
      sheet.set(address, "far");
    });
    // The far cell rewritten as a stub, which `holds` is false for.
    const stubbed = edited(data, (xml) => cellXml(xml, address, `<c r="${address}"/>`));

    const [sheet] = await readSheets(stubbed);

    expect(sheet?.rows).toHaveLength(1);
  });

  test("the stub tail is never built, not only absent from the rows (gate 1's F1)", () => {
    // `!data` as SheetJS leaves it with `sheetStubs`: a stub at the last row makes it as
    // long as the address says (here 1 000 rows; the measured file said 1 048 576, +77.8
    // MB through `readSheets` and +633.9 MB over 40 entries). The array is watched for
    // the rows the build reads: it must read the stored one and no other.
    const rows: XLSX.CellObject[][] = Array.from({ length: 1_000 }, () => []);
    rows[0] = [{ t: "s", v: "Alex" }];
    rows[999] = [{ t: "z" }];
    const read: string[] = [];
    const watched = new Proxy(rows, {
      get(target, key, receiver) {
        if (typeof key === "string" && /^\d+$/u.test(key)) read.push(key);
        return Reflect.get(target, key, receiver) as unknown;
      },
    });
    const sheet = { "!data": watched } as unknown as XLSX.DenseSheet;

    const extent = placesOf(sheet, 0);
    read.length = 0;
    const built = rowsOf(sheet, extent.widths, false);

    expect(extent.widths).toEqual([1]);
    expect(built).toHaveLength(1);
    expect(read).toEqual(["0"]);
  });

  test("the walk of a stub tail costs its stored rows, not its length (gate 2's F3)", () => {
    // A stub at A1048576 makes `!data` a million long with two rows in it, and at XFD makes a
    // row 16 384 long with two cells: 400 sheets of the first took 19.6 s through `readSheets`
    // when `placesOf` walked the length, `forEach` included (37.8 ms a sheet against 42.6).
    // A Proxy counts the indices asked about: `entries()` and `forEach` ask for every one.
    let asked = 0;
    const counted = <T extends object>(target: T): T =>
      new Proxy(target, {
        has(at, key) {
          if (typeof key === "string" && /^\d+$/u.test(key)) asked += 1;
          return Reflect.has(at, key);
        },
        get(at, key, receiver) {
          if (typeof key === "string" && /^\d+$/u.test(key)) asked += 1;
          return Reflect.get(at, key, receiver) as unknown;
        },
      });
    const wide: XLSX.CellObject[] = [];
    wide[0] = { t: "s", v: "Alex" };
    wide[16_383] = { t: "z" };
    const rows: XLSX.CellObject[][] = [];
    rows[0] = counted(wide);
    rows[1_048_575] = [{ t: "z" }];
    const sheet = { "!data": counted(rows) } as unknown as XLSX.DenseSheet;

    const extent = placesOf(sheet, 0);

    expect(extent.widths).toEqual([1]);
    expect(asked).toBeLessThan(10);
  });

  test("case 4: a far column in every row is refused as slots, at the first row past the cap", async () => {
    // 122 rows of 16 384 places are 1 998 848 slots, 123 are 2 015 232.
    expect(await refusal(workbookOf([column("2022", "XFD", 122)]))).toBeUndefined();

    const error = await refusal(workbookOf([column("2022", "XFD", 123)]));

    expect(error?.code).toBe("WORKBOOK_TOO_LARGE");
    expect(error?.details).toEqual({ bound: "slots" });
  });

  test("case 4's control: 4 000 rows at column B read unchanged", async () => {
    const [sheet] = await readSheets(workbookOf([column("2022", "B", 4_000)]));

    const far = { value: { kind: "text", text: "far" }, formula: null };
    expect(sheet?.rows).toHaveLength(4_000);
    expect(sheet?.rows[0]).toEqual([{ value: { kind: "text", text: "Alex" }, formula: null }, far]);
    expect(sheet?.rows[3_999]).toEqual([null, far]);
  });

  test("the slots are one running total across the workbook's sheets, not one per sheet", async () => {
    // 70 rows at XFD is 1 146 880 slots: under the cap alone, over it twice.
    expect(await refusal(workbookOf([column("2022", "XFD", 70)]))).toBeUndefined();

    const error = await refusal(workbookOf([column("2022", "XFD", 70), column("2023", "XFD", 70)]));

    expect(error?.code).toBe("WORKBOOK_TOO_LARGE");
    expect(error?.details).toEqual({ bound: "slots" });
  });

  test("case 5: one part listed under many sheets is refused before it is parsed, whatever the far cell", async () => {
    // Two entries at A1 and A19000 are 38 000 slots, far under the cap and every
    // row bound: it is the sharing that is refused, so before any sheet is charged.
    expect(await refusal(sharedPartWorkbook(1, "A19000"))).toBeUndefined();

    const error = await refusal(sharedPartWorkbook(2, "A19000"));

    expect(error?.code).toBe("WORKBOOK_NOT_XLSX");
    expect(error?.message).toContain("does not give each of its sheets a part of its own");
    expect((await refusal(sharedPartWorkbook(40, "A100000")))?.code).toBe("WORKBOOK_NOT_XLSX");
  });

  test.each([
    [
      "an absolute target",
      (n: string) => (Number(n) % 2 === 0 ? "/xl/worksheets/sheet1.xml" : "worksheets/sheet1.xml"),
    ],
    [
      "a target in another case",
      (n: string) => (Number(n) % 2 === 0 ? "Worksheets/SHEET1.xml" : "worksheets/sheet1.xml"),
    ],
    [
      "a target with an xl/ prefix",
      (n: string) => (Number(n) % 2 === 0 ? "xl/worksheets/sheet1.xml" : "worksheets/sheet1.xml"),
    ],
  ])("a shared part under %s is still shared", async (_what, target) => {
    const shared = sharedPartWorkbook(2, "A2", target);
    // SheetJS itself reads the one part under both sheets, so the refusal is not of a
    // spelling it would have told apart.
    const parsed = XLSX.read(shared, { type: "buffer" });
    expect(parsed.SheetNames).toEqual(["S1", "S2"]);
    expect(Object.keys(parsed.Sheets["S2"] ?? {})).toContain("A2");

    const error = await refusal(shared);

    expect(error?.code).toBe("WORKBOOK_NOT_XLSX");
  });

  test("sheets that each have a part of their own are not shared, however many", async () => {
    const sheets = Array.from({ length: 12 }, (_, i) => column(`S${String(i)}`, "B", 3));

    expect(await refusal(workbookOf(sheets))).toBeUndefined();
  });

  test("the slots run across distinct parts too: 105 sheets of A1 and A19000 are read, 106 refused as slots", async () => {
    // 19 000 slots a sheet, a gap row a slot of its own: 105 sheets are 1 995 000 and 106
    // are 2 014 000. Every sheet is under `MAX_WORKBOOK_ROWS`, so only the total stops it.
    const sheets = (count: number): SheetWriter[] =>
      Array.from({ length: count }, (_, i) => {
        const sheet = new SheetWriter(`S${String(i)}`);
        sheet.set("A1", "Alex");
        sheet.set("A19000", "far");
        return sheet;
      });
    // The boundary on both sides (gate 2's N2): the most the cap admits is read whole.
    expect(await readSheets(workbookOf(sheets(105)))).toHaveLength(105);

    const error = await refusal(workbookOf(sheets(106)));

    expect(error?.code).toBe("WORKBOOK_TOO_LARGE");
    expect(error?.details).toEqual({ bound: "slots" });
  });

  test("a row wide on its own costs its own width, not the product of rows and the widest", async () => {
    // Rows times the widest column would be 3 000 x 702, 2.1 million: over the cap.
    const data = file((sheet) => {
      sheet.set("ZZ1", "far");
      for (let r = 2; r <= 3_000; r += 1) sheet.set(`A${String(r)}`, "x");
    });

    const [sheet] = await readSheets(data);

    expect(sheet?.rows).toHaveLength(3_000);
  });
});

// lg-96, gate 2's F2: the sheets are counted by SheetJS itself and the copy of its rules can
// only refuse, so a spelling the copy does not know is a refusal and not a way in.
describe("a workbook that does not give each sheet a part of its own is refused before any sheet is parsed (lg-96)", () => {
  const SHEETS = `<sheet name="S1" sheetId="1" r:id="dup1"/><sheet name="S2" sheetId="2" r:id="dup2"/>`;
  const FIRST = worksheetRelationship("dup1", "worksheets/sheet1.xml");
  const SECOND = (target: string): string => worksheetRelationship("dup2", target);

  async function refusal(data: Buffer): Promise<AppError | undefined> {
    try {
      await readSheets(data);
    } catch (error: unknown) {
      if (error instanceof AppError) return error;
      throw error;
    }
    return undefined;
  }

  /** How many sheets SheetJS itself reads `P1` into: 2 when it reads one part for two. */
  function readsOnePartTwice(bytes: Buffer): number {
    const book = XLSX.read(bytes, { type: "buffer", dense: true });
    return book.SheetNames.filter(
      (name) => (book.Sheets[name] as XLSX.DenseSheet | undefined)?.["!data"]?.[0]?.[0]?.v === "P1",
    ).length;
  }

  /** The one sheet's part as the writer wrote it, to name under a second spelling. */
  function partOf(): Buffer {
    const sheet = new SheetWriter("S");
    sheet.set("A1", "P1");
    const part = entriesOf(workbookOf([sheet])).find((e) => e.name === "xl/worksheets/sheet1.xml");
    if (part?.data === undefined) throw new Error("no sheet part");
    return part.data;
  }

  // Gate 2's seven spellings, each of which SheetJS reads as two sheets over one part and
  // the round 1 copy did not know: `sharedSheetPart` answered `undefined` for every one.
  test.each([
    [
      "a numeric entity",
      { sheets: SHEETS, relationships: FIRST + SECOND("worksheets/sheet&#49;.xml") },
    ],
    [
      "a hex entity",
      { sheets: SHEETS, relationships: FIRST + SECOND("&#x77;orksheets/sheet1.xml") },
    ],
    [
      "an _x0031_ code",
      { sheets: SHEETS, relationships: FIRST + SECOND("worksheets/sheet_x0031_.xml") },
    ],
    [
      "a > inside a quoted sheet name",
      {
        sheets: `<sheet name="S1" sheetId="1" r:id="dup1"/><sheet name="a>b" sheetId="2" r:id="dup2"/>`,
        relationships: FIRST + SECOND("worksheets/sheet1.xml"),
      },
    ],
    [
      "an empty r:id beside strRelID",
      {
        sheets: `<sheet name="S1" sheetId="1" r:id="dup1"/><sheet name="S2" sheetId="2" r:id="" strRelID="dup2"/>`,
        relationships: FIRST + SECOND("worksheets/sheet1.xml"),
      },
    ],
    [
      "sheets with no id beside a relationship Id of undefined",
      {
        sheets: `<sheet name="S1" sheetId="1"/><sheet name="S2" sheetId="2"/>`,
        relationships: worksheetRelationship("undefined", "worksheets/sheet1.xml"),
      },
    ],
    [
      "a <sheet followed by a tab, which SheetJS does not count",
      {
        sheets: `<sheet\tname="X" sheetId="9" r:id="nope"/>${SHEETS}`,
        relationships: FIRST + SECOND("worksheets/sheet1.xml"),
      },
    ],
  ])("%s: SheetJS reads one part twice and the workbook is refused", async (_what, rewiring) => {
    const bytes = rewiredWorkbook(rewiring);

    expect(readsOnePartTwice(bytes)).toBe(2);
    const error = await refusal(bytes);

    expect(error?.code).toBe("WORKBOOK_NOT_XLSX");
  });

  test("a part under a name of its own that SheetJS decodes to another part's is still refused", async () => {
    // The copy cannot see the decoding, so a part named to look distinct to it must not pass:
    // `sheet&#49;.xml` exists as a part of its own, and SheetJS reads `sheet1.xml` for it.
    const bytes = rewiredWorkbook({
      sheets: SHEETS,
      relationships: FIRST + SECOND("worksheets/sheet&#49;.xml"),
      extra: [{ name: "xl/worksheets/sheet&#49;.xml", data: partOf() }],
    });

    expect(readsOnePartTwice(bytes)).toBe(2);
    expect((await refusal(bytes))?.code).toBe("WORKBOOK_NOT_XLSX");
  });

  test.each([
    [
      "a workbook part spelled XL/Workbook.xml",
      {
        sheets: SHEETS,
        relationships: FIRST + SECOND("worksheets/sheet1.xml"),
        rename: { "xl/workbook.xml": "XL/Workbook.xml" },
      },
    ],
    [
      "a workbook part renamed through its content type, with a > in the Override",
      {
        sheets: SHEETS,
        relationships: FIRST + SECOND("worksheets/sheet1.xml"),
        contentTypes: (xml: string) =>
          xml.replace(
            /<Override PartName="\/xl\/workbook\.xml"/u,
            '<Override X="a>b" PartName="/xl/wb2.xml"',
          ),
        rename: {
          "xl/workbook.xml": "xl/wb2.xml",
          "xl/_rels/workbook.xml.rels": "xl/_rels/wb2.xml.rels",
        },
      },
    ],
  ])("%s: whatever the zip check refuses, the reader refuses (gate 2)", async (_what, rewiring) => {
    const bytes = rewiredWorkbook(rewiring);
    // SheetJS reads it, as two sheets over one part: only the zip check stands in the way.
    expect(readsOnePartTwice(bytes)).toBe(2);
    expect(() => workbookEntries(bytes)).toThrow();

    expect((await refusal(bytes))?.code).toBe("WORKBOOK_NOT_XLSX");
  });

  test("N1: a relationship tag followed by a tab is no relationship to SheetJS, and the workbook is refused all the same", async () => {
    // SheetJS ignores both relationships, reads the sheets by position and finds one
    // `sheet1.xml`; the second sheet has no part. Refused either way: for a shared part
    // by the round 1 copy, which took the tab, and for a missing part by this one.
    const bytes = rewiredWorkbook({
      sheets: SHEETS,
      relationships:
        worksheetRelationship("dup1", "worksheets/sheet1.xml", "\t") +
        worksheetRelationship("dup2", "worksheets/sheet1.xml", "\t"),
    });

    expect(readsOnePartTwice(bytes)).toBe(1);
    expect((await refusal(bytes))?.code).toBe("WORKBOOK_NOT_XLSX");
  });

  test("a sheet that resolves to no part is refused, not skipped", async () => {
    const bytes = rewiredWorkbook({
      sheets: SHEETS,
      relationships: FIRST + SECOND("worksheets/missing.xml"),
    });

    expect(readsOnePartTwice(bytes)).toBe(1);
    expect((await refusal(bytes))?.code).toBe("WORKBOOK_NOT_XLSX");
  });

  test("sheets with no relationship at all are read by position, each from a part of its own", async () => {
    const first = new SheetWriter("2022");
    first.set("A1", "Alex");
    const second = new SheetWriter("2023");
    second.set("A1", "Sam");
    const bare = zipOf(
      entriesOf(workbookOf([first, second])).map((entry) => {
        if (entry.data === undefined) return entry;
        const xml = entry.data.toString("utf8");
        if (entry.name === "xl/workbook.xml") {
          return { name: entry.name, data: Buffer.from(xml.replaceAll(/ r:id="[^"]*"/gu, "")) };
        }
        if (entry.name === "xl/_rels/workbook.xml.rels") {
          return {
            name: entry.name,
            data: Buffer.from(xml.replaceAll(/<Relationship [^>]*worksheet[^>]*\/>/gu, "")),
          };
        }
        return entry;
      }),
    );

    const sheets = await readSheets(bare);

    expect(sheets.map((sheet) => sheet.name)).toEqual(["2022", "2023"]);
    expect(sheets[1]?.rows[0]?.[0]?.value).toEqual({ kind: "text", text: "Sam" });
  });

  test("the sheet list is read by SheetJS without parsing a sheet: the call the check rests on", () => {
    // `bookSheets` returns the names and no `Sheets`; the check calls it before any parse. If a
    // SheetJS upgrade made it parse, the check would cost what it exists to prevent.
    const bytes = workbookOf([new SheetWriter("2022"), new SheetWriter("2023")]);

    const listed = XLSX.read(bytes, { type: "buffer", bookSheets: true });

    expect(listed.SheetNames).toEqual(["2022", "2023"]);
    expect(listed.Sheets).toBeUndefined();
  });
});

// lg-104: SheetJS reads, for each sheet, more than its part: the sheet's `.rels` and what
// they name, and it finds every part by the name in the entry's local header. A part
// reached twice that way is parsed twice, past every bound, so it is refused first.
describe("a part SheetJS would read more than once for the sheets is refused before any sheet is parsed (lg-104)", () => {
  const SHARED = "names one of its parts from more than one place in its sheets";

  async function refusal(data: Buffer): Promise<AppError | undefined> {
    try {
      await readSheets(data);
    } catch (error: unknown) {
      if (error instanceof AppError) return error;
      throw error;
    }
    return undefined;
  }

  /** SheetJS's own read: each sheet's `A1`, and how many comments it hangs on it. */
  function sheetJs(bytes: Buffer): { text: unknown; comments: number }[] {
    const book = XLSX.read(bytes, { type: "buffer", dense: true });
    return book.SheetNames.map((name) => {
      const cell = (book.Sheets[name] as XLSX.DenseSheet | undefined)?.["!data"]?.[0]?.[0];
      return { text: cell?.v, comments: cell?.c?.length ?? 0 };
    });
  }

  const comments = (target: string, id = "c1"): string =>
    `<Relationship Id="${id}" Type="${relationshipType("comments")}" Target="${target}"/>`;

  test("the local-name decoy: 14 sheets that SheetJS reads from one part are refused, by the zip check", async () => {
    const bytes = localNameWorkbook(14, textPart("BIG"));

    expect(sheetJs(bytes).filter((sheet) => sheet.text === "BIG")).toHaveLength(14);
    expect(() => workbookEntries(bytes)).toThrow(AppError);
    expect((await refusal(bytes))?.code).toBe("WORKBOOK_NOT_XLSX");
  });

  test("the decoy's honest control, every local name its directory name, is read: the big part once", async () => {
    const bytes = localNameWorkbook(14, textPart("BIG"), true);

    const sheets = await readSheets(bytes);

    expect(sheets).toHaveLength(14);
    expect(sheets.filter((sheet) => sheet.rows[0]?.[0]?.value?.kind === "text")).toHaveLength(14);
    expect(
      sheets.filter(
        (sheet) => JSON.stringify(sheet.rows[0]?.[0]?.value) === '{"kind":"text","text":"BIG"}',
      ),
    ).toHaveLength(1);
  });

  test("one comments part named by 14 sheets' .rels, which SheetJS parses for each, is refused", async () => {
    const bytes = relatedWorkbook(14, () => comments("../comments1.xml"), [
      { name: "xl/comments1.xml", data: commentsPart(200) },
    ]);

    expect(sheetJs(bytes).filter((sheet) => sheet.comments === 1)).toHaveLength(14);
    const error = await refusal(bytes);

    expect(error?.code).toBe("WORKBOOK_NOT_XLSX");
    expect(error?.message).toContain(SHARED);
  });

  test("the comments control, a part of its own for each of 14 sheets, is read", async () => {
    const bytes = relatedWorkbook(
      14,
      (n) => comments(`../comments${n}.xml`),
      Array.from({ length: 14 }, (_, i) => ({
        name: `xl/comments${String(i + 1)}.xml`,
        data: commentsPart(14),
      })),
    );

    expect(await readSheets(bytes)).toHaveLength(14);
  });

  test("one comments part named twice in one sheet's .rels, spelled in two cases, which SheetJS parses twice, is refused", async () => {
    const bytes = relatedWorkbook(
      1,
      () => comments("../comments1.xml") + comments("../COMMENTS1.xml", "c2"),
      [{ name: "xl/comments1.xml", data: commentsPart(1) }],
    );

    expect(sheetJs(bytes)[0]?.comments).toBe(2);
    expect((await refusal(bytes))?.message).toContain(SHARED);
  });

  const VML = "../drawings/vmlDrawing1.vml";
  test.each([
    [
      "a comments target spelled with an entity, which SheetJS decodes",
      (n: string) => comments(n === "1" ? "../comments1.xml" : "../comments&#49;.xml"),
      [{ name: "xl/comments1.xml", data: commentsPart(1) }],
      () => "",
    ],
    [
      "a comments part whose name is not ASCII, found as SheetJS finds it",
      () => comments("../commentés.xml"),
      [{ name: "xl/commentés.xml", data: commentsPart(1) }],
      () => "",
    ],
    [
      "one VML drawing, read through each sheet's legacyDrawing",
      () => `<Relationship Id="v1" Type="${relationshipType("vmlDrawing")}" Target="${VML}"/>`,
      [{ name: "xl/drawings/vmlDrawing1.vml", data: Buffer.from("<xml/>") }],
      () => '<legacyDrawing r:id="v1"/>',
    ],
    [
      "one threaded comments part",
      () =>
        `<Relationship Id="t1" Type="http://schemas.microsoft.com/office/2017/10/relationships/threadedComment" Target="../threadedComments/threadedComment1.xml"/>`,
      [
        {
          name: "xl/threadedComments/threadedComment1.xml",
          data: Buffer.from("<ThreadedComments/>"),
        },
      ],
      () => "",
    ],
    [
      "one drawing, of a kind SheetJS does not parse for a worksheet: every type is counted",
      () =>
        `<Relationship Id="d1" Type="${relationshipType("drawing")}" Target="../drawings/drawing1.xml"/>`,
      [{ name: "xl/drawings/drawing1.xml", data: Buffer.from("<xdr:wsDr/>") }],
      () => "",
    ],
  ])("two sheets naming %s are refused", async (_what, relationships, extra, more) => {
    const bytes = relatedWorkbook(2, relationships, extra, more);

    expect((await refusal(bytes))?.message).toContain(SHARED);
  });

  test("two chartsheets whose drawings name one chart are refused; a chart each is read", async () => {
    const chartsheets = (chart: (n: string) => string): Buffer => {
      const ids = ["1", "2"];
      return packaged(
        ids.map((n) => ({ target: `chartsheets/sheet${n}.xml`, kind: "chartsheet" })),
        ids.flatMap((n) => [
          {
            name: `xl/chartsheets/sheet${n}.xml`,
            data: Buffer.from(
              `<chartsheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><drawing r:id="d1"/></chartsheet>`,
            ),
          },
          {
            name: `xl/chartsheets/_rels/sheet${n}.xml.rels`,
            data: relationshipsPart(
              `<Relationship Id="d1" Type="${relationshipType("drawing")}" Target="../drawings/drawing${n}.xml"/>`,
            ),
          },
          { name: `xl/drawings/drawing${n}.xml`, data: Buffer.from('<c:chart r:id="c1"/>') },
          {
            name: `xl/drawings/_rels/drawing${n}.xml.rels`,
            data: relationshipsPart(
              `<Relationship Id="c1" Type="${relationshipType("chart")}" Target="../charts/${chart(n)}"/>`,
            ),
          },
          { name: `xl/charts/chart${n}.xml`, data: Buffer.from("<c:chartSpace/>") },
        ]),
      );
    };

    expect((await refusal(chartsheets(() => "chart1.xml")))?.message).toContain(SHARED);
    expect(await refusal(chartsheets((n) => `chart${n}.xml`))).toBeUndefined();
  });

  // Found while building lg-104: two more spellings lg-96's check read as two parts,
  // each of which SheetJS reads as one part for both sheets.
  test("a workbook relationship target with a CDATA section, which SheetJS decodes, is refused", async () => {
    const target = "worksheets/sheet<![CDATA[1]]>.xml";
    const bytes = rewiredWorkbook({
      sheets: `<sheet name="S1" sheetId="1" r:id="dup1"/><sheet name="S2" sheetId="2" r:id="dup2"/>`,
      relationships:
        worksheetRelationship("dup1", "worksheets/sheet1.xml") +
        worksheetRelationship("dup2", target),
      extra: [{ name: `xl/${target}`, data: textPart("OTHER") }],
    });

    expect(sheetJs(bytes).map((sheet) => sheet.text)).toEqual(["P1", "P1"]);
    expect((await refusal(bytes))?.code).toBe("WORKBOOK_NOT_XLSX");
  });

  test("a workbook .rels saved as UTF-16, which SheetJS decodes and a byte-to-a-character reading does not, is refused", async () => {
    const relationships =
      worksheetRelationship("rId1", "worksheets/big.xml") +
      worksheetRelationship("rId2", "worksheets/big.xml");
    const text = relationshipsPart(relationships).toString("utf8");
    const bytes = packaged(
      [{ target: "worksheets/sheet1.xml" }, { target: "worksheets/sheet2.xml" }],
      [
        { name: "xl/worksheets/sheet1.xml", data: textPart("tiny1") },
        { name: "xl/worksheets/sheet2.xml", data: textPart("tiny2") },
        { name: "xl/worksheets/big.xml", data: textPart("BIG") },
      ],
    );
    const utf16 = zipOf(
      entriesOf(bytes).map((entry) =>
        entry.name === "xl/_rels/workbook.xml.rels"
          ? {
              name: entry.name,
              data: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]),
            }
          : entry,
      ),
    );

    expect(sheetJs(utf16).map((sheet) => sheet.text)).toEqual(["BIG", "BIG"]);
    expect((await refusal(utf16))?.code).toBe("WORKBOOK_NOT_XLSX");
  });

  test("a sheet whose part name is not ASCII is found as SheetJS finds it, and read", async () => {
    const bytes = packaged(
      [{ target: "worksheets/feuillé.xml" }],
      [{ name: "xl/worksheets/feuillé.xml", data: textPart("P1") }],
    );

    const [sheet] = await readSheets(bytes);

    expect(sheet?.rows[0]?.[0]?.value).toEqual({ kind: "text", text: "P1" });
  });
});
