import { DataTypes, QueryInterface } from "sequelize";

export async function up({ context: qi }: { context: QueryInterface }): Promise<void> {
  await qi.createTable("order_summaries", {
    id: { type: DataTypes.STRING, primaryKey: true },
    customer_id: { type: DataTypes.STRING, allowNull: false },
    total: { type: DataTypes.INTEGER, allowNull: false },
    items_count: { type: DataTypes.INTEGER, allowNull: false },
    placed_at: { type: DataTypes.DATE, allowNull: false },
  });
}

export async function down({ context: qi }: { context: QueryInterface }): Promise<void> {
  await qi.dropTable("order_summaries");
}
