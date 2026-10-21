import { Sequelize } from "sequelize-typescript";
import { createMigrator } from "../../infrastructure/database/migrator";
import CustomerModel from "../../infrastructure/customer/repository/sequelize/customer.model";
import ProductModel from "../../infrastructure/product/repository/sequelize/product.model";
import OrderModel from "../../infrastructure/order/repository/sequelize/order.model";
import OrderItemModel from "../../infrastructure/order/repository/sequelize/order-item.model";
import OrderSummaryModel from "../../infrastructure/order-read-model/sequelize/order-summary.model";
import OutboxMessageModel from "../../infrastructure/outbox/outbox-message.model";
import IdempotencyKeyModel from "../../infrastructure/idempotency/idempotency-key.model";

export const ALL_MODELS = [
  CustomerModel,
  ProductModel,
  OrderModel,
  OrderItemModel,
  OrderSummaryModel,
  OutboxMessageModel,
  IdempotencyKeyModel,
];

export function createE2ESequelize(): Sequelize {
  return new Sequelize({
    dialect: "postgres",
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432"),
    database: process.env.DB_NAME || "ddd_project",
    username: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "postgres",
    logging: false,
  });
}

export async function setupE2EDatabase(): Promise<Sequelize> {
  const sequelize = createE2ESequelize();
  await sequelize.addModels(ALL_MODELS);
  // Reset via the real migration path, not sequelize.sync() — sync()
  // recreates tables straight from the current model definitions, which can
  // silently drift out of sync with what Umzug's SequelizeMeta believes has
  // been applied. That drift was latent as long as every migration was a
  // CREATE TABLE (Sequelize emits `IF NOT EXISTS`, so it's forgiving of the
  // drift), but broke for real the moment a migration used addColumn
  // (not idempotent): running test:e2e then test:collection against the
  // same Postgres, in that order, made the real app's migration crash with
  // "column already exists" — sync() had already added it, unrecorded.
  await sequelize.getQueryInterface().dropAllTables();
  await createMigrator(sequelize).up();
  return sequelize;
}

export async function truncateAllTables(): Promise<void> {
  // Order matters due to FK constraints
  await OrderItemModel.destroy({ where: {}, truncate: false });
  await OrderModel.destroy({ where: {}, truncate: false });
  await OrderSummaryModel.destroy({ where: {}, truncate: false });
  await OutboxMessageModel.destroy({ where: {}, truncate: false });
  await IdempotencyKeyModel.destroy({ where: {}, truncate: false });
  await CustomerModel.destroy({ where: {}, truncate: false });
  await ProductModel.destroy({ where: {}, truncate: false });
}
