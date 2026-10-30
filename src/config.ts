export interface Config {
  http: boolean;
  port: number;
  host: string;
  token?: string;
  poolSize: number;
  idleMs: number;
}

export class ConfigError extends Error {}

const DEFAULT_PORT = 7331;
const DEFAULT_IDLE_MS = 15 * 60 * 1000;

export function loadConfig(argv: string[] = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env): Config {
  let http = false;
  let port = env.DBLINK_PORT ? Number(env.DBLINK_PORT) : DEFAULT_PORT;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--help" || arg === "-h") {
      continue;
    }
    if (arg === "--http") {
      http = true;
      const next = argv[i + 1];
      if (next && /^\d+$/.test(next)) {
        port = Number(next);
        i++;
      } else if (next === undefined || next.startsWith("-")) {
        // keep default / env port
      } else {
        throw new ConfigError(`Invalid --http port: ${next}`);
      }
    } else if (arg.startsWith("--http=")) {
      http = true;
      const value = arg.slice("--http=".length);
      if (!/^\d+$/.test(value)) throw new ConfigError(`Invalid --http port: ${value}`);
      port = Number(value);
    } else if (arg.startsWith("--")) {
      throw new ConfigError(`Unknown option: ${arg}`);
    }
  }

  const host = env.DBLINK_BIND || "127.0.0.1";
  const token = env.DBLINK_HTTP_TOKEN;

  if (http && !token) {
    throw new ConfigError(
      "HTTP transport requires DBLINK_HTTP_TOKEN. Refusing to start an unauthenticated HTTP endpoint.",
    );
  }
  if (http && Number.isNaN(port)) {
    throw new ConfigError(`Invalid port: ${port}`);
  }

  return {
    http,
    port,
    host,
    token,
    poolSize: env.DBLINK_POOL_SIZE ? Number(env.DBLINK_POOL_SIZE) : 5,
    idleMs: env.DBLINK_IDLE_MS ? Number(env.DBLINK_IDLE_MS) : DEFAULT_IDLE_MS,
  };
}
