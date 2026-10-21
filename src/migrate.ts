import "reflect-metadata";
import dotenv from "dotenv";
import DatabaseConfig from "./infrastructure/database/database-config";
import { createMigrator } from "./infrastructure/database/migrator";
import logger from "./infrastructure/logging/logger";

dotenv.config();

const command = process.argv[2] || "up";

async function main() {
  const db = DatabaseConfig.getInstance();
  await db.getSequelize().authenticate();

  const migrator = createMigrator(db.getSequelize());

  switch (command) {
    case "up": {
      const applied = await migrator.up();
      logger.info(
        { applied: applied.map((m) => m.name) },
        applied.length ? "Migrations applied." : "Already up to date, nothing to apply.",
      );
      break;
    }
    case "down": {
      const reverted = await migrator.down();
      logger.info({ reverted: reverted.map((m) => m.name) }, "Reverted the last migration.");
      break;
    }
    case "status": {
      const [executed, pending] = await Promise.all([migrator.executed(), migrator.pending()]);
      logger.info(
        { executed: executed.map((m) => m.name), pending: pending.map((m) => m.name) },
        "Migration status",
      );
      break;
    }
    default:
      logger.error({ command }, 'Unknown command — use "up", "down", or "status".');
      process.exitCode = 1;
  }

  await db.getSequelize().close();
}

main().catch((err) => {
  logger.error({ err }, "Migration command failed");
  process.exit(1);
});
