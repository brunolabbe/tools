/**
 * An `.xlsx` file as the plain cell grids `@ledger/books` reads (lg-7): every
 * kind of cell the reader hands back, written by the test. Nothing here is real.
 */

import { describe, expect, test } from "vitest";
import { readSheets } from "../src/xlsx.ts";
import { SheetWriter, entriesOf, workbookOf, zipOf } from "./helpers/xlsx-file.ts";

function file(build: (sheet: SheetWriter) => void): Buffer {
  const sheet = new SheetWriter("2022");
  build(sheet);
  return workbookOf([sheet]);
}

/**
 * `xlsx` with its first sheet's XML rewritten by `edit`: SheetJS writes neither
 * rich text nor a shared formula, and Excel writes both.
 */
function edited(xlsx: Buffer, edit: (xml: string) => string): Buffer {
  return zipOf(
    entriesOf(xlsx).map((entry) =>
      entry.name === "xl/worksheets/sheet1.xml" && entry.data !== undefined
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
