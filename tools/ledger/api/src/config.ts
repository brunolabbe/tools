/**
 * Environment parsing, done once at boot.
 *
 * This app is the only place in the tool that reads `process.env`. Every other
 * package is a library and takes its configuration as arguments.
 */

import path from "node:path";
import process from "node:process";
import { AppError } from "@ledger/contract";
import { DEFAULT_RECEIPT_MODEL } from "@ledger/receipts";
import { trustProxy } from "@webtools/core";
import { readAddress } from "./directory.ts";

export const LOG_LEVELS = ["debug", "info", "warn", "error", "silent"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface ApiConfig {
  host: string;
  port: number;
  /**
   * `DATABASE_PATH`: the directory the books are kept in, one file per household
   * at `households/<id>.db` (lg-21) — or `:memory:`, which gives each household
   * an in-memory database of its own, and is what the tests use.
   */
  dataDir: string;

  /**
   * The household directory (lg-20): a SQLite file of its own, `directory.db` in
   * the data directory unless `DIRECTORY_PATH` says otherwise, and `:memory:`
   * when the books are. Never inside `households/` (lg-21).
   */
  directoryPath: string;

  /**
   * Whether `X-Forwarded-For` may name the client.
   *
   * Off by default, and the same shape, default and parsing function as the
   * other two tools' — `trustProxy` from `@webtools/core`. Nothing here is keyed
   * on `request.ip` yet, so today it only decides what the logs say; it is
   * wired now so that the first rate limit this tool grows does not arrive
   * already decorative behind the tunnel.
   */
  trustProxy: boolean | string;

  /**
   * Built UI to serve from this process, same-origin. Undefined serves nothing,
   * which is a perfectly good headless configuration.
   */
  webDir: string | undefined;

  /** Origins allowed to call the API from a browser. Empty means same-origin only. */
  corsOrigins: readonly string[];
  logLevel: LogLevel;

  /**
   * Requests a person may make per minute to the routes that read, and to the
   * routes that write (lg-4). Per person, not per address: behind the tunnel
   * both people may share one, and the identity is what Access vouched for.
   * Zero disables a limiter, as it does for the other tools.
   */
  rateLimitReadsPerMinute: number;
  rateLimitWritesPerMinute: number;

  /** `NODE_ENV=production`, which the image sets. Decides what may not be configured. */
  production: boolean;

  /** How a request proves who it is (lg-3), and who is an admin (lg-20). */
  access: AccessConfig;

  /** What reads a receipt photo when the person asks (lg-8). */
  receiptReader: ReceiptReaderConfig;
}

/**
 * The model behind the receipt reader (lg-8). With no key there is no reader:
 * a read is refused as `RECEIPT_READER_UNCONFIGURED`, and a receipt is typed by
 * hand, which never needed one.
 */
export interface ReceiptReaderConfig {
  /** `ANTHROPIC_API_KEY`. Read here and nowhere else; never logged. */
  apiKey: string | undefined;
  /** `RECEIPT_MODEL`, `claude-haiku-5-5` by default (the owner's choice, measured on lg-8). */
  model: string;
}

/**
 * Cloudflare Access, as the API sees it. Every field is configuration and
 * nothing here is ever read from a request: the key set's host is built from
 * `team` alone. Who belongs to which household is not here at all: it is the
 * household directory (lg-20), read on every request.
 */
export interface AccessConfig {
  /**
   * The `<team>` in `<team>.cloudflareaccess.com`, which is both where the
   * signing keys are fetched from and the issuer every token must name.
   */
  team: string | undefined;
  /** The application's AUD tag, which every token must carry. */
  audience: string | undefined;
  /**
   * `LEDGER_ADMINS`: lower-cased addresses that may manage the directory (lg-22
   * is the first to act on it). An admin need not be a member of any household,
   * and being one reads no books.
   */
  admins: ReadonlySet<string>;
  /**
   * Development only: every request is this address, and no token is read.
   * Refused at boot in production mode, which is what keeps it out of the image,
   * and refused by `createApp` when the directory has no member by it.
   */
  devIdentity: string | undefined;
}

export const API_DEFAULTS = {
  host: "127.0.0.1",
  // Not 8080 or 8090: the downloader's and the planner's APIs default there, and
  // running every tool at once should not need any of them reconfigured.
  port: 8100,
  dataDir: "./storage/ledger",
  directoryFile: "directory.db",
  /** Where each household's books file is, inside the data directory (lg-21). */
  householdsDir: "households",
  /** Where each household's receipt photos are, inside the data directory (lg-8). */
  receiptsDir: "receipts",
  logLevel: "info",
  // Two people on a phone. A tap on the inbox is one write and a screen is a
  // handful of reads, so neither is near these; a script is.
  rateLimitReadsPerMinute: 120,
  rateLimitWritesPerMinute: 60,
} as const satisfies Partial<Record<string, unknown>>;

function int(
  raw: string | undefined,
  fallback: number,
  { min = 1, max = Number.MAX_SAFE_INTEGER } = {},
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function optionalPath(raw: string | undefined): string | undefined {
  const value = raw?.trim() ?? "";
  return value === "" ? undefined : path.resolve(value);
}

function list(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

function logLevel(raw: string | undefined): LogLevel {
  const value = (raw ?? API_DEFAULTS.logLevel).trim().toLowerCase();
  return (LOG_LEVELS as readonly string[]).includes(value) ? (value as LogLevel) : "info";
}

/**
 * Production mode, read forgivingly (gate 1, F2; the owner's decision): the
 * guard it feeds refuses `DEV_IDENTITY`, so `Production` or a padded
 * ` production ` must count as production rather than slip past a literal match.
 */
function isProduction(raw: string | undefined): boolean {
  return (raw ?? "").trim().toLowerCase() === "production";
}

/** A DNS label, so the key set's host cannot be steered anywhere by its own setting. */
const TEAM_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

function optionalString(raw: string | undefined): string | undefined {
  const value = raw?.trim() ?? "";
  return value === "" ? undefined : value;
}

function refuse(message: string): never {
  // `INTERNAL`, as every tool's refusal to boot is: the operator reads the
  // message in the boot log, and no caller ever sees it.
  throw new AppError("INTERNAL", message);
}

/** `LEDGER_ADMINS`: addresses, comma-separated. */
function admins(raw: string | undefined): Set<string> {
  const set = new Set<string>();
  for (const [index, entry] of list(raw).entries()) {
    const address = readAddress(entry);
    // Positions, never the entry itself: the addresses are people's, and the
    // boot log is read by whoever reads the host's logs.
    if (address === undefined) refuse(`LEDGER_ADMINS entry ${index + 1} is not an address.`);
    set.add(address);
  }
  return set;
}

function loadAccessConfig(env: NodeJS.ProcessEnv): AccessConfig {
  // Retired by lg-20. Refused rather than ignored, so a stale `.env` cannot
  // look as if it still admits people: membership is the directory's now.
  if (env["ACCESS_PEOPLE"] !== undefined) {
    refuse(
      "ACCESS_PEOPLE is retired: who belongs to which household is the directory's (npm run household:ledger). Remove it.",
    );
  }
  return {
    team: optionalString(env["ACCESS_TEAM"])?.toLowerCase(),
    audience: optionalString(env["ACCESS_AUD"]),
    admins: admins(env["LEDGER_ADMINS"]),
    devIdentity: optionalString(env["DEV_IDENTITY"])?.toLowerCase(),
  };
}

/**
 * What the process refuses to start with. Each would otherwise boot a service
 * whose health answers perfectly while it refuses, or admits, the wrong people.
 */
function checkAccessConfig(access: AccessConfig, production: boolean): void {
  if (access.devIdentity !== undefined && production) {
    refuse("DEV_IDENTITY is set in production mode, where it would skip the Access check.");
  }
  if ((access.team === undefined) !== (access.audience === undefined)) {
    refuse("ACCESS_TEAM and ACCESS_AUD are set together or not at all.");
  }
  if (access.team !== undefined && !TEAM_NAME.test(access.team)) {
    refuse("ACCESS_TEAM is the team name alone, the <team> in <team>.cloudflareaccess.com.");
  }
}

/**
 * The receipt reader's configuration (lg-8). `ANTHROPIC_CUSTOM_HEADERS` beside a
 * key refuses to boot, for the reason the planner's `refuseCustomHeaders` gives
 * (the owner's decision on pl-39): the SDK applies it to every request whatever
 * it is passed, and a header in it can replace the key or change what a request
 * bills. Blank is unset, as the SDK reads it. Without a key nothing builds the
 * SDK, so the variable reaches nothing and is let be. The value is never
 * repeated: a variable that carries headers may be carrying a key.
 */
function loadReceiptReaderConfig(env: NodeJS.ProcessEnv): ReceiptReaderConfig {
  const apiKey = optionalString(env["ANTHROPIC_API_KEY"]);
  if (apiKey !== undefined && optionalString(env["ANTHROPIC_CUSTOM_HEADERS"]) !== undefined) {
    refuse(
      "ANTHROPIC_API_KEY and ANTHROPIC_CUSTOM_HEADERS are both set. The Anthropic SDK applies that variable to every request and it can replace the key, so the ledger refuses to start with it. Unset it.",
    );
  }
  return { apiKey, model: optionalString(env["RECEIPT_MODEL"]) ?? DEFAULT_RECEIPT_MODEL };
}

/**
 * The directory may not be one of the books (lg-20's gate, F4). Pointed at the
 * books file, it once failed at boot and left that file half-migrated with both
 * schemas' tables. Since lg-21 the books are a directory of files, and the one
 * place the two can collide is `households/`, so anything in there is refused
 * before a file is opened.
 */
function checkDirectoryPath(dataDir: string, directoryPath: string): void {
  if (dataDir === ":memory:" || directoryPath === ":memory:") return;
  const households = path.join(dataDir, API_DEFAULTS.householdsDir);
  const relative = path.relative(households, path.resolve(directoryPath));
  const outside =
    relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
  if (!outside) {
    refuse(
      "DIRECTORY_PATH is inside the households directory, where each household's books are kept. Put it elsewhere, such as directory.db in the data directory.",
    );
  }
}

export function loadApiConfig(
  overrides: Partial<ApiConfig> = {},
  env: NodeJS.ProcessEnv = process.env,
): ApiConfig {
  const rawData = overrides.dataDir ?? optionalString(env["DATABASE_PATH"]);
  const dataDir =
    rawData === ":memory:" ? ":memory:" : path.resolve(rawData ?? API_DEFAULTS.dataDir);
  const directoryPath =
    overrides.directoryPath ??
    optionalString(env["DIRECTORY_PATH"]) ??
    (dataDir === ":memory:" ? ":memory:" : path.join(dataDir, API_DEFAULTS.directoryFile));
  checkDirectoryPath(dataDir, directoryPath);

  const config: ApiConfig = {
    host: overrides.host ?? env["HOST"] ?? API_DEFAULTS.host,
    port: overrides.port ?? int(env["PORT"], API_DEFAULTS.port, { min: 0, max: 65_535 }),
    dataDir,
    directoryPath,
    trustProxy: overrides.trustProxy ?? trustProxy(env["TRUST_PROXY"]),
    // Resolved so a relative WEB_DIR means the same thing wherever the process
    // was started from.
    webDir: overrides.webDir ?? optionalPath(env["WEB_DIR"]),
    corsOrigins: overrides.corsOrigins ?? list(env["CORS_ORIGINS"]),
    logLevel: overrides.logLevel ?? logLevel(env["LOG_LEVEL"]),
    rateLimitReadsPerMinute:
      overrides.rateLimitReadsPerMinute ??
      int(env["RATE_LIMIT_READS_PER_MINUTE"], API_DEFAULTS.rateLimitReadsPerMinute, { min: 0 }),
    rateLimitWritesPerMinute:
      overrides.rateLimitWritesPerMinute ??
      int(env["RATE_LIMIT_WRITES_PER_MINUTE"], API_DEFAULTS.rateLimitWritesPerMinute, { min: 0 }),
    production: overrides.production ?? isProduction(env["NODE_ENV"]),
    access: overrides.access ?? loadAccessConfig(env),
    receiptReader: overrides.receiptReader ?? loadReceiptReaderConfig(env),
  };
  // After the overrides, so a test cannot build a configuration the process
  // would have refused.
  checkAccessConfig(config.access, config.production);
  return config;
}
