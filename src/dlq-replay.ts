import "reflect-metadata";
import dotenv from "dotenv";
import { connect } from "amqplib";
import { EVENTS_EXCHANGE, RABBITMQ_URL } from "./infrastructure/messaging/rabbitmq/constants";
import { replayOrderPlacedDlq } from "./infrastructure/messaging/dlq/order-placed-dlq-replay";
import logger from "./infrastructure/logging/logger";

dotenv.config();

async function main() {
  // A dedicated confirm channel rather than the shared RabbitMqConnection
  // singleton used by the long-lived processes: this is a one-shot operator
  // tool, and replayOrderPlacedDlq needs publisher confirms (see its
  // docstring) to safely drain the DLQ without risking message loss.
  const connectionModel = await connect(RABBITMQ_URL);
  const channel = await connectionModel.createConfirmChannel();
  await channel.assertExchange(EVENTS_EXCHANGE, "topic", { durable: true });

  const { replayed } = await replayOrderPlacedDlq(channel);
  logger.info({ replayed }, "Replayed messages from the order-placed dead-letter queue");

  await channel.close();
  await connectionModel.close();
}

main().catch((err) => {
  logger.error({ err }, "Failed to replay the order-placed dead-letter queue");
  process.exit(1);
});
