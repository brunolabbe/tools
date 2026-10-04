/**
 * The two buckets (lg-5), on a synthetic history: invented people, invented
 * amounts, the shapes `00-ANALYSIS.md` §4 and §5 describe.
 */

import { describe, expect, test } from "vitest";
import { bufferAsOf, mortgageAsOf, splitCents } from "../src/index.ts";
import type { FiledRow } from "../src/index.ts";

const PEOPLE = ["alex", "sam"];

function row(
  date: string,
  amountCents: number,
  bucket: FiledRow["bucket"],
  personId: string | null,
): FiledRow {
  return { date, amountCents, bucket, personId };
}

/**
 * One schedule every two weeks and one monthly (§4), an odd-cent payment, and a
 * buffer funded at the ratio, paid out of, topped up, and drawn on again later.
 */
const HISTORY: FiledRow[] = [
  row("2026-01-02", 40000, "mortgage", "alex"),
  row("2026-01-03", 60000, "current-expenses", "alex"),
  row("2026-01-03", 40000, "current-expenses", "sam"),
  row("2026-01-05", 80000, "mortgage", "sam"),
  row("2026-01-12", -70001, "mortgage", null),
  row("2026-01-16", 40000, "mortgage", "alex"),
  row("2026-01-20", -25000, "current-expenses", null),
  row("2026-01-26", -70000, "mortgage", null),
  row("2026-02-01", 80000, "mortgage", "sam"),
  row("2026-02-10", 15000, "current-expenses", "sam"),
  row("2026-02-15", -50000, "current-expenses", null),
];

function sumOwn(position: ReturnType<typeof mortgageAsOf>): number {
  return position.own.reduce((sum, person) => sum + person.ownCents, 0);
}

describe("the mortgage bucket", () => {
  test("each person's own money is their deposits less half of every payment", () => {
    const position = mortgageAsOf(HISTORY, PEOPLE, "2026-02-28");

    // alex: 80 000 in, half of 140 001 out; sam: 160 000 in, the other half.
    // The odd cent of the payments falls to alex, who sorts first.
    expect(position.own).toEqual([
      { personId: "alex", ownCents: 80000 - 70001 },
      { personId: "sam", ownCents: 160000 - 70000 },
    ]);
    expect(position.balanceCents).toBe(240000 - 140001);
    expect(sumOwn(position)).toBe(position.balanceCents);
  });

  test("the two sum to the balance to the cent, right after an odd-cent payment", () => {
    const position = mortgageAsOf(HISTORY, PEOPLE, "2026-01-12");

    expect(position.balanceCents).toBe(40000 + 80000 - 70001);
    expect(position.own).toEqual([
      { personId: "alex", ownCents: 40000 - 35001 },
      { personId: "sam", ownCents: 80000 - 35000 },
    ]);
    expect(sumOwn(position)).toBe(position.balanceCents);
  });

  test("says who is ahead and by how much, and nobody when they are level", () => {
    expect(mortgageAsOf(HISTORY, PEOPLE, "2026-02-28").lead).toEqual({
      personId: "sam",
      byCents: 90000 - 9999,
    });

    const level = [
      row("2026-01-02", 50000, "mortgage", "alex"),
      row("2026-01-02", 50000, "mortgage", "sam"),
      row("2026-01-12", -70000, "mortgage", null),
    ];
    expect(mortgageAsOf(level, PEOPLE, "2026-01-31").lead).toBeNull();
  });

  test("a later row does not reach back into an earlier date", () => {
    const before = mortgageAsOf(HISTORY, PEOPLE, "2026-01-31");

    expect(before.balanceCents).toBe(80000 + 80000 - 140001);
    expect(sumOwn(before)).toBe(before.balanceCents);
  });

  test("ignores the buffer's rows, and is empty before the first row", () => {
    expect(mortgageAsOf(HISTORY, PEOPLE, "2025-12-31")).toEqual({
      balanceCents: 0,
      own: [
        { personId: "alex", ownCents: 0 },
        { personId: "sam", ownCents: 0 },
      ],
      lead: null,
    });
  });

  test("a person a row names who was not listed still gets their money", () => {
    const rows = [...HISTORY, row("2026-02-20", 1234, "mortgage", "casey")];

    const position = mortgageAsOf(rows, PEOPLE, "2026-02-28");

    expect(position.own.map((person) => person.personId)).toEqual(["alex", "casey", "sam"]);
    expect(sumOwn(position)).toBe(position.balanceCents);
    // Three people: who is "ahead" of whom is not a question the screen asks.
    expect(position.lead).toBeNull();
  });

  // A uniform history would hold this by accident: here every payment is a
  // different odd or even amount, on every date, so a per-payment rounding that
  // drifted, or a split that lost a cent, would show.
  test("the parts sum to the balance on every date of a long, varied history", () => {
    const rows: FiledRow[] = [];
    let seed = 7;
    const next = (): number => {
      // Park–Miller: exact in a double, and no short cycle in the low bits.
      seed = (seed * 48_271) % 2_147_483_647;
      return seed;
    };
    for (let day = 0; day < 400; day++) {
      const date = new Date(Date.UTC(2024, 0, 1 + day)).toISOString().slice(0, 10);
      const kind = next() % 4;
      if (kind === 0) rows.push(row(date, 30000 + (next() % 20000), "mortgage", "alex"));
      if (kind === 1) rows.push(row(date, 30000 + (next() % 20000), "mortgage", "sam"));
      if (kind === 2) rows.push(row(date, -(60000 + (next() % 999)), "mortgage", null));
      if (kind === 3) rows.push(row(date, next() % 300, "mortgage", null));
    }
    const odd = rows.filter((entry) => entry.personId === null && entry.amountCents % 2 !== 0);
    expect(odd.length).toBeGreaterThan(20);

    for (const { date } of rows) {
      const position = mortgageAsOf(rows, PEOPLE, date);
      expect(sumOwn(position), date).toBe(position.balanceCents);
      // Rounded once on the cumulative joint total: the halves are never more than a cent apart.
      const joint = rows
        .filter((entry) => entry.personId === null && entry.date <= date)
        .reduce((sum, entry) => sum + entry.amountCents, 0);
      const [alexHalf = 0, samHalf = 0] = splitCents(joint, 2);
      expect(Math.abs(alexHalf - samHalf)).toBeLessThanOrEqual(1);
    }
  });
});

describe("splitCents", () => {
  test("gives the odd cent to the first, whichever its sign", () => {
    expect(splitCents(-70001, 2)).toEqual([-35001, -35000]);
    expect(splitCents(70001, 2)).toEqual([35001, 35000]);
    expect(splitCents(-70000, 2)).toEqual([-35000, -35000]);
    expect(splitCents(10, 3)).toEqual([4, 3, 3]);
    expect(splitCents(0, 2)).toEqual([0, 0]);
  });
});

describe("the buffer", () => {
  test("its balance as of a past date leaves out a later row that changes today's", () => {
    // The snowblower on 2026-02-15 is what makes today's balance differ.
    expect(bufferAsOf(HISTORY, PEOPLE, "2026-02-12").balanceCents).toBe(
      60000 + 40000 - 25000 + 15000,
    );
    expect(bufferAsOf(HISTORY, PEOPLE, "2026-02-28").balanceCents).toBe(
      60000 + 40000 - 25000 + 15000 - 50000,
    );
  });

  test("each person's contributions are what they put in, and payments out are nobody's", () => {
    expect(bufferAsOf(HISTORY, PEOPLE, "2026-01-31").contributions).toEqual([
      { personId: "alex", contributedCents: 60000 },
      { personId: "sam", contributedCents: 40000 },
    ]);
    expect(bufferAsOf(HISTORY, PEOPLE, "2026-02-28").contributions).toEqual([
      { personId: "alex", contributedCents: 60000 },
      { personId: "sam", contributedCents: 55000 },
    ]);
  });

  test("money returned to a person counts against what they put in", () => {
    const rows = [...HISTORY, row("2026-02-20", -5000, "current-expenses", "alex")];

    expect(bufferAsOf(rows, PEOPLE, "2026-02-28").contributions[0]).toEqual({
      personId: "alex",
      contributedCents: 55000,
    });
  });
});
