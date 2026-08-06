import { expect, test } from "vitest";
import { AppError } from "@downloader/shared";

test("smoke", () => {
  const x: number = 1;
  expect(x).toBe(1);
  expect(new AppError("INTERNAL").code).toBe("INTERNAL");
});
