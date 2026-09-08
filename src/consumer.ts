import { shutdownTracing } from "./infrastructure/observability/tracing";
import "reflect-metadata";
import dotenv from "dotenv";
import DatabaseConfig from "./infrastructure/database/database-config";
import OrderReadModelRepository from "./infrastructure/order-read-model/sequelize/order-read-model.repository";
import OrderPlacedConsumer from "./infrastructure/messaging/consumers/order-placed.consumer";
import RabbitMqConnection from "./infrastructure/messaging/rabbitmq/rabbitmq-connection";
import logger from "./infrastructure/logging/logger";
import { startMetricsServer } from "./infrastructure/observability/metrics-server";

dotenv.config();

const METRICS_PORT = parseInt(process.env.CONSUMER_METRICS_PORT || "9091");

async function bootstrap() {
  const db = DatabaseConfig.getInstance();
  await db.connect();

  startMetricsServer(METRICS_PORT);

  const consumer = new OrderPlacedConsumer(new OrderReadModelRepository());
  await consumer.start();

  logger.info("Consumer running. Press Ctrl+C to exit.");

  let shuttingDown = false;
  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "shutting down gracefully");
    consumer.stop();
    try {
      await RabbitMqConnection.getInstance().close();
    } catch (err) {
      logger.error({ err }, "error while closing RabbitMQ connection");
    }
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
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => void shutdown(signal));
  }
}

bootstrap().catch((err) => {
  logger.error({ err }, "Failed to start consumer");
  process.exit(1);
});
