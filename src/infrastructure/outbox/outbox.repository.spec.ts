import { Sequelize } from "sequelize-typescript";
import { appendOutboxMessages } from "./outbox-writer";
import OutboxMessageModel from "./outbox-message.model";
import OutboxRepository from "./outbox.repository";

describe("OutboxRepository test", () => {
  let sequelize: Sequelize;

  beforeEach(async () => {
    sequelize = new Sequelize({
      dialect: "sqlite",
      storage: ":memory:",
      logging: false,
      sync: { force: true },
    });
    await sequelize.addModels([OutboxMessageModel]);
    await sequelize.sync();
  });

  afterEach(async () => {
    await sequelize.close();
  });

  async function seed(entries: { eventName: string; routingKey: string; payload: unknown }[]) {
    await sequelize.transaction((t) => appendOutboxMessages(entries, t));
  }

  it("returns pending rows oldest-first, up to the requested limit", async () => {
    // Explicit, spaced-out timestamps — sequential inserts can otherwise land
    // in the same millisecond on an in-memory SQLite DB, making "oldest
    // first" non-deterministic if we relied on the NOW() default instead.
    for (const [id, offsetSeconds] of [
      ["1", 0],
      ["2", 1],
      ["3", 2],
    ] as const) {
      await OutboxMessageModel.create({
        id,
        event_name: "OrderPlacedEvent",
        routing_key: "order.placed",
        payload: JSON.stringify({ id }),
        status: "pending",
        attempts: 0,
        created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, offsetSeconds)),
      });
    }

    const repository = new OutboxRepository();
    const pending = await repository.findPending(2);

    expect(pending).toHaveLength(2);
    expect(pending.map((m) => m.payload.id)).toEqual(["1", "2"]);
  });

  it("counts pending rows and excludes sent ones", async () => {
    await seed([
      { eventName: "OrderPlacedEvent", routingKey: "order.placed", payload: { id: "1" } },
      { eventName: "OrderPlacedEvent", routingKey: "order.placed", payload: { id: "2" } },
    ]);
    const repository = new OutboxRepository();

    expect(await repository.countPending()).toBe(2);

    const [first] = await repository.findPending(10);
    await repository.markSent(first.id);

    expect(await repository.countPending()).toBe(1);
  });

  it("excludes rows already marked sent", async () => {
    await seed([
      { eventName: "OrderPlacedEvent", routingKey: "order.placed", payload: { id: "1" } },
    ]);
    const repository = new OutboxRepository();
    const [message] = await repository.findPending(10);

    await repository.markSent(message.id);

    expect(await repository.findPending(10)).toHaveLength(0);
    const model = await OutboxMessageModel.findByPk(message.id);
    expect(model!.status).toBe("sent");
    expect(model!.sent_at).not.toBeNull();
  });

  it("keeps a failed row pending so it gets retried, while tracking attempts and the last error", async () => {
    await seed([
      { eventName: "OrderPlacedEvent", routingKey: "order.placed", payload: { id: "1" } },
    ]);
    const repository = new OutboxRepository();
    const [message] = await repository.findPending(10);

    await repository.recordFailure(message.id, "connection refused");
    await repository.recordFailure(message.id, "connection refused again");

    const stillPending = await repository.findPending(10);
    expect(stillPending).toHaveLength(1);

    const model = await OutboxMessageModel.findByPk(message.id);
    expect(model!.attempts).toBe(2);
    expect(model!.last_error).toBe("connection refused again");
    expect(model!.status).toBe("pending");
  });

  describe("claim (the fix for multiple outbox-relay replicas racing on the same row)", () => {
    it("lets the first caller claim a pending row", async () => {
      await seed([
        { eventName: "OrderPlacedEvent", routingKey: "order.placed", payload: { id: "1" } },
      ]);
      const repository = new OutboxRepository();
      const [message] = await repository.findPending(10);

      expect(await repository.claim(message.id)).toBe(true);
      const model = await OutboxMessageModel.findByPk(message.id);
      expect(model!.status).toBe("sending");
      expect(model!.claimed_at).not.toBeNull();
    });

    it("refuses a second claim on the same row — this is what stops a duplicate publish", async () => {
      await seed([
        { eventName: "OrderPlacedEvent", routingKey: "order.placed", payload: { id: "1" } },
      ]);
      const repository = new OutboxRepository();
      const [message] = await repository.findPending(10);

      expect(await repository.claim(message.id)).toBe(true);
      expect(await repository.claim(message.id)).toBe(false); // e.g. a second relay replica
    });

    it('excludes a claimed ("sending") row from findPending/countPending', async () => {
      await seed([
        { eventName: "OrderPlacedEvent", routingKey: "order.placed", payload: { id: "1" } },
      ]);
      const repository = new OutboxRepository();
      const [message] = await repository.findPending(10);
      await repository.claim(message.id);

      expect(await repository.countPending()).toBe(0);
      expect(await repository.findPending(10)).toHaveLength(0);
    });

    it("makes a claimed row claimable again after recordFailure reverts it to pending", async () => {
      await seed([
        { eventName: "OrderPlacedEvent", routingKey: "order.placed", payload: { id: "1" } },
      ]);
      const repository = new OutboxRepository();
      const [message] = await repository.findPending(10);
      await repository.claim(message.id);

      await repository.recordFailure(message.id, "channel closed");

      expect(await repository.countPending()).toBe(1);
      expect(await repository.claim(message.id)).toBe(true);
    });
  });

  describe("reclaimStale (the fix for a relay crashing between claim() and markSent/recordFailure)", () => {
    it("puts a row claimed longer than staleMs ago back to pending", async () => {
      await seed([
        { eventName: "OrderPlacedEvent", routingKey: "order.placed", payload: { id: "1" } },
      ]);
      const repository = new OutboxRepository();
      const [message] = await repository.findPending(10);
      await repository.claim(message.id);
      await OutboxMessageModel.update(
        { claimed_at: new Date(Date.now() - 120_000) },
        { where: { id: message.id } },
      );

      const reclaimedCount = await repository.reclaimStale(60_000);

      expect(reclaimedCount).toBe(1);
      const model = await OutboxMessageModel.findByPk(message.id);
      expect(model!.status).toBe("pending");
      expect(model!.claimed_at).toBeNull();
      expect(await repository.findPending(10)).toHaveLength(1);
    });

    it("leaves a recently claimed row alone", async () => {
      await seed([
        { eventName: "OrderPlacedEvent", routingKey: "order.placed", payload: { id: "1" } },
      ]);
      const repository = new OutboxRepository();
      const [message] = await repository.findPending(10);
      await repository.claim(message.id);

      expect(await repository.reclaimStale(60_000)).toBe(0);
      const model = await OutboxMessageModel.findByPk(message.id);
      expect(model!.status).toBe("sending");
    });

    it("ignores rows that were never claimed (still pending)", async () => {
      await seed([
        { eventName: "OrderPlacedEvent", routingKey: "order.placed", payload: { id: "1" } },
      ]);
      const repository = new OutboxRepository();

      expect(await repository.reclaimStale(0)).toBe(0);
    });
  });
});
