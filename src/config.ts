import { parseFlags, stringFlag } from "./cli/args.js";

export interface Config {
  http: boolean;
  port: number;
  host: string;
  token?: string;
  poolSize: number;
  idleMs: number;
  maxPools: number;
}

export class ConfigError extends Error {}

const DEFAULT_PORT = 7331;
const DEFAULT_IDLE_MS = 15 * 60 * 1000;

type Command = "stdio" | "serve";

/** Legacy/stdio entry point: `dblink` or `dblink --http [port]`. */
export function loadConfig(argv: string[] = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env): Config {
  return buildConfig(argv, env, "stdio");
}

/** Serve entry point: `dblink serve --host --port --token`. */
export function loadServeConfig(argv: string[], env: NodeJS.ProcessEnv = process.env): Config {
  return buildConfig(argv, env, "serve");
}

function buildConfig(argv: string[], env: NodeJS.ProcessEnv, command: Command): Config {
  const flags = parseFlags(argv);
  const allowed =
    command === "serve" ? new Set(["host", "port", "token", "help", "h"]) : new Set(["http", "help", "h"]);
  for (const key of flags.keys()) {
    if (!allowed.has(key)) throw new ConfigError(`Unknown option: --${key}`);
  }

  const http = command === "serve" ? true : flags.has("http");
  let port = env.DBLINK_PORT ? Number(env.DBLINK_PORT) : DEFAULT_PORT;

  if (command === "serve") {
    const raw = stringFlag(flags, "port");
    if (raw !== undefined) {
      if (!/^\d+$/.test(raw)) throw new ConfigError(`Invalid --port: ${raw}`);
      port = Number(raw);
    }
  } else if (flags.has("http")) {
    const raw = stringFlag(flags, "http");
    if (raw !== undefined) {
      if (!/^\d+$/.test(raw)) throw new ConfigError(`Invalid --http port: ${raw}`);
      port = Number(raw);
    }
  }

  const host = (command === "serve" ? stringFlag(flags, "host") : undefined) ?? env.DBLINK_BIND ?? "127.0.0.1";
  const token = (command === "serve" ? stringFlag(flags, "token") : undefined) ?? env.DBLINK_HTTP_TOKEN;

  if (http && !token) {
    throw new ConfigError(
      command === "serve"
        ? "serve requires a token: pass --token or set DBLINK_HTTP_TOKEN"
        : "HTTP transport requires DBLINK_HTTP_TOKEN. Refusing to start an unauthenticated HTTP endpoint.",
    );
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new ConfigError(`Invalid port: ${port}`);
  }

  return {
    http,
    port,
    host,
    token,
    poolSize: readInteger(env.DBLINK_POOL_SIZE, "DBLINK_POOL_SIZE", 5, 1),
    idleMs: readInteger(env.DBLINK_IDLE_MS, "DBLINK_IDLE_MS", DEFAULT_IDLE_MS, 0),
    maxPools: readInteger(env.DBLINK_MAX_POOLS, "DBLINK_MAX_POOLS", 20, 1),
  };
}

function readInteger(value: string | undefined, name: string, fallback: number, min: number): number {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) {
    throw new ConfigError(`${name} must be an integer >= ${min}`);
  }
  return n;
}
