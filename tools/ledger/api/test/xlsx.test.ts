/**
 * An `.xlsx` file as the plain cell grids `@ledger/books` reads (lg-7): every
 * kind of cell the reader hands back, written by the test. Nothing here is real.
 */

import * as XLSX from "xlsx";
import { describe, expect, test } from "vitest";
import { readSheets } from "../src/xlsx.ts";
import { SheetWriter, entriesOf, workbookOf, zipOf } from "./helpers/xlsx-file.ts";

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

    expect(sheet?.rows[0]).toEqual([
      { value: { kind: "text", text: "Alex" }, formula: null },
      null,
    ]);
  });

  test("a file that is not a workbook is refused, with the reader's reason", async () => {
    await expect(readSheets(Buffer.from("not a zip"))).rejects.toThrow(
      /^The file could not be read as an \.xlsx workbook \(.+\)\.$/u,
    );
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

  test("a zip in another spreadsheet format is refused, naming the format", async () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[1]]), "s");
    const ods = XLSX.write(book, { type: "buffer", bookType: "ods" }) as Buffer;

    await expect(readSheets(ods)).rejects.toThrow(
      "The file could not be read as an .xlsx workbook (ods, not xlsx).",
    );
  });

  test("a merge past the last stored row holds its places to its own end", async () => {
    const data = file((sheet) => {
      sheet.set("A1", "Alex");
      sheet.merge("A3:B5");
    });

    const [sheet] = await readSheets(data);

    expect(sheet?.rows).toHaveLength(5);
    expect(sheet?.rows[1]).toEqual([]);
    expect(sheet?.rows[2]).toEqual([null, null]);
    expect(sheet?.rows[4]).toEqual([null, null]);
  });

  test("F5: a merge over 150 000 rows is read, not a RangeError", async () => {
    const data = file((sheet) => {
      sheet.set("A1", "Alex");
      sheet.merge("A1:B150000");
    });

    const [sheet] = await readSheets(data);

    expect(sheet?.rows).toHaveLength(150_000);
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
