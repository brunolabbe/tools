/**
 * The salaries and the ratio (lg-5). Every write appends, so each test that
 * corrects something also reads the table to show the earlier record is kept.
 * Invented salaries.
 */

import { afterEach, describe, expect, test } from "vitest";
import { ROUTES } from "@ledger/contract";
import type {
  ErrorResponse,
  Ratio,
  RatiosResponse,
  SalariesResponse,
  SalaryEntry,
  SalaryEntryResponse,
} from "@ledger/contract";
import { createApp } from "../src/server.ts";
import { migratedBooks } from "./helpers/template.ts";
import type { App } from "../src/server.ts";
import { ALEX, SAM, accessConfig, homeBooks, memberDirectory } from "./helpers/access.ts";
import { startApp } from "./helpers/classification.ts";

let app: App | undefined;

afterEach(async () => {
  await app?.shutdown();
  app = undefined;
});

async function start(...args: Parameters<typeof startApp>): Promise<App> {
  app = await startApp(...args);
  return app;
}

function year(value: number, alex: number, sam: number): SalaryEntry {
  return {
    year: value,
    salaries: [
      { personId: "alex", amountCents: alex },
      { personId: "sam", amountCents: sam },
    ],
  };
}

async function enter(target: App, entry: SalaryEntry): Promise<SalaryEntryResponse> {
  const response = await target.server.inject({
    method: "POST",
    url: ROUTES.salaries,
    payload: entry,
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<SalaryEntryResponse>();
}

async function confirm(
  target: App,
  entered: SalaryEntryResponse,
  effectiveFrom: string,
): Promise<Ratio> {
  const response = await target.server.inject({
    method: "POST",
    url: ROUTES.ratios,
    payload: { effectiveFrom, salaryIds: entered.salaries.map((salary) => salary.id) },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<Ratio>();
}

async function inEffect(target: App, asOf: string): Promise<Ratio | null> {
  const response = await target.server.inject({
    method: "GET",
    url: `${ROUTES.ratios}?asOf=${asOf}`,
  });
  return response.json<RatiosResponse>().inEffect;
}

function records(target: App): {
  id: number;
  person_id: string;
  year: number;
  amount_cents: number;
  supersedes: number | null;
}[] {
  return homeBooks(target)
    .prepare("SELECT id, person_id, year, amount_cents, supersedes FROM salaries ORDER BY id")
    .all() as ReturnType<typeof records>;
}

describe("POST /api/salaries", () => {
  test("stores a year's salaries, recording who and when, and proposes the ratio they give", async () => {
    const target = await start(SAM);

    const entered = await enter(target, year(2025, 6_000_000, 4_000_000));

    expect(entered.salaries).toEqual([
      expect.objectContaining({
        personId: "alex",
        year: 2025,
        amountCents: 6_000_000,
        supersedes: null,
        enteredBy: "sam",
        enteredAt: "2026-10-03T09:30:00.000Z",
      }),
      expect.objectContaining({
        personId: "sam",
        year: 2025,
        amountCents: 4_000_000,
        supersedes: null,
        enteredBy: "sam",
      }),
    ]);
    // Proposed for the day it was entered; nothing is stored until it is confirmed.
    expect(entered.proposal).toEqual({
      effectiveFrom: "2026-10-03",
      shares: [
        { personId: "alex", partsPerMillion: 600_000, salaryId: entered.salaries[0]?.id },
        { personId: "sam", partsPerMillion: 400_000, salaryId: entered.salaries[1]?.id },
      ],
    });
    expect(homeBooks(target).prepare("SELECT count(*) AS n FROM ratios").get()).toEqual({ n: 0 });
  });

  test("a proposal's two shares sum to exactly 1 000 000", async () => {
    const target = await start();

    const { proposal } = await enter(target, year(2025, 1_000_000, 2_000_000));

    expect(proposal?.shares.map((share) => share.partsPerMillion)).toEqual([333_333, 666_667]);
  });

  test("the same salaries sent twice file nothing new", async () => {
    const target = await start();
    await enter(target, year(2025, 6_000_000, 4_000_000));

    await enter(target, year(2025, 6_000_000, 4_000_000));

    expect(records(target)).toHaveLength(2);
  });

  test("one person's year alone is stored, and proposes nothing until the other's is there", async () => {
    const target = await start();

    const entered = await enter(target, {
      year: 2025,
      salaries: [{ personId: "alex", amountCents: 6_000_000 }],
    });

    expect(entered.salaries).toHaveLength(1);
    expect(entered.proposal).toBeNull();
  });

  test("a person nobody has heard of is refused, and nothing is stored", async () => {
    const target = await start();

    const response = await target.server.inject({
      method: "POST",
      url: ROUTES.salaries,
      payload: { year: 2025, salaries: [{ personId: "casey", amountCents: 1 }] },
    });

    expect(response.statusCode).toBe(400);
    expect(records(target)).toEqual([]);
  });

  test("a negative salary, a missing year, or one person twice is refused", async () => {
    const target = await start();

    for (const payload of [
      year(2025, -1, 4_000_000),
      { salaries: [{ personId: "alex", amountCents: 1 }] },
      {
        year: 2025,
        salaries: [
          { personId: "alex", amountCents: 1 },
          { personId: "alex", amountCents: 2 },
        ],
      },
    ]) {
      const response = await target.server.inject({
        method: "POST",
        url: ROUTES.salaries,
        payload,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json<ErrorResponse>().error.code).toBe("BAD_REQUEST");
    }
    expect(records(target)).toEqual([]);
  });
});

describe("POST /api/ratios", () => {
  test("stores the ratio the salaries give, with the records it came from", async () => {
    const target = await start();
    const entered = await enter(target, year(2025, 6_000_000, 4_000_000));

    const ratio = await confirm(target, entered, "2025-01-01");

    expect(ratio).toEqual({
      id: expect.any(Number),
      effectiveFrom: "2025-01-01",
      shares: entered.proposal?.shares,
      supersedes: null,
      enteredAt: "2026-10-03T09:30:00.000Z",
      enteredBy: "alex",
    });
  });

  test("the same confirmation twice is one ratio", async () => {
    const target = await start();
    const entered = await enter(target, year(2025, 6_000_000, 4_000_000));

    const first = await confirm(target, entered, "2025-01-01");
    const second = await confirm(target, entered, "2025-01-01");

    expect(second).toEqual(first);
    expect(homeBooks(target).prepare("SELECT count(*) AS n FROM ratios").get()).toEqual({ n: 1 });
  });

  test("salaries from two different years are refused", async () => {
    const target = await start();
    const a = await enter(target, year(2025, 6_000_000, 4_000_000));
    const b = await enter(target, year(2026, 6_000_000, 4_000_000));

    const response = await target.server.inject({
      method: "POST",
      url: ROUTES.ratios,
      payload: { effectiveFrom: "2026-01-01", salaryIds: [a.salaries[0]?.id, b.salaries[1]?.id] },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe("a corrected salary", () => {
  test("keeps the earlier record, and the earlier ratio still reads as in effect for its own dates", async () => {
    const target = await start();
    const ratio2025 = await confirm(
      target,
      await enter(target, year(2025, 6_000_000, 4_000_000)),
      "2025-01-01",
    );
    const entered2026 = await enter(target, year(2026, 6_000_000, 6_000_000));
    const ratio2026 = await confirm(target, entered2026, "2026-01-01");
    const [, samOriginal] = entered2026.salaries;

    // sam's 2026 salary was mistyped. alex's is sent again, unchanged, because
    // the proposal is between the people an entry names (lg-29).
    const corrected = await enter(target, year(2026, 6_000_000, 4_000_000));
    expect(
      records(target).filter((row) => row.person_id === "alex" && row.year === 2026),
    ).toHaveLength(1);

    // The earlier record is still stored, and the correction names it.
    const sam2026 = records(target).filter((row) => row.person_id === "sam" && row.year === 2026);
    expect(sam2026).toEqual([
      {
        id: samOriginal?.id,
        person_id: "sam",
        year: 2026,
        amount_cents: 6_000_000,
        supersedes: null,
      },
      {
        id: expect.any(Number),
        person_id: "sam",
        year: 2026,
        amount_cents: 4_000_000,
        supersedes: samOriginal?.id,
      },
    ]);
    // Only the correction stands.
    const standing = await target.server.inject({ method: "GET", url: ROUTES.salaries });
    expect(
      standing
        .json<SalariesResponse>()
        .salaries.map((salary) => [salary.personId, salary.year, salary.amountCents]),
    ).toEqual([
      ["alex", 2026, 6_000_000],
      ["sam", 2026, 4_000_000],
      ["alex", 2025, 6_000_000],
      ["sam", 2025, 4_000_000],
    ]);

    // Correcting a salary does not move a confirmed ratio: 2026's still reads
    // 50/50, from the record it was derived from.
    expect(await inEffect(target, "2026-03-01")).toEqual(ratio2026);
    expect(corrected.proposal?.shares.map((share) => share.partsPerMillion)).toEqual([
      600_000, 400_000,
    ]);

    // Confirmed from the middle of the year, the new ratio is in effect from then on.
    const ratioJuly = await confirm(target, corrected, "2026-07-01");
    expect(ratioJuly.supersedes).toBeNull();
    expect(await inEffect(target, "2025-06-30")).toEqual(ratio2025);
    expect(await inEffect(target, "2026-06-30")).toEqual(ratio2026);
    expect(await inEffect(target, "2026-07-01")).toEqual(ratioJuly);
    expect(await inEffect(target, "2024-12-31")).toBeNull();
  });

  test("cannot be confirmed into a ratio once it is corrected", async () => {
    const target = await start();
    const original = await enter(target, year(2026, 6_000_000, 6_000_000));
    await enter(target, year(2026, 6_000_000, 4_000_000));

    const response = await target.server.inject({
      method: "POST",
      url: ROUTES.ratios,
      payload: { effectiveFrom: "2026-01-01", salaryIds: original.salaries.map((s) => s.id) },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json<ErrorResponse>().error.code).toBe("SALARY_NOT_FOUND");
  });

  test("confirming another ratio for the same day supersedes it, and the earlier is kept", async () => {
    const target = await start();
    const first = await confirm(
      target,
      await enter(target, year(2026, 6_000_000, 6_000_000)),
      "2026-01-01",
    );

    const second = await confirm(
      target,
      await enter(target, year(2026, 6_000_000, 4_000_000)),
      "2026-01-01",
    );

    expect(second.supersedes).toBe(first.id);
    expect(await inEffect(target, "2026-03-01")).toEqual(second);
    const all = await target.server.inject({ method: "GET", url: ROUTES.ratios });
    expect(all.json<RatiosResponse>().ratios).toEqual([second]);
    expect(homeBooks(target).prepare("SELECT count(*) AS n FROM ratios").get()).toEqual({ n: 2 });
  });
});

function threePeople(alex: number, casey: number, sam: number): SalaryEntry {
  return {
    year: 2025,
    salaries: [
      { personId: "alex", amountCents: alex },
      { personId: "casey", amountCents: casey },
      { personId: "sam", amountCents: sam },
    ],
  };
}

describe("a salary left out of an entry (lg-29)", () => {
  const CASEY = "casey@example.test";

  /** A household of alex, casey and sam, alex the caller. */
  async function startThree(): Promise<App> {
    app = await createApp({
      booksTemplate: migratedBooks(),
      directory: memberDirectory([
        [ALEX, "alex"],
        [CASEY, "casey"],
        [SAM, "sam"],
      ]),
      config: {
        dataDir: ":memory:",
        logLevel: "silent",
        access: accessConfig({ devIdentity: ALEX }),
      },
      now: () => new Date("2026-10-03T09:30:00Z"),
    });
    return app;
  }

  test("the proposal is between the people entered, not every salary the year holds", async () => {
    const target = await startThree();
    const first = await enter(target, threePeople(5_000_000, 4_000_000, 1_000_000));
    expect(first.proposal?.shares.map((share) => share.personId)).toEqual(["alex", "casey", "sam"]);

    // sam's field is blank this time, though a salary of his stands for 2025.
    const second = await enter(target, {
      year: 2025,
      salaries: [
        { personId: "alex", amountCents: 5_000_000 },
        { personId: "casey", amountCents: 4_000_000 },
      ],
    });

    expect(second.proposal?.shares.map((share) => [share.personId, share.partsPerMillion])).toEqual(
      [
        ["alex", 555_556],
        ["casey", 444_444],
      ],
    );
    // The salary on record is not erased, and the year still lists it.
    expect(second.salaries.map((salary) => salary.personId)).toEqual(["alex", "casey", "sam"]);
    expect(records(target)).toHaveLength(3);
  });

  test("confirming that proposal stores a ratio of the two, and sam is not in it", async () => {
    const target = await startThree();
    await enter(target, threePeople(5_000_000, 4_000_000, 1_000_000));
    const second = await enter(target, {
      year: 2025,
      salaries: [
        { personId: "alex", amountCents: 5_000_000 },
        { personId: "casey", amountCents: 4_000_000 },
      ],
    });

    const response = await target.server.inject({
      method: "POST",
      url: ROUTES.ratios,
      payload: {
        effectiveFrom: "2025-01-01",
        salaryIds: second.proposal?.shares.map((share) => share.salaryId),
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<Ratio>().shares.map((share) => share.personId)).toEqual(["alex", "casey"]);
  });

  test("an entry of one person proposes nothing, though the year holds salaries for others", async () => {
    const target = await startThree();
    await enter(target, threePeople(5_000_000, 4_000_000, 1_000_000));

    const alone = await enter(target, {
      year: 2025,
      salaries: [{ personId: "alex", amountCents: 6_000_000 }],
    });

    expect(alone.proposal).toBeNull();
    expect(alone.salaries.map((salary) => [salary.personId, salary.amountCents])).toEqual([
      ["alex", 6_000_000],
      ["casey", 4_000_000],
      ["sam", 1_000_000],
    ]);
  });
});
