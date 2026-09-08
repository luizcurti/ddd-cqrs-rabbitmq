import { Channel } from "amqplib";

export interface RetryQueueOptions {
  retryExchange: string;
  retryQueue: string;
  targetExchange: string;
  targetRoutingKey: string;
  delayMs: number;
}

/**
 * The classic no-plugin RabbitMQ delayed-retry: a queue that does nothing
 * but hold a message for `delayMs` (via a message TTL) and then dead-letter
 * it straight back into the real exchange/routing key. A consumer that
 * nacks into this queue's upstream exchange gets a delayed second attempt
 * instead of an instant, hot-looping retry.
 */
export async function setupRetryQueue(
  channel: Channel,
  { retryExchange, retryQueue, targetExchange, targetRoutingKey, delayMs }: RetryQueueOptions,
): Promise<void> {
  await channel.assertExchange(retryExchange, "fanout", { durable: true });
  await channel.assertQueue(retryQueue, {
    durable: true,
    arguments: {
      "x-message-ttl": delayMs,
      "x-dead-letter-exchange": targetExchange,
      "x-dead-letter-routing-key": targetRoutingKey,
    },
  });
  await channel.bindQueue(retryQueue, retryExchange, "");
}
