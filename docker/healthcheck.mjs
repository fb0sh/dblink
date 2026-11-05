// Mode-aware liveness probe for the dblink container. Node only (no curl in node:22-alpine).
// Connection refused (stdio, no HTTP listener) => healthy; otherwise GET /healthz must return 200.
import net from "node:net";
import http from "node:http";

const port = Number(process.env.DBLINK_PORT || 7331);
const bind = process.env.DBLINK_BIND;
const host = bind && bind !== "0.0.0.0" ? bind : "127.0.0.1";

const probe = net.connect({ host, port });
probe.setTimeout(2000);

probe.on("connect", () => {
  probe.destroy();
  const req = http.get({ host, port, path: "/healthz", timeout: 2000 }, (res) => {
    res.resume();
    process.exit(res.statusCode === 200 ? 0 : 1);
  });
  req.on("timeout", () => {
    req.destroy();
    process.exit(1);
  });
  req.on("error", () => process.exit(1));
});

probe.on("timeout", () => {
  probe.destroy();
  process.exit(1);
});

probe.on("error", (err) => {
  process.exit(err && err.code === "ECONNREFUSED" ? 0 : 1);
});
