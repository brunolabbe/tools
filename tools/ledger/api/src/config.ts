/**
 * Environment parsing, done once at boot.
 *
 * This app is the only place in the tool that reads `process.env`. Every other
 * package is a library and takes its configuration as arguments.
 */

import path from "node:path";
import process from "node:process";
import { AppError } from "@ledger/contract";
import { trustProxy } from "@webtools/core";

export const LOG_LEVELS = ["debug", "info", "warn", "error", "silent"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface ApiConfig {
  host: string;
  port: number;
  /** A file path, or `:memory:` — which is what the tests use. */
  databasePath: string;

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

  /** `NODE_ENV=production`, which the image sets. Decides what may not be configured. */
  production: boolean;

  /** Who may use the tool, and how a request proves it (lg-3). */
  access: AccessConfig;
}

/**
 * Cloudflare Access, as the API sees it. Every field is configuration and
 * nothing here is ever read from a request: the key set's host is built from
 * `team` alone, and the email-to-person map is the operator's, never a table
 * seeded from the repository.
 */
export interface AccessConfig {
  /**
   * The `<team>` in `<team>.cloudflareaccess.com`, which is both where the
   * signing keys are fetched from and the issuer every token must name.
   */
  team: string | undefined;
  /** The application's AUD tag, which every token must carry. */
  audience: string | undefined;
  /** Lower-cased email address → person id. An address not here gets a 403. */
  people: ReadonlyMap<string, string>;
  /**
   * Development only: every request is this address, and no token is read.
   * Refused at boot in production mode, which is what keeps it out of the image.
   */
  devIdentity: string | undefined;
}

export const API_DEFAULTS = {
  host: "127.0.0.1",
  // Not 8080 or 8090: the downloader's and the planner's APIs default there, and
  // running every tool at once should not need any of them reconfigured.
  port: 8100,
  dataDir: "./storage/ledger",
  databaseFile: "ledger.db",
  logLevel: "info",
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

/** `ACCESS_PEOPLE`: `address=person` pairs, comma-separated. */
function people(raw: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const [index, entry] of list(raw).entries()) {
    const at = entry.indexOf("=");
    const email = (at === -1 ? "" : entry.slice(0, at)).trim().toLowerCase();
    const person = (at === -1 ? "" : entry.slice(at + 1)).trim();
    // Positions, never the entry itself: the addresses are the household's,
    // and the boot log is read by whoever reads the host's logs.
    if (email === "" || person === "") {
      refuse(`ACCESS_PEOPLE entry ${index + 1} is not of the form address=person.`);
    }
    if (map.has(email)) refuse(`ACCESS_PEOPLE names the address in entry ${index + 1} twice.`);
    map.set(email, person);
  }
  return map;
}

function loadAccessConfig(env: NodeJS.ProcessEnv): AccessConfig {
  return {
    team: optionalString(env["ACCESS_TEAM"])?.toLowerCase(),
    audience: optionalString(env["ACCESS_AUD"]),
    people: people(env["ACCESS_PEOPLE"]),
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
  if (access.devIdentity !== undefined && !access.people.has(access.devIdentity)) {
    refuse("DEV_IDENTITY is not an address in ACCESS_PEOPLE, so every request would be refused.");
  }
  if ((access.team === undefined) !== (access.audience === undefined)) {
    refuse("ACCESS_TEAM and ACCESS_AUD are set together or not at all.");
  }
  if (access.team !== undefined && !TEAM_NAME.test(access.team)) {
    refuse("ACCESS_TEAM is the team name alone, the <team> in <team>.cloudflareaccess.com.");
  }
}

export function loadApiConfig(
  overrides: Partial<ApiConfig> = {},
  env: NodeJS.ProcessEnv = process.env,
): ApiConfig {
  const rawDatabase = overrides.databasePath ?? env["DATABASE_PATH"];
  const databasePath =
    rawDatabase === ":memory:"
      ? ":memory:"
      : (rawDatabase ?? path.resolve(API_DEFAULTS.dataDir, API_DEFAULTS.databaseFile));

  const config: ApiConfig = {
    host: overrides.host ?? env["HOST"] ?? API_DEFAULTS.host,
    port: overrides.port ?? int(env["PORT"], API_DEFAULTS.port, { min: 0, max: 65_535 }),
    databasePath,
    trustProxy: overrides.trustProxy ?? trustProxy(env["TRUST_PROXY"]),
    // Resolved so a relative WEB_DIR means the same thing wherever the process
    // was started from.
    webDir: overrides.webDir ?? optionalPath(env["WEB_DIR"]),
    corsOrigins: overrides.corsOrigins ?? list(env["CORS_ORIGINS"]),
    logLevel: overrides.logLevel ?? logLevel(env["LOG_LEVEL"]),
    production: overrides.production ?? isProduction(env["NODE_ENV"]),
    access: overrides.access ?? loadAccessConfig(env),
  };
  // After the overrides, so a test cannot build a configuration the process
  // would have refused.
  checkAccessConfig(config.access, config.production);
  return config;
}
