import { Channel, ConsumeMessage } from "amqplib";
import OrderReadModelRepositoryInterface from "../../../domain/checkout/read-model/order-summary.interface";
import { EVENTS_EXCHANGE } from "../rabbitmq/constants";
import { setupDeadLetterQueue } from "../rabbitmq/dead-letter";
import { setupRetryQueue } from "../rabbitmq/retry-queue";
import RabbitMqConnection from "../rabbitmq/rabbitmq-connection";
import RabbitMqConnectionInterface from "../rabbitmq/rabbitmq-connection.interface";
import logger from "../../logging/logger";
import { startDlqDepthPolling } from "../../observability/dlq-metrics";
import {
  consumerMessagesFailedTotal,
  consumerMessagesProcessedTotal,
  consumerMessagesRetriedTotal,
  consumerProcessingDuration,
} from "../../observability/metrics";

export const ORDER_PLACED_ROUTING_KEY = "order.placed";
export const ORDER_PLACED_QUEUE = "order-summary.order-placed";
export const ORDER_PLACED_RETRY_EXCHANGE = `${EVENTS_EXCHANGE}.retry`;
export const ORDER_PLACED_RETRY_QUEUE = "order-summary.order-placed.retry";
export const ORDER_PLACED_DLX = `${EVENTS_EXCHANGE}.dlx`;
export const ORDER_PLACED_DLQ = "order-summary.order-placed.dlq";

interface XDeath {
  queue?: string;
  reason?: string;
  count?: number;
}

interface OrderPlacedIntegrationEvent {
  eventName: string;
  occurredAt: string;
  correlationId?: string | null;
  data: {
    id: string;
    customerId: string;
    total: number;
    items: { productId: string; name: string; quantity: number; unitPrice: number }[];
  };
}

/**
 * How many times the main queue has rejected this message so far — RabbitMQ
 * folds repeat (queue, reason) dead-letterings into one x-death entry with an
 * incrementing count, so this is exactly "processing attempts that failed".
 */
function attemptsSoFar(msg: ConsumeMessage): number {
  const deaths = msg.properties.headers?.["x-death"] as XDeath[] | undefined;
  const rejected = deaths?.find((d) => d.queue === ORDER_PLACED_QUEUE && d.reason === "rejected");
  return rejected?.count ?? 0;
}

/**
 * Consumes OrderPlaced integration events and projects them into the
 * order_summaries read model — the "read side" of this project's basic CQRS setup.
 */
export default class OrderPlacedConsumer {
  private resubscribing = false;
  private stopDlqDepthPolling: (() => void) | null = null;
  private stopped = false;

  constructor(
    private readonly readModelRepository: OrderReadModelRepositoryInterface,
    private readonly connection: RabbitMqConnectionInterface = RabbitMqConnection.getInstance(),
    private readonly reconnectDelayMs: number = 2000,
    private readonly dlqMetricsIntervalMs: number = 10000,
    private readonly maxAttempts: number = 3,
    private readonly retryDelayMs: number = 5000,
  ) {}

  async start(): Promise<void> {
    await this.subscribe();
  }

  /**
   * Stops the DLQ-depth poller and closes the RabbitMQ connection so no more
   * deliveries arrive. Abrupt rather than a drain of in-flight messages —
   * closing the connection while a message is mid-handleMessage() leaves it
   * unacked, which RabbitMQ simply requeues for redelivery later. That's the
   * same at-least-once behavior this consumer already relies on for a broker
   * restart, so shutdown doesn't need a separate "wait for the current
   * message" path.
   */
  stop(): void {
    this.stopped = true;
    this.stopDlqDepthPolling?.();
  }

  private async subscribe(): Promise<void> {
    const channel = await this.connection.getChannel();

    await setupDeadLetterQueue(channel, {
      dlxExchange: ORDER_PLACED_DLX,
      dlqQueue: ORDER_PLACED_DLQ,
    });

    // A message nack'd from the main queue lands here first, waits
    // retryDelayMs, then dead-letters back into the main exchange for
    // another attempt — instead of hot-looping or giving up on the first try.
    await setupRetryQueue(channel, {
      retryExchange: ORDER_PLACED_RETRY_EXCHANGE,
      retryQueue: ORDER_PLACED_RETRY_QUEUE,
      targetExchange: EVENTS_EXCHANGE,
      targetRoutingKey: ORDER_PLACED_ROUTING_KEY,
      delayMs: this.retryDelayMs,
    });

    await channel.assertQueue(ORDER_PLACED_QUEUE, {
      durable: true,
      arguments: { "x-dead-letter-exchange": ORDER_PLACED_RETRY_EXCHANGE },
    });
    await channel.bindQueue(ORDER_PLACED_QUEUE, EVENTS_EXCHANGE, ORDER_PLACED_ROUTING_KEY);

    await channel.consume(ORDER_PLACED_QUEUE, (msg) => {
      void this.handleMessage(channel, msg);
    });

    // A broker restart/network blip closes this channel; without resubscribing,
    // the consumer would keep running but silently stop projecting anything.
    channel.on("close", () => this.scheduleResubscribe());
    channel.on("error", () => this.scheduleResubscribe());

    // Re-subscribing hands us a new channel, so the old poller (still
    // pointed at a dead channel) must be stopped before starting a new one.
    this.stopDlqDepthPolling?.();
    this.stopDlqDepthPolling = startDlqDepthPolling(
      channel,
      ORDER_PLACED_DLQ,
      this.dlqMetricsIntervalMs,
    );

    logger.info(
      {
        queue: ORDER_PLACED_QUEUE,
        routingKey: ORDER_PLACED_ROUTING_KEY,
        retryQueue: ORDER_PLACED_RETRY_QUEUE,
        dlq: ORDER_PLACED_DLQ,
        maxAttempts: this.maxAttempts,
      },
      "order-placed consumer listening",
    );
  }

  private scheduleResubscribe(): void {
    if (this.stopped || this.resubscribing) {
      return;
    }
    this.resubscribing = true;

    setTimeout(() => {
      void this.attemptResubscribe();
    }, this.reconnectDelayMs);
  }

  private async attemptResubscribe(): Promise<void> {
    try {
      await this.subscribe();
      this.resubscribing = false;
    } catch (error) {
      logger.error({ err: error }, "order-placed consumer failed to resubscribe, will retry");
      this.resubscribing = false;
      this.scheduleResubscribe();
    }
  }

  async handleMessage(channel: Channel, msg: ConsumeMessage | null): Promise<void> {
    if (!msg) {
      return;
    }

    const endTimer = consumerProcessingDuration.startTimer();
    let correlationId: string | null | undefined;
    try {
      const event: OrderPlacedIntegrationEvent = JSON.parse(msg.content.toString());
      correlationId = event.correlationId;
      const log = logger.child({ correlationId: correlationId ?? undefined });

      await this.readModelRepository.upsert({
        id: event.data.id,
        customerId: event.data.customerId,
        total: event.data.total,
        itemsCount: event.data.items.length,
        placedAt: new Date(event.occurredAt),
      });

      endTimer();
      consumerMessagesProcessedTotal.inc();
      log.info({ orderId: event.data.id }, "order projected into read model");
      channel.ack(msg);
    } catch (error) {
      endTimer();
      const attempts = attemptsSoFar(msg) + 1;
      const log = logger.child({ correlationId: correlationId ?? undefined, attempts });

      if (attempts >= this.maxAttempts) {
        consumerMessagesFailedTotal.inc();
        log.error(
          { err: error },
          `giving up after ${attempts} attempts, routing directly to the dead-letter queue`,
        );
        // Relay it ourselves and ack the original — nack'ing here would just
        // send it through the retry queue for yet another doomed attempt.
        channel.sendToQueue(ORDER_PLACED_DLQ, msg.content, {
          persistent: true,
          headers: msg.properties.headers,
        });
        channel.ack(msg);
      } else {
        consumerMessagesRetriedTotal.inc();
        log.error(
          { err: error },
          `processing failed (attempt ${attempts}/${this.maxAttempts}), retrying after ${this.retryDelayMs}ms`,
        );
        channel.nack(msg, false, false);
      }
    }
  }
}
