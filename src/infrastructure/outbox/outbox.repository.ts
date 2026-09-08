import { literal, Op } from "sequelize";
import OutboxRepositoryInterface, {
  OutboxMessageRecord,
} from "../../domain/@shared/outbox/outbox-message.interface";
import OutboxMessageModel from "./outbox-message.model";

function toRecord(model: OutboxMessageModel): OutboxMessageRecord {
  return {
    id: model.id,
    eventName: model.event_name,
    routingKey: model.routing_key,
    payload: JSON.parse(model.payload),
    correlationId: model.correlation_id,
    traceContext: model.trace_context,
    attempts: model.attempts,
    lastError: model.last_error,
    createdAt: model.created_at,
    sentAt: model.sent_at,
  };
}

export default class OutboxRepository implements OutboxRepositoryInterface {
  async findPending(limit: number): Promise<OutboxMessageRecord[]> {
    const models = await OutboxMessageModel.findAll({
      where: { status: "pending" },
      order: [["created_at", "ASC"]],
      limit,
    });
    return models.map(toRecord);
  }

  async countPending(): Promise<number> {
    return OutboxMessageModel.count({ where: { status: "pending" } });
  }

  async claim(id: string): Promise<boolean> {
    // The WHERE clause is what makes this atomic: only the caller whose
    // UPDATE actually matches a row still in "pending" gets affectedCount
    // 1 — a second relay instance racing on the same row updates zero rows
    // and knows to back off, instead of both going on to publish it.
    const [affectedCount] = await OutboxMessageModel.update(
      { status: "sending", claimed_at: new Date() },
      { where: { id, status: "pending" } },
    );
    return affectedCount === 1;
  }

  async markSent(id: string): Promise<void> {
    await OutboxMessageModel.update({ status: "sent", sent_at: new Date() }, { where: { id } });
  }

  async recordFailure(id: string, error: string): Promise<void> {
    // Back to "pending" (not left at "sending") so the next poll retries it.
    await OutboxMessageModel.update(
      {
        status: "pending",
        attempts: literal("attempts + 1") as unknown as number,
        last_error: error,
      },
      { where: { id } },
    );
  }

  async reclaimStale(staleMs: number): Promise<number> {
    // A row can only be stuck here if the process that claimed it (set
    // status="sending") died before calling markSent()/recordFailure() —
    // both flip it away from "sending" on every normal code path. There's no
    // in-process way to distinguish "still publishing" from "crashed mid-
    // publish", so age is the only signal: claimed_at older than staleMs
    // means whatever claimed it is gone.
    const [affectedCount] = await OutboxMessageModel.update(
      { status: "pending", claimed_at: null },
      {
        where: {
          status: "sending",
          claimed_at: { [Op.lt]: new Date(Date.now() - staleMs) },
        },
      },
    );
    return affectedCount;
  }
}
