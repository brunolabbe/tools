/**
 * `writes.ts` sends every write the web client has (lg-98): one entry for each
 * `POST` call in `web/src/api/*.ts`, 34 at a100f429, so a write added to an
 * `api/` module without saying what it makes stale fails here.
 */

import { readFileSync, readdirSync } from "node:fs";
import { expect, test } from "vitest";
import { WRITES } from "../src/writes.ts";

test("the writes are the 34 POST calls in web/src/api, one entry each (lg-98)", () => {
  const dir = new URL("../src/api/", import.meta.url);
  const posts: string[] = [];
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".ts"))) {
    const source = readFileSync(new URL(file, dir), "utf8");
    // Each exported function, with its body up to the next export.
    for (const part of source.split(/^export /mu).slice(1)) {
      const name = /^(?:async )?function (\w+)/u.exec(part)?.[1];
      const calls = part.match(/method: "POST"/gu)?.length ?? 0;
      if (name !== undefined && calls > 0) posts.push(...Array<string>(calls).fill(name));
    }
  }
  expect(posts).toHaveLength(34);
  expect(posts.toSorted()).toEqual(Object.keys(WRITES).toSorted());
});
