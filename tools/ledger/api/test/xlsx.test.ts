/**
 * An `.xlsx` file as the plain cell grids `@ledger/books` reads (lg-7): every
 * kind of cell exceljs hands back, written by the test. Nothing here is real.
 */

import ExcelJS from "exceljs";
import { describe, expect, test } from "vitest";
import { readSheets } from "../src/xlsx.ts";

async function file(build: (sheet: ExcelJS.Worksheet) => void): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  build(book.addWorksheet("2022"));
  return Buffer.from(await book.xlsx.writeBuffer());
}

describe("reading an .xlsx file", () => {
  test("each kind of cell becomes text, a number or a day, with a formula's text beside its saved value", async () => {
    const data = await file((sheet) => {
      sheet.getCell("A1").value = "Versement";
      sheet.getCell("B1").value = 12.5;
      sheet.getCell("C1").value = new Date("2022-03-01T00:00:00.000Z");
      sheet.getCell("C1").numFmt = "yyyy-mm-dd";
      sheet.getCell("D1").value = true;
      sheet.getCell("E1").value = { richText: [{ text: "Dép. " }, { text: "Courantes" }] };
      sheet.getCell("F1").value = { formula: "B1*2", result: 25 };
      sheet.getCell("G1").value = { error: "#REF!" };
      sheet.getCell("H1").value = { text: "un lien", hyperlink: "https://example.test/" };
      sheet.getCell("A2").value = { formula: "B1*2", result: 25 };
      sheet.getCell("A3").value = { sharedFormula: "A2", result: 26 };
      sheet.getCell("B2").value = "   ";
    });

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
    const data = await file((sheet) => {
      sheet.getCell("A1").value = "Alex";
      sheet.mergeCells("A1:B1");
    });

    const [sheet] = await readSheets(data);

    expect(sheet?.rows[0]).toEqual([
      { value: { kind: "text", text: "Alex" }, formula: null },
      null,
    ]);
  });

  test("a file that is not a workbook is refused, with exceljs's reason", async () => {
    await expect(readSheets(Buffer.from("not a zip"))).rejects.toThrow(
      /^The file could not be read as an \.xlsx workbook \(.+\)\.$/u,
    );
  });

  test("a formula saved as 0 or FALSE keeps its value", async () => {
    const data = await file((sheet) => {
      sheet.getCell("A1").value = { formula: "0*1", result: 0 };
      sheet.getCell("B1").value = { formula: "1=2", result: false };
    });

    const [sheet] = await readSheets(data);

    expect(sheet?.rows[0]).toEqual([
      { value: { kind: "number", number: 0 }, formula: "0*1" },
      { value: { kind: "text", text: "FALSE" }, formula: "1=2" },
    ]);
  });
});
