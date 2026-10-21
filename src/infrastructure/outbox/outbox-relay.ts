import { Channel } from "amqplib";
import OutboxRepositoryInterface, {
  OutboxMessageRecord,
} from "../../domain/@shared/outbox/outbox-message.interface";
import RabbitMqConnection from "../messaging/rabbitmq/rabbitmq-connection";
import RabbitMqConnectionInterface from "../messaging/rabbitmq/rabbitmq-connection.interface";
import { EVENTS_EXCHANGE } from "../messaging/rabbitmq/constants";
import logger from "../logging/logger";
import {
  outboxMessagesFailedTotal,
  outboxMessagesReclaimedTotal,
  outboxMessagesRelayedTotal,
  outboxPendingGauge,
} from "../observability/metrics";
import { withExtractedContext } from "../observability/trace-context";

const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_STALE_CLAIM_MS = 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls the outbox table and relays pending rows to the RabbitMQ topic
 * exchange. This is the piece that turns the outbox write (atomic with the
 * aggregate) into an actual integration event — without it, events would
 * just pile up in the table and never reach a consumer.
 */
export default class OutboxRelay {
  private stopped = false;

  constructor(
    private readonly outboxRepository: OutboxRepositoryInterface,
    private readonly connection: RabbitMqConnectionInterface = RabbitMqConnection.getInstance(),
    private readonly pollIntervalMs: number = 2000,
    private readonly batchSize: number = DEFAULT_BATCH_SIZE,
    // How long a row can sit "sending" before we assume the relay instance
    // that claimed it is gone and give it back to the pool. A real publish
    // is milliseconds, not minutes, so this is deliberately generous — it
    // only needs to be shorter than "an operator would otherwise notice and
    // intervene", not tuned to any expected latency.
    private readonly staleClaimMs: number = DEFAULT_STALE_CLAIM_MS,
  ) {}

  async start(): Promise<void> {
    this.stopped = false;
    while (!this.stopped) {
      try {
        await this.pollOnce();
      } catch (error) {
        // A broker outage (or any other poll failure) must not kill the
        // relay process — it should just retry on the next interval.
        logger.error({ err: error }, "outbox relay poll failed, will retry next interval");
      }
      await sleep(this.pollIntervalMs);
    }
  }

  stop(): void {
    this.stopped = true;
  }

  async pollOnce(): Promise<void> {
    // Recover rows orphaned by a relay instance that crashed between claim()
    // and markSent()/recordFailure() — otherwise they'd sit in "sending"
    // forever, invisible to findPending/countPending, and never get retried.
    const reclaimed = await this.outboxRepository.reclaimStale(this.staleClaimMs);
    if (reclaimed > 0) {
      outboxMessagesReclaimedTotal.inc(reclaimed);
      logger.warn(
        { reclaimed, staleClaimMs: this.staleClaimMs },
        "reclaimed outbox rows stuck in 'sending' — a relay instance likely crashed mid-publish",
      );
    }

    // Drain the whole backlog in batches rather than one batch per interval —
    // otherwise throughput is capped at batchSize/pollIntervalMs regardless
    // of how big the backlog gets, and a traffic burst never catches up.
    let pendingCount = await this.outboxRepository.countPending();
    outboxPendingGauge.set(pendingCount);

    while (pendingCount > 0) {
      const pending = await this.outboxRepository.findPending(this.batchSize);
      if (pending.length === 0) {
        break;
      }

      const channel = await this.connection.getChannel();
      let anySucceeded = false;
      let anyClaimedByUs = false;
      for (const message of pending) {
        const outcome = await this.relay(channel, message);
        if (outcome === "sent") anySucceeded = true;
        if (outcome !== "skipped") anyClaimedByUs = true;
      }

      if (anyClaimedByUs && !anySucceeded) {
        // We claimed rows and every one of them failed to publish —
        // retrying immediately would just spin hot against a broken publish
        // path. Back off to the next scheduled poll instead of looping
        // within this one. (If everything was "skipped" instead, another
        // relay instance is actively working the same backlog — looping
        // straight back to countPending() is fine, that's just a query.)
        break;
      }

      pendingCount = await this.outboxRepository.countPending();
      outboxPendingGauge.set(pendingCount);
    }
  }

  private async relay(
    channel: Channel,
    message: OutboxMessageRecord,
  ): Promise<"sent" | "skipped" | "failed"> {
    const log = logger.child({
      correlationId: message.correlationId ?? undefined,
      outboxId: message.id,
    });

    const claimed = await this.outboxRepository.claim(message.id);
    if (!claimed) {
      // Another relay replica claimed this row first — not our message to send.
      return "skipped";
    }

    try {
      const body = Buffer.from(
        JSON.stringify({
          eventName: message.eventName,
          occurredAt: message.createdAt,
          correlationId: message.correlationId,
          data: message.payload,
        }),
      );

      // Publishing inside the extracted context is what makes amqplib's
      // instrumentation stamp the ORIGINAL HTTP request's trace id onto this
      // message's headers, instead of starting an unrelated new trace.
      withExtractedContext(message.traceContext, () => {
        channel.publish(EVENTS_EXCHANGE, message.routingKey, body, {
          contentType: "application/json",
          persistent: true,
        });
      });

      await this.outboxRepository.markSent(message.id);
      outboxMessagesRelayedTotal.inc();
      log.info({ routingKey: message.routingKey }, "outbox message relayed to RabbitMQ");
      return "sent";
    } catch (error) {
      await this.outboxRepository.recordFailure(message.id, (error as Error).message);
      outboxMessagesFailedTotal.inc();
      log.error({ err: error }, "failed to relay outbox message, will retry next poll");
      return "failed";
    }
  }
}
