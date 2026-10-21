import { ConfirmChannel } from "amqplib";
import { EVENTS_EXCHANGE } from "../rabbitmq/constants";
import { ORDER_PLACED_DLQ, ORDER_PLACED_ROUTING_KEY } from "../consumers/order-placed.consumer";

export interface DlqReplayResult {
  replayed: number;
}

/**
 * Republishes on a confirm channel and waits for the broker's ack before
 * acking the original off the DLQ. A plain (non-confirm) channel's publish()
 * only writes to the local socket buffer — it returns before the broker has
 * necessarily received anything, so a connection drop right after it would
 * ack a message off the DLQ that never actually made it back onto the main
 * exchange, losing it for good. There's no outbox behind this path to fall
 * back on, so this is the one place in the codebase that needs a real
 * publisher confirm rather than fire-and-forget.
 */
function publishConfirmed(
  channel: ConfirmChannel,
  routingKey: string,
  content: Buffer,
): Promise<void> {
  return new Promise((resolve, reject) => {
    channel.publish(
      EVENTS_EXCHANGE,
      routingKey,
      content,
      { contentType: "application/json", persistent: true },
      (err) => (err ? reject(err) : resolve()),
    );
  });
}

/**
 * Drains every message currently sitting in the OrderPlaced dead-letter
 * queue and republishes it to the main exchange so the consumer gets
 * another shot at it. An operator runs this after fixing whatever made the
 * messages fail in the first place (a bug, a downed dependency, ...).
 */
export async function replayOrderPlacedDlq(channel: ConfirmChannel): Promise<DlqReplayResult> {
  let replayed = 0;

  for (;;) {
    const msg = await channel.get(ORDER_PLACED_DLQ, { noAck: false });
    if (!msg) {
      break;
    }

    await publishConfirmed(channel, ORDER_PLACED_ROUTING_KEY, msg.content);
    channel.ack(msg);
    replayed += 1;
  }

  return { replayed };
}
