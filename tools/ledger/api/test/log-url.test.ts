/**
 * lg-72: the terms page says the ledger's log "holds no statement row, no
 * amount". The error handler logged `request.url`, query string included, and
 * two routes the UI calls carry values in the query: History's search
 * (`GET /api/rows?q=`) and a receipt's matches (`?amountCents=&date=`). A
 * refused request wrote them to the log. This holds that the path is logged and
 * the query is not.
 *
 * Synthetic text only. Something is asserted to have been logged first, so an
 * empty log is not what passes.
 */

import { afterEach, expect, test } from "vitest";
import { ROUTES } from "@ledger/contract";
import { createLogger } from "../src/logger.ts";
import type { App } from "../src/server.ts";
import { createApp } from "../src/server.ts";
import { ALEX, accessConfig, memberDirectory } from "./helpers/access.ts";

let app: App | undefined;

afterEach(async () => {
  await app?.shutdown();
  app = undefined;
});

async function appLoggingInto(lines: string[]): Promise<App> {
  app = await createApp({
    directory: memberDirectory(),
    logger: createLogger({ level: "debug", write: (line) => void lines.push(line) }),
    config: { dataDir: ":memory:", access: accessConfig({ devIdentity: ALEX }) },
  });
  return app;
}

test("a refused History search logs the path and not the search text", async () => {
  const lines: string[] = [];
  const { server } = await appLoggingInto(lines);

  // `limit` over the contract's cap, so the request is refused as malformed.
  const response = await server.inject({
    method: "GET",
    url: `${ROUTES.rows}?q=SYNTHETIC%20SHOP&limit=999999`,
  });

  expect(response.statusCode).toBe(400);
  const rejected = lines.filter((line) => line.includes('"msg":"request rejected"'));
  expect(rejected).toHaveLength(1);
  expect(rejected[0]).toContain(`"url":"${ROUTES.rows}"`);
  expect(lines.filter((line) => line.includes("SYNTHETIC"))).toEqual([]);
});

test("a refused receipt match logs the path and not the amount or the date", async () => {
  const lines: string[] = [];
  const { server } = await appLoggingInto(lines);

  // Not a receipt id, so the request is refused before it reads anything.
  const response = await server.inject({
    method: "GET",
    url: "/api/receipts/not-an-id/matches?amountCents=4599&date=2026-10-01",
  });

  expect(response.statusCode).toBeGreaterThanOrEqual(400);
  const rejected = lines.filter((line) => line.includes('"msg":"request rejected"'));
  expect(rejected).toHaveLength(1);
  expect(rejected[0]).toContain('"url":"/api/receipts/not-an-id/matches"');
  expect(lines.filter((line) => line.includes("4599"))).toEqual([]);
  expect(lines.filter((line) => line.includes("2026-10-01"))).toEqual([]);
});
