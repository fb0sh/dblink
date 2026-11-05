# dblink

A Model Context Protocol (MCP) server that lets an agent talk to multiple databases through a small, uniform tool surface: **PostgreSQL**, **MySQL**, **Redis**, **SQLite** and **MongoDB**.

```
open_connection(dsn) ──▶ connection_id ──▶ db_query / db_execute / db_list_tables / db_describe_table / redis_command / mongo_find / mongo_aggregate / mongo_write / mongo_list_collections / mongo_describe_collection ──▶ close_connection
```

## Install & run

```bash
# stdio (default, no auth — for local use)
npx @fb0sh/dblink

# HTTP (requires a bearer token; refuses to start without one)
DBLINK_HTTP_TOKEN=change-me npx @fb0sh/dblink --http 7331
```

Prefer a container? See [Docker (container MCP)](#docker-container-mcp) for the published `ghcr.io/fb0sh/dblink` image and MCP client config.

## CLI

```bash
dblink                                              # stdio server (default)
dblink serve --host 0.0.0.0 --port 7331 --token xxx  # HTTP server
dblink client --url http://127.0.0.1:7331/mcp --token xxx   # interactive REPL
dblink client --list                                # list tools
dblink client --tool db_query --args '{"connection_id":"conn_x","sql":"select 1"}'
```

`dblink serve` requires a token (`--token` or `DBLINK_HTTP_TOKEN`) and refuses to start without one. `dblink client` is a thin MCP client for manual testing and scripts.

MCP client config (stdio) example:

```json
{
  "mcpServers": {
    "dblink": { "command": "npx", "args": ["-y", "@fb0sh/dblink"] }
  }
}
```

## Docker (container MCP)

The image runs the same MCP server. Default is **stdio** (the MCP client spawns the container); `serve` switches it to **MCP Streamable HTTP**.

Published image (public, `linux/amd64`): `ghcr.io/fb0sh/dblink:2.1.0` (also `:2` and `:latest`).

```bash
docker pull ghcr.io/fb0sh/dblink:2.1.0
```

Build locally instead (equivalent, tagged `dblink:local`):

```bash
docker build -t dblink:local .
```

### MCP client config — stdio (container)

```json
{
  "mcpServers": {
    "dblink": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "ghcr.io/fb0sh/dblink:2.1.0"]
    }
  }
}
```

Use `dblink:local` in place of the image if you built it locally. The client must attach stdin (`-i`) and must not allocate a TTY (`-t`).

### MCP client config — Streamable HTTP

```bash
docker run -d --name dblink \
  -p 7331:7331 \
  -e DBLINK_HTTP_TOKEN=change-me \
  ghcr.io/fb0sh/dblink:2.1.0 serve
```

```json
{
  "mcpServers": {
    "dblink": {
      "url": "http://127.0.0.1:7331/mcp",
      "headers": { "Authorization": "Bearer change-me" }
    }
  }
}
```

`serve` requires `DBLINK_HTTP_TOKEN` and refuses to start without it. Releases publish on `vX.Y.Z` tags via the `release-image` workflow (`X.Y.Z`, `X`, `latest`). GHCR starts new packages private — after the first publish, set the package visibility to **Public** once in the package settings.

`GET/HEAD /healthz` is an unauthenticated liveness probe (returns `{"ok":true}`); every other path, including `/mcp`, still requires the Bearer token.

SQLite persistence — mount a volume at `/data` and use a file DSN:

```bash
docker run -i --rm -v dblink-data:/data ghcr.io/fb0sh/dblink:2.1.0
# inside the session: open_connection with dsn "sqlite:/data/app.db"
```

The image sets `DBLINK_BIND=0.0.0.0` (unlike the bare-metal default `127.0.0.1`). If you override the port with `--port`, set `DBLINK_PORT` to match so the container `HEALTHCHECK` probes the right port. The `HEALTHCHECK` probes the bind address (`DBLINK_BIND`, or `127.0.0.1` when bound to `0.0.0.0`) and cannot detect a `serve` whose process is alive but listener has died.

## Library usage (integration)

Hold one MCP session instead of reconnecting per call:

```js
import { createDblinkClient } from "@fb0sh/dblink/client";

const dblink = await createDblinkClient({
  url: "http://127.0.0.1:7331/mcp",
  token: process.env.DBLINK_HTTP_TOKEN,
});
const tools = await dblink.listTools();
const opened = await dblink.call("open_connection", { dsn: "sqlite::memory:" });
const rows = await dblink.call("db_query", {
  connection_id: opened.json.connection_id,
  sql: "select 1 as v",
});
await dblink.close();
```

`createDblinkClient` keeps the session alive (one initialize handshake). Use `callOnce(...)` for fire-and-forget scripts.

## Tools

| Tool | Purpose |
| --- | --- |
| `open_connection(dsn, read_only=true, name?)` | Open/reuse a connection, return `connection_id` |
| `close_connection(connection_id)` | Close and release |
| `list_connections()` | Alive/dead status of active connections |
| `db_query(connection_id, sql, params?, limit?)` | Read-only SQL |
| `db_execute(connection_id, sql, params?)` | Write SQL (needs `read_only:false`) |
| `db_list_tables(connection_id, schema?)` | List tables/views |
| `db_describe_table(connection_id, table, schema?)` | Columns + indexes |
| `redis_command(connection_id, command, args?)` | Read-only Redis commands (allow-list) |
| `mongo_find(connection_id, collection, filter?, projection?, sort?, limit?, database?)` | Query documents (relaxed EJSON) |
| `mongo_aggregate(connection_id, collection, pipeline, limit?, database?)` | Aggregation pipeline (no `$out/$merge` when read-only) |
| `mongo_write(connection_id, collection, action, payload, database?)` | insert/update/delete (writable connections only) |
| `mongo_list_collections(connection_id, database?)` | List collections |
| `mongo_describe_collection(connection_id, collection, database?)` | Sample document, indexes, inferred fields |

Supported DSN schemes: `postgres://`, `postgresql://`, `mysql://`, `redis://`, `rediss://`, `mongodb://`, `mongodb+srv://`, `sqlite:` (file or `:memory:`).

## Configuration (environment)

| Variable | Default | Meaning |
| --- | --- | --- |
| `DBLINK_HTTP_TOKEN` | — | Required when `--http` is used; bearer token |
| `DBLINK_BIND` | `127.0.0.1` | Bind address; `0.0.0.0` must be explicit |
| `DBLINK_PORT` | `7331` | HTTP port (or pass `--http <port>`) |
| `DBLINK_POOL_SIZE` | `5` | Max clients per pool |
| `DBLINK_IDLE_MS` | `900000` | Idle pool eviction (15 min) |
| `DBLINK_MAX_POOLS` | `20` | Max distinct connection pools per process |

Limits: 100 rows by default (max 1000), 256 KB per result, 30 s statement timeout. Truncated results return `truncated: true`.

Errors are uniform: `{ ok: false, error: { code, message, hint? } }` with `code` ∈ `CONN_NOT_FOUND | CONN_CLOSED | READ_ONLY_VIOLATION | SQL_ERROR | TIMEOUT | LIMIT_EXCEEDED | UNSUPPORTED`.

## Security — read this

- **`read_only` is not a security boundary.** The real boundary is the **database account**. Use a read-only database user for read-only connections. The built-in SQL guard (single statement, no DDL/DML, no `SELECT ... INTO`) is best-effort and can be bypassed (CTEs, functions, comments, etc.). See `docs/adr/0003-read-only-boundary.md`.
- DSNs are passed by the agent and transit the model context; the server itself never writes plaintext credentials to its logs.
- HTTP is fail-closed: without `DBLINK_HTTP_TOKEN` the server refuses to start. Default bind is `127.0.0.1`; exposing it on `0.0.0.0` is your call and requires the token to be protected.
- stdio transport is unauthenticated by design (local, single user).

## Development

```bash
npm install
npm run build      # tsc -> dist/
npm test           # unit tests (SQLite + fakes); docker tests skipped
docker compose up -d   # postgres/mysql/redis for integration
DBLINK_TEST_PG_DSN=postgres://dblink:dblink@127.0.0.1:55432/dblink \
DBLINK_TEST_MYSQL_DSN=mysql://dblink:dblink@127.0.0.1:53306/dblink \
DBLINK_TEST_REDIS_DSN=redis://127.0.0.1:56379 \
DBLINK_TEST_MONGO_DSN=mongodb://127.0.0.1:57017/dblink \
npm run test:integration
```

See `docs/adr/` for design decisions, `GLOSSARY.md` for vocabulary, and `.scratch/dblink/` for the spec and tickets.
