import http from "http";
import { register } from "./metrics";
import logger from "../logging/logger";

/**
 * A tiny standalone HTTP server exposing GET /metrics for processes that
 * aren't already an Express app (consumer, outbox-relay). The API server
 * exposes /metrics directly on its own Express app instead — see app.ts.
 */
export function startMetricsServer(port: number): http.Server {
  const server = http.createServer((req, res) => {
    if (req.url === "/metrics") {
      register
        .metrics()
        .then((body) => {
          res.setHeader("Content-Type", register.contentType);
          res.end(body);
        })
        .catch((error) => {
          logger.error({ err: error }, "failed to render metrics");
          res.writeHead(500).end();
        });
      return;
    }
    res.writeHead(404).end();
  });

  server.listen(port, () => logger.info({ port }, "metrics server listening"));
  return server;
}
