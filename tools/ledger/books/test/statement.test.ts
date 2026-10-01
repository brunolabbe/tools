import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { AppError } from "@ledger/contract";
import { parseStatement } from "../src/index.ts";

/**
 * Three months, 12 rows, a four-row same-day group on 12 September. Synthetic
 * end to end: invented caisse, lender and amounts, the real shape. Newest first,
 * as AccèsD lists it.
 */
const THREE_MONTHS = readFileSync(new URL("./fixtures/three-months.txt", import.meta.url), "utf8");

function failure(text: string): AppError {
  try {
    parseStatement(text);
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("expected parseStatement to throw, and it returned");
}

/** One edit, which must land exactly once — an edit that missed would prove nothing. */
function edit(text: string, from: string, to: string): string {
  expect(text.split(from), `"${from}" should occur exactly once`).toHaveLength(2);
  return text.replace(from, () => to);
}

/** 1-based number of the first line containing `needle`. */
function lineOf(text: string, needle: string): number {
  const index = text.split("\n").findIndex((line) => line.includes(needle));
  expect(index, `a line containing "${needle}"`).toBeGreaterThanOrEqual(0);
  return index + 1;
}

/** A one-row, one-month paste, for the cases that are about a single field. */
function onePaste(options: {
  abbreviation?: string;
  name?: string;
  amount: string;
  balance: string;
  total?: string;
}): string {
  const name = options.name ?? "Septembre";
  const amount = options.amount;
  return [
    `${name} 2026`,
    "Date\tDescription\tMontant\tSolde\tlien",
    `12 ${options.abbreviation ?? "SEP"}12 ${name}`,
    "Virements",
    "Virement entre folios /Caisse du Lac",
    "",
    `${amount}\t${options.balance}\t`,
    `12 ${name} Virement entre folios /Caisse du Lac ${amount}`,
    `Total\t${options.total ?? amount}`,
    "",
  ].join("\n");
}

describe("parseStatement on a three-month paste", () => {
  const { rows } = parseStatement(THREE_MONTHS);

  test("returns every row, oldest first, with seq counting from 0", () => {
    expect(rows).toHaveLength(12);
    expect(rows.map((row) => row.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(rows[0]).toEqual({
      date: "2026-07-03",
      category: "Virements",
      description: "Virement entre folios /Caisse du Lac",
      amountCents: 150000,
      balanceCents: 350000,
      seq: 0,
    });
    expect(rows[11]).toEqual({
      date: "2026-09-28",
      category: "Taxes municipales/scolaires",
      description: "Taxes /Ville Exemple",
      amountCents: -110000,
      balanceCents: 52095,
      seq: 11,
    });
  });

  test("takes the year from each month header and the day from the row", () => {
    expect(rows.map((row) => row.date)).toEqual([
      "2026-07-03",
      "2026-07-15",
      "2026-07-29",
      "2026-08-03",
      "2026-08-12",
      "2026-08-26",
      "2026-09-01",
      "2026-09-12",
      "2026-09-12",
      "2026-09-12",
      "2026-09-12",
      "2026-09-28",
    ]);
  });

  test("orders the four rows of one day by the paste's listing, never by sorting", () => {
    // Listed newest first, so the last of the four in the text is the first in time.
    expect(
      rows
        .filter((row) => row.date === "2026-09-12")
        .map((row) => [row.seq, row.description, row.amountCents, row.balanceCents]),
    ).toEqual([
      [7, "Virement entre folios /Caisse du Lac", 40000, 197545],
      [8, "Frais mensuels", -500, 197045],
      [9, "Hypothèque /Prêteur Exemple", -70000, 127045],
      [10, "Virement - AccèsD Internet /Caisse du Lac", 35050, 162095],
    ]);
  });

  test("reads the same on CRLF line endings and behind a byte-order mark", () => {
    expect(parseStatement(THREE_MONTHS.replaceAll("\n", "\r\n")).rows).toEqual(rows);
    expect(parseStatement(`﻿${THREE_MONTHS}`).rows).toEqual(rows);
  });

  test("parses an empty paste to no rows rather than inventing one", () => {
    expect(parseStatement("").rows).toEqual([]);
    expect(parseStatement("\n  \n").rows).toEqual([]);
  });

  test("proves its own chain: every balance follows from the row before it", () => {
    for (const [index, row] of rows.entries()) {
      const previous = rows[index - 1];
      if (previous) expect(row.balanceCents).toBe(previous.balanceCents + row.amountCents);
    }
  });
});

describe("parseStatement refuses a paste that does not prove itself", () => {
  test("an altered balance fails the chain, naming the row", () => {
    const text = edit(THREE_MONTHS, "−5,00 $\t1 970,45 $", "−5,00 $\t1 971,45 $");
    const error = failure(text);
    expect(error.code).toBe("STATEMENT_CHAIN_BROKEN");
    expect(error.retryable).toBe(false);
    // The date line of the "Frais mensuels" row: its amounts sit four lines below it.
    expect(error.details).toMatchObject({
      line: lineOf(text, "971,45") - 4,
      seq: 8,
      date: "2026-09-12",
      description: "Frais mensuels",
      balanceCents: 197145,
      expectedBalanceCents: 197045,
      unexplainedCents: 100,
    });
    expect(error.message).toContain("Frais mensuels");
    expect(error.message).toContain("1.00 $ is unexplained");
  });

  test("a missing row fails the chain, and says how much money went unexplained", () => {
    // Drop the whole 12 August row: six lines, from its date line to its echo.
    const lines = THREE_MONTHS.split("\n");
    const start = lineOf(THREE_MONTHS, "12 AOÛ12 Août") - 1;
    const missing = [...lines.slice(0, start), ...lines.slice(start + 6)].join("\n");
    // The month total is checked as the paste is read, so on its own the gap is
    // reported as a total that disagrees — correct it, and the chain is what is
    // left to say the money is missing.
    expect(failure(missing).code).toBe("STATEMENT_TOTAL_MISMATCH");
    const error = failure(edit(missing, "Total\t−1 534,56 $", "Total\t−834,56 $"));
    expect(error.code).toBe("STATEMENT_CHAIN_BROKEN");
    expect(error.details).toMatchObject({ date: "2026-08-26", unexplainedCents: -70000 });
  });

  test("an altered month total fails, naming the Total line", () => {
    const text = edit(THREE_MONTHS, "Total\t−1 144,49 $", "Total\t−1 144,48 $");
    const error = failure(text);
    expect(error.code).toBe("STATEMENT_TOTAL_MISMATCH");
    expect(error.details).toMatchObject({
      line: lineOf(text, "Total\t−1 144,48 $"),
      month: "2026-09",
      totalCents: -114448,
      sumCents: -114449,
      differenceCents: 1,
    });
  });

  test("a month with no Total line fails, naming its header", () => {
    const text = edit(THREE_MONTHS, "Total\t1 200,00 $\n", "");
    const error = failure(text);
    expect(error.code).toBe("STATEMENT_TOTAL_MISMATCH");
    expect(error.details).toMatchObject({
      line: lineOf(text, "Juillet 2026"),
      month: "2026-07",
      totalCents: null,
    });
  });

  test("a paste cut off before its last Total fails rather than passing a partial month", () => {
    const cut = THREE_MONTHS.slice(0, THREE_MONTHS.lastIndexOf("Total\t"));
    const error = failure(cut);
    expect(error.code).toBe("STATEMENT_TOTAL_MISMATCH");
    expect(error.details).toMatchObject({ month: "2026-07", totalCents: null });
  });

  test("an altered echo amount fails, naming the row", () => {
    const text = edit(
      THREE_MONTHS,
      "12 Septembre Frais mensuels −5,00 $",
      "12 Septembre Frais mensuels −6,00 $",
    );
    const error = failure(text);
    expect(error.code).toBe("STATEMENT_ECHO_MISMATCH");
    expect(error.details).toMatchObject({
      line: lineOf(text, "−5,00 $\t1 970,45") - 4,
      echoLine: lineOf(text, "−6,00 $"),
      date: "2026-09-12",
      description: "Frais mensuels",
      amountCents: -500,
    });
  });

  test("an altered echo description fails", () => {
    const text = edit(
      THREE_MONTHS,
      "12 Septembre Frais mensuels −5,00 $",
      "12 Septembre Frais annuels −5,00 $",
    );
    expect(failure(text).code).toBe("STATEMENT_ECHO_MISMATCH");
  });

  test("an altered echo date fails", () => {
    const text = edit(
      THREE_MONTHS,
      "12 Septembre Frais mensuels −5,00 $",
      "13 Septembre Frais mensuels −5,00 $",
    );
    expect(failure(text).code).toBe("STATEMENT_ECHO_MISMATCH");
  });

  test("an echo that is missing altogether fails as an echo", () => {
    const text = edit(THREE_MONTHS, "12 Septembre Frais mensuels −5,00 $\n", "\n");
    expect(failure(text).code).toBe("STATEMENT_ECHO_MISMATCH");
  });
});

describe("parseStatement on every way an amount is written", () => {
  test.each([
    ["U+2212 minus", "−1 234,56 $", -123456],
    ["hyphen minus", "-1 234,56 $", -123456],
    ["explicit plus", "+1 234,56 $", 123456],
    ["a plain space", "1 234,56 $", 123456],
    ["a no-break space (U+00A0)", "1 234,56 $", 123456],
    ["a narrow no-break space (U+202F)", "1 234,56 $", 123456],
  ])("reads %s in the amount, the balance, the echo and the total", (_name, written, cents) => {
    const { rows } = parseStatement(onePaste({ amount: written, balance: written }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amountCents: cents, balanceCents: cents });
  });
});

describe("parseStatement on month abbreviations", () => {
  test.each([
    [1, "JAN", "Janvier"],
    [2, "FEV", "Février"],
    [2, "FÉV", "Février"],
    [3, "MAR", "Mars"],
    [4, "AVR", "Avril"],
    [5, "MAI", "Mai"],
    [6, "JUN", "Juin"],
    [7, "JUL", "Juillet"],
    [8, "AOÛ", "Août"],
    [8, "AOU", "Aout"],
    [9, "SEP", "Septembre"],
    [10, "OCT", "Octobre"],
    [11, "NOV", "Novembre"],
    [12, "DEC", "Décembre"],
    [12, "DÉC", "Decembre"],
    [12, "déc", "DÉCEMBRE"],
  ])("month %i: %s with %s", (month, abbreviation, name) => {
    const { rows } = parseStatement(
      onePaste({ abbreviation, name, amount: "+5,00 $", balance: "5,00 $" }),
    );
    expect(rows[0]?.date).toBe(`2026-${String(month).padStart(2, "0")}-12`);
  });
});

describe("parseStatement never skips what it does not recognise", () => {
  test("a stray line between two rows fails with its own line number", () => {
    const line = lineOf(THREE_MONTHS, "12 Septembre Frais mensuels") + 1;
    const lines = THREE_MONTHS.split("\n");
    lines.splice(line - 1, 0, "Pending transaction");
    const error = failure(lines.join("\n"));
    expect(error.code).toBe("STATEMENT_UNRECOGNIZED_LINE");
    expect(error.details).toMatchObject({ line });
    expect(error.message).toContain(`Line ${line}`);
    expect(error.message).toContain("Pending transaction");
    expect(error.message).toContain("not a row, a header or a total");
  });

  test("a line after the last Total fails with its line number", () => {
    const text = `${THREE_MONTHS}Solde final 1 000,00 $\n`;
    const error = failure(text);
    expect(error.code).toBe("STATEMENT_UNRECOGNIZED_LINE");
    expect(error.details).toMatchObject({ line: lineOf(text, "Solde final") });
  });

  test("a line before the first month header fails", () => {
    const error = failure(`Relevé de compte\n${THREE_MONTHS}`);
    expect(error.code).toBe("STATEMENT_UNRECOGNIZED_LINE");
    expect(error.details).toMatchObject({ line: 1 });
  });

  test("a row before any month header fails", () => {
    const rowOnly = THREE_MONTHS.split("\n").slice(2).join("\n");
    const error = failure(rowOnly);
    expect(error.code).toBe("STATEMENT_UNRECOGNIZED_LINE");
    expect(error.details).toMatchObject({ line: 1 });
  });

  test("a month header that is not a month fails", () => {
    const text = edit(THREE_MONTHS, "Août 2026", "Aoûtt 2026");
    const error = failure(text);
    expect(error.code).toBe("STATEMENT_UNRECOGNIZED_LINE");
    expect(error.details).toMatchObject({ line: lineOf(text, "Aoûtt 2026") });
  });

  test("a row cut short by the end of the paste fails at that row", () => {
    const lines = THREE_MONTHS.split("\n");
    const start = lineOf(THREE_MONTHS, "1 SEP1 Septembre");
    const error = failure(lines.slice(0, start + 2).join("\n"));
    expect(error.code).toBe("STATEMENT_UNRECOGNIZED_LINE");
    expect(error.details).toMatchObject({ line: start });
  });

  test("an amount line that is not an amount fails at that line", () => {
    const text = edit(THREE_MONTHS, "−5,00 $\t1 970,45 $", "−5,0 $\t1 970,45 $");
    const error = failure(text);
    expect(error.code).toBe("STATEMENT_UNRECOGNIZED_LINE");
    expect(error.details).toMatchObject({ line: lineOf(text, "−5,0 $") });
  });

  test("a row that is not followed by a blank line fails at that line", () => {
    const text = edit(THREE_MONTHS, "Frais mensuels\n\n", "Frais mensuels\nsuite\n");
    const error = failure(text);
    expect(error.code).toBe("STATEMENT_UNRECOGNIZED_LINE");
    expect(error.details).toMatchObject({ line: lineOf(text, "suite") });
  });

  test("an unknown abbreviation fails at its date line", () => {
    const text = edit(THREE_MONTHS, "28 SEP28 Septembre", "28 SET28 Septembre");
    const error = failure(text);
    expect(error.code).toBe("STATEMENT_UNRECOGNIZED_LINE");
    expect(error.details).toMatchObject({ line: lineOf(text, "28 SET28") });
  });

  test("a date that disagrees with its month header fails", () => {
    const text = edit(THREE_MONTHS, "28 SEP28 Septembre", "28 OCT28 Octobre");
    expect(failure(text).code).toBe("STATEMENT_UNRECOGNIZED_LINE");
  });

  test("a day the month does not have fails", () => {
    const text = edit(THREE_MONTHS, "28 SEP28 Septembre", "31 SEP31 Septembre");
    expect(failure(text).code).toBe("STATEMENT_UNRECOGNIZED_LINE");
  });

  test("a date whose glued day differs from its first day fails", () => {
    const text = edit(THREE_MONTHS, "28 SEP28 Septembre", "28 SEP29 Septembre");
    expect(failure(text).code).toBe("STATEMENT_UNRECOGNIZED_LINE");
  });

  test("a second Total for one month fails", () => {
    const text = edit(
      THREE_MONTHS,
      "Total\t1 200,00 $\n",
      "Total\t1 200,00 $\nTotal\t1 200,00 $\n",
    );
    expect(failure(text).code).toBe("STATEMENT_UNRECOGNIZED_LINE");
  });

  test("a Total that is not an amount fails", () => {
    const text = edit(THREE_MONTHS, "Total\t1 200,00 $", "Total\tbeaucoup");
    expect(failure(text).code).toBe("STATEMENT_UNRECOGNIZED_LINE");
  });
});
