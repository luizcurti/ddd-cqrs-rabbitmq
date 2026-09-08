import { Transaction } from "sequelize";
import { v4 as uuid } from "uuid";
import { OutboxMessageInput } from "../../domain/@shared/outbox/outbox-message.interface";
import OutboxMessageModel from "./outbox-message.model";

/**
 * Appends outbox rows inside the caller's transaction. This is the whole
 * point of the outbox pattern: the aggregate write and the outbox write
 * commit or roll back together, so an event can never be raised for a
 * change that didn't actually persist (or vice versa).
 */
export async function appendOutboxMessages(
  messages: OutboxMessageInput[],
  transaction: Transaction,
): Promise<void> {
  for (const message of messages) {
    await OutboxMessageModel.create(
      {
        id: uuid(),
        event_name: message.eventName,
        routing_key: message.routingKey,
        payload: JSON.stringify(message.payload),
        correlation_id: message.correlationId ?? null,
        trace_context: message.traceContext ?? null,
        status: "pending",
        attempts: 0,
        last_error: null,
      },
      { transaction },
    );
  }
}
