import { Sequelize } from "sequelize-typescript";
import OrderReadModelRepository from "./order-read-model.repository";
import OrderSummaryModel from "./order-summary.model";

describe("OrderReadModelRepository test", () => {
  let sequelize: Sequelize;

  beforeEach(async () => {
    sequelize = new Sequelize({
      dialect: "sqlite",
      storage: ":memory:",
      logging: false,
      sync: { force: true },
    });

    await sequelize.addModels([OrderSummaryModel]);
    await sequelize.sync();
  });

  afterEach(async () => {
    await sequelize.close();
  });

  it("creates a new read model row on first upsert", async () => {
    const repository = new OrderReadModelRepository();

    await repository.upsert({
      id: "order-1",
      customerId: "customer-1",
      total: 100,
      itemsCount: 2,
      placedAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const summary = await repository.find("order-1");
    expect(summary).toEqual({
      id: "order-1",
      customerId: "customer-1",
      total: 100,
      itemsCount: 2,
      placedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
  });

  it("overwrites an existing row when the same order is projected again", async () => {
    const repository = new OrderReadModelRepository();
    const base = {
      id: "order-1",
      customerId: "customer-1",
      itemsCount: 1,
      placedAt: new Date("2026-01-01T00:00:00.000Z"),
    };

    await repository.upsert({ ...base, total: 100 });
    await repository.upsert({ ...base, total: 150, itemsCount: 2 });

    const summary = await repository.find("order-1");
    expect(summary.total).toBe(150);
    expect(summary.itemsCount).toBe(2);
    expect((await repository.findAll()).length).toBe(1);
  });

  it("throws when the order summary does not exist", async () => {
    const repository = new OrderReadModelRepository();
    await expect(repository.find("missing")).rejects.toThrow("Order summary not found");
  });
});
