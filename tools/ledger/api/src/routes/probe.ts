/**
 * DO NOT MERGE. repo-91 measurement probe: variant D, a control for the
 * unresolved import. The documented Express shape: `consume()` in the handler,
 * fed from a property of `req`. Neither `express` nor `rate-limiter-flexible` is
 * installed, exactly as in variants B and C.
 */

import { readFileSync } from "node:fs";
import express from "express";
import type { FastifyInstance } from "fastify";
import { RateLimiterMemory } from "rate-limiter-flexible";
import type { AppContext } from "../context.ts";

const PROBE_FILE = "/etc/hostname";

const limiter = new RateLimiterMemory({ points: 10, duration: 1 });

const expressApp = express();

expressApp.get("/api/probe-d", async (req, res) => {
  await limiter.consume(req.ip);
  res.send(readFileSync(PROBE_FILE, "utf8"));
});

export function registerProbeRoutes(_app: FastifyInstance, _context: AppContext): void {
  void expressApp;
}
