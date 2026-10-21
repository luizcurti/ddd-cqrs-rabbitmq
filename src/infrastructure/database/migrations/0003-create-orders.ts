import { DataTypes, QueryInterface } from "sequelize";

export async function up({ context: qi }: { context: QueryInterface }): Promise<void> {
  await qi.createTable("orders", {
    id: { type: DataTypes.STRING, primaryKey: true },
    customer_id: {
      type: DataTypes.STRING,
      allowNull: false,
      references: { model: "customers", key: "id" },
      onDelete: "NO ACTION",
      onUpdate: "CASCADE",
    },
    // INTEGER, not FLOAT/DECIMAL — matches sync()'s inference for TS `number`.
    total: { type: DataTypes.INTEGER, allowNull: false },
  });
}

export async function down({ context: qi }: { context: QueryInterface }): Promise<void> {
  await qi.dropTable("orders");
}
