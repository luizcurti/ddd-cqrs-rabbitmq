import "reflect-metadata";
import { authedRequest } from "./setup/authenticated-request";
import { Sequelize } from "sequelize-typescript";
import app from "../api/app";
import { setupE2EDatabase, truncateAllTables } from "./setup/database.helper";
import OrderReadModelRepository from "../infrastructure/order-read-model/sequelize/order-read-model.repository";

describe("Order read model E2E — /read-models/orders", () => {
  let sequelize: Sequelize;
  const repository = new OrderReadModelRepository();

  beforeAll(async () => {
    sequelize = await setupE2EDatabase();
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    await truncateAllTables();
  });

  // ─────────────────────────────────────────────
  // GET /read-models/orders
  // ─────────────────────────────────────────────

  describe("GET /read-models/orders", () => {
    it("should return an empty array when no order has been projected yet", async () => {
      const res = await authedRequest(app).get("/read-models/orders");

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("should list order summaries projected by the OrderPlaced consumer", async () => {
      // The consumer is a separate process (see src/consumer.ts); here we write
      // directly through the read-model repository to simulate its projection,
      // matching how POST /orders -> RabbitMQ -> consumer would populate this table.
      await repository.upsert({
        id: "order-1",
        customerId: "customer-1",
        total: 100,
        itemsCount: 2,
        placedAt: new Date("2026-01-01T00:00:00.000Z"),
      });
      await repository.upsert({
        id: "order-2",
        customerId: "customer-2",
        total: 50,
        itemsCount: 1,
        placedAt: new Date("2026-01-02T00:00:00.000Z"),
      });

      const res = await authedRequest(app).get("/read-models/orders");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body.map((s: { id: string }) => s.id).sort()).toEqual(["order-1", "order-2"]);
    });
  });

  // ─────────────────────────────────────────────
  // GET /read-models/orders/:id
  // ─────────────────────────────────────────────

  describe("GET /read-models/orders/:id", () => {
    it("should return the order summary by id", async () => {
      await repository.upsert({
        id: "order-1",
        customerId: "customer-1",
        total: 100,
        itemsCount: 2,
        placedAt: new Date("2026-01-01T00:00:00.000Z"),
      });

      const res = await authedRequest(app).get("/read-models/orders/order-1");

      expect(res.status).toBe(200);
      expect(res.body.id).toBe("order-1");
      expect(res.body.customerId).toBe("customer-1");
      expect(res.body.total).toBe(100);
      expect(res.body.itemsCount).toBe(2);
    });

    it("should return 404 for a non-existing order summary", async () => {
      const res = await authedRequest(app).get("/read-models/orders/non-existing-id");

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Order summary not found");
    });
  });
});
