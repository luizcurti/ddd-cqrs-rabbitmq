import { shutdownTracing } from "./infrastructure/observability/tracing";
import "reflect-metadata";
import dotenv from "dotenv";
import DatabaseConfig from "./infrastructure/database/database-config";
import OutboxRepository from "./infrastructure/outbox/outbox.repository";
import OutboxRelay from "./infrastructure/outbox/outbox-relay";
import logger from "./infrastructure/logging/logger";
import { startMetricsServer } from "./infrastructure/observability/metrics-server";

dotenv.config();

const POLL_INTERVAL_MS = parseInt(process.env.OUTBOX_POLL_INTERVAL_MS || "2000");
const BATCH_SIZE = parseInt(process.env.OUTBOX_BATCH_SIZE || "200");
const METRICS_PORT = parseInt(process.env.OUTBOX_RELAY_METRICS_PORT || "9092");
const STALE_CLAIM_MS = parseInt(process.env.OUTBOX_STALE_CLAIM_MS || "60000");

async function bootstrap() {
  const db = DatabaseConfig.getInstance();
  await db.connect();

  startMetricsServer(METRICS_PORT);

  const relay = new OutboxRelay(
    new OutboxRepository(),
    undefined,
    POLL_INTERVAL_MS,
    BATCH_SIZE,
    STALE_CLAIM_MS,
  );
  logger.info(
    { pollIntervalMs: POLL_INTERVAL_MS, batchSize: BATCH_SIZE, staleClaimMs: STALE_CLAIM_MS },
    "Outbox relay starting. Press Ctrl+C to exit.",
  );

  // relay.stop() only flips a flag the poll loop checks between iterations —
  // the awaited relay.start() below doesn't resolve until the current
  // iteration finishes, which is what makes this a graceful (not abrupt) stop.
  let shuttingDown = false;
  function shutdown(signal: string): void {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "shutting down gracefully");
    relay.stop();
  }
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => shutdown(signal));
  }

  await relay.start();

  try {
    await db.disconnect();
  } catch (err) {
    logger.error({ err }, "error while closing database connection");
  }
  try {
    // Flushing pending spans can itself fail (e.g. the OTLP collector is
    // unreachable) — that must not turn a clean shutdown into a crash.
    await shutdownTracing();
  } catch (err) {
    logger.error({ err }, "error while shutting down tracing");
  }
  process.exit(0);
}

bootstrap().catch((err) => {
  logger.error({ err }, "Failed to start outbox relay");
  process.exit(1);
});
