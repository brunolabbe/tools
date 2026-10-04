/**
 * DO NOT MERGE. repo-91 measurement probe: variant E, the control for the
 * unresolved import. The shape CodeQL's own test suite uses for
 * `rate-limiter-flexible` (tst.js): `consume(req.ip)` in a separate Express
 * middleware ahead of the expensive handler. Neither `express` nor
 * `rate-limiter-flexible` is installed, exactly as in variants B to D.
 */

import { readFileSync } from "node:fs";
import express from "express";
import type { FastifyInstance } from "fastify";
import { RateLimiterMemory } from "rate-limiter-flexible";
import type { AppContext } from "../context.ts";

const PROBE_FILE = "/etc/hostname";

const limiter = new RateLimiterMemory({ points: 10, duration: 1 });

const expressApp = express();

const limitMiddleware = (req: express.Request, res: express.Response, next: () => void): void => {
  limiter
    .consume(req.ip)
    .then(next)
    .catch(() => res.status(429).send("rate limited"));
};

const expensiveHandler = (_req: express.Request, res: express.Response): void => {
  res.send(readFileSync(PROBE_FILE, "utf8"));
};

expressApp.get("/api/probe-e", limitMiddleware, expensiveHandler);

export function registerProbeRoutes(_app: FastifyInstance, _context: AppContext): void {
  void expressApp;
}
