import { Sequelize } from "sequelize-typescript";
import CustomerModel from "../customer/repository/sequelize/customer.model";
import ProductModel from "../product/repository/sequelize/product.model";
import OrderModel from "../order/repository/sequelize/order.model";
import OrderItemModel from "../order/repository/sequelize/order-item.model";
import OrderSummaryModel from "../order-read-model/sequelize/order-summary.model";
import OutboxMessageModel from "../outbox/outbox-message.model";
import IdempotencyKeyModel from "../idempotency/idempotency-key.model";
import { createMigrator } from "./migrator";
import logger from "../logging/logger";

export class DatabaseConfig {
  private static instance: DatabaseConfig;
  private sequelize: Sequelize;

  private constructor() {
    this.createConnection();
  }

  public static getInstance(): DatabaseConfig {
    if (!DatabaseConfig.instance) {
      DatabaseConfig.instance = new DatabaseConfig();
    }
    return DatabaseConfig.instance;
  }

  private createConnection(): void {
    const isTest = process.env.NODE_ENV === "test";

    if (isTest) {
      // SQLite in memory for tests
      this.sequelize = new Sequelize({
        dialect: "sqlite",
        storage: ":memory:",
        logging: false,
        sync: { force: true },
      });
    } else {
      // PostgreSQL for development/production
      this.sequelize = new Sequelize({
        dialect: "postgres",
        host: process.env.DB_HOST || "localhost",
        port: parseInt(process.env.DB_PORT || "5432"),
        database: process.env.DB_NAME || "ddd_project",
        username: process.env.DB_USER || "postgres",
        password: process.env.DB_PASSWORD || "postgres",
        logging:
          process.env.NODE_ENV === "development" ? (sql: string) => logger.debug(sql) : false,
      });
    }

    // Add all models
    this.sequelize.addModels([
      CustomerModel,
      ProductModel,
      OrderModel,
      OrderItemModel,
      OrderSummaryModel,
      OutboxMessageModel,
      IdempotencyKeyModel,
    ]);
  }

  public getSequelize(): Sequelize {
    return this.sequelize;
  }

  public async connect(): Promise<void> {
    try {
      await this.sequelize.authenticate();
      logger.info("Database connection established successfully.");

      if (process.env.NODE_ENV !== "test") {
        // app runs as N replicas, and consumer/outbox-relay are separate
        // processes — all of them call connect() at startup, so without a
        // lock they'd race to run the same migration concurrently. Postgres
        // advisory locks are session-scoped: a crashed/killed process can
        // never leave this stuck, since the lock releases when its
        // connection drops.
        await this.sequelize.query("SELECT pg_advisory_lock(727272001)");
        try {
          const migrator = createMigrator(this.sequelize);
          const pending = await migrator.pending();
          await migrator.up();
          logger.info(
            { applied: pending.map((m) => m.name) },
            "Database migrations applied successfully.",
          );
        } finally {
          await this.sequelize.query("SELECT pg_advisory_unlock(727272001)");
        }
      }
    } catch (error) {
      logger.error({ err: error }, "Unable to connect to the database.");
      throw error;
    }
  }

  public async disconnect(): Promise<void> {
    try {
      await this.sequelize.close();
      logger.info("Database connection closed successfully.");
    } catch (error) {
      logger.error({ err: error }, "Error closing database connection.");
      throw error;
    }
  }

  public async truncate(): Promise<void> {
    if (process.env.NODE_ENV === "test") {
      await this.sequelize.truncate({ cascade: true, restartIdentity: true });
    }
  }
}

export default DatabaseConfig;
