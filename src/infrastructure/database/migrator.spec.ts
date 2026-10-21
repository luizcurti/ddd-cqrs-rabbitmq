import { Sequelize } from "sequelize";
import { createMigrator } from "./migrator";

const EXPECTED_MIGRATIONS = [
  "0001-create-customers",
  "0002-create-products",
  "0003-create-orders",
  "0004-create-order-items",
  "0005-create-order-summaries",
  "0006-create-outbox-messages",
  "0007-create-idempotency-keys",
  "0008-add-outbox-claimed-at",
];

const EXPECTED_TABLES = [
  "customers",
  "products",
  "orders",
  "order_items",
  "order_summaries",
  "outbox_messages",
  "idempotency_keys",
];

describe("migrator", () => {
  let sequelize: Sequelize;

  beforeEach(() => {
    sequelize = new Sequelize({ dialect: "sqlite", storage: ":memory:", logging: false });
  });

  afterEach(async () => {
    await sequelize.close();
  });

  it("creates every table when migrating up, in order", async () => {
    const migrator = createMigrator(sequelize);

    const applied = await migrator.up();

    expect(applied.map((m) => m.name)).toEqual(EXPECTED_MIGRATIONS);
    const tables = await sequelize.getQueryInterface().showAllTables();
    for (const table of EXPECTED_TABLES) {
      expect(tables).toContain(table);
    }
  });

  it("is idempotent — running up() again applies nothing new", async () => {
    const migrator = createMigrator(sequelize);
    await migrator.up();

    const secondRun = await migrator.up();

    expect(secondRun).toEqual([]);
  });

  it("rolls back the most recently applied migration with down()", async () => {
    const migrator = createMigrator(sequelize);
    await migrator.up();

    const reverted = await migrator.down();

    expect(reverted.map((m) => m.name)).toEqual(["0008-add-outbox-claimed-at"]);
    const table = await sequelize.getQueryInterface().describeTable("outbox_messages");
    expect(table.claimed_at).toBeUndefined();
  });

  it("can roll every migration back down to a clean database, in reverse order", async () => {
    const migrator = createMigrator(sequelize);
    await migrator.up();

    let executed = await migrator.executed();
    const revertedOrder: string[] = [];
    while (executed.length > 0) {
      const [reverted] = await migrator.down();
      revertedOrder.push(reverted.name);
      executed = await migrator.executed();
    }

    expect(revertedOrder).toEqual([...EXPECTED_MIGRATIONS].reverse());
    const tables = await sequelize.getQueryInterface().showAllTables();
    for (const table of EXPECTED_TABLES) {
      expect(tables).not.toContain(table);
    }
  });

  it("reports every migration as pending before running, and none after", async () => {
    const migrator = createMigrator(sequelize);

    expect(await migrator.pending()).toHaveLength(EXPECTED_MIGRATIONS.length);

    await migrator.up();

    expect(await migrator.pending()).toHaveLength(0);
    expect(await migrator.executed()).toHaveLength(EXPECTED_MIGRATIONS.length);
  });
});
