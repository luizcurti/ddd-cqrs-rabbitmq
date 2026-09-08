import { Channel } from "amqplib";
import { dlqDepthGauge } from "./metrics";
import logger from "../logging/logger";

/**
 * Periodically refreshes the DLQ depth gauge by asking RabbitMQ how many
 * messages are sitting in the queue. A gauge should be cheap to scrape, so
 * this polls in the background instead of hitting the broker on every
 * GET /metrics request. Returns a function that stops the polling.
 */
export function startDlqDepthPolling(
  channel: Channel,
  queueName: string,
  intervalMs = 10000,
): () => void {
  const refresh = () => {
    channel
      .checkQueue(queueName)
      .then((info) => dlqDepthGauge.set(info.messageCount))
      .catch((error) => {
        logger.error({ err: error }, "failed to refresh DLQ depth metric");
      });
  };

  refresh();
  const timer = setInterval(refresh, intervalMs);
  // A background metrics refresh should never be the thing keeping the
  // process alive — unref it so it doesn't block a graceful shutdown (or,
  // in tests, leave the Jest worker hanging with nothing else running).
  timer.unref();
  return () => clearInterval(timer);
}
