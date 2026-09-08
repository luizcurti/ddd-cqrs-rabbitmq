import { Channel } from "amqplib";

export interface DeadLetterQueueOptions {
  dlxExchange: string;
  dlqQueue: string;
}

/**
 * Declares a dedicated dead-letter exchange + queue and returns the queue
 * arguments a consumer's main queue must be asserted with so RabbitMQ
 * automatically routes rejected (nack, requeue=false) messages here instead
 * of dropping them.
 */
export async function setupDeadLetterQueue(
  channel: Channel,
  { dlxExchange, dlqQueue }: DeadLetterQueueOptions,
): Promise<void> {
  await channel.assertExchange(dlxExchange, "fanout", { durable: true });
  await channel.assertQueue(dlqQueue, { durable: true });
  await channel.bindQueue(dlqQueue, dlxExchange, "");
}
