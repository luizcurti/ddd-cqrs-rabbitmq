import { shutdownTracing } from "../infrastructure/observability/tracing";
import "reflect-metadata";
import dotenv from "dotenv";
import app from "./app";
import DatabaseConfig from "../infrastructure/database/database-config";
import logger from "../infrastructure/logging/logger";

dotenv.config();

const PORT = parseInt(process.env.PORT || "3000");
const SHUTDOWN_TIMEOUT_MS = 10_000;

async function bootstrap() {
  const db = DatabaseConfig.getInstance();
  await db.connect();

  const server = app.listen(PORT, () => {
    logger.info(`Server running on http://localhost:${PORT}`);
  });

  let shuttingDown = false;
  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "shutting down gracefully");

    // Force-exit if closing the server (waiting for in-flight requests and
    // idle keep-alive sockets) takes too long, rather than hang forever.
    const forceExit = setTimeout(() => {
      logger.warn("graceful shutdown timed out, forcing exit");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    server.close(async (err) => {
      if (err) {
        logger.error({ err }, "error while closing HTTP server");
      }
      try {
        await db.disconnect();
      } catch (dbErr) {
        logger.error({ err: dbErr }, "error while closing database connection");
      }
      try {
        // Flushing pending spans can itself fail (e.g. the OTLP collector is
        // unreachable) — that must not turn a clean shutdown into a crash.
        await shutdownTracing();
      } catch (tracingErr) {
        logger.error({ err: tracingErr }, "error while shutting down tracing");
      }
      clearTimeout(forceExit);
      process.exit(0);
    });
  }

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => void shutdown(signal));
  }
}

bootstrap().catch((err) => {
  logger.error({ err }, "Failed to start server");
  process.exit(1);
});
